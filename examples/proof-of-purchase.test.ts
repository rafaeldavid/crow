// The ledger row and proof of purchase (T-538) on the two real Sepolia deals the evidence check's tests use.
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeEventLog, type Abi } from 'viem';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { main } from './proof-of-purchase.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => new URL(`../fixtures/evidence/${f}`, import.meta.url);
const raw = (name: string) => gunzipSync(readFileSync(here(`${name}.json.gz`))).toString('utf8');
const RELEASED = 'released-0x341562cc';
const REFUNDED = 'refunded-0x9908966e';
const ABI = (JSON.parse(readFileSync(new URL('../packages/settlement/evm/abis.json', import.meta.url), 'utf8')) as { rules: Abi }).rules;
// The deployment these deals ran on, as in evidence.test.ts: after a redeploy it comes from HOLDBACK_DEPLOYMENT.
const dealRules = JSON.parse(raw(RELEASED)).operator.domain.verifyingContract;
const ranOn = readdirSync(new URL('../contracts/deployments/', import.meta.url)).filter((f) => f.endsWith('.json'))
  .find((f) => JSON.parse(readFileSync(new URL(`../contracts/deployments/${f}`, import.meta.url), 'utf8')).rules.toLowerCase() === dealRules)!;
const pinnedHere = ranOn === 'sepolia.json';
if (!pinnedHere) process.env['HOLDBACK_DEPLOYMENT'] = readFileSync(new URL(`../contracts/deployments/${ranOn}`, import.meta.url), 'utf8');

// Nothing may be fetched: any fetch fails the test that made it.
beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('proof-of-purchase made a network call');
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  if (!pinnedHere) delete process.env['HOLDBACK_DEPLOYMENT'];
});

const quiet = () => {
  const lines: string[] = [];
  return { lines, io: { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s) } };
};
/** Writes the fixture into a fresh directory and runs the command on it, with the deal's chain read unless `--no-receipt`. */
async function run(name: string, args: string[], text = raw(name)) {
  const dir = mkdtempSync(join(tmpdir(), 'proof-'));
  const file = join(dir, `${name}.json`);
  writeFileSync(file, text);
  const q = quiet();
  const withReceipt = args.includes('--no-receipt') ? args.filter((a) => a !== '--no-receipt') : [...args, '--receipt', here(`${name}.receipt.json`).pathname];
  const code = await main([file, ...withReceipt], q.io);
  const ledger = join(dir, `${name}.ledger.json`);
  const proof = join(dir, `${name}.proof.md`);
  return {
    code, out: q.lines.join('\n'), dir,
    row: existsSync(ledger) ? (JSON.parse(readFileSync(ledger, 'utf8')) as J) : undefined,
    page: existsSync(proof) ? readFileSync(proof, 'utf8') : undefined,
  };
}
/** The amount the chain receipt's payment event moved: PaymentReleased on a release, Refunded on a refund. */
const paidOnChain = (name: string, event: string) => {
  const receipt = JSON.parse(readFileSync(here(`${name}.receipt.json`), 'utf8')).result;
  for (const l of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: ABI, data: l.data, topics: l.topics }) as J;
      if (d.eventName === event) return (d.args.amount as bigint).toString();
    } catch { /* another contract's log */ }
  }
  throw new Error(`no ${event} in the receipt`);
};

