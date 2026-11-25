// `publish` (T-552, ADR-0040 §4, §5): a folder that sells from a template publishes a standing offer, which any buyer
// takes with site/take.mjs while no program of the seller runs. It needs no ETH, and Crow deploys nothing at this step:
// the first take deploys the seller contract (T-549).
//
//   1. The check (setup-check.ts), as first-deal runs it: a folder that fails it publishes nothing.
//   2. The seller contract's address: the CREATE2 address, through the public deterministic deployer, of the pinned
//      HoldbackStandingSeller code with the folder's signing key, at salt 0. One address for every take (ADR-0040 §7).
//   3. The template: the terms the folder's adapter would sign (verify.ts, publicOfferTerms), with the contract as the
//      seller, the dates as offsets, the expiry and the offer's ID (core's templateFrom).
//   4. A folder with finished work (work/ready.<ext>): the file sealed once, the ciphertext stored once on operator 1,
//      one envelope for each of the three adjudicators, and that standing delivery inside the template. The content
//      key is kept nowhere: the primary wraps it to each buyer on its accept.
//   5. One filled example, from a placeholder buyer, as the contract's `termsOf` builds it (core's takeTerms; on anvil,
//      setup-publish.test.ts compares it with the deployed contract's own answer).
//   6. Only on the person's yes: `publish` without --expect prints the example and the hash of the template it would sign,
//      and exits 3 having sent nothing. Run with `--expect <that hash>`, it builds the template again and signs only an
//      equal one, so terms the operators serve differently in between are never signed (red team, T-552). The key signs
//      the template's EIP-712 digest under the contract's domain. The command checks its own result:
//      the signature recovers to the key, and the example take and its standing delivery pass the API's schemas.
//   7. The mandate: the operators admit a seller by mandate, so the faucet grants one to the contract's address, as it
//      grants one to each deal key with its quote (D73). The request names the contract and the folder's one holding
//      address, which every per-deal grant already names. It lasts 30 days; `publish` run again renews it.
//   8. The card entry site/take.mjs reads (`offers[].standing`), in the card's folder, and the record in crow.json.
//
// `--preview` prints the same and exits 0. `--replace` publishes the folder's current template in place of a live
// one, and prints the old one's revocation. `--revoke` prints the signed revocation of each unexpired template of the
// offer, after the contract's deployment for a contract no take deployed yet; any account with ETH sends them, and the
// sender gains nothing. Templates are live by this machine's clock, which must agree with the operators' within 10
// minutes before anything is signed.
// Work that depends on the buyer's input (ADR-0040 §3) has no template here: the folder sells fixed work only.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seal, wrapKeyForRecipients } from '@holdback/core/crypto';
import { commitmentId, encodeStandingSignature, parseCommitment, parseDelivery, recoversFrom, STANDING_DELIVERY, STANDING_SELLER_DOMAIN, standingDeliveryFor, TAKE, takeTerms, templateDigest, templateFrom, templateHash, type Address, type CommitmentTerms, type Hex32, type StandingDeliveryBody, type StandingOffer, type TakeFill, type Timestamp } from '@holdback/core';
import { concat, encodeAbiParameters, encodeFunctionData, getContractAddress, keccak256, stringToBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { plain as plainLine } from './plain.ts';
import { acceptanceFor, loadConfig, pinnedSeller } from './seller-adapter.ts';
import { runChecks } from './setup-check.ts';
import { addressOf, CARD_FILE, FILES, holdingAddressOf, locked, pinnedReader, readKey, readState, writeState, writeWhole, type Call, type J, type StandingRecord, type State } from './setup-seller.ts';
import { readWorkFile, readyPath } from './setup-work-api.ts';
import { STANDING_SELLER_CREATION_CODE } from './standing-seller-code.ts';
import { jcs, publicOfferTerms } from './verify.ts';

const plain = (s: unknown, max = 300) => plainLine(String(s ?? '')).slice(0, max);
const lc = (s: unknown) => String(s ?? '').toLowerCase();
/** The public deterministic deployment proxy (ADR-0040 §4), as site/take.mjs pins it. */
export const DETERMINISTIC_DEPLOYER: Address = '0x4e59b44847b379578588920ca78fbf26c0b4956c';
export const ZERO_SALT: Hex32 = `0x${'00'.repeat(32)}`;
/** The most the operators' time and this machine's may differ before publish signs: 10 minutes. */
export const CLOCK_SKEW_MS = 600_000;
/** How long the faucet's mandate lasts, and so the template's default expiry: 30 days. */
export const MANDATE_DAYS = 30;
/** The placeholder buyer of the filled example: nobody's address and an all-zero encryption key. */
export const EXAMPLE_BUYER: Address = `0x${'00'.repeat(19)}01`;
const EXAMPLE_KEY = 'A'.repeat(43);
const OFFER_ID = /^[A-Za-z0-9._-]{1,80}$/;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z') as Timestamp;

/** The seller contract's address for `key` at `salt`: CREATE2 through the deterministic deployer, of the pinned code with the key. */
export function sellerAddressOf(key: Address, salt: Hex32 = ZERO_SALT): Address {
  const initCode = concat([STANDING_SELLER_CREATION_CODE, encodeAbiParameters([{ type: 'address' }], [key])]);
  return lc(getContractAddress({ opcode: 'CREATE2', from: DETERMINISTIC_DEPLOYER, salt, bytecode: initCode })) as Address;
}

/** The standing entry a card names for one offer: what site/take.mjs's entryOf reads. */
export const entryOf = (r: StandingRecord) => ({ chainId: r.chainId, seller: r.seller, key: r.key, salt: r.salt, template: r.template, signature: r.signature });

/** The folder's templates that a buyer can still take, by the operators' time: not expired and not revoked here. */
export const liveRecords = (state: State, nowMs: number): StandingRecord[] => (state.standing ?? []).filter((r) => !r.revokeSignedAt && nowMs < Date.parse(r.template.expiresAt));
/** The templates the card lists: the live ones no later `publish --replace` replaced, so each offer ID is listed once. */
export const listedRecords = (state: State, nowMs: number): StandingRecord[] => liveRecords(state, nowMs).filter((r) => !r.replacedAt);

/** The filled example: the template taken by a placeholder buyer at `createdAt`, as the contract's termsOf builds it. */
export function exampleOf(template: StandingOffer, seller: Address, createdAt: Timestamp): { fill: TakeFill; terms: CommitmentTerms; id: Hex32 } {
  const fill: TakeFill = { buyer: EXAMPLE_BUYER, buyerPaymentAddress: EXAMPLE_BUYER, buyerEncryptionPublicKey: EXAMPLE_KEY, nonceSeed: ZERO_SALT, createdAt };
  const terms = takeTerms(template, fill, seller);
  return { fill, terms, id: commitmentId(terms) };
}

/** The key's EIP-712 `Revoke(bytes32 templateHash)` under the seller contract's domain, and the call that relays it. */
export async function revocationOf(key: Hex, r: StandingRecord): Promise<{ templateHash: Hex32; to: Address; data: Hex }> {
  const th = templateHash(r.template);
  const keySignature = await privateKeyToAccount(key).signTypedData({ domain: { ...STANDING_SELLER_DOMAIN, chainId: r.chainId, verifyingContract: r.seller }, types: { Revoke: [{ name: 'templateHash', type: 'bytes32' }] }, primaryType: 'Revoke', message: { templateHash: th } });
  const data = encodeFunctionData({ abi: [{ type: 'function', name: 'revoke', stateMutability: 'nonpayable', inputs: [{ name: 'templateHash', type: 'bytes32' }, { name: 'keySignature', type: 'bytes' }], outputs: [] }], functionName: 'revoke', args: [th, keySignature] });
  return { templateHash: th, to: r.seller, data };
}

/** The deployment of the seller contract through the deterministic deployer: for a revocation before any take. */
const deployLine = (key: Address, seller: Address) => ({
  step: 'deploy', ok: true, to: DETERMINISTIC_DEPLOYER, data: concat([ZERO_SALT, STANDING_SELLER_CREATION_CODE, encodeAbiParameters([{ type: 'address' }], [key])]), seller,
  detail: `A revocation sent to ${seller} before it has code changes nothing, and its receipt still says success. Only when cast code ${seller} prints 0x, send this transaction first, alone, from any account with ETH: it deploys the contract with your key and gives its sender no power. Never send it when the address has code: a second deployment fails and burns its gas.`,
});

/** One line for a revocation: the transaction, who may send it, and what it does. */
const revokeLine = (rev: { templateHash: Hex32; to: Address; data: Hex }, r: StandingRecord) => ({
  step: 'revoke', ok: true, offerId: r.template.offerId, templateHash: rev.templateHash, chainId: r.chainId, to: rev.to, data: rev.data,
  detail: `Send this transaction from any account with ETH on chain ${r.chainId}, for example with cast send ${rev.to} ${rev.data.slice(0, 10)}...: the key signed it, so the sender gains nothing. It works once the contract has code: the first take deploys it, or the deploy line does. Until it is sent, the template can be taken until ${r.template.expiresAt}; a funded take still settles by its terms.`,
});

/** The card in the card's folder with `records` as its standing offers: other offers kept, `status` and the draft's marks dropped. */
function writeCard(state: State, records: StandingRecord[], dropped: string[] = []): string {
  const card = state.card!;
  mkdirSync(card, { recursive: true });
  let was: J = {};
  try {
    was = JSON.parse(readFileSync(join(card, CARD_FILE), 'utf8'));
  } catch {
    // no card yet, or one that is not JSON: written anew
  }
  const ids = new Set([...records.map((r) => r.template.offerId), ...dropped]);
  const kept = Array.isArray(was?.offers) ? was.offers.filter((o: J) => !ids.has(o?.id)) : [];
  const { status: _status, ...rest } = was && typeof was === 'object' && !Array.isArray(was) ? was : ({} as J); // eslint-disable-line @typescript-eslint/no-unused-vars
  const seller = records[0]?.seller ?? (state.standing ?? [])[0]?.seller;
  const offers = [...kept, ...records.map((r) => ({ id: r.template.offerId, description: plain(r.template.terms.deliverable?.description, 500), standing: entryOf(r) }))];
  const next = { ...rest, type: 'crow-agent', name: rest.name ?? state.name, ...(seller && offers.some((o: J) => o.standing) ? { seller } : {}), testTokensOnly: true, offers };
  if (!offers.some((o: J) => o.standing)) delete (next as J).seller;
  const file = join(card, CARD_FILE);
  writeWhole(file, `${JSON.stringify(next, null, 2)}\n`, 0o644);
  return file;
}

/** What `publish` sends, and to whom: printed before anything is sent, and alone by `publish --preview`. */
function previewLine(c: Call, seller: Address, holding: string, file: boolean): Record<string, unknown> {
  return {
    step: 'preview',
    sends: [
      { to: c.operators, what: 'reads only: the discovery document, the club, the adjudicators, the settlement time, and whether the seller contract holds a mandate.' },
      ...(file ? [{ to: c.operators[0], what: "the finished work, sealed: the ciphertext, once. It names no address. Its size and SHA-256 become public with the template; its content only to the deal's adjudicators and each buyer." }] : []),
      { to: c.operators[0], what: `the faucet grant: the seller contract's address ${seller} and ${holding}, the one holding address every grant of this folder names. A mandate for the contract becomes public, and a mint of one base unit on the chain.` },
    ],
    public: `The template, in the card file you publish: its terms, the payout address, the key's address and the seller contract's address ${seller}, the one address every take of it names, which links those deals to one another.`,
    onChain: 'nothing: the first take deploys the seller contract. This step needs no ETH.',
    money: 'Test tokens only: nothing here is real money.',
  };
}

/**
 * The faucet's mandate for the seller contract, then a read until every operator lists it, up to `waitMs`. Returns
 * its end in ms, or throws naming the refusal. A refusal within the window of an earlier grant is no stop while the
 * mandate still lasts.
 */
async function mandate(c: Call, reader: { trusted: J; sources(): string[] }, seller: Address, holding: string, clubId: string): Promise<number> {
  const end = async (): Promise<number> => {
    try {
      const list = await reader.trusted(`/v1/agents/${seller}`, (x: J) => x.mandates ?? []);
      const ends = (list as J[]).filter((x) => x?.clubId === clubId && Array.isArray(x?.scope?.roles) && x.scope.roles.includes('seller')).map((x) => Date.parse(x.scope.expiresAt)).filter(Number.isFinite);
      return ends.length ? Math.max(...ends) : 0;
    } catch (e) {
      if (/not_found|disagree/.test((e as Error).message)) return 0; // no operator, or not every operator, lists it yet
      throw e;
    }
  };
  const before = await end();
  const res = await fetch(`${c.operators[0]}/v1/faucet`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ address: seller, amount: '1', paymentAddress: holding }), signal: AbortSignal.timeout(120_000) });
  const answer: J = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (before > Date.now()) return before;
    throw new Error(`the faucet refused the seller contract's mandate (${res.status}: ${plain(answer?.detail ?? answer?.type, 200)})`);
  }
  for (const stop = Date.now() + (c.testWorld ? 30_000 : 90_000); ; await new Promise((r) => setTimeout(r, c.testWorld ? 300 : 3000))) {
    const now = await end();
    if (now > before || (now > Date.now() && before === 0)) return now;
    if (Date.now() > stop) throw new Error(`the faucet granted the mandate, and the operators do not both list it after ${c.testWorld ? 30 : 90} s`);
  }
}

