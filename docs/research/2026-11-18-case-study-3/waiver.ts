// Case study 3, the waiver (T-535): a seller holds work that fails a check, shows the failure, and both parties sign
// the settlement that names the held delivery and releases its key (site/ref/after-funding.txt, "Settling late work").
// The settlement's nonce is the hash of a SettlementNote saying what was waived (ADR-0039 section 4; D78, Rafa's
// carrier of 2026-11-18): the note's domain-free EIP-712 struct hash, signed by both parties' keys inside the
// MutualSettlement. No contract change, no new route: the operators take the caller's nonce.
//
// Crow runs both roles: a fresh seller key and a fresh buyer key, each held in memory only, test tokens from the
// faucet, on the Sepolia deployment pinned in examples/deployments.ts. The report is the seller's data: it is parsed
// as JSON inside the check library and never run.
//
//   node docs/research/2026-11-18-case-study-3/waiver.ts --report <report.json> --scope <scope.json> --price <base units> [--add-check <check.json>] --out <dir>
//
// scope.json: {"commit": "<40 hex>", "files": ["<path>", ...]}. --add-check adds one check the buyer asks for on top of
// the form, as terms.ts does. Writes <dir>/waiver.json: the deal's ID, the
// failing checks, the note and its hash, the settlement's transaction, and the times.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// Packages by path: this folder is outside the examples package, whose dependencies these are.
import { preflightDelivery } from '../../../packages/judgment/dist/index.js';
import { hashStruct, type Hex } from '../../../examples/node_modules/viem/_esm/index.js';
import { Agent } from '../../../examples/agent.ts';
import { fill } from '../../../examples/seller-adapter-core.ts';
import { commitmentIdOf, deliveryHashOf, knownPins, openOwnEnvelope, operatorFeeOf } from '../../../examples/verify.ts';

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

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const [reportFile, scopeFile, price, out, extra] = [arg('--report'), arg('--scope'), arg('--price'), arg('--out'), arg('--add-check')];
if (!reportFile || !scopeFile || !price || !/^[1-9][0-9]*$/.test(price) || !out) {
  console.error('usage: node waiver.ts --report <report.json> --scope <scope.json> --price <base units, above 0> --out <dir>');
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
const failingOf = (bytes: Uint8Array) =>
  preflightDelivery({ plaintext: bytes, mime: 'application/json', format: 'application/json', acceptance } as J).deterministic.filter((o: J) => o.required && !o.passed).map((o: J) => o.checkId as string);

const seller = new Agent(OPERATORS, random32(), crypto.getRandomValues(new Uint8Array(32)), pin.domain, pin.chain);
const buyer = new Agent(OPERATORS, random32(), crypto.getRandomValues(new Uint8Array(32)), pin.domain, pin.chain);
step('start', `seller ${seller.address}, buyer ${buyer.address}: fresh keys held in memory only; form version ${template.form?.version}`);

// The gate, again here: the seller's own check run on the report before any offer.
const failing = failingOf(report);
if (failing.length === 0) throw new Error('the report passes every check: a waiver needs work that fails one');
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

// The seller signs the delivery and holds it: nothing is posted, so no adjudicator judges it.
const { prepared: pd, intent: di } = await seller.prepareDelivery(terms, report);
const delivery = (await seller.sign(pd, di)).body;
const deliveryHash = deliveryHashOf(delivery);
step('held', `the seller signed the delivery and holds it, deliveryHash ${deliveryHash}; it shows the buyer the failing checks: ${failing.join(', ')}`);

// The buyer opens its own envelope from the handed delivery and runs the checks itself.
const ct = new Uint8Array(await (await fetch(delivery.ciphertext.uri)).arrayBuffer());
const opened = await openOwnEnvelope({ terms, delivery, recorded: { deliveryHash }, ciphertext: ct, encryptionSecretKey: buyer.encryptionSecretKey } as J);
const buyerFailing = failingOf(opened.plaintext);
if (buyerFailing.join() !== failing.join()) throw new Error(`the buyer's check run fails ${buyerFailing.join(', ')}, not ${failing.join(', ')}`);
step('opened', `the buyer opened its envelope (plaintext ${opened.plaintextSha256}) and its own check run fails the same: ${buyerFailing.join(', ')}`);

// The note both sign, as the settlement's nonce.
const note = { kind: 'waiver', deliveryHash, waivedChecks: failing, successor: `0x${'0'.repeat(64)}` as Hex, salt: random32() };
const nonce = noteHash(note);
const payouts = [{ to: terms.sellerPayoutAddress, amount: { token: terms.price.token, amount: price } }];
const prepared = await buyer.call('POST', '/v1/prepare/settlement', { commitmentId: id, nonce, payouts, releaseKey: true, delivery });
const intent = { kind: 'settlement' as const, terms, payouts, releaseKey: true, deliveryHash, nonce, delivery };
const mine = await buyer.sign(prepared, intent);
const theirs = await seller.sign(prepared, intent);
const settled = await buyer.call('POST', mine.path, { ...mine.body, sellerSignature: theirs.body.sellerSignature });
step('signed', `both signed the MutualSettlement: the whole price to the seller, the key released, nonce = the note's hash ${nonce}; ${settled.escrowState}`);
const done = await buyer.waitFor(id, ['Settled'], 5 * 60_000);
step('settled', `${done.escrowState}`);

const events = (await buyer.call('GET', `/v1/commitments/${id}/events?limit=200`)).items;
mkdirSync(out, { recursive: true });
const record = { commitmentId: id, seller: seller.address, buyer: buyer.address, price, adjudicationFee: fee.toString(), operatorFee: operatorFee.toString(), failing, deliveryHash, note, noteHash: nonce, times, events: events.map((e: J) => ({ type: e.type, at: e.at ?? e.createdAt, tx: e.payload?.tx ?? null })) };
writeFileSync(join(out, 'waiver.json'), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ commitmentId: id, outcome: done.escrowState, noteHash: nonce }));