describe('the ledger row on real deals', () => {
  it('a released deal, as the buyer: amounts equal the terms and the chain receipt, the party facts are not stated', async () => {
    const r = await run(RELEASED, ['--as', 'buyer']);
    expect(r.code, r.out).toBe(0);
    const terms = JSON.parse(raw(RELEASED)).terms;
    const row = r.row;
    expect(row.format).toBe('crow-ledger-row/1');
    expect(row.commitmentId).toBe('0x341562ccb28591a4df09a0cfbabfeffec1fff011631585e0a020a177ec192e9b');
    expect(row.outcome).toBe('released');
    expect(row.settledAt).toBe('2026-11-17T08:45:00Z');
    expect(row.price).toEqual({ base: terms.price.amount, decimal: '40.00' });
    expect(row.price.base).toBe(paidOnChain(RELEASED, 'PaymentReleased'));
    expect(row.adjudicationFee).toMatchObject({ base: '1000000', decimal: '1.00' });
    expect(row.operatorFee).toEqual({ base: '0', decimal: '0.00' });
    expect(row.paid).toEqual({ base: '41000000', decimal: '41.00' });
    expect(row.received).toEqual({ base: '0', decimal: '0.00' });
    expect(row.counterparty).toEqual({ role: 'seller', address: terms.seller, payoutAddress: terms.sellerPayoutAddress });
    expect(row.bought.description).toBe(terms.deliverable.description);
    expect(row.transactions.settlement).toMatchObject({ hash: '0xe47168fad7058cb2b164c7bceb297510cb3e2582a4ded02c6ffc88946194ae96', block: '12153293', confirmedByChainRead: true });
    expect(row.token.symbol).toBe('tUSDC');
    expect(Object.values(row.stated).every((v) => v === null)).toBe(true);
    // No float anywhere: every amount is a decimal string.
    for (const k of ['price', 'adjudicationFee', 'operatorFee', 'paid', 'received']) expect(typeof row[k].base).toBe('string');
  });
  it('a refunded deal, as the buyer: the price came back, the fee did not', async () => {
    const r = await run(REFUNDED, ['--as', 'buyer']);
    expect(r.code, r.out).toBe(0);
    expect(r.row.outcome).toBe('refunded');
    expect(r.row.paid.base).toBe('41000000');
    expect(r.row.received.base).toBe('40000000');
    expect(r.row.received.base).toBe(paidOnChain(REFUNDED, 'Refunded'));
    expect(r.page).toContain('Refunded: the price went back to the buyer');
  });
  it('as the seller: received the price on a release, nothing on a refund; the counterparty is the buyer', async () => {
    const a = await run(RELEASED, ['--as', 'seller']);
    expect(a.row.received.base).toBe(paidOnChain(RELEASED, 'PaymentReleased'));
    expect(a.row.paid.base).toBe('0');
    expect(a.row.counterparty.role).toBe('buyer');
    const b = await run(REFUNDED, ['--as', 'seller']);
    expect(b.row.received.base).toBe('0');
  });
});

describe('the proof of purchase page', () => {
  it('shows the order, the acceptance, the payment, the signers and the offline check, and says what it is not', async () => {
    const r = await run(RELEASED, ['--as', 'buyer']);
    const page = r.page!;
    expect(page).toContain('It is not an invoice and not tax or legal advice');
    expect(page).toContain('Sepolia, a test network (chain 11155111)');
    for (const h of ['## The order', '## The acceptance', '## The payment', '## Who signed what', '## Check it yourself']) expect(page).toContain(h);
    expect(page).toContain('0x4714ce862bc0ec3b11588906fd5880188a5ab115ff66d8c169a8c74f12daa27d'); // the delivery hash
    expect(page).toContain('0xbdd591ceae09b86bf307df4c2bef6b4d1f21fa4f1a8a204a3cede459a64e55ea'); // the judgment record hash
    expect(page).toContain('41.00 tUSDC (41000000 base units)');
    expect(page).toContain(`node examples/evidence.ts check ${RELEASED}.json`);
    expect(page).toContain(r.row.evidence.sha256);
    expect(page.match(/not stated/g)!.length).toBeGreaterThanOrEqual(7);
  });
  it('prints the party facts it was given, from a file and flags, and nothing it was not', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'facts-'));
    const facts = join(dir, 'facts.json');
    writeFileSync(facts, JSON.stringify({ name: 'Example Buyer Ltd', reference: 'PO-1', fiatValue: '36.80', fiatCurrency: 'EUR' }));
    const r = await run(RELEASED, ['--as', 'buyer', '--facts', facts, '--reference', 'PO-2', '--rate', '0.8975', '--rate-source', 'ECB reference rate']);
    expect(r.code, r.out).toBe(0);
    expect(r.row.stated).toEqual({ name: 'Example Buyer Ltd', counterpartyName: null, reference: 'PO-2', fiatValue: '36.80', fiatCurrency: 'EUR', rate: '0.8975', rateSource: 'ECB reference rate', rateTime: null });
    expect(r.page).toContain('| Fiat value | 36.80 EUR |');
    const noCurrency = await run(RELEASED, ['--as', 'buyer', '--fiat-value', '36.80']);
    expect(noCurrency.page).toContain('| Fiat value | 36.80, currency *not stated* |');
    expect(r.page).toContain('| Rate | 0.8975, source ECB reference rate, time *not stated* |');
  });
  it('refuses a fiat value that is not a decimal string, and an unknown fact', async () => {
    expect((await run(RELEASED, ['--as', 'buyer', '--fiat-value', '36,80'])).code).toBe(2);
    expect((await run(RELEASED, ['--as', 'buyer', '--fiat-value', '3.68e1'])).code).toBe(2);
    const dir = mkdtempSync(join(tmpdir(), 'facts-'));
    writeFileSync(join(dir, 'f.json'), JSON.stringify({ vatNumber: 'x' }));
    expect((await run(RELEASED, ['--as', 'buyer', '--facts', join(dir, 'f.json')])).code).toBe(2);
    expect((await run(RELEASED, [])).code).toBe(2); // no role
  });
  it('escapes Markdown in text it did not write, and forms no autolink', async () => {
    const r = await run(RELEASED, ['--as', 'buyer', '--name', 'A | B [x](http://e.invalid) `c` www.e.invalid']);
    expect(r.page).toContain('A \\| B \\[x\\](http\\://e.invalid) \\`c\\` www\\.e.invalid');
    // The seller's description carries a URL too.
    expect(r.page).toContain('Repository: https\\://github.com/theredguild');
  });
  it('says the settlement succeeded in its block, as the chain read shows', async () => {
    const r = await run(RELEASED, ['--as', 'buyer']);
    expect(r.page).toContain('succeeded in block 12153293, as the chain read shows');
  });
});

