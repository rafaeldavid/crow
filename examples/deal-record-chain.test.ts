// T-621: the deal record on a chain names who was paid. The demo's world on anvil, as the live operators run it: one
// deal the checks accept and one they reject, each settled by the primary's decision. The record then names the seller's
// payout address as paidTo, or the buyer's payment address as refundedTo, and its two postings checks run. Before
// T-621 a chain's settled events carried no postings, so both fields read null and both checks "not run". T-627 adds
// an early accept, whose fee returns to the buyer.
import nacl from 'tweetnacl';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { dealRecord } from './deal-record.ts';
import { ANVIL_SKIP, anvilReady, anvilWorld, type AnvilWorld } from './e2e-world.ts';
import { pinOf } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const CHECKS = [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] }];
const GOOD = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n';
const BAD = 'name\nada\n';

describe.skipIf(!anvilReady)(`deal-record.ts on anvil: a decided deal names who was paid (T-621)${ANVIL_SKIP}`, () => {
  let a: AnvilWorld;
  const was = process.env['HOLDBACK_DEPLOYMENT'];
  beforeAll(async () => {
    a = await anvilWorld();
    process.env['HOLDBACK_DEPLOYMENT'] = JSON.stringify(a.deployment);
  }, 180_000);
  afterAll(async () => {
    if (was === undefined) delete process.env['HOLDBACK_DEPLOYMENT'];
    else process.env['HOLDBACK_DEPLOYMENT'] = was;
    await a?.close();
  });

  /** One funded and delivered deal between two fresh agents, followed to its end. The seller is paid at a second address. */
  async function deal(work: string, state: 'Released' | 'Refunded', price = '5000000') {
    const pin = pinOf(a.deployment);
    const agent = () => new Agent([...a.urls], generatePrivateKey(), nacl.box.keyPair().secretKey, pin.domain, pin.chain);
    const seller = agent(), buyer = agent();
    const payout = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
    const found = await buyer.call('GET', '/.well-known/holdback.json');
    for (const who of [buyer, seller]) await who.call('POST', '/v1/faucet', { address: who.address });
    const [primary, fallback, appeal] = ['primary', 'fallback', 'appeal'].map((r) => (found.demo.adjudicators as J[]).find((x) => x.role === r).address);
    const offer = await seller.offer({
      template: 'checks-only', clubId: found.demo.clubId, seller: seller.address, sellerPayoutAddress: payout,
      buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
      adjudicators: { primary, fallback, appeal }, price: { token: pin.token.id, amount: price },
      deliverable: { kind: 'dataset', description: `customers, to be ${state} at ${price}`, format: 'text/csv' }, checks: CHECKS,
      timing: { offerExpiresInSec: 600, fundWithinSec: 900, deliverWithinSec: 1800, judgeWithinSec: 120, fallbackWithinSec: 120 },
    });
    await buyer.waitFor(offer.id, ['AcceptedByAdjudicator'], 90_000);
    await buyer.agreeAndFund(offer.terms, 10n ** 12n);
    await seller.waitFor(offer.id, ['Held'], 90_000);
    await seller.deliverAndShare(offer.terms, new TextEncoder().encode(work));
    await buyer.waitFor(offer.id, [state], 90_000);
    const record = await dealRecord(offer.id, { operators: [...a.urls], party: 'buyer' });
    const checks = Object.fromEntries(record.checks.map((c) => [c.check, c.ok]));
    return { record, checks, payout, buyer: buyer.address.toLowerCase() };
  }

  it('Released: paidTo is the payout address in the terms, refundedTo null, and the postings checks pass', async () => {
    const { record, checks, payout } = await deal(GOOD, 'Released');
    expect(record.row).toMatchObject({ outcome: 'Released', paidTo: payout, refundedTo: null, sellerPayoutAddress: payout });
    expect(checks).toMatchObject({ 'domain is pinned': true, 'postings conserve the hold': true, 'postings follow the outcome': true });
    expect(record.checks.filter((c) => c.ok === false)).toEqual([]);
    expect(record.disagreements).toEqual([]);
  }, 300_000);

  it('Refunded: refundedTo is the buyer\'s payment address, paidTo null, and the postings checks pass', async () => {
    const { record, checks, buyer } = await deal(BAD, 'Refunded');
    expect(record.row).toMatchObject({ outcome: 'Refunded', paidTo: null, refundedTo: buyer, buyerPaymentAddress: buyer });
    expect(checks).toMatchObject({ 'domain is pinned': true, 'postings conserve the hold': true, 'postings follow the outcome': true });
    expect(record.checks.filter((c) => c.ok === false)).toEqual([]);
    expect((record.settlement as J).postings.map((p: J) => p.why)).toEqual(['price back to the buyer', 'fee to the primary adjudicator, whose decision settles']);
    expect(record.disagreements).toEqual([]);
  }, 300_000);

  // T-627: a price of 0 pays no one; the fee pays the deciding adjudicator, and both postings checks run and pass.
  it('a decision on a price of 0: no payee, the fee to the primary, and the postings checks pass', async () => {
    const { record, checks } = await deal(GOOD, 'Released', '0');
    expect(record.row).toMatchObject({ outcome: 'Released', paidTo: null, refundedTo: null });
    expect(checks).toMatchObject({ 'postings conserve the hold': true, 'postings follow the outcome': true });
    expect(record.checks.filter((c) => c.ok === false)).toEqual([]);
    expect((record.settlement as J).postings.map((p: J) => p.why)).toEqual(['fee to the primary adjudicator, whose decision settles']);
  }, 300_000);

  // T-627: the buyer accepts during a held reject (ADR-0051), as `held-reject --accept` does. The price goes to the
  // payout address and the fee back to the buyer, which is no refund of the price.
  it('an early accept: paidTo is the payout address, refundedTo null, and the postings checks pass, for both parties', async () => {
    const pin = pinOf(a.deployment);
    const agent = () => new Agent([...a.urls], generatePrivateKey(), nacl.box.keyPair().secretKey, pin.domain, pin.chain);
    const seller = agent(), buyer = agent();
    const payout = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
    const found = await buyer.call('GET', '/.well-known/holdback.json');
    for (const who of [buyer, seller]) await who.call('POST', '/v1/faucet', { address: who.address });
    const [primary, fallback, appeal] = ['primary', 'fallback', 'appeal'].map((r) => (found.demo.adjudicators as J[]).find((x) => x.role === r).address);
    const offer = await seller.offer({
      template: 'default', clubId: found.demo.clubId, seller: seller.address, sellerPayoutAddress: payout,
      buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
      adjudicators: { primary, fallback, appeal }, price: { token: pin.token.id, amount: '5000000' },
      deliverable: { kind: 'document', description: 'a note, accepted early', format: 'text/plain' }, checks: [],
      rubric: { passThreshold: 300, criteria: [{ id: 'ok', description: 'Fine.', weight: 1, anchors: { '0': 'No', '2': 'Partly', '4': 'Yes' } }] },
      timing: { offerExpiresInSec: 600, fundWithinSec: 900, deliverWithinSec: 1800, judgeWithinSec: 3600, fallbackWithinSec: 3600, appealDecideSec: 3600 },
    });
    await buyer.waitFor(offer.id, ['AcceptedByAdjudicator'], 90_000);
    await buyer.agreeAndFund(offer.terms, 10n ** 12n);
    await seller.waitFor(offer.id, ['Held'], 90_000);
    const { delivery } = await seller.deliverAndShare(offer.terms, new TextEncoder().encode('a note that says FAIL-ME'));
    // The primary publishes its reject and holds it: the deal stays Delivered for the buyer's choice.
    for (let i = 0; i < 300 && !(await buyer.call('GET', `/v1/commitments/${offer.id}/judgment`).catch(() => null)); i++) await new Promise((r) => setTimeout(r, 200));
    expect((await buyer.call('GET', `/v1/commitments/${offer.id}`)).escrowState).toBe('Delivered');
    await buyer.earlyAccept(offer.terms, delivery);
    await buyer.waitFor(offer.id, ['Released'], 90_000);
    for (const party of ['buyer', 'seller'] as const) {
      const record = await dealRecord(offer.id, { operators: [...a.urls], party, ...(party === 'seller' ? { delivery } : {}) });
      const checks = Object.fromEntries(record.checks.map((c) => [c.check, c.ok]));
      expect(record.row, party).toMatchObject({ outcome: 'Released', paidTo: payout, refundedTo: null, sellerPayoutAddress: payout });
      expect(checks, party).toMatchObject({ 'domain is pinned': true, 'postings conserve the hold': true, 'postings follow the outcome': true });
      expect(record.checks.filter((c) => c.ok === false), party).toEqual([]);
      expect((record.settlement as J).postings.map((p: J) => [p.to, p.amount.amount]), party).toEqual([[payout, '5000000'], [buyer.address.toLowerCase(), offer.terms.adjudication.fee.amount]]);
      expect(record.disagreements, party).toEqual([]);
    }
  }, 300_000);
});