/**
 * The marker first-deal writes (setup.ts): from here on the command sends requests that name this folder, so a standing
 * offer starts the folder's dealing as a first deal does (D73: nothing named to a Crow-run host before the marker).
 */
function marker(c: Call): void {
  const file = join(c.folder, FILES.marker);
  if (!existsSync(file)) {
    const now = Date.now();
    writeWhole(file, `${JSON.stringify({ step: 'marker', startedAt: new Date(now).toISOString(), startedAtMs: now, operators: c.operators, by: 'publish' })}\n`, 0o644);
  }
  c.note({ step: 'marker', file, detail: 'The standing offer starts: the next requests are the first that name this folder to the operators.' });
}

/** `publish`: the standing offer of a folder that sells from a template. */
export async function publish(c: Call): Promise<number> {
  const state = readState(c.folder);
  if (!state || !state.payout || !state.address) {
    c.say({ step: 'publish', ok: false, detail: `${c.folder} has no finished ${FILES.state}: run the seller command first. Nothing was sent.` });
    return 1;
  }
  if (state.sells !== 'template' || !state.work) {
    c.say({ step: 'publish', ok: false, detail: "This folder sells Crow's sample: publish makes a standing offer of a folder that sells from a template (seller --template). Nothing was sent." });
    return 1;
  }
  const offerId = c.flags.get('--offer-id') ?? state.name;
  if (!OFFER_ID.test(offerId)) throw new Error('--offer-id takes 1 to 80 letters, digits, dots, hyphens and underscores: the card\'s offer ID. Nothing was sent');
  const given = c.flags.get('--expires');
  if (given !== undefined && !(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(given) && Number.isFinite(Date.parse(given)))) throw new Error('--expires takes a UTC time in whole seconds, such as 2027-01-31T00:00:00Z. Nothing was sent');
  const modes = ['--preview', '--replace', '--revoke'].filter((f) => c.flags.has(f));
  if (modes.length > 1) throw new Error(`give one of ${modes.join(', ')}. Nothing was sent`);
  if (c.flags.has('--preview')) return run(c, state, offerId, given);
  return locked(c.folder, 0, () => run(c, state, offerId, given));
}

