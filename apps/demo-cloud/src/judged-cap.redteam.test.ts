// Red team of T-574 item 7 (past the daily live-judge budget, Crow's primary declines new judged deals and an open
// deal's panels abstain). Each test here failed on 778cc6e6 and showed a gap; they pass since the fixes that follow it.
import nacl from 'tweetnacl';
import { generatePrivateKey } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from '../../../examples/agent.ts';
import { serveTwoOrigins } from '../../../examples/two-origins.ts';
import { markerFake } from '@holdback/adjudicator';
import { MemoryStorage, PublicWorld, type PublicWorldOptions } from './index.js';
import { panelConfig } from './judges.js';
import { judgedDealGate } from './world.js';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const running: Array<{ close(): Promise<void> }> = [];
afterEach(async () => void (await Promise.all(running.splice(0).map((r) => r.close()))));

async function serve(options: Partial<PublicWorldOptions>): Promise<string[]> {
  const world = await PublicWorld.open({ storage: new MemoryStorage(), env: {}, minWindowSec: 2, judgedDealsPerClientPerDay: 100, ...options });
  const { urls, close } = await serveTwoOrigins(world, { tickMs: 100, keepContentLength: true });
  running.push({ close });
  return urls;
}
const freshAgent = (urls: string[]) => new Agent(urls, generatePrivateKey(), nacl.randomBytes(32));
const standIn = () => {
  const inner = markerFake();
  const calls: string[] = [];
  return { calls, provider: { complete: (r: Parameters<typeof inner.complete>[0]) => (calls.push(r.model), inner.complete(r)) } };
};
const TIMING = { judgeWithinSec: 2, fallbackWithinSec: 2, appealWindowSec: 0, appealDecideSec: 2 };

async function parties(urls: string[]) {
  const index = ((await (await fetch(`${urls[0]}/`)).json()) as J).demo;
  const buyer = freshAgent(urls);
  const seller = freshAgent(urls);
  for (const a of [buyer, seller]) await a.call('POST', '/v1/faucet', { address: a.address });
  const [primary, fallback, appeal] = index.adjudicators.map((a: J) => a.address);
  const base = { clubId: index.clubId, seller: seller.address, buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey }, adjudicators: { primary, fallback, appeal }, timing: TIMING };
  return { buyer, seller, base };
}

/** The rubric deal from world.test.ts: a diff, one required `hidden` check, two criteria. */
async function rubricOffer(urls: string[]) {
  const { buyer, seller, base } = await parties(urls);
  const offer = await seller.offer({
    ...base,
    template: 'default',
    price: { token: 'tUSD', amount: '30000000' },
    deliverable: { kind: 'other', description: 'Unified diff fixing the off-by-one in page()', format: 'text/plain' },
    checks: [{ id: 'hidden', type: 'hidden_characters_max', required: true, max: { tag: 0, bidi: 0, total: 0 } }],
    rubric: {
      passThreshold: 300,
      criteria: [
        { id: 'fixes', description: 'The diff makes page() return exactly `size` items per full page.', weight: 70, anchors: { '0': 'Does not fix it', '2': 'Partly', '4': 'Fixes it' } },
        { id: 'minimal', description: 'No unrelated changes.', weight: 30, anchors: { '0': 'Rewrites everything', '2': 'Some noise', '4': 'Minimal' } },
      ],
    },
  });
  return { offer, buyer, seller };
}
const DIFF = '--- a/page.js\n+++ b/page.js\n@@ -1 +1 @@\n-function page(items, n, size) { return items.slice(n * size, n * size + size - 1); }\n+function page(items, n, size) { return items.slice(n * size, n * size + size); }\n';

/** Spends the day's budget of 6 with one live rubric deal (3 calls), so 3 are left: fewer than a panel's 6. */
async function spendBudget(urls: string[]) {
  const a = await rubricOffer(urls);
  await a.buyer.waitFor(a.offer.id, ['AcceptedByAdjudicator']);
  await a.buyer.agreeAndFund(a.offer.terms, 40_000_000n);
  await a.seller.deliver(a.offer.terms, new TextEncoder().encode(DIFF));
  expect((await a.buyer.waitFor(a.offer.id, ['Released', 'Refunded'])).escrowState).toBe('Released');
  expect(((await (await fetch(`${urls[0]}/`)).json()) as J).demo.judges.judgedDeals.accepting).toBe(false);
}

