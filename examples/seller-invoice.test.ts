// The seller's invoice and credit note (T-565) from deal records of SimChain deals: a Released deal, a Refunded deal, a
// settlement both parties signed with a split, and a deal with a price of 0. The records come from
// examples/deal-record.ts run against the in-process SimChain world, as the seller would write them; the command itself
// must make no network call.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import type { Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { dealRecord } from './deal-record.ts';
import { esc, explorerOf, fractionOf, main, SELLER_FORMAT } from './seller-invoice.ts';
import { freshNonce, pinOf, SIMCHAIN_DOMAIN, type Intent } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const PRICE = '25000000'; // 25.00 tUSD
const CHECKS = [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] }];
const GOOD = 'customer_id,email\n1,ada@example.com\n';
const BAD = 'name\nada\n';
/** The seller's own words in the terms, with markup a page must not run. */
const HOSTILE_DESCRIPTION = 'customers <script>alert("terms")</script> & <img src=x onerror=alert(1)>';

let world: SimWorld;
const dirs: string[] = [];
const realFetch = globalThis.fetch;
/** Set while the command runs: any fetch then fails the test. */
let offline = false;
const records: Record<'released' | 'refunded' | 'split' | 'free' | 'hostile', J> = {} as never;

const account = async () => (await (await realFetch(`${world.url}/accounts`, { method: 'POST' })).json()) as J;
async function parties() {
  const s = await account(), b = await account();
  return {
    seller: new Agent([...world.info.operators], s.privateKey, Buffer.from(s.encryptionSecretKey, 'base64url')),
    buyer: new Agent([...world.info.operators], b.privateKey, Buffer.from(b.encryptionSecretKey, 'base64url')),
  };
}
let n = 0;
async function funded(price: string, description = `customers, deal ${++n}`) {
  const { seller, buyer } = await parties();
  const a = world.info.adjudicators;
  const offer = await seller.offer({
    template: 'checks-only', clubId: world.info.clubId, seller: seller.address, buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
    adjudicators: { primary: a[0]!.address, fallback: a[1]!.address, appeal: a[2]!.address },
    price: { token: 'tUSD', amount: price }, deliverable: { kind: 'dataset', description, format: 'text/csv' }, checks: CHECKS,
    timing: { offerExpiresInSec: 60, fundWithinSec: 90, deliverWithinSec: 120 },
  });
  await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
  await buyer.agreeAndFund(offer.terms, 10n ** 12n);
  await buyer.waitFor(offer.id, ['Held']);
  return { offer, seller, buyer };
}
/**
 * Waits until every operator serves the deal as settled for good. `finalAt` alone is not enough: the settlement layer
 * derives it from the clock, so it is set the second the (zero-length) appeal window closes, while `appealState` moves
 * from `none` to `expired` only when the primary adjudicator's next pass applies the expiry. A record read in between
 * finds the two operators answering at different sides of that move, and rightly reports that they differ.
 */
const final = async (buyer: Agent, id: Hex) => {
  const done = async () => {
    for (const api of world.info.operators) {
      const s = await buyer.call('GET', `/v1/commitments/${id}`, undefined, api);
      const decided = s.escrowState === 'Released' || s.escrowState === 'Refunded';
      if (!s.finalAt || (decided && s.appealState !== 'expired')) return false;
    }
    return true;
  };
  for (let i = 0; i < 100 && !(await done()); i++) await new Promise((r) => setTimeout(r, 100));
};
async function decided(price: string, work: string, description?: string) {
  const { offer, seller, buyer } = await funded(price, description);
  const { delivery } = await seller.deliverAndShare(offer.terms, new TextEncoder().encode(work));
  await buyer.waitFor(offer.id, ['Released', 'Refunded']);
  await final(buyer, offer.id);
  return dealRecord(offer.id, { operators: [...world.info.operators], party: 'seller', delivery });
}
async function split() {
  const { offer, seller, buyer } = await funded(PRICE);
  const nonce = freshNonce();
  const p = await buyer.call('POST', '/v1/prepare/settlement', { commitmentId: offer.id, toSellerBps: 3000, releaseKey: false, nonce });
  const intent: Intent = { kind: 'settlement', terms: offer.terms, payouts: p.submit.body.payouts, releaseKey: false, deliveryHash: null, nonce };
  const mine = await buyer.sign(p, intent), theirs = await seller.sign(p, intent);
  await buyer.call('POST', mine.path, { ...mine.body, sellerSignature: theirs.body.sellerSignature });
  await buyer.waitFor(offer.id, ['Settled']);
  await final(buyer, offer.id);
  return dealRecord(offer.id, { operators: [...world.info.operators], party: 'seller' });
}

