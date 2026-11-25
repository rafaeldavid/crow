// The buyer's command that takes a standing offer (T-551, ADR-0040 §5), bundled as site/take.mjs. Test tokens only:
// it signs only under a settlement layer pinned in verify.ts (Sepolia, or HOLDBACK_DEPLOYMENT for a local chain).
//
//   node take.mjs <card URL> <offer id> <key store directory> <the most you pay, base units>
//       reads the seller's card, checks the offer's standing entry, fills a take with fresh keys, shows the filled
//       terms on stdout and stops with exit status 3. Nothing is signed or paid. Its last line on stderr is the approve
//       command: running it is the principal's one yes.
//   node take.mjs approve <key store directory> <commitment ID> <the most you pay, base units>
//       checks the take again, posts it, waits for the primary adjudicator's acceptance, agrees and funds, posts the
//       template's standing delivery, waits for the decision, and writes the file into the key store.
//   node take.mjs resume <key store directory> [<commitment ID>]
//       after a restart: follows each funded take in the store to its outcome, and writes the file on a release.
//
// A card is a stranger's data (D74), so before it shows anything this file checks, and refuses naming what failed:
//   - the seller address follows from the key and the salt: the CREATE2 address, through the public deterministic
//     deployer, of the creation code this file pins (standing-seller-code.ts) with that key. So the code at that
//     address is HoldbackStandingSeller with that key, and nothing else (ADR-0040 §4);
//   - the template's signature is the key's, under that contract's own EIP-712 domain;
//   - the template names this chain, the pinned rules deployment and the pinned token, carries the card offer's ID,
//     and holds no field a template does not have; the take it builds is public (ADR-0040 §7) and passes the API's
//     own schema;
//   - the club, its rulebook, and the primary adjudicator's policy and registry are the ones every operator serves;
//   - a standing delivery is kept on an operator, with one envelope for each of the deal's three adjudicators.
// What the checks prove is the code and what the key signed. Who the key belongs to rests on the card's origin.
//
// It dates the take BLOCK_BACK_SEC before the operators' time: the seller contract refuses a take dated after the
// newest block, and a live chain's newest block lags the wall clock by up to a slot (T-549, known limits).
// Every message it signs is signed here, by the take's own fresh key; the operators relay. The file the seller
// delivers is untrusted data: this file writes it into the store and never prints, runs or reads it.
import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commitmentId, encodeStandingSignature, parseCommitment, parseDelivery, recoversFrom, holdbackDomain, signTerms, STANDING_DELIVERY, standingDeliveryFor, TAKE, takeTerms, templateDigest, toTimestamp, type Address, type CommitmentTerms, type Hex32, type StandingOffer, type TakeFill, type Timestamp } from '@holdback/core';
import { concat, encodeAbiParameters, getContractAddress, type Hex } from 'viem';
import { Agent } from './agent.ts';
import { FaucetLimited, loadKeys, makeKeys, openDeals, printable, type BuyerSigner, type Offer } from './buyer-signer.ts';
import { command } from './entry.ts';
import { STANDING_SELLER_CREATION_CODE } from './standing-seller-code.ts';
import { commitmentIdOf, jcs, knownPins, moneyAddressWarnings, operatorFeeOf, Refusal, type Pin } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The public deterministic deployment proxy (ADR-0040 §4), at one address on every chain that has it. */
export const DETERMINISTIC_DEPLOYER: Address = '0x4e59b44847b379578588920ca78fbf26c0b4956c';
/** How far before the operators' time a take is dated: two 12-second Sepolia slots, so the newest block is past it. */
export const BLOCK_BACK_SEC = 24;
/** The most of a card this file reads. */
export const CARD_MAX_BYTES = 1_048_576;

