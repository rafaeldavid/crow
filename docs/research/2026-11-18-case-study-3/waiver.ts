// Case study 3, the waiver (T-535), as ADR-0039 section 2 describes it, with the note of section 4.
//   1. The seller's own check lists the defects. It signs the delivery and holds it: nothing is posted, so no
//      adjudicator judges it.
//   2. The buyer sees the defects, not the content. The seller hands it the delivery's fields with the hash of each
//      envelope, never an envelope, so the buyer cannot open the work before it pays. The buyer recomputes the
//      delivery's hash from those fields.
//   3. Both sign one MutualSettlement: the held delivery, the whole price to the seller, releaseKey true, and as nonce
//      the hash of a SettlementNote naming the waived checks (D78: the note rides in the existing nonce). The buyer
//      countersigns and hands its signature back; the seller submits, with the delivery and its key proof.
//   4. Once the deal is Settled and the key released, the seller hands over the delivery and the buyer opens the work.
// No contract change and no new route: the operators take the caller's nonce (ADR-0039 section 4).
//
// Crow runs both roles: a fresh seller key and a fresh buyer key, each held in memory only, test tokens from the
// faucet, on the Sepolia deployment pinned in examples/deployments.ts. The report is the seller's data: it is parsed
// as JSON inside the check library and never run.
//
//   node docs/research/2026-11-18-case-study-3/waiver.ts --report <report.json> --scope <scope.json> --price <base units> [--add-check <check.json>] --out <dir>
//
// scope.json: {"commit": "<40 hex>", "files": ["<path>", ...]}. --add-check adds one check the buyer asks for on top of
// the form, as terms.ts does. Writes <dir>/waiver.json: the deal's ID, the failing checks, the note and its hash,
// the transactions and the times.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// Packages by path: this folder is outside the examples package, whose dependencies these are.
import { preflightDelivery } from '../../../packages/judgment/dist/index.js';
import { concat, encodeAbiParameters, hashStruct, keccak256, toBytes, type Hex } from '../../../examples/node_modules/viem/_esm/index.js';
import { Agent } from '../../../examples/agent.ts';
import { fill } from '../../../examples/seller-adapter-core.ts';
import { commitmentIdOf, deliveryHashOf, knownPins, openOwnEnvelope, operatorFeeOf, TYPES } from '../../../examples/verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const OPERATORS = ['https://api.crow.direct', 'https://api2.crow.direct'];
/** An hour to deliver; the offer open 10 minutes, funding within 15; judged within a minute if it ever were. */
const TIMING = { offerExpiresInSec: 600, fundWithinSec: 900, deliverWithinSec: 3600, judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 };
/** ADR-0039 section 4. */
export const NOTE_TYPES = { SettlementNote: [
  { name: 'kind', type: 'string' }, { name: 'deliveryHash', type: 'bytes32' }, { name: 'waivedChecks', type: 'string[]' },
  { name: 'successor', type: 'bytes32' }, { name: 'salt', type: 'bytes32' },
] } as const;
export const noteHash = (note: J): Hex => hashStruct({ types: NOTE_TYPES, primaryType: 'SettlementNote', data: note });