describe('refusals', () => {
  it('without the chain read: exit 2, the command to get it, nothing written', async () => {
    const r = await run(RELEASED, ['--as', 'buyer', '--no-receipt']);
    expect(r.code).toBe(2);
    expect(r.out).toContain('eth_getTransactionReceipt');
    expect(r.row).toBeUndefined();
    expect(r.page).toBeUndefined();
  });
  it("another transaction's chain read: exit 1", async () => {
    const r = await run(RELEASED, ['--as', 'buyer', '--no-receipt', '--receipt', here(`${REFUNDED}.receipt.json`).pathname]);
    expect(r.code).toBe(1);
    expect(r.row).toBeUndefined();
  });
  it('an operator fee, which the evidence check does not cover: exit 2, nothing written', async () => {
    const b = JSON.parse(raw(RELEASED));
    b.events.push({ ...b.events.at(-1), seq: b.events.at(-1).seq + 1, type: 'fee.operator', payload: { amount: { token: b.terms.price.token, amount: '5' } } });
    const r = await run(RELEASED, ['--as', 'buyer'], JSON.stringify(b));
    expect(r.code).toBe(2);
    expect(r.out).toContain('operator fee');
    expect(r.row).toBeUndefined();
  });
  it('one changed byte in the evidence file: exit 1 and nothing written', async () => {
    const text = raw(RELEASED);
    const i = text.indexOf('"amount": "40000000"') >= 0 ? text.indexOf('"amount": "40000000"') : text.indexOf('"amount":"40000000"');
    expect(i).toBeGreaterThan(0);
    const at = text.indexOf('4', i + 8);
    const changed = `${text.slice(0, at)}5${text.slice(at + 1)}`;
    const r = await run(RELEASED, ['--as', 'buyer'], changed);
    expect(r.code).toBe(1);
    expect(r.out).toContain('wrote nothing');
    expect(r.row).toBeUndefined();
    expect(r.page).toBeUndefined();
  });
  it('a byte changed inside a signed transaction: exit 1', async () => {
    const b = JSON.parse(raw(RELEASED));
    const [hash, tx] = Object.entries(b.transactions)[0] as [string, string];
    b.transactions[hash] = `${tx.slice(0, 100)}${tx[100] === '0' ? '1' : '0'}${tx.slice(101)}`;
    expect((await run(RELEASED, ['--as', 'buyer'], JSON.stringify(b))).code).toBe(1);
  });
});