const HEX32 = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const DEC = /^(0|[1-9][0-9]{0,77})$/;
const isRecord = (x: unknown): x is Record<string, J> => typeof x === 'object' && x !== null && !Array.isArray(x);
const lc = (x: unknown) => String(x).toLowerCase();
const shown = (v: unknown) => printable([...jcs(v ?? null)].slice(0, 200).join(''));
const refuse = (why: string): never => {
  throw new Refusal(`refusing to sign: ${why}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sh = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);

/** The seller contract's address for `key` at `salt`: CREATE2 through the deterministic deployer, of the pinned code with the key. */
export function sellerAddressOf(key: Address, salt: Hex32): Address {
  const initCode = concat([STANDING_SELLER_CREATION_CODE, encodeAbiParameters([{ type: 'address' }], [key])]);
  return lc(getContractAddress({ opcode: 'CREATE2', from: DETERMINISTIC_DEPLOYER, salt, bytecode: initCode })) as Address;
}

/** The card in a seller's page or its agent.json: the JSON itself, or the page's `<script type="application/json" id="crow-agent">` block. */
export function cardFrom(text: string): J {
  if (/^\s*\{/.test(text)) return JSON.parse(text);
  const block = /<script\b[^>]*\bid\s*=\s*["']crow-agent["'][^>]*>([\s\S]*?)<\/script>/i.exec(text);
  if (!block) throw new Error('the page holds no crow-agent card: no <script id="crow-agent"> block, and it is not JSON');
  return JSON.parse(block[1]!);
}

/** Fetches a card: https, or http on this machine only; no redirect, since the card's origin is who the seller is. */
export async function fetchCard(url: string): Promise<{ origin: string; card: J }> {
  const u = new URL(url);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error(`the card URL must be https (or http on this machine), not ${u.protocol}`);
  if (u.username || u.password) throw new Error('the card URL must not carry a user name or password');
  const res = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`the card at ${u.origin}${u.pathname.slice(0, 120)} answered ${res.status}`);
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength > CARD_MAX_BYTES) throw new Error(`the card is ${body.byteLength} bytes, above the ${CARD_MAX_BYTES} this file reads`);
  return { origin: u.origin, card: cardFrom(new TextDecoder('utf-8', { fatal: true }).decode(body)) };
}

/** The standing entry the card names for one offer, as a take needs it (ADR-0040 §5). */
export type StandingEntry = { chainId: number; seller: Address; key: Address; salt: Hex32; template: StandingOffer; signature: Hex };

const TEMPLATE_KEYS = ['rules', 'expiresAt', 'offerId', 'terms', 'delivery'];
const TERMS_KEYS = ['schemaVersion', 'clubId', 'rulebookHash', 'sellerPayoutAddress', 'deliverable', 'acceptance', 'price', 'adjudication', 'remedy', 'timing'];
const TIMING_KEYS = ['offerExpiresAt', 'fundBy', 'deliverBy', 'judgeBy', 'fallbackBy', 'appealWindowSec', 'appealDecideSec', 'maxSubmissions', 'disputeBy', 'disputeJudgeSec', 'disputeFallbackSec'];
const DELIVERY_KEYS = ['ciphertext', 'plaintextSha256', 'plaintextMime', 'encryptedKeys', 'submittedAt'];

/** Refuses an object with a field outside `allowed`, or without one of `required`: a take would carry an unknown field unseen. */
function only(o: unknown, where: string, allowed: string[], required: string[] = allowed): Record<string, J> {
  if (!isRecord(o)) return refuse(`${where} is not an object`);
  for (const k of Object.keys(o)) if (!allowed.includes(k)) refuse(`${where}.${printable(JSON.stringify(k.slice(0, 40)))} is not a field a standing offer holds`);
  for (const k of required) if (o[k] === undefined) refuse(`${where} has no ${k}`);
  return o;
}

/**
 * The card's offer `offerId` and its standing entry, checked by shape: the entry's fields, and a template that holds
 * exactly a template's fields. Offline: the signature and the address are checkEntry's.
 */
export function entryOf(card: J, offerId: string): StandingEntry {
  if (!isRecord(card) || card['type'] !== 'crow-agent') refuse('the card is not a crow-agent card');
  if (!Array.isArray(card['offers'])) return refuse('the card lists no offers');
  const offers = (card['offers'] as J[]).filter((o) => isRecord(o) && o['id'] === offerId);
  if (offers.length !== 1) refuse(`the card lists ${offers.length} offers with the id ${shown(offerId)}, not one`);
  const s = offers[0]!['standing'];
  if (!isRecord(s)) refuse(`the card's offer ${shown(offerId)} has no standing entry: it is not a standing offer, so take it with buy.mjs`);
  const e = only(s, 'standing', ['chainId', 'seller', 'key', 'salt', 'template', 'signature']);
  if (!Number.isSafeInteger(e['chainId']) || e['chainId'] < 1) refuse('standing.chainId is not a chain ID');
  for (const k of ['seller', 'key']) if (!ADDRESS.test(lc(e[k])) || typeof e[k] !== 'string') refuse(`standing.${k} is not an address`);
  if (typeof e['salt'] !== 'string' || !HEX32.test(lc(e['salt']))) refuse('standing.salt is not 32 bytes as 0x and 64 hex characters');
  if (typeof e['signature'] !== 'string' || !/^0x([0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(e['signature'])) refuse("standing.signature is not the key's 64- or 65-byte signature");
  const t = only(e['template'], 'standing.template', TEMPLATE_KEYS, TEMPLATE_KEYS.filter((k) => k !== 'delivery'));
  const terms = only(t['terms'], 'standing.template.terms', TERMS_KEYS);
  only(terms['timing'], 'standing.template.terms.timing', TIMING_KEYS, TIMING_KEYS.slice(0, 8));
  if (t['delivery'] !== undefined) only(t['delivery'], 'standing.template.delivery', DELIVERY_KEYS);
  if (t['offerId'] !== offerId) refuse(`the template's offerId is ${shown(t['offerId'])}, not the card's offer ${shown(offerId)}`);
  return { chainId: e['chainId'], seller: lc(e['seller']) as Address, key: lc(e['key']) as Address, salt: lc(e['salt']) as Hex32, template: structuredClone(t) as StandingOffer, signature: e['signature'] as Hex };
}

/**
 * The offline checks of a standing entry under `pin`: the chain and the rules deployment, the token, the address
 * from the key and the salt, and the template's signature by the key. Refuses, naming the check.
 */
export async function checkEntry(e: StandingEntry, pin: Pin): Promise<void> {
  if (!pin.chain) refuse('take.mjs takes a standing offer on a chain: the operators serve SimChain');
  if (e.chainId !== pin.domain.chainId) refuse(`the standing offer is on chain ${e.chainId}, not the pinned chain ${pin.domain.chainId}`);
  if (lc(e.template.rules) !== lc(pin.domain.verifyingContract)) refuse(`the template names the rules deployment ${shown(e.template.rules)}, not the pinned ${pin.domain.verifyingContract}`);
  const want = sellerAddressOf(e.key, e.salt);
  if (want !== e.seller) refuse(`the seller address ${e.seller} does not follow from the key ${e.key} and the salt ${e.salt}: HoldbackStandingSeller with that key is at ${want}, so the code at ${e.seller} is not known`);
  const t = e.template.terms;
  if (lc(t.price?.token) !== lc(pin.token.id) || lc(t.adjudication?.fee?.token) !== lc(pin.token.id)) refuse(`the template's price and fee are not both in the pinned token ${pin.token.id} (${pin.token.symbol})`);
  if (!DEC.test(String(t.price?.amount)) || !DEC.test(String(t.adjudication?.fee?.amount))) refuse("the template's price or fee is not base units as a decimal string");
  let digest: Hex32;
  try {
    digest = templateDigest(e.template, e.seller, e.chainId);
  } catch (x) {
    return refuse(`the template does not encode: ${printable(String((x as Error).message).slice(0, 200))}`);
  }
  if (!(await recoversFrom(digest, e.signature, e.key))) refuse(`the template's signature is not the key ${e.key}'s under the seller contract's domain`);
}

/** The filled take: its terms, ID, and the seller contract's take blob. Checks the take is public and passes the API's schema. */
export function takeOf(e: StandingEntry, fill: TakeFill, buyerSignature: Hex = `0x${'00'.repeat(65)}`): { terms: CommitmentTerms; id: Hex32; sellerSignature: Hex; body: J } {
  const terms = takeTerms(e.template, fill, e.seller);
  if (terms.disclosure.level !== 'public') refuse(`the take's disclosure is ${shown(terms.disclosure)}, not public`);
  const id = commitmentId(terms);
  // Two encoders of the terms, core's and the one the pinned bundles sign with, must agree on the ID.
  if (lc(commitmentIdOf(terms)) !== lc(id)) refuse('the take encodes to two commitment IDs');
  const sellerSignature = encodeStandingSignature(TAKE, e.template, e.signature, fill);
  const body = { ...terms, id, signatures: { seller: sellerSignature, buyer: buyerSignature } };
  const parsed = parseCommitment(body);
  if (!parsed.ok) refuse(`the take does not pass the API's commitment schema: ${printable(parsed.error.detail.slice(0, 300))}`);
  // A standing delivery the operators would refuse after funding would leave the buyer waiting for its reclaim.
  const d = standingDeliveryFor(e.template, id);
  if (d) {
    const delivered = parseDelivery({ ...d, signature: encodeStandingSignature(STANDING_DELIVERY, e.template, e.signature, fill) });
    if (!delivered.ok) refuse(`the template's standing delivery does not pass the API's delivery schema: ${printable(delivered.error.detail.slice(0, 300))}`);
  }
  return { terms, id, sellerSignature, body };
}

/** What take.mjs keeps beside the key file, `<address>.take.json`: the card's entry and the fill, as shown. */
type TakeRecord = { version: 1; address: string; card: { url: string; origin: string; offerId: string }; entry: StandingEntry; fill: TakeFill; commitmentId: Hex32; shown: J; posted?: boolean; delivered?: boolean };

const takeFile = (store: string, address: string) => join(store, `${address}.take.json`);
function writeJson(path: string, v: unknown): void {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(v, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
function readRecord(store: string, id: string): TakeRecord {
  for (const f of readdirSync(store).filter((n) => /^0x[0-9a-f]{40}\.take\.json$/.test(n))) {
    const r = JSON.parse(readFileSync(join(store, f), 'utf8')) as TakeRecord;
    if (r.version === 1 && r.commitmentId === id) return r;
  }
  throw new Error(`no take in ${store} shows ${id}: run take.mjs with the card first`);
}
const keyFileOf = (store: string, address: string) => JSON.parse(readFileSync(join(store, `${address}.json`), 'utf8')) as J;

const operators = () => (process.env['HOLDBACK_OPERATORS'] || 'https://api.crow.direct,https://api2.crow.direct').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);

/** The agent for a key under the pinned settlement layer every operator serves, as buyer-signer.ts connects. */
async function connect(privateKey: Hex, encryptionSecretKey: string): Promise<{ agent: Agent; pin: Pin }> {
  const secret = new Uint8Array(Buffer.from(encryptionSecretKey, 'base64url'));
  const boot = new Agent(operators(), privateKey, secret);
  const found = await boot.trusted('/.well-known/holdback.json', (x) => x.domain);
  const pin = knownPins().find((p) => jcs({ ...p.domain, verifyingContract: lc(p.domain.verifyingContract) }) === jcs({ ...found, verifyingContract: lc(found?.verifyingContract) }));
  if (!pin) return refuse(`the operators serve EIP-712 domain ${shown(found)}, not one pinned here`);
  return { agent: new Agent(operators(), privateKey, secret, pin.domain, pin.chain), pin };
}

/**
 * The checks that need the operators: the template not expired by their time, the club, its rulebook and the primary's
 * policy and registry as every operator serves them, and a standing delivery kept on an operator with one envelope per
 * adjudicator. Refuses, naming the field.
 */
async function checkServed(e: StandingEntry, agent: Agent): Promise<void> {
  const t = e.template.terms;
  const now = await agent.settlementNow();
  if (!(now < Date.parse(e.template.expiresAt))) refuse(`the template expired at ${e.template.expiresAt}: the seller contract approves no take of it now`);
  const club = await agent.trusted('/.well-known/holdback.json', (x) => (typeof x.demo?.clubId === 'string' ? x.demo.clubId : null));
  if (club !== null && t.clubId !== club) refuse(`clubId is ${shown(t.clubId)}, not the demo club every operator names (${shown(club)})`);
  const { rulebookHash } = await agent.club(t.clubId);
  if (lc(t.rulebookHash) !== lc(rulebookHash)) refuse(`rulebookHash is ${shown(t.rulebookHash)}, not the hash every operator serves for club ${shown(t.clubId)}`);
  const a = t.adjudication;
  const reg = await agent.registration(a.adjudicator);
  for (const [field, got, want] of [['policyId', a.policyId, reg.policy?.id], ['policyHash', a.policyHash, reg.policyHash], ['registryHash', a.registryHash, reg.registry?.hash]] as const) {
    if (lc(got) !== lc(want)) refuse(`${field} is ${shown(got)}, not the primary adjudicator's as every operator serves it (${shown(want)})`);
  }
  const d = e.template.delivery;
  if (d) {
    const uri = String(d.ciphertext?.uri);
    let origin = '';
    try {
      origin = new URL(uri).origin;
    } catch {}
    if (!agent.sources().some((op) => new URL(op).origin === origin)) refuse(`the standing delivery's file is at ${shown(uri)}, not on an operator: this file opens only a file an operator keeps`);
    const want = [a.adjudicator, a.fallbackAdjudicator, a.appealAdjudicator].map(lc).sort();
    const got = (Array.isArray(d.encryptedKeys) ? d.encryptedKeys : []).map((k: J) => lc(k?.recipient)).sort();
    if (jcs(got) !== jcs(want)) refuse(`the standing delivery has envelopes for ${shown(got)}, not one for each of the three adjudicators ${shown(want)}`);
  }
}

/** What the principal approves: the filled terms in full, the fees, the deadlines with their distance, the delivery. */
async function offerOf(e: StandingEntry, terms: CommitmentTerms, id: Hex32, agent: Agent, pin: Pin): Promise<Offer> {
  const schedule = await agent.operatorFeeSchedule();
  const operator = schedule ? operatorFeeOf(terms.price, schedule) : 0n;
  const price = { token: terms.price.token, amount: terms.price.amount };
  const adjudication = { token: terms.adjudication.fee.token, amount: terms.adjudication.fee.amount };
  const t = terms.timing, at = (s: string) => Date.parse(s) / 1000;
  const a = terms.adjudication;
  return {
    commitmentId: id, seller: e.seller, price,
    fees: { adjudication, operator: { token: price.token, amount: operator.toString() }, total: { token: price.token, amount: (BigInt(price.amount) + BigInt(adjudication.amount) + operator).toString() } },
    deliverable: terms.deliverable, checks: terms.acceptance.deterministicChecks, rubric: terms.acceptance.rubric, deadlines: terms.timing,
    windows: { offerExpiresInSec: at(t.offerExpiresAt) - at(terms.createdAt), fundWithinSec: at(t.fundBy) - at(terms.createdAt), deliverWithinSec: at(t.deliverBy) - at(terms.createdAt), judgeWithinSec: at(t.judgeBy) - at(t.deliverBy), fallbackWithinSec: at(t.fallbackBy) - at(t.judgeBy), appealWindowSec: t.appealWindowSec, appealDecideSec: t.appealDecideSec },
    maxSubmissions: t.maxSubmissions,
    adjudicators: { primary: lc(a.adjudicator), fallback: lc(a.fallbackAdjudicator), appeal: lc(a.appealAdjudicator) },
    settlement: { mode: terms.settlement.mode }, disclosure: { level: terms.disclosure.level }, clubId: terms.clubId, rulebookHash: terms.rulebookHash,
    policyId: a.policyId, policyHash: a.policyHash, registryHash: a.registryHash,
    buyerPaymentAddress: lc(terms.buyerPaymentAddress), sellerPayoutAddress: lc(terms.sellerPayoutAddress),
    schemaVersion: terms.schemaVersion, remedy: { onReject: terms.remedy.onReject }, nonce: lc(terms.nonce) as Hex, createdAt: terms.createdAt, token: { ...pin.token },
  };
}

/** Each deadline as a date and its distance from now, for a person to read. */
function timeline(terms: CommitmentTerms, nowMs: number): Record<string, { at: string; fromNow: string }> {
  const out: Record<string, { at: string; fromNow: string }> = {};
  for (const k of ['offerExpiresAt', 'fundBy', 'deliverBy', 'judgeBy', 'fallbackBy'] as const) {
    const s = Math.round((Date.parse(terms.timing[k]) - nowMs) / 1000);
    const abs = Math.abs(s), unit = abs >= 86_400 ? `${Math.round(abs / 86_400)} d` : abs >= 3600 ? `${Math.round(abs / 3600)} h` : abs >= 60 ? `${Math.round(abs / 60)} min` : `${abs} s`;
    out[k] = { at: terms.timing[k], fromNow: s >= 0 ? `in ${unit}` : `${unit} ago` };
  }
  return out;
}

const say = (x: unknown) => console.error(printable(JSON.stringify(x)));

/** Reads the card, checks the standing entry, fills a take with fresh keys and shows it. Signs and pays nothing. */
async function show(cardUrl: string, offerId: string, store: string, budget: string): Promise<number> {
  if (printable(store) !== store) throw new Error('the key store path holds a control or invisible character: pick a path the approve line can carry');
  const { origin, card } = await fetchCard(cardUrl);
  const entry = entryOf(card, offerId);
  if (card.seller !== undefined && lc(card.seller) !== entry.seller) refuse(`the card's seller is ${shown(card.seller)}, and its standing entry names ${entry.seller}`);
  const signer = await makeKeys(store, {});
  const keys = keyFileOf(store, signer.address);
  const { agent, pin } = await connect(keys.privateKey, keys.encryptionSecretKey);
  await checkEntry(entry, pin);
  await checkServed(entry, agent);
  const now = await agent.settlementNow();
  const fill: TakeFill = { buyer: signer.address as Address, buyerPaymentAddress: signer.address as Address, buyerEncryptionPublicKey: signer.encryptionPublicKey, nonceSeed: `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}` as Hex32, createdAt: toTimestamp(Math.floor(now / 1000) * 1000 - BLOCK_BACK_SEC * 1000) as Timestamp };
  const { terms, id } = takeOf(entry, fill);
  if (!(now < Date.parse(terms.timing.offerExpiresAt))) refuse(`the take's offer expires at ${terms.timing.offerExpiresAt}, already past: the template's offer window is shorter than ${BLOCK_BACK_SEC} s`);
  const offer = await offerOf(entry, terms, id, agent, pin);
  for (const w of moneyAddressWarnings('payout', offer.sellerPayoutAddress, pin, offer.adjudicators)) console.error(w);
  const approve = [...['HOLDBACK_OPERATORS', 'HOLDBACK_DEPLOYMENT'].filter((k) => process.env[k]).map((k) => `${k}=${sh(process.env[k]!)}`), command('take', import.meta.url), 'approve', sh(store), id, budget].join(' ');
  const shownOffer = {
    approval: BigInt(offer.fees.total.amount) > BigInt(budget) ? 'over-budget' : 'needed', budget, card: origin, offerId, key: entry.key, templateExpiresAt: entry.template.expiresAt,
    delivery: entry.template.delivery ? { kind: 'standing: one fixed file for every take, posted by this command after funding', plaintextSha256: entry.template.delivery.plaintextSha256, plaintextMime: entry.template.delivery.plaintextMime, bytes: entry.template.delivery.ciphertext.bytes } : { kind: 'the seller delivers after funding, before deliverBy' },
    ...offer, timeline: timeline(terms, now), ...(BigInt(offer.fees.total.amount) > BigInt(budget) ? {} : { approve }),
  };
  writeJson(takeFile(store, signer.address), { version: 1, address: signer.address, card: { url: cardUrl, origin, offerId }, entry, fill, commitmentId: id, shown: shownOffer } satisfies TakeRecord);
  console.log(printable(JSON.stringify(shownOffer)));
  if (shownOffer.approval === 'over-budget') {
    console.error(printable(`The take costs ${offer.fees.total.amount} base units, above ${budget}: nothing is signed or paid.`));
    return 1;
  }
  console.error(printable(`Stopped before signing: nothing is signed or paid. The terms above are the seller's template filled for you, from ${origin}. Fund exactly this take before ${terms.timing.offerExpiresAt}: run`));
  console.error(printable(approve));
  return 3;
}

/** POST `path` to each operator in turn until one takes it; the last refusal if none does. */
async function relay(agent: Agent, path: string, body: J): Promise<J> {
  let last: unknown;
  for (const api of agent.sources()) {
    try {
      return await agent.call('POST', path, body, api);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/** Polls every operator until each reports one of `states`, or `until` (ms) passes. */
async function waitState(agent: Agent, id: Hex32, states: string[], until: number): Promise<string> {
  let seen: string[] = [];
  for (let pause = 400; Date.now() < until; await sleep(pause), pause = Math.min(pause * 1.5, 5000)) {
    seen = await Promise.all(agent.sources().map((api) => agent.call('GET', `/v1/commitments/${id}`, undefined, api).then((s: J) => String(s.escrowState), () => 'no answer')));
    if (seen.every((s) => states.includes(s))) return seen[0]!;
  }
  throw new Error(`${id} is ${seen.join(' / ')}, not ${states.join(' or ')}, by ${new Date(until).toISOString()}`);
}

/** The principal's yes: checks the shown take again, posts it, waits for the acceptance, funds, delivers, opens. */
async function approve(store: string, id: Hex32, budget: string): Promise<number> {
  const r = readRecord(store, id);
  const keys = keyFileOf(store, r.address);
  const { agent, pin } = await connect(keys.privateKey, keys.encryptionSecretKey);
  // Every check again, against the entry and the fill the principal was shown: the card is not read again.
  await checkEntry(r.entry, pin);
  await checkServed(r.entry, agent);
  const buyerSignature = await signTerms(keys.privateKey, holdbackDomain(pin.domain.chainId, pin.domain.verifyingContract as Address), takeTerms(r.entry.template, r.fill, r.entry.seller));
  const { terms, body } = takeOf(r.entry, r.fill, buyerSignature);
  if (commitmentId(terms) !== id) refuse(`the take rebuilds to ${commitmentId(terms)}, not the shown ${id}`);
  const offer = await offerOf(r.entry, terms, id, agent, pin);
  for (const f of ['price', 'fees', 'deliverable', 'checks', 'rubric', 'deadlines', 'adjudicators', 'sellerPayoutAddress', 'seller'] as const) {
    if (jcs(offer[f]) !== jcs(r.shown[f])) refuse(`${f} is ${shown(offer[f])}, not the shown ${shown(r.shown[f])}`);
  }
  if (BigInt(offer.fees.total.amount) > BigInt(budget)) refuse(`the take costs ${offer.fees.total.amount} base units, above ${budget}`);
  const offerEnds = Date.parse(terms.timing.offerExpiresAt);
  if (!((await agent.settlementNow()) < offerEnds)) refuse(`the take's offer expired at ${terms.timing.offerExpiresAt}: run take.mjs with the card again for a new take`);

  // The faucet's test tokens and a mandate in the demo club, for the take's own key.
  let signer: BuyerSigner = await loadKeys(store, r.address);
  if (!keys.paid) {
    try {
      await signer.testFunds(offer.fees.total.amount);
    } catch (e) {
      if (!(e instanceof FaucetLimited)) throw e;
      console.error(printable(`Stopped: the faucet refused a grant (429: ${e.detail}). It grants again ${e.retryAfterSec === null ? 'within the hour' : `in ${e.retryAfterSec} s`}. Nothing is signed or paid. Run the same approve line again before ${terms.timing.offerExpiresAt}.`));
      return 1;
    }
  }
  // Post the take, unless an operator holds it already (a run that stopped after posting).
  const held = await Promise.all(agent.sources().map((api) => agent.call('GET', `/v1/commitments/${id}`, undefined, api).then(() => true, () => false)));
  if (!held.some(Boolean)) say({ posted: id, state: (await relay(agent, '/v1/commitments', body)).escrowState });
  await waitState(agent, id, ['AcceptedByAdjudicator', 'Held', 'Delivered', 'Judging', 'FallbackJudging', 'Escalated', 'Released', 'Refunded', 'Settled'], offerEnds);
  // The buyer signer funds and follows it, unchanged: the terms and the offer as this file checked them.
  writeJson(join(store, `${r.address}.json`), { ...keyFileOf(store, r.address), commitmentId: id, checked: { terms, offer } });
  signer = await loadKeys(store, r.address);
  say({ funded: id, paid: (await signer.agreeAndFund(id)).total });
  const d = standingDeliveryFor(r.entry.template, id);
  if (d && !r.delivered) {
    const state = String((await agent.call('GET', `/v1/commitments/${id}`)).escrowState);
    if (state === 'Held') say({ delivered: id, state: (await relay(agent, `/v1/commitments/${id}/deliveries`, { ...d, signature: encodeStandingSignature(STANDING_DELIVERY, r.entry.template, r.entry.signature, r.fill) })).escrowState });
    writeJson(takeFile(store, r.address), { ...r, delivered: true });
  }
  return finish(signer, store);
}

/** Follows a funded take to its outcome (watch, reclaim past deliverBy, open), and writes the file on a release. */
async function finish(s: BuyerSigner, store: string): Promise<number> {
  const id = s.commitmentId!;
  const done = await s.openDelivery(id, { onReport: say });
  const file = done.work === null ? null : join(store, `${id}.work`);
  if (file) writeFileSync(file, done.work!, { mode: 0o600 });
  console.log(printable(JSON.stringify({ commitmentId: id, buyer: s.address, paid: s.paid?.total, outcome: done.outcome, ...(done.settlement ? { settlement: done.settlement } : {}), file, plaintextSha256: done.plaintextSha256, transactions: done.transactions })));
  return 0;
}

const USAGE = `usage:
  node take.mjs <card URL> <offer id> <key store directory> <the most you pay, base units>   show the filled take, then stop (exit 3)
  node take.mjs approve <key store directory> <commitment ID> <the most you pay, base units>   the principal's yes: post, fund, deliver, open
  node take.mjs resume <key store directory> [<commitment ID>]   follow each funded take to its outcome`;

/** The command line. Returns the exit status: 0 done, 1 refused or failed, 2 usage, 3 stopped for the principal's yes. */
export async function main(args: string[]): Promise<number> {
  const [first, a, b, c] = args;
  try {
    if (first === undefined || first === '--help' || first === '-h') {
      (first === undefined ? console.error : console.log)(USAGE);
      return first === undefined ? 2 : 0;
    }
    if (first === 'approve') {
      if (!a || !HEX32.test(lc(b)) || !DEC.test(c ?? '')) return (console.error(USAGE), 2);
      return await approve(a, lc(b) as Hex32, c!);
    }
    if (first === 'resume') {
      if (!a) return (console.error(USAGE), 2);
      const deals = b ? [await loadKeys(a, lc(b))] : await openDeals(a);
      if (deals.length === 0) console.error(printable(`No funded take in ${a} is waiting for its outcome.`));
      let failed = 0;
      for (const s of deals) await finish(s, a).catch((e) => (failed++, say({ error: String((e as Error).message ?? e) })));
      return failed ? 1 : 0;
    }
    if (!a || !b || !DEC.test(c ?? '')) return (console.error(USAGE), 2);
    return await show(first, a, b, c!);
  } catch (e) {
    console.error(printable(e instanceof Refusal ? `Stopped, ${e.message}. Nothing more is signed or paid.` : `Stopped: ${String((e as Error)?.message ?? e)}`));
    return 1;
  }
}