// ---- The delivery's hash from its fields and its envelope hashes, with no envelope (step 2) ----
// EIP-712 encodes an array of structs as the keccak of their struct hashes, one after another, so the buyer needs each
// envelope's struct hash and not the envelope. The type string is TYPES' Delivery with its referenced types, sorted.
const typeString = (name: string): string => `${name}(${(TYPES as J)[name].map((f: J) => `${f.type} ${f.name}`).join(',')})`;
const DELIVERY_TYPE = ['Delivery', 'Ciphertext', 'EncryptedKey', 'KeyUnlock'].map(typeString).join('');
const secs = (iso: string) => BigInt(Math.floor(Date.parse(iso) / 1000));
const envelopeHash = (k: J): Hex => hashStruct({ types: TYPES, primaryType: 'EncryptedKey', data: { recipient: k.recipient, scheme: k.scheme, ciphertext: k.ciphertext, unlock: k.unlock ? { kind: k.unlock.kind, round: BigInt(k.unlock.round ?? 0) } : { kind: '', round: 0n } } } as J);
/** What the seller shows the buyer: every signed field of the delivery but the envelopes, and each envelope's hash. */
const viewOf = (d: J) => {
  const { encryptedKeys, signature: _signature, ...fields } = d;
  return { ...fields, envelopes: encryptedKeys.map((k: J) => ({ recipient: k.recipient, hash: envelopeHash(k) })) };
};
const deliveryHashOfView = (v: J): Hex => {
  const ct = hashStruct({ types: TYPES, primaryType: 'Ciphertext', data: { uri: v.ciphertext.uri, sha256: v.ciphertext.sha256, bytes: BigInt(v.ciphertext.bytes), cipher: v.ciphertext.cipher } } as J);
  return keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint8' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint64' }],
    [keccak256(toBytes(DELIVERY_TYPE)), v.commitmentId, v.attempt, ct, keccak256(toBytes(v.plaintextSha256)), keccak256(toBytes(v.plaintextMime)), keccak256(concat(v.envelopes.map((e: J) => e.hash))), secs(v.submittedAt)],
  ));
};

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const [reportFile, scopeFile, price, out, extra] = [arg('--report'), arg('--scope'), arg('--price'), arg('--out'), arg('--add-check')];
if (!reportFile || !scopeFile || !price || !/^[1-9][0-9]*$/.test(price) || !out) {
  console.error('usage: node waiver.ts --report <report.json> --scope <scope.json> --price <base units, above 0> [--add-check <check.json>] --out <dir>');
  process.exit(2);
}
const pin = knownPins().find((p) => p.domain.chainId === 11155111);
if (!pin) throw new Error('examples/deployments.ts pins no Sepolia deployment');
const now = () => new Date().toISOString();
const times: Record<string, string> = {};
const step = (name: string, line: string) => { times[name] = now(); console.log(`${times[name]} ${line}`); };
const random32 = (): Hex => `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;

const report = new Uint8Array(readFileSync(reportFile));
const scope = JSON.parse(readFileSync(scopeFile, 'utf8'));
const template = JSON.parse(readFileSync(new URL('../../../examples/seller-adapter.template.json', import.meta.url), 'utf8'));
const deliverable = fill(template.deliverable, scope);
const checks = [...fill(template.checks, scope), ...(extra ? [JSON.parse(readFileSync(extra, 'utf8'))] : [])];
const acceptance = { deterministicChecks: checks, rubric: { criteria: [], passThreshold: 0 } };
const outcomesOf = (bytes: Uint8Array) => preflightDelivery({ plaintext: bytes, mime: 'application/json', format: 'application/json', acceptance } as J).deterministic;
const failingOf = (bytes: Uint8Array) => outcomesOf(bytes).filter((o: J) => o.required && !o.passed).map((o: J) => o.checkId as string);

const seller = new Agent(OPERATORS, random32(), crypto.getRandomValues(new Uint8Array(32)), pin.domain, pin.chain);
const buyer = new Agent(OPERATORS, random32(), crypto.getRandomValues(new Uint8Array(32)), pin.domain, pin.chain);
step('start', `seller ${seller.address}, buyer ${buyer.address}: fresh keys held in memory only; form version ${template.form?.version}`);

// The gate, again here: the seller's own check run on the report before any offer.
const failing = failingOf(report);
if (failing.length === 0) throw new Error('the report passes every check: a waiver needs work that fails one');
const defects = outcomesOf(report).filter((o: J) => o.required && !o.passed).map((o: J) => ({ checkId: o.checkId, detail: o.detail ?? null }));
step('checked', `the seller's check run: the report fails ${failing.join(', ')}`);

for (const a of [seller, buyer]) await a.call('POST', '/v1/faucet', { address: a.address });
const found = await seller.trusted('/.well-known/holdback.json', (x: J) => ({ clubId: x.demo?.clubId, adjudicators: x.demo?.adjudicators }));
const role = (r: string) => found.adjudicators.find((a: J) => a.role === r).address as string;
step('faucet', `both admitted to ${found.clubId}; the buyer holds test tokens`);