beforeAll(async () => {
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    if (offline) throw new Error('seller-invoice made a network call');
    return realFetch(input, init);
  };
  world = await startSimWorld({ env: {}, onError: () => {} });
  [records.released, records.refunded, records.split, records.free, records.hostile] = await Promise.all([decided(PRICE, GOOD), decided(PRICE, BAD), split(), decided('0', GOOD), decided(PRICE, GOOD, HOSTILE_DESCRIPTION)]);
}, 120_000);
afterAll(async () => {
  globalThis.fetch = realFetch;
  await world.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SELLER = {
  format: SELLER_FORMAT,
  name: 'Example Data GmbH',
  address: ['Musterstrasse 1', '12345 Musterstadt'],
  country: 'DE',
  taxId: 'DE123456789',
  lines: ['Registered at Amtsgericht Charlottenburg, HRB 000000'],
  tax: { treatment: 'rate', rateBps: 1900 },
  numbering: { invoice: { prefix: 'INV-2026-', next: 1 } },
};
const BUYER = { name: 'Buyer Ltd', address: ['1 High Street', 'London'], country: 'GB', taxId: 'GB123456789', reference: 'PO-77' };

/** A fresh folder with the seller file, and a runner that writes a record into it and runs the command offline. */
function folder(seller: J = SELLER) {
  const dir = mkdtempSync(join(tmpdir(), 'invoice-'));
  dirs.push(dir);
  const sellerFile = join(dir, 'seller.json');
  writeFileSync(sellerFile, `${JSON.stringify(seller, null, 2)}\n`);
  const run = async (record: J, args: string[] = [], o: { buyer?: J; name?: string } = {}) => {
    const recordFile = join(dir, `${o.name ?? 'record'}.json`);
    writeFileSync(recordFile, typeof record === 'string' ? record : JSON.stringify(record, null, 2));
    const extra: string[] = [];
    if (o.buyer !== undefined) {
      writeFileSync(join(dir, 'buyer.json'), JSON.stringify(o.buyer));
      extra.push('--buyer', join(dir, 'buyer.json'));
    }
    const lines: string[] = [];
    offline = true;
    let code: number;
    try {
      code = await main([recordFile, sellerFile, ...extra, ...args], { out: (s) => lines.push(s), err: (s) => lines.push(s) }, () => new Date('2026-11-19T12:00:00Z'));
    } finally {
      offline = false;
    }
    return { code, out: lines.join('\n') };
  };
  const doc = (number: string) => (existsSync(join(dir, `${number}.json`)) ? (JSON.parse(readFileSync(join(dir, `${number}.json`), 'utf8')) as J) : undefined);
  const html = (number: string) => readFileSync(join(dir, `${number}.html`), 'utf8');
  const sellerNow = () => JSON.parse(readFileSync(sellerFile, 'utf8')) as J;
  const documents = () => readdirSync(dir).filter((f) => /^(INV|CN)-/.test(f)).sort();
  return { dir, sellerFile, run, doc, html, sellerNow, documents };
}
const clone = (x: J): J => JSON.parse(JSON.stringify(x));

describe("seller-invoice: the seller's invoice and credit note from a deal record", () => {
  it('a Released deal: an invoice for the price, with the tax the seller states split out of it, and the deal\'s references', async () => {
    const f = folder();
    const r = await f.run(records.released, [], { buyer: BUYER });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('Issued invoice INV-2026-0001');
    const d = f.doc('INV-2026-0001');
    const t = records.released.terms.signed;
    expect(d).toMatchObject({
      format: 'crow-invoice/1', kind: 'invoice', number: 'INV-2026-0001', issueDate: '2026-11-19', supplyDate: records.released.row.settledAt.slice(0, 10), credits: null,
      seller: { name: 'Example Data GmbH', taxId: 'DE123456789', signingAddress: t.seller.toLowerCase(), payoutAddress: t.sellerPayoutAddress.toLowerCase() },
      buyer: { name: 'Buyer Ltd', taxId: 'GB123456789', reference: 'PO-77', signingAddress: t.buyer.toLowerCase(), paymentAddress: t.buyerPaymentAddress.toLowerCase() },
      deal: { commitmentId: records.released.commitmentId, outcome: 'Released', description: t.deliverable.description, price: { base: PRICE, decimal: '25.00' }, sellerShare: { base: PRICE } },
      token: { id: 'tUSD', symbol: 'tUSD', decimals: 6 },
      // 25.00 including 19 %: net 21.008403 (25000000 × 10000 / 11900, rounded half up), tax 3.991597.
      totals: { net: { base: '21008403', decimal: '21.008403' }, tax: { base: '3991597' }, total: { base: PRICE, decimal: '25.00' } },
      tax: { treatment: 'rate', rateBps: 1900 },
      payment: { to: t.sellerPayoutAddress.toLowerCase(), amount: { base: PRICE } },
      fiat: null,
    });
    expect(BigInt(d.totals.net.base) + BigInt(d.totals.tax.base)).toBe(BigInt(PRICE));
    // The rules contract is the one the record's operators served, never a constant.
    expect(d.deal.network.rulesContract).toBe(records.released.operators[0].domain.verifyingContract.toLowerCase());
    expect(d.notice).toMatch(/gives no tax or legal advice/);
    expect(d.notice).not.toMatch(/complies|compliant/i);
    const page = f.html('INV-2026-0001');
    expect(page).toContain('<title>Invoice INV-2026-0001</title>');
    expect(page).toContain(records.released.commitmentId);
    expect(page).toContain('25.00 tUSD');
    expect(page).toContain('SimChain, a local simulation');
    expect(page).toContain('gives no tax or legal advice');
    expect(page).toContain(`Paid in full through escrow on ${records.released.row.settledAt.slice(0, 10)}.`);
    expect(page).toContain('Tax at 19.00 %, as the seller states it');
    expect(d.source.checks).toMatch(/recomputed two of the record's checks/);
    expect(f.sellerNow().numbering.invoice.next).toBe(2);
    expect(f.sellerNow().issued).toEqual([expect.objectContaining({ number: 'INV-2026-0001', kind: 'invoice', commitmentId: records.released.commitmentId, issueDate: '2026-11-19' })]);
  });

  it('a Refunded deal: no document without an invoice to credit; with one, a credit note for the price that names it', async () => {
    const f = folder({ ...SELLER, numbering: { invoice: { prefix: 'INV-2026-', next: 5 }, creditNote: { prefix: 'CN-2026-', next: 1 } } });
    const none = await f.run(records.refunded);
    expect(none.code).toBe(1);
    expect(none.out).toMatch(/whole price went back to the buyer.*no invoice is due.*--credits/);
    expect(f.documents()).toEqual([]);
    expect(f.sellerNow().numbering).toEqual({ invoice: { prefix: 'INV-2026-', next: 5 }, creditNote: { prefix: 'CN-2026-', next: 1 } });

    const r = await f.run(records.refunded, ['--credits', 'INV-2026-0003', '--credits-date', '2026-11-10'], { buyer: BUYER });
    expect(r.code, r.out).toBe(0);
    const d = f.doc('CN-2026-0001');
    expect(d).toMatchObject({ kind: 'credit-note', number: 'CN-2026-0001', credits: { number: 'INV-2026-0003', issueDate: '2026-11-10' }, totals: { total: { base: PRICE } }, payment: { to: records.refunded.terms.signed.buyerPaymentAddress.toLowerCase() }, deal: { outcome: 'Refunded', sellerShare: { base: '0' } } });
    expect(f.html('CN-2026-0001')).toContain('Credits invoice</th><td>INV-2026-0003 of 2026-11-10');
    // The credit note has its own series here; the invoice series did not move.
    expect(f.sellerNow().numbering).toEqual({ invoice: { prefix: 'INV-2026-', next: 5 }, creditNote: { prefix: 'CN-2026-', next: 2 } });
  });

  it('a settlement both parties signed with a split: an invoice for the seller\'s 30 %, or a credit note for the 70 % refunded', async () => {
    const f = folder({ ...SELLER, tax: { treatment: 'reverse-charge', note: 'Customer to account for the VAT' } });
    const r = await f.run(records.split, [], { buyer: BUYER });
    expect(r.code, r.out).toBe(0);
    expect(f.doc('INV-2026-0001')).toMatchObject({ kind: 'invoice', deal: { outcome: 'Settled', price: { base: PRICE }, sellerShare: { base: '7500000' }, refunded: { base: '17500000' } }, totals: { net: { base: '7500000' }, tax: { base: '0' }, total: { base: '7500000', decimal: '7.50' } }, tax: { treatment: 'reverse-charge', note: 'Customer to account for the VAT' } });
    expect(f.html('INV-2026-0001')).toContain('Reverse charge. Customer to account for the VAT');
    // The share invoice covers only what the seller was paid: no credit note on top of it.
    const over = await f.run(records.split, ['--credits', 'INV-2026-0001', '--credits-date', '2026-11-19'], { buyer: BUYER });
    expect(over.code).toBe(1);
    expect(over.out).toMatch(/this command issued INV-2026-0001 for this deal, an invoice for only what you were paid, so the refunded part was never invoiced/);

    // A seller that invoiced the full price elsewhere credits the 70 % instead, once.
    const g = folder({ ...SELLER, tax: { treatment: 'reverse-charge', note: 'Customer to account for the VAT' } });
    const c = await g.run(records.split, ['--credits', 'OLD-0009', '--credits-date', '2026-11-01'], { buyer: BUYER });
    expect(c.code, c.out).toBe(0);
    // No credit-note series in this file: the credit note takes the next invoice number.
    expect(g.doc('INV-2026-0001')).toMatchObject({ kind: 'credit-note', totals: { total: { base: '17500000' } }, credits: { number: 'OLD-0009' } });
    const twice = await g.run(records.split, ['--credits', 'OLD-0042', '--credits-date', '2026-11-02'], { buyer: BUYER });
    expect(twice.code).toBe(1);
    expect(twice.out).toMatch(/credit note INV-2026-0001 already credits this deal's refund against invoice OLD-0009: a refund is credited once/);
    // And no share invoice after that credit: the earlier invoice already covers the share.
    const share = await g.run(records.split, [], { buyer: BUYER });
    expect(share.code).toBe(1);
    expect(share.out).toMatch(/issued credit note INV-2026-0001 for this deal, crediting the refunded part of invoice OLD-0009/);
    // A credit note naming an invoice of another deal in the register is refused.
    const h = folder();
    expect((await h.run(records.released, [], { name: 'a' })).code).toBe(0);
    const wrong = await h.run(records.refunded, ['--credits', 'INV-2026-0001', '--credits-date', '2026-11-19'], { name: 'b' });
    expect(wrong.code).toBe(1);
    expect(wrong.out).toMatch(/INV-2026-0001 in your register is an invoice for another deal/);
    expect(g.documents()).toEqual(['INV-2026-0001.html', 'INV-2026-0001.json']);
    expect(g.sellerNow().numbering.invoice.next).toBe(2);
  });

  it('reverse charge without the buyer\'s VAT number is refused by name', async () => {
    const f = folder();
    const r = await f.run(records.released, ['--tax', 'reverse-charge'], { buyer: { name: 'Buyer Ltd' } });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/reverse-charge document only with both parties' VAT numbers, and the buyer file gives none for the buyer \(taxId\)/);
    // The seller's own VAT number too (EU Article 226(3) and (4); Germany §14a UStG; Peppol rule BR-AE-02).
    const g = folder({ ...SELLER, taxId: undefined });
    const s = await g.run(records.released, ['--tax', 'reverse-charge'], { buyer: BUYER });
    expect(s.code).toBe(1);
    expect(s.out).toMatch(/only with both parties' VAT numbers, and the seller file gives none for you \(taxId\)/);
    expect(f.documents()).toEqual([]);
    expect(g.documents()).toEqual([]);
  });

  it('a deal with a price of 0: no seller\'s invoice, since the seller was paid nothing; the fee is the adjudicator\'s', async () => {
    const f = folder();
    const r = await f.run(records.free);
    expect(records.free.row.outcome).toBe('Released');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/price is 0.*no seller's invoice or credit note is due.*adjudicator's to invoice/);
    // With an invoice to credit, the same: nothing was paid or refunded.
    expect((await f.run(records.free, ['--credits', 'INV-1', '--credits-date', '2026-11-01'])).out).toMatch(/price is 0/);
    expect(f.documents()).toEqual([]);
    expect(f.sellerNow().numbering.invoice.next).toBe(1);
  });

  it('refuses a tampered record by the check it fails, and writes nothing', async () => {
    const f = folder();
    const cases: Array<[string, (r: J) => void, RegExp]> = [
      ['a higher price', (r) => (r.terms.signed.price.amount = '99000000'), /check "commitment ID" failed here/],
      ['another seller', (r) => (r.terms.signed.sellerPayoutAddress = '0x000000000000000000000000000000000000dead'), /check "commitment ID" failed here/],
      ["another seller's signature", (r) => (r.terms.signatures.seller.signature = records.refunded.terms.signatures.seller.signature), /check "seller's terms signature" failed here/],
      ['a failed check', (r) => (r.checks.find((c: J) => c.check === 'event hashes').ok = false), /check "event hashes" failed/],
      ['a check that did not run', (r) => (r.checks.find((c: J) => c.check === 'operator receipts').ok = null), /check "operator receipts" did not run/],
      ['a missing check', (r) => (r.checks = r.checks.filter((c: J) => c.check !== 'hold is price plus fee')), /check "hold is price plus fee" is missing/],
      ['operators that disagree', (r) => (r.disagreements = [{ section: 'settlement', operators: ['a', 'b'] }]), /different answers for settlement/],
      ['an unfinished deal', (r) => (r.outcome.escrowState = 'Held'), /has not finished: its state in the record is Held/],
      ['a deal not final', (r) => (r.outcome.finalAt = null), /not final yet/],
      ['an outcome that its row contradicts', (r) => (r.outcome.escrowState = 'Settled'), /does not agree with itself: its outcome says Settled and its row says Released/],
      ['settlement times that differ', (r) => (r.row.settledAt = '2026-01-01T00:00:00Z'), /does not agree with itself: its settlement times do not agree/],
      ['another file', (r) => (r.record = 'holdback-evidence/1'), /not a deal record/],
      ['another deployment', (r) => r.operators.forEach((o: J) => (o.domain.verifyingContract = '0x000000000000000000000000000000000000c0de')), /does not pin \(rules contract 0x000000000000000000000000000000000000c0de\)\. For a deal on an earlier deployment, set HOLDBACK_DEPLOYMENT/],
    ];
    for (const [what, change, why] of cases) {
      const r = clone(records.released);
      change(r);
      const out = await f.run(r);
      expect(out.code, what).toBe(1);
      expect(out.out, what).toMatch(why);
    }
    const split = clone(records.split);
    split.settlement.postings[0].amount.amount = '1';
    expect((await f.run(split)).out).toMatch(/settlement pays out/);
    // A payout below 0 that keeps the sum: refused.
    const negative = clone(records.split);
    const [a, b] = negative.settlement.postings;
    a.amount.amount = '-5';
    b.amount.amount = String(BigInt(PRICE) + 5n);
    expect((await f.run(negative, ['--credits', 'X-1', '--credits-date', '2026-11-01'])).out).toMatch(/a settlement payout is not a whole amount above 0/);
    // A Refunded deal edited to read Released, one field at a time: each step of the edit is caught (T-565 review, H1).
    const flip = clone(records.refunded);
    flip.outcome.escrowState = 'Released';
    expect((await f.run(flip)).out).toMatch(/its outcome says Released and its row says Refunded/);
    flip.row.outcome = 'Released';
    expect((await f.run(flip)).out).toMatch(/its outcome is Released but the steps that settle it are settlement.refunded/);
    flip.steps.find((x: J) => x.step === 'settlement.refunded').step = 'settlement.released';
    expect((await f.run(flip)).out).toMatch(/who it says was paid does not match its outcome/);
    expect(f.documents()).toEqual([]);
    expect(f.sellerNow().numbering.invoice.next).toBe(1);
    expect(f.sellerNow().issued).toBeUndefined();
  });

  it("escapes hostile strings in the buyer's fields and the deal's description, in the page, and keeps them as plain data in the JSON", async () => {
    const f = folder();
    const hostile = {
      name: '<script>alert(1)</script>Evil "Corp"',
      address: ['"><img src=x onerror=alert(2)>', 'line\nbreak \u202Eevil\u202C & co'],
      taxId: "' onmouseover='x",
      reference: '</td></tr></table><iframe src="https://example.com">',
    };
    const r = await f.run(records.hostile, [], { buyer: hostile });
    expect(r.code, r.out).toBe(0);
    const page = f.html('INV-2026-0001');
    // No hostile tag or attribute survives as markup; as escaped text it is harmless.
    for (const bad of ['<script', '<img', '<iframe', "' onmouseover", '"><img', '\u202E', '</table><']) expect(page, bad).not.toContain(bad);
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;Evil &quot;Corp&quot;');
    expect(page).toContain('customers &lt;script&gt;alert(&quot;terms&quot;)&lt;/script&gt; &amp; &lt;img src=x onerror=alert(1)&gt;');
    expect(page).toContain("Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\"");
    // The page loads nothing and runs nothing: no script, no external resource.
    expect(page).not.toMatch(/<script|<link|<img|<iframe|src=["']?http/i);
    const d = f.doc('INV-2026-0001');
    expect(d.buyer.name).toBe(hostile.name);
    expect(d.buyer.address[1]).toBe('line break evil & co');
    expect(esc('a<b>"c"&\'d\'')).toBe('a&lt;b&gt;&quot;c&quot;&amp;&#39;d&#39;');
  });

  it('caps the length of every field the seller or the buyer gives', async () => {
    const f = folder();
    const r = await f.run(records.released, [], { buyer: { name: 'x'.repeat(301) } });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/buyer file: name must be text of 1 to 300 characters/);
    expect(f.documents()).toEqual([]);
  });

  it('refuses a seller file with a missing field by its name, and leaves the file as it was', async () => {
    const cases: Array<[J, RegExp]> = [
      [{ ...SELLER, name: undefined }, /seller file: name is missing/],
      [{ ...SELLER, address: undefined }, /seller file: address is missing/],
      [{ ...SELLER, tax: undefined }, /seller file: tax is missing/],
      [{ ...SELLER, numbering: undefined }, /seller file: numbering is missing/],
      [{ ...SELLER, numbering: { invoice: { prefix: 'INV-' } } }, /seller file: numbering.invoice.next must be a whole number/],
      [{ ...SELLER, format: undefined }, /seller file: format must be "crow-seller-details\/1"/],
      [{ ...SELLER, vatNumber: 'DE1' }, /the seller file has a field this command does not know, vatNumber/],
      [{ ...SELLER, tax: { treatment: 'rate', rateBps: 19.5 } }, /rateBps must be a whole number of basis points/],
    ];
    for (const [seller, why] of cases) {
      const f = folder(JSON.parse(JSON.stringify(seller)));
      const before = readFileSync(f.sellerFile, 'utf8');
      const r = await f.run(records.released);
      expect(r.code, String(why)).toBe(2);
      expect(r.out).toMatch(why);
      expect(r.out).toMatch(/wrote nothing/);
      expect(readFileSync(f.sellerFile, 'utf8')).toBe(before);
      expect(f.documents()).toEqual([]);
    }
  });

  it('numbers one seller file\'s documents in order, never repeating or skipping, and rewrites an issued one unchanged', async () => {
    const f = folder({ ...SELLER, numbering: { invoice: { prefix: 'INV-2026-', next: 1 } } });
    const order: Array<[string, J, string[]]> = [['a', records.released, []], ['b', records.split, []], ['c', records.hostile, []], ['d', records.refunded, ['--credits', 'X-1', '--credits-date', '2026-11-01']]];
    for (const [name, record, args] of order) {
      const r = await f.run(record, args, { name });
      expect(r.code, r.out).toBe(0);
      // A refused run in between takes no number.
      expect((await f.run(records.free, [], { name: 'free' })).code).toBe(1);
    }
    expect(f.documents()).toEqual(['INV-2026-0001.html', 'INV-2026-0001.json', 'INV-2026-0002.html', 'INV-2026-0002.json', 'INV-2026-0003.html', 'INV-2026-0003.json', 'INV-2026-0004.html', 'INV-2026-0004.json']);
    const reg = f.sellerNow().issued;
    expect(reg.map((e: J) => e.number)).toEqual(['INV-2026-0001', 'INV-2026-0002', 'INV-2026-0003', 'INV-2026-0004']);
    expect(f.sellerNow().numbering.invoice.next).toBe(5);

    // The same deal again, on another day: the same number, the same date, the same bytes.
    const before = readFileSync(join(f.dir, 'INV-2026-0001.json'), 'utf8');
    const again = await f.run(records.released, ['--issue-date', '2026-12-01'], { name: 'a' });
    expect(again.code, again.out).toBe(0);
    expect(again.out).toContain('Wrote invoice INV-2026-0001 again');
    expect(readFileSync(join(f.dir, 'INV-2026-0001.json'), 'utf8')).toBe(before);
    expect(f.sellerNow().numbering.invoice.next).toBe(5);

    // The same deal with other content: refused, since an issued document is not changed.
    const changed = await f.run(records.released, [], { name: 'a', buyer: { name: 'Someone Else' } });
    expect(changed.code).toBe(1);
    expect(changed.out).toMatch(/INV-2026-0001 was issued for this deal on 2026-11-19 with other content/);
    expect(readFileSync(join(f.dir, 'INV-2026-0001.json'), 'utf8')).toBe(before);

    // A next number set back by hand would repeat one: refused. Set forward, it is used, with a note on the gap.
    const back = f.sellerNow();
    back.numbering.invoice.next = 3;
    writeFileSync(f.sellerFile, JSON.stringify(back));
    const other = await decided(PRICE, GOOD);
    const repeat = await f.run(other, [], { name: 'e' });
    expect(repeat.code).toBe(1);
    expect(repeat.out).toMatch(/next invoice number is INV-2026-0003, but INV-2026-0004 is already issued: set numbering.invoice.next to 5/);
    back.numbering.invoice.next = 7;
    writeFileSync(f.sellerFile, JSON.stringify(back));
    const ahead = await f.run(other, [], { name: 'e' });
    expect(ahead.code, ahead.out).toBe(0);
    expect(ahead.out).toMatch(/2 numbers before INV-2026-0007 in this series were not issued by this command/);
  }, 60_000);

  it('says a number is in the register when writing its files failed after it, and the next run writes them', async () => {
    const f = folder();
    mkdirSync(join(f.dir, 'INV-2026-0001.json')); // a directory where the document goes: the rename fails
    const r = await f.run(records.released);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/INV-2026-0001 is in your register, but writing its files failed: .*Run the same command again/);
    expect(readdirSync(f.dir).filter((x) => x.endsWith('.tmp'))).toEqual([]);
    expect(existsSync(`${f.sellerFile}.lock`)).toBe(false);
    rmSync(join(f.dir, 'INV-2026-0001.json'), { recursive: true });
    const again = await f.run(records.released);
    expect(again.code, again.out).toBe(0);
    expect(again.out).toContain('Wrote invoice INV-2026-0001 again');
    expect(f.sellerNow().numbering.invoice.next).toBe(2);
  });

  it('names a re-fetched deal record as the reason a rerun differs', async () => {
    const f = folder();
    expect((await f.run(records.released)).code).toBe(0);
    const refetched = { ...clone(records.released), writtenAt: '2026-11-20T00:00:00.000Z' };
    const r = await f.run(refetched);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/The deal record differs from the one it was made from .*use that file, under the same name, to write it again/);
    expect(r.out).toMatch(/does not write a correction of it yet/);
  });

  it('refuses a second run while another holds the seller file', async () => {
    const f = folder();
    writeFileSync(`${f.sellerFile}.lock`, '');
    const r = await f.run(records.released);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/seller.json.lock exists: another run is writing this seller file/);
    expect(existsSync(`${f.sellerFile}.lock`)).toBe(true);
    expect(f.documents()).toEqual([]);
  });

  it('shows a fiat figure only with the rate, its currency, source and date, computed exactly from the seller\'s rate', async () => {
    const f = folder();
    const partial = await f.run(records.released, ['--rate', '0.9234', '--currency', 'EUR']);
    expect(partial.code).toBe(2);
    expect(partial.out).toMatch(/--rate-source, --rate-date missing/);
    expect(f.documents()).toEqual([]);
    const r = await f.run(records.released, ['--rate', '0.9234', '--currency', 'EUR', '--rate-source', 'ECB reference rate', '--rate-date', '2026-11-18']);
    expect(r.code, r.out).toBe(0);
    // 25.00 tUSD × 0.9234 = 23.085 → 23.09; tax 3.991597 × 0.9234 = 3.6858… → 3.69; net 23.09 − 3.69 = 19.40.
    expect(f.doc('INV-2026-0001').fiat).toMatchObject({ currency: 'EUR', rate: '0.9234', rateFraction: { numerator: '9234', denominator: '10000' }, rateSource: 'ECB reference rate', rateDate: '2026-11-18', total: '23.09', tax: '3.69', net: '19.40' });
    expect(f.html('INV-2026-0001')).toContain('In EUR: net 19.40, tax 3.69, total 23.09, at 0.9234 EUR for one tUSD, from ECB reference rate on 2026-11-18');
    expect(fractionOf('12.5')).toEqual({ numerator: 125n, denominator: 10n });
  });

  it('keeps the explorer links for a deal on an earlier Sepolia deployment pinned through HOLDBACK_DEPLOYMENT', () => {
    const dir = new URL('../contracts/deployments/', import.meta.url);
    const earlier = readdirSync(dir).find((f) => f.endsWith('.json') && f !== 'sepolia.json')!;
    // pinOf without an explorer is what knownPins builds from HOLDBACK_DEPLOYMENT.
    const pin = pinOf(JSON.parse(readFileSync(new URL(earlier, dir), 'utf8')));
    expect(pin.chain?.explorer).toBeUndefined();
    expect(explorerOf(pin)).toBe('https://sepolia.etherscan.io');
    expect(explorerOf({ domain: SIMCHAIN_DOMAIN, token: { id: 'tUSD', symbol: 'tUSD', decimals: 6 } })).toBeNull();
  });

  it('refuses a call it cannot read, and a date that is not one', async () => {
    const f = folder();
    expect((await f.run('not json')).out).toMatch(/the deal record is not JSON/);
    expect((await f.run(records.released, ['--issue-date', '2026-02-30'])).out).toMatch(/the issue date must be a date as YYYY-MM-DD/);
    expect((await f.run(records.released, ['--credits', 'INV-1'])).out).toMatch(/--credits and --credits-date go together/);
    expect((await f.run(records.released, ['--bogus', '1'])).out).toMatch(/unknown option --bogus/);
    expect((await f.run(records.released, ['--credits', 'INV-1', '--credits-date', '2026-11-01'])).out).toMatch(/refunded nothing/);
    expect(f.documents()).toEqual([]);
  });
});