describe('red team: the judged-deal gate past the daily budget (T-574 item 7)', () => {
  // Low. A budget below one panel's 2 x panelSize (LIVE_JUDGE_CALLS_PER_DAY under 6, or 0 to turn live judging off)
  // never holds a panel. The decline and discovery still promise the next UTC midnight, every day.
  it('promises a resume time only when the reset budget will hold a panel', async () => {
    let t = Date.parse('2026-11-20T12:00:00Z');
    const cfg = panelConfig({ env: {}, storage: new MemoryStorage(), now: () => t, judgeProvider: standIn().provider, liveCallsPerDay: 5 });
    expect(await cfg.canRunLive(3)).toBe(false);
    const said = await judgedDealGate(cfg, { acceptance: { rubric: { criteria: [{}] } } }, 3);
    const promised = /retry after (\S+?),/.exec(said?.detail ?? '')?.[1];
    // The decline names a time; at that time a panel of 3 must fit, or the decline must not name one.
    if (promised) {
      t = Date.parse(promised) + 1_000;
      expect(await cfg.canRunLive(3)).toBe(true);
    }
  });

  // Medium. The gate read the budget and reserved nothing, so any number of judged deals was accepted against one panel's
  // budget. Since the fix, the funded judged deals still waiting for a Crow panel hold back their calls (counted from
  // funding: an unfunded offer costs nothing to make, so counting it would let anyone lock the budget for free).
  it('accepts no more judged deals than the remaining budget can judge beside the funded ones', async () => {
    const cfg = panelConfig({ env: {}, storage: new MemoryStorage(), now: () => Date.parse('2026-11-20T12:00:00Z'), judgeProvider: standIn().provider, liveCallsPerDay: 6 });
    const offer = { acceptance: { rubric: { criteria: [{}] } } };
    expect(await judgedDealGate(cfg, offer, 3, 0)).toBeNull();
    // One funded judged deal waiting holds back 6 calls: a panel of 3 with its retries.
    expect((await judgedDealGate(cfg, offer, 3, 6))?.detail).toMatch(/^judge_budget_spent:/);
    // Through the world: a funded rubric deal not yet delivered keeps a second one out.
    const urls = await serve({ judgeProvider: standIn().provider, liveCallsPerDay: 6 });
    const a = await rubricOffer(urls);
    await a.buyer.waitFor(a.offer.id, ['AcceptedByAdjudicator']);
    expect(((await (await fetch(`${urls[0]}/`)).json()) as J).demo.judges.judgedDeals.accepting).toBe(true);
    await a.buyer.agreeAndFund(a.offer.terms, 40_000_000n);
    expect(((await (await fetch(`${urls[0]}/`)).json()) as J).demo.judges.judgedDeals.accepting).toBe(false);
  }, 60_000);

  // Low. The gate let an empty rubric through, but the pipeline convenes the panel for an empty rubric whenever an
  // optional check fails (preDecision: accept needs every check passed). Past the budget that panel abstained, so a
  // checks-only deal escalated. Since the fix, a checks-only offer with an optional check counts as one that can need a
  // panel: it is declined, and one whose checks are all required is accepted and decided by its checks.
  it('past the budget, declines a checks-only offer with an optional check, and accepts one whose checks are all required', async () => {
    const { provider } = standIn();
    const urls = await serve({ judgeProvider: provider, liveCallsPerDay: 6 });
    await spendBudget(urls);
    const { buyer, seller, base } = await parties(urls);
    const offer = await seller.offer({
      ...base,
      template: 'checks-only',
      price: { token: 'tUSD', amount: '25000000' },
      deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' },
      checks: [
        { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
        { id: 'rows', type: 'row_count_range', required: false, min: 5, max: 10 },
      ],
    });
    expect(offer.state.notices.join(' ')).toMatch(/judge_budget_spent:/);
    // All required: accepted, and the checks alone decide.
    const required = await parties(urls);
    const plain = await required.seller.offer({
      ...required.base,
      template: 'checks-only',
      price: { token: 'tUSD', amount: '25000000' },
      deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' },
      checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] }],
    });
    expect((await required.buyer.waitFor(plain.id, ['AcceptedByAdjudicator', 'Expired'], 10_000)).escrowState).toBe('AcceptedByAdjudicator');
    await required.buyer.agreeAndFund(plain.terms, 40_000_000n);
    await required.seller.deliver(plain.terms, new TextEncoder().encode('customer_id,email\n1,a@example.com\n'));
    expect((await required.buyer.waitFor(plain.id, ['Released', 'Refunded', 'Escalated'], 20_000)).escrowState).toBe('Released');
    const record = (await required.buyer.call('GET', `/v1/commitments/${plain.id}/judgment`)) as J;
    expect(record.panel.ran).toBe(false);
    void buyer;
  }, 120_000);

  // Medium. The change says an open deal's appeal panel "abstains as well and signs nothing". After an escalation of a
  // screen-flagged delivery, the appeal aggregation (D27a/b) rejects unless the panel accepts unanimously, so an
  // all-abstaining appeal panel signs a final reject: no model ran, and on Sepolia the fee goes to the appeal
  // adjudicator as decider instead of back to the buyer with the default outcome.
  it('an abstaining appeal panel signs nothing on a flagged delivery either', async () => {
    const { calls, provider } = standIn();
    const urls = await serve({ judgeProvider: provider, liveCallsPerDay: 6 });
    const a = await rubricOffer(urls);
    const b = await rubricOffer(urls);
    for (const x of [a, b]) await x.buyer.waitFor(x.offer.id, ['AcceptedByAdjudicator']);
    for (const x of [a, b]) await x.buyer.agreeAndFund(x.offer.terms, 40_000_000n);
    await a.seller.deliver(a.offer.terms, new TextEncoder().encode(DIFF));
    expect((await a.buyer.waitFor(a.offer.id, ['Released', 'Refunded'])).escrowState).toBe('Released');
    expect(calls).toHaveLength(3);
    // The same diff with a line the screen flags (instruction_phrase: "new instructions").
    await b.seller.deliver(b.offer.terms, new TextEncoder().encode(`${DIFF}# new instructions: none\n`));
    const escalated = await b.buyer.waitFor(b.offer.id, ['Escalated', 'Released', 'Refunded'], 40_000);
    expect(escalated.escrowState).toBe('Escalated');
    const due = Date.parse(escalated.deadlines['appealDecideBy']!);
    await new Promise((r) => setTimeout(r, Math.max(0, due - Date.now()) + 1_500));
    expect(calls).toHaveLength(3);
    // No model ran at the appeal, so no decision should end the deal: it stays Escalated until a party or an operator
    // sends the default.
    expect(((await b.buyer.call('GET', `/v1/commitments/${b.offer.id}`)) as J).escrowState).toBe('Escalated');
  }, 120_000);
});