const { id, terms } = await seller.offer({
  template: 'checks-only', clubId: found.clubId, seller: seller.address,
  buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
  adjudicators: { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') },
  price: { token: pin.token.id, amount: price }, deliverable, checks, timing: TIMING,
});
if (commitmentIdOf(terms) !== id) throw new Error('the offered terms do not hash to the commitment ID');
step('offered', `offered ${id} at ${price} base units`);

// The primary adjudicator takes the deal before the buyer may agree (AcceptedByAdjudicator on every operator).
await buyer.waitFor(id, ['AcceptedByAdjudicator'], 2 * 60_000);
step('accepted', 'AcceptedByAdjudicator: the primary adjudicator took the deal');
const fee = BigInt(terms.adjudication.fee.amount);
const schedule = await buyer.operatorFeeSchedule();
const operatorFee = schedule ? operatorFeeOf(terms.price, schedule) : 0n;
const held = await buyer.agreeAndFund(terms, BigInt(price) + fee + operatorFee);
await buyer.waitFor(id, ['Held'], 5 * 60_000);
step('funded', `Held: ${held.hold?.amount?.amount} base units held (price ${price}, adjudication fee ${fee}), operator fee ${operatorFee}`);

// Step 1: the seller signs the delivery and holds it.
const { prepared: pd, intent: di } = await seller.prepareDelivery(terms, report);
const delivery = (await seller.sign(pd, di)).body;
const deliveryHash = deliveryHashOf(delivery);
const view = viewOf(delivery);
if (deliveryHashOfView(view) !== deliveryHash) throw new Error('the delivery hash from the fields and envelope hashes is not the delivery hash: do not offer the waiver');
step('held', `the seller signed the delivery and holds it, deliveryHash ${deliveryHash}; it offers the waiver: the failing checks ${failing.join(', ')}, the delivery's fields and ${view.envelopes.length} envelope hashes, no envelope`);

// Step 2: the buyer sees the defects, not the content.
if (view.envelopes.some((e: J) => 'ciphertext' in e)) throw new Error('the waiver offer carries an envelope');
if (String(view.commitmentId).toLowerCase() !== id.toLowerCase()) throw new Error('the waiver offer is for another deal');
const buyerHash = deliveryHashOfView(view);
if (buyerHash !== deliveryHash) throw new Error("the delivery's fields do not hash to the delivery the seller names");
if (!view.envelopes.some((e: J) => String(e.recipient).toLowerCase() === buyer.address)) throw new Error('the delivery has no envelope for the buyer');
step('shown', `the buyer recomputed deliveryHash ${buyerHash} from the fields and envelope hashes, and holds no envelope; the defects it is shown: ${defects.map((d) => d.checkId).join(', ')}; its principal says yes to waiving them`);

// Step 3: both sign one MutualSettlement with the note's hash as its nonce; the buyer countersigns, the seller submits.
const note = { kind: 'waiver', deliveryHash, waivedChecks: failing, successor: `0x${'0'.repeat(64)}` as Hex, salt: random32() };
const nonce = noteHash(note);
const payouts = [{ to: terms.sellerPayoutAddress, amount: { token: terms.price.token, amount: price } }];
const prepared = await seller.call('POST', '/v1/prepare/settlement', { commitmentId: id, nonce, payouts, releaseKey: true, delivery });
const base = { kind: 'settlement' as const, terms, payouts, releaseKey: true, deliveryHash, nonce };
// The operator's prepared settlement carries the whole delivery in its submit body, envelopes included, for the
// submitter. The seller removes it before handing the prepared settlement to the buyer: the signed MutualSettlement
// never contains the delivery, only its hash, so the buyer's signature is the same. Nothing the buyer gets may hold an
// envelope's ciphertext.
const { delivery: _carried, ...submitBody } = prepared.submit.body;
const forBuyer = { ...prepared, submit: { ...prepared.submit, body: submitBody } };
if (delivery.encryptedKeys.some((k: J) => JSON.stringify(forBuyer).includes(k.ciphertext) || JSON.stringify(view).includes(k.ciphertext))) throw new Error('what the buyer would get holds an envelope');
const countersigned = await buyer.sign(forBuyer, base); // the buyer's intent carries no delivery: it holds none
const mine = await seller.sign(prepared, { ...base, delivery });
const settled = await seller.call('POST', mine.path, { ...mine.body, buyerSignature: countersigned.body.buyerSignature });
step('signed', `the buyer countersigned and the seller submitted the MutualSettlement: the whole price to the seller, the key released, nonce = the note's hash ${nonce}; ${settled.escrowState}`);
const done = await buyer.waitFor(id, ['Settled'], 5 * 60_000);
step('settled', `${done.escrowState}`);

// Step 4: the key is released; the seller hands over the delivery and the buyer opens the work.
const ct = new Uint8Array(await (await fetch(delivery.ciphertext.uri)).arrayBuffer());
const opened = await openOwnEnvelope({ terms, delivery, recorded: { deliveryHash }, ciphertext: ct, encryptionSecretKey: buyer.encryptionSecretKey } as J);
const buyerFailing = failingOf(opened.plaintext);
step('opened', `after the settlement the buyer opened its envelope (plaintext ${opened.plaintextSha256}); its own check run fails ${buyerFailing.join(', ')}, the checks it waived`);

const events = (await buyer.call('GET', `/v1/commitments/${id}/events?limit=200`)).items;
mkdirSync(out, { recursive: true });
const record = { commitmentId: id, seller: seller.address, buyer: buyer.address, price, adjudicationFee: fee.toString(), operatorFee: operatorFee.toString(), failing, defects, deliveryHash, note, noteHash: nonce, times, events: events.map((e: J) => ({ type: e.type, at: e.at, tx: e.payload?.tx ?? null })) };
writeFileSync(join(out, 'waiver.json'), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ commitmentId: id, outcome: done.escrowState, noteHash: nonce }));