async function run(c: Call, state: State, offerId: string, given: string | undefined): Promise<number> {
  const preview = c.flags.has('--preview');
  const nothing = preview ? 'Nothing was sent.' : 'Nothing was signed or sent.';
  // 1. The check, first: a folder that fails it publishes nothing.
  const failed = (await runChecks(c.folder)).filter((r) => !r.ok);
  if (failed.length) {
    for (const r of failed) c.say({ step: 'check', ...r });
    c.say({ step: 'publish', ok: false, detail: `The check fails (${failed.map((r) => r.check).join(', ')}): fix it, then run check. ${nothing}` });
    return 1;
  }
  const { reader, pin } = await pinnedReader(c, nothing);
  if (!pin.chain) throw new Error(`a standing offer needs a chain, and these operators serve ${plain(pin.token.symbol, 20)} on SimChain. ${nothing}`);
  const key = readKey(c.folder);
  const keyAddress = addressOf(key) as Address;
  const seller = sellerAddressOf(keyAddress);
  const holding = holdingAddressOf(key);
  const chainId = pin.domain.chainId;
  const now = await reader.settlementNow();
  // This machine's clock bounds the template's life, not the operators' word: a template is live by local time, its
  // default expiry counts from local time, and a signature waits while the two disagree by more than CLOCK_SKEW_MS.
  const local = Date.now();
  const rules = lc(pin.domain.verifyingContract) as Address;
  const mine = (r: StandingRecord) => r.template.offerId === offerId && r.chainId === chainId && r.key === keyAddress && lc(r.template.rules) === rules;
  const live = liveRecords(state, local).filter(mine);

  // --revoke: each unexpired template's signed revocation, again when one was printed before; the card no longer
  // lists the offer. The deployment comes first, for a contract no take has deployed yet.
  if (c.flags.has('--revoke')) {
    const unexpired = (state.standing ?? []).filter((r) => mine(r) && local < Date.parse(r.template.expiresAt));
    if (unexpired.length === 0) {
      c.say({ step: 'publish', ok: false, offerId, detail: `No live template of the offer ${offerId} is in ${FILES.state}: nothing to revoke. Nothing was sent.` });
      return 1;
    }
    c.say(deployLine(keyAddress, seller));
    for (const r of unexpired) {
      c.say(revokeLine(await revocationOf(key, r), r));
      r.revokeSignedAt ??= iso(Date.now());
    }
    writeState(c.folder, state);
    const card = writeCard(state, listedRecords(state, local), [offerId]);
    c.say({ step: 'publish', ok: true, offerId, revoked: 'signed, not sent', card, detail: `The card no longer lists the offer ${offerId}: publish it again on your site. Nothing was sent.` });
    return 0;
  }

  // The terms the folder's adapter signs, with the contract as the seller: read and built here, sent nowhere.
  const { discovered } = await pinnedSeller(c.operators, key);
  const config = loadConfig(join(c.folder, FILES.configuration));
  const clubId = String(config.clubId ?? discovered.clubId);
  const adjudicators = (config.adjudicators ?? discovered.adjudicators) as { primary: string; fallback: string; appeal: string };
  const registration = await reader.registration(adjudicators.primary);
  const rulebookHash = await reader.rulebookHash(clubId);
  const createdAt = iso(Math.floor(now / 1000) * 1000);
  const built = acceptanceFor(config, JSON.parse(readFileSync(join(c.folder, FILES.template), 'utf8')), {}, undefined);
  const terms = publicOfferTerms({ template: 'checks-only', clubId, seller, buyer: { address: EXAMPLE_BUYER, encryptionPublicKey: EXAMPLE_KEY }, sellerPayoutAddress: state.payout!.address, adjudicators, price: { token: pin.token.id, amount: state.work!.price }, deliverable: built.deliverable, checks: built.acceptance.deterministicChecks, timing: config.timing }, registration, rulebookHash, createdAt, ZERO_SALT) as CommitmentTerms;
  const ready = readyPath(c.folder, state.work!.format);
  const file = existsSync(ready) ? readWorkFile(ready, false) : undefined;
  if (file && !file.bytes) throw new Error(`${ready} ${file.problem ?? 'cannot be read'}. ${nothing}`);

  // A live template, and no --replace: it is kept as it is, and only its mandate is renewed. A folder whose terms or
  // finished work changed since is told so: --replace publishes them.
  const keep = !c.flags.has('--replace') ? live.filter((r) => !r.replacedAt).at(-1) : undefined;
  const fileSha = file?.bytes ? `sha256:${createHash('sha256').update(file.bytes).digest('hex')}` : undefined;
  const drifted = keep !== undefined && (jcs({ rules, terms: templateFrom(terms, { rules, expiresAt: keep.template.expiresAt, offerId }).terms }) !== jcs({ rules: lc(keep.template.rules), terms: keep.template.terms }) || fileSha !== keep.template.delivery?.plaintextSha256);
  const driftAdvice = drifted ? { advice: `This folder's terms or finished work changed since the live template ${templateHash(keep!.template)} was signed, and it is kept as it was. Run publish --replace to sign the folder's current template.` } : {};
  const expiresAt = (given ?? iso(Math.floor(local / 1000) * 1000 + MANDATE_DAYS * 86_400_000)) as Timestamp;
  if (!keep && !(Date.parse(expiresAt) > local)) throw new Error(`--expires ${expiresAt} is not after this machine's time ${iso(local)}: no buyer could take the template. ${nothing}`);
  if (!preview && Math.abs(now - local) > CLOCK_SKEW_MS) throw new Error(`the operators' time ${iso(now)} and this machine's ${iso(local)} differ by more than ${CLOCK_SKEW_MS / 60_000} minutes: a template's dates count from them. Set this machine's clock, or name other operators. ${nothing}`);
  // What the key will sign, shown first: the approval names it by a hash, so a template that differs from the one shown
  // (another adjudicator, club, fee or policy the operators serve, or a changed folder) is never signed.
  const shownTemplate = keep?.template ?? templateFrom(terms, { rules, expiresAt, offerId });
  const shownHash = keccak256(stringToBytes(jcs({ chainId, rules, seller, key: keyAddress, offerId, expiresAt: shownTemplate.expiresAt, terms: shownTemplate.terms, file: keep ? (keep.template.delivery?.plaintextSha256 ?? null) : (fileSha ?? null) })));
  const expect = c.flags.get('--expect');
  if (preview || (!keep && expect === undefined)) {
    const approve = ['--offer-id', offerId, '--expires', shownTemplate.expiresAt, '--expect', shownHash, ...(c.flags.has('--replace') ? ['--replace'] : [])].join(' ');
    c.say({ ...previewLine(c, seller, holding, !keep && !!file), offerId, seller, key: keyAddress, expiresAt: shownTemplate.expiresAt, ...(keep ? { kept: templateHash(keep.template), ...driftAdvice } : { approve, next: `Show the person the example: every take is these terms with the buyer's own fields, binding until ${shownTemplate.expiresAt}. On their yes, run publish again with: ${approve}` }), ...(file ? { file: { path: ready, bytes: file.bytes!.length } } : { delivery: 'work done after funding: deliver delivers each take' }), example: exampleOf(shownTemplate, seller, createdAt).terms, sent: 'nothing: nothing is signed or sent before the person approves the example.' });
    return preview ? 0 : 3;
  }
  if (!keep && expect !== shownHash) throw new Error(`the template is not the one shown (--expect ${plain(expect, 80)}; it is ${shownHash} now): the operators' answers or this folder changed since. Run publish without --expect to see it again. ${nothing}`);
  let record: StandingRecord;
  if (keep) {
    record = keep;
  } else {
    // 4. Finished work: sealed once, stored once on operator 1, with one envelope for each adjudicator.
    c.say(previewLine(c, seller, holding, !!file));
    marker(c);
    let delivery: StandingDeliveryBody | undefined;
    if (file) {
      const sealed = await seal(file.bytes!);
      const stored: J = await reader.call('POST', '/v1/ciphertext', sealed.ciphertext, c.operators[0]);
      const sha = `sha256:${createHash('sha256').update(sealed.ciphertext).digest('hex')}`;
      if (stored?.id !== sha || stored?.bytes !== sealed.ciphertext.length || typeof stored?.uri !== 'string' || new URL(stored.uri).origin !== new URL(c.operators[0]!).origin) throw new Error(`operator 1 stored the ciphertext as ${plain(stored?.id, 80)} at ${plain(stored?.uri, 200)}, not ${sha} on its own origin. Nothing was signed`);
      // The file as the store serves it: take.mjs reads it there before it shows a take.
      const back = new Uint8Array(await (await fetch(stored.uri, { redirect: 'error', signal: AbortSignal.timeout(30_000) })).arrayBuffer());
      if (`sha256:${createHash('sha256').update(back).digest('hex')}` !== sha) throw new Error(`the store does not serve the ciphertext at ${plain(stored.uri, 200)}. Nothing was signed`);
      const a = terms.adjudication;
      const recipients = await Promise.all([a.adjudicator, a.fallbackAdjudicator, a.appealAdjudicator].map(async (x) => ({ recipient: x as Address, publicKey: (await reader.registration(x)).encryptionPublicKey })));
      delivery = { ciphertext: { uri: stored.uri, sha256: sha, bytes: sealed.ciphertext.length, cipher: 'aes-256-gcm' }, plaintextSha256: sealed.plaintextSha256, plaintextMime: state.work!.format, encryptedKeys: wrapKeyForRecipients(sealed.key, recipients), submittedAt: createdAt } as StandingDeliveryBody;
      c.say({ step: 'publish', ok: true, stored: stored.uri, bytes: sealed.ciphertext.length, detail: 'The finished work is stored, sealed, once: every take of this template is delivered with it.' });
    }
    const template = templateFrom(terms, { rules, expiresAt, offerId, ...(delivery ? { delivery } : {}) });

    // 6. The key signs the template; the command checks its own result before anything else is written.
    const signature = await privateKeyToAccount(key).sign({ hash: templateDigest(template, seller, chainId) });
    record = { offerId, chainId, seller, key: keyAddress, salt: ZERO_SALT, template, signature, publishedAt: iso(Date.now()) };
    const example = exampleOf(template, seller, createdAt);
    if (!(await recoversFrom(templateDigest(template, seller, chainId), signature, keyAddress))) throw new Error('the template\'s signature does not recover to the folder\'s key. Nothing was sent');
    const take = parseCommitment({ ...example.terms, id: example.id, signatures: { seller: encodeStandingSignature(TAKE, template, signature, example.fill), buyer: `0x${'00'.repeat(65)}` } });
    if (!take.ok) throw new Error(`a take of the template does not pass the API's commitment schema: ${plain(take.error.detail, 300)}. Nothing more was sent`);
    const d = standingDeliveryFor(template, example.id);
    if (d && !parseDelivery({ ...d, signature: encodeStandingSignature(STANDING_DELIVERY, template, signature, example.fill) }).ok) throw new Error("the template's standing delivery does not pass the API's delivery schema. Nothing more was sent");
    for (const old of live) old.replacedAt = record.publishedAt;
    state.standing = [...(state.standing ?? []), record];
    state.steps['publish'] ??= record.publishedAt;
    writeState(c.folder, state);
    c.say({ step: 'template', ok: true, offerId, templateHash: templateHash(template), seller, key: keyAddress, expiresAt, offsets: template.terms.timing, ...(delivery ? { delivery: { plaintextSha256: delivery.plaintextSha256, plaintextMime: delivery.plaintextMime, bytes: delivery.ciphertext.bytes } } : { delivery: 'work done after funding: deliver delivers each take' }), example: example.terms, exampleId: example.id, detail: `One take filled by a placeholder buyer at ${createdAt}, as the seller contract's termsOf builds it: every take is these terms with the buyer's own address, key and time, its dates counted from its createdAt. The key signed this template; it binds every take until ${expiresAt}.` });
    for (const old of live) c.say(revokeLine(await revocationOf(key, old), old));
  }

  // 7. The mandate, then 8. the card. The card is written before the mandate, so a refused grant leaves the published entry.
  const card = writeCard(state, listedRecords(state, local));
  if (keep) marker(c);
  let until: number;
  try {
    until = await mandate(c, reader as J, seller, holding, clubId);
  } catch (e) {
    c.say({ step: 'publish', ok: false, offerId, card, detail: `${plain((e as Error).message, 400)}. The template is signed and the card is written; until the contract holds a mandate, the operators refuse its takes. Run publish again: it keeps the template and asks the faucet again.` });
    return 1;
  }
  record.mandateUntil = iso(until);
  writeState(c.folder, state);
  const short = Date.parse(record.template.expiresAt) > until;
  c.say({
    step: 'publish', ok: true, offerId, seller, key: keyAddress, card, templateHash: templateHash(record.template), expiresAt: record.template.expiresAt, mandateUntil: iso(until), kept: keep !== undefined, ...driftAdvice,
    ...(short ? { advice: `The template lasts past the mandate's end, ${iso(until)}: the operators admit its takes only while the mandate lasts. Run publish again before then; it renews the mandate and keeps the template.` } : {}),
    detail: `Publish ${card} on your own site as agent.json, or its JSON in a <script type="application/json" id="crow-agent"> block of a page. A buyer takes the offer ${offerId} with take.mjs (https://crow.direct/ref/take.txt); the first take deploys the seller contract ${seller}. ${record.template.delivery ? 'Every take is delivered with the finished work, with nothing running here.' : 'Run deliver after each take is funded, or on its schedule: it delivers the work of each take of this contract.'}`,
  });
  return 0;
}
