// T-581 (roadmap N222, security review 2026-11-21, section 5): the brakes on what a stranger can spend. Each test here is
// also an attack that failed before the change: one buyer holding the day's judge budget with judged deals, by any
// route to the settlement layer; many clients draining the relayer; a restart resetting the faucet's per-client count.
import nacl from 'tweetnacl';
import { generatePrivateKey } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from '../../../examples/agent.ts';
import { serveTwoOrigins } from '../../../examples/two-origins.ts';
import { markerFake } from '@holdback/adjudicator';
import { MemoryStorage, PublicWorld, type PublicWorldOptions } from './index.js';
import { BuyerJudgedDeals, DailyCaps } from './limits.js';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const closers: Array<() => Promise<void>> = [];
afterEach(async () => void (await Promise.all(closers.splice(0).map((c) => c()))));

/** One world, served twice: `urls` come from one client address, `other` from a second one. */
async function serve(options: Partial<PublicWorldOptions> = {}, storage = new MemoryStorage()) {
  const world = await PublicWorld.open({ storage, env: {}, minWindowSec: 2, ...options });
  const a = await serveTwoOrigins(world, { tickMs: 100, client: '198.51.100.7' });
  const b = await serveTwoOrigins(world, { client: '203.0.113.9' });
  closers.push(a.close, b.close);
  return { world, urls: a.urls, other: b.urls, storage };
}
const freshAgent = (urls: string[]) => new Agent(urls, generatePrivateKey(), nacl.randomBytes(32));
const TIMING = { judgeWithinSec: 2, fallbackWithinSec: 2, appealWindowSec: 0, appealDecideSec: 2 };
const post = (url: string, body: unknown, key: string) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) });

const granted = new Set<string>();
/**
 * An offer, the buyer and seller each at `urls`. `judged` makes it a rubric deal; otherwise one required check. `o.buyer`
 * reuses a buyer; `o.direct` submits the signed offer straight to the settlement layer, past every operator; `o.accepted`
 * false returns without waiting for Crow's acceptance.
 */
async function offered(urls: string[], judged: boolean, o: { buyer?: Agent; direct?: PublicWorld; accepted?: boolean } = {}) {
  const index = ((await (await fetch(`${urls[0]}/`)).json()) as J).demo;
  const buyer = o.buyer ?? freshAgent(urls);
  const seller = freshAgent(urls);
  for (const a of [buyer, seller]) {
    if (granted.has(a.address)) continue;
    await a.call('POST', '/v1/faucet', { address: a.address });
    granted.add(a.address);
  }
  const [primary, fallback, appeal] = index.adjudicators.map((x: J) => x.address);
  const common = {
    clubId: index.clubId,
    seller: seller.address,
    buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
    adjudicators: { primary, fallback, appeal },
    price: { token: 'tUSD', amount: '25000000' },
    timing: TIMING,
  };
  const given = judged
    ? {
        ...common,
        template: 'default',
        deliverable: { kind: 'other', description: 'A diff', format: 'text/plain' },
        checks: [{ id: 'hidden', type: 'hidden_characters_max', required: true, max: { tag: 0, bidi: 0, total: 0 } }],
        rubric: { passThreshold: 300, criteria: [{ id: 'fixes', description: 'Fixes it.', weight: 100, anchors: { '0': 'No', '2': 'Partly', '4': 'Yes' } }] },
      }
    : {
        ...common,
        template: 'checks-only',
        deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' },
        checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] }],
      };
  let offer: { id: string; terms: J; state: J };
  if (o.direct) {
    // The seller's signed offer goes to the settlement layer itself: no operator sees it.
    const world = o.direct;
    const call = seller.call.bind(seller);
    seller.call = (async (method: string, path: string, body?: J) => {
      if (method !== 'POST' || path !== '/v1/commitments') return call(method, path, body);
      const r = await world.chain.submit({ kind: 'offer', commitment: body });
      if (!r.ok) throw new Error(`direct offer refused: ${JSON.stringify(r)}`);
      return { notices: [] };
    }) as typeof seller.call;
    offer = await seller.offerDirect(given);
  } else offer = await seller.offer(given);
  if (o.accepted !== false) await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
  return { buyer, seller, offer };
}
const fund = (d: Awaited<ReturnType<typeof offered>>) => d.buyer.agreeAndFund(d.offer.terms, 40_000_000n);
const standIn = () => ({ judgeProvider: markerFake() as never });

/** Waits a few of the world's passes (100 ms apart), then reads the deal's state. */
async function stateAfterPasses(d: Awaited<ReturnType<typeof offered>>): Promise<string> {
  await new Promise((r) => setTimeout(r, 1500));
  return (await d.buyer.call('GET', `/v1/commitments/${d.offer.id}`)).escrowState;
}
const relayerFunded = async (storage: MemoryStorage) => [...(await storage.list<{ funded: number }>({ prefix: 'lc:' })).entries()].filter(([k]) => k.endsWith(':all')).reduce((n, [, v]) => n + v.funded, 0);

describe('judged deals per buyer per day, at Crow\'s acceptance (T-581 item 1; Rafa, 2026-11-24)', () => {
  // Attack: one buyer address takes judged deal after judged deal. Each funded one reserves 6 of the daily judge calls,
  // so a handful hold the day for everyone. Before the change Crow accepted every one. The default is 3, so the Sepolia
  // demo plays its three judged beats from one buyer; the fourth is declined before anyone can fund it.
  it('accepts three judged deals per buyer a day and declines the fourth, which costs the relayer nothing', async () => {
    const { urls, storage } = await serve({ ...standIn(), liveCallsPerDay: 100 });
    const buyer = freshAgent(urls);
    for (let i = 0; i < 3; i++) await offered(urls, true, { buyer });
    const fourth = await offered(urls, true, { buyer, accepted: false });
    // The operators say so before relaying, from the adjudicator's own `declines`.
    expect(fourth.offer.state.notices.join(' ')).toMatch(/judged_deals_per_buyer:/);
    expect(await stateAfterPasses(fourth)).toBe('Offered');
    const before = await relayerFunded(storage);
    await expect(fund(fourth)).rejects.toThrow();
    expect(await relayerFunded(storage)).toBe(before);
    // A deal decided by required checks alone needs no judge call: the same buyer still gets it. Another buyer is apart.
    await offered(urls, false, { buyer });
    await offered(urls, true);
  }, 90_000);

  it('counts and declines an offer submitted straight to the settlement layer, past every operator', async () => {
    const { world, urls } = await serve({ ...standIn(), liveCallsPerDay: 100 });
    const buyer = freshAgent(urls);
    await offered(urls, true, { buyer });
    await offered(urls, true, { buyer, direct: world });
    await offered(urls, true, { buyer, direct: world });
    const fourth = await offered(urls, true, { buyer, direct: world, accepted: false });
    expect(await stateAfterPasses(fourth)).toBe('Offered');
  }, 90_000);

  it('is a configured value: 0 declines every judged deal, a malformed value refuses to start, a scripted panel counts nothing', async () => {
    const none = await serve({ ...standIn(), liveCallsPerDay: 100, env: { JUDGED_DEALS_PER_BUYER_PER_DAY: '0' } });
    expect(await stateAfterPasses(await offered(none.urls, true, { accepted: false }))).toBe('Offered');
    await offered(none.urls, false);
    await expect(PublicWorld.open({ storage: new MemoryStorage(), env: { JUDGED_DEALS_PER_BUYER_PER_DAY: '1.5' } })).rejects.toThrow(/JUDGED_DEALS_PER_BUYER_PER_DAY/);
    await expect(PublicWorld.open({ storage: new MemoryStorage(), env: { FUNDED_DEALS_PER_DAY: 'many' } })).rejects.toThrow(/FUNDED_DEALS_PER_DAY/);
    // Without live judges no budget is spent, so nothing is counted.
    const scripted = await serve({ judgedDealsPerBuyerPerDay: 1 });
    const buyer = freshAgent(scripted.urls);
    await offered(scripted.urls, true, { buyer });
    await offered(scripted.urls, true, { buyer });
  }, 90_000);
});

describe('BuyerJudgedDeals, the count behind it (T-581)', () => {
  const day = Date.parse('2026-11-24T12:00:00Z');
  it('lets exactly the limit through from concurrent acceptances, and counts one deal once', async () => {
    const j = new BuyerJudgedDeals(new MemoryStorage(), () => day, 's', 3);
    const takes = await Promise.all(Array.from({ length: 20 }, (_, i) => j.take(i % 2 ? '0xAbC' : '0xabc', `d${i}`)));
    expect(takes.filter(Boolean)).toHaveLength(3);
    const k = new BuyerJudgedDeals(new MemoryStorage(), () => day, 's', 3);
    expect((await Promise.all(Array.from({ length: 10 }, () => k.take('0xb', 'same')))).every(Boolean)).toBe(true);
    expect(await Promise.all(['x', 'y', 'z'].map((d) => k.take('0xb', d)))).toEqual([true, true, false]);
  });

  it('checks without counting, gives a count back, and opens again at 00:00 UTC with the old rows deleted', async () => {
    let now = day;
    const storage = new MemoryStorage();
    const j = new BuyerJudgedDeals(storage, () => now, 's', 1);
    expect(await j.check('0xb', 'a')).toBe(true);
    expect(await j.take('0xb', 'a')).toBe(true);
    expect(await j.check('0xb', 'b')).toBe(false);
    expect(await j.check('0xb', 'a')).toBe(true);
    await j.giveBack('0xb', 'a');
    expect(await j.take('0xb', 'b')).toBe(true);
    expect(await j.take('0xb', 'c')).toBe(false);
    now = Date.parse('2026-11-25T00:00:01Z');
    expect(await j.take('0xb', 'c')).toBe(true);
    const rows = [...(await storage.list({ prefix: 'ja:' })).keys()];
    expect(rows.every((k) => k.startsWith('ja:2026-11-25:'))).toBe(true);
    expect(rows.join()).not.toContain('0xb');
  });
});

describe('funded deals per day across every client (T-581 item 2)', () => {
  // Attack: many addresses, each under its own cap, drain the one relayer wallet. Before the change the second client's
  // deal was relayed, however many clients came.
  it('stops the second client at the global cap, and never counts a funding of a deal already funded', async () => {
    const { urls, other } = await serve({ fundedDealsPerDay: 1 });
    const first = await offered(urls, false);
    const second = await offered(other, false);
    await fund(first);
    await expect(fund(second)).rejects.toThrow(/rate_limited.*across all clients/);
    // A deal past funding costs the relayer no funding gas, so the cap lets it through to the settlement layer's answer.
    await expect(fund(first)).rejects.toThrow(/invalid_state/);
  }, 90_000);
});

describe('DailyCaps, the new count for every client (T-581)', () => {
  const limits = { fundedDeals: 1, ciphertextBytes: 10, fundedDealsAll: 2 };
  const day = () => Date.parse('2026-11-24T12:00:00Z');

  it('tells a refusal apart: the client, or every client together', async () => {
    const caps = new DailyCaps(new MemoryStorage(), day, 's', limits);
    expect(await caps.takeFunding(0, 'a', 'f1')).toEqual({ ok: true, counted: true });
    expect(await caps.takeFunding(0, 'a', 'f2')).toMatchObject({ ok: false, reason: 'client' });
    expect((await caps.takeFunding(0, 'b', 'f3')).ok).toBe(true);
    expect(await caps.takeFunding(1, 'c', 'f4')).toMatchObject({ ok: false, reason: 'global' });
  });

  it('gives both counts back when the relay refuses, and keeps the replay rule', async () => {
    const caps = new DailyCaps(new MemoryStorage(), day, 's', limits);
    await caps.takeFunding(0, 'a', 'f1');
    expect(await caps.takeFunding(0, 'a', 'f1')).toEqual({ ok: true, counted: false });
    await caps.settleFunding(0, 'a', 'f1', false);
    expect(await caps.takeFunding(0, 'a', 'f2')).toEqual({ ok: true, counted: true });
    expect(await caps.takeFunding(0, 'c', 'f3')).toEqual({ ok: true, counted: true });
    expect(await caps.takeFunding(0, 'd', 'f4')).toMatchObject({ ok: false, reason: 'global' });
  });

  it('opens again at 00:00 UTC', async () => {
    let now = day();
    const caps = new DailyCaps(new MemoryStorage(), () => now, 's', limits);
    await caps.takeFunding(0, 'a', 'f1');
    await caps.takeFunding(0, 'b', 'f2');
    expect((await caps.takeFunding(0, 'c', 'f3')).ok).toBe(false);
    now = Date.parse('2026-11-25T00:00:01Z');
    expect((await caps.takeFunding(0, 'c', 'f3')).ok).toBe(true);
  });
});

describe('faucet grants per client, kept in storage (T-581 item 3)', () => {
  // Attack: a client takes its grants, then the Durable Object restarts (a deploy, an eviction); the count was in memory,
  // so the client started again at zero. The same storage under a new world must remember it.
  it('remembers the count across a restart, and stores no address', async () => {
    const storage = new MemoryStorage();
    const first = await serve({ faucetPerClient: 2 }, storage);
    for (const k of [1, 2]) expect((await post(`${first.urls[0]}/v1/faucet`, { address: freshAgent(first.urls).address }, `k-${k}`)).status).toBe(200);
    expect((await post(`${first.urls[0]}/v1/faucet`, { address: freshAgent(first.urls).address }, 'k-3')).status).toBe(429);
    const second = await serve({ faucetPerClient: 2 }, storage);
    const again = await post(`${second.urls[0]}/v1/faucet`, { address: freshAgent(second.urls).address }, 'k-4');
    expect(again.status).toBe(429);
    expect(await again.json()).toMatchObject({ type: expect.stringContaining('rate_limited') });
    // Another client is not counted against.
    expect((await post(`${second.other[0]}/v1/faucet`, { address: freshAgent(second.other).address }, 'k-5')).status).toBe(200);
    const rows = [...(await storage.list({ prefix: 'fc:' })).keys()];
    expect(rows).toHaveLength(2);
    expect(rows.join()).not.toMatch(/198\.51\.100\.7|203\.0\.113\.9/);
  }, 60_000);

  it('opens a client again once its window has passed, and deletes the closed rows', async () => {
    let t = Date.parse('2026-11-24T12:00:00Z');
    const storage = new MemoryStorage();
    const { urls, other } = await serve({ faucetPerClient: 1, faucetWindowSec: 3600, now: () => t }, storage);
    expect((await post(`${urls[0]}/v1/faucet`, { address: freshAgent(urls).address }, 'w-1')).status).toBe(200);
    expect((await post(`${urls[0]}/v1/faucet`, { address: freshAgent(urls).address }, 'w-2')).status).toBe(429);
    t += 3_601_000;
    expect((await post(`${other[0]}/v1/faucet`, { address: freshAgent(other).address }, 'w-3')).status).toBe(200);
    expect((await storage.list({ prefix: 'fc:' })).size).toBe(1);
    expect((await post(`${urls[0]}/v1/faucet`, { address: freshAgent(urls).address }, 'w-4')).status).toBe(200);
  }, 60_000);
});

describe('the red team and review of T-581', () => {
  // High (review item 1, red team item 1): takeFunding awaited the global row between the client's check and its count,
  // so concurrent takes from one client all passed. 20 at once must admit exactly the cap.
  it('admits exactly the cap from concurrent takes of one client', async () => {
    const caps = new DailyCaps(new MemoryStorage(), () => Date.parse('2026-11-24T12:00:00Z'), 's', { fundedDeals: 3, ciphertextBytes: 10, fundedDealsAll: 100 });
    const plain = await Promise.all(Array.from({ length: 20 }, (_, i) => caps.takeFunding(0, 'b', `p${i}`)));
    expect(plain.filter((t) => t.ok)).toHaveLength(3);
    // And concurrent give-backs leave the counts right: all three of b's back, so three more fit.
    const admitted = plain.flatMap((t, i) => (t.ok ? [`p${i}`] : []));
    await Promise.all(admitted.map((f) => caps.settleFunding(0, 'b', f, false)));
    expect((await Promise.all(Array.from({ length: 5 }, (_, i) => caps.takeFunding(0, 'b', `q${i}`)))).filter((t) => t.ok)).toHaveLength(3);
  });

  it('counts a take that straddles 00:00 UTC on one day only', async () => {
    let calls = 0;
    const times = [Date.parse('2026-11-24T23:59:59.999Z'), Date.parse('2026-11-25T00:00:00.001Z')];
    const caps = new DailyCaps(new MemoryStorage(), () => times[Math.min(calls++, 1)]!, 's', { fundedDeals: 1, ciphertextBytes: 10, fundedDealsAll: 1 });
    expect((await caps.takeFunding(0, 'a', 'f1')).ok).toBe(true);
    // Both rows were charged on 25 November: a second client on that day meets the global cap.
    expect(await caps.takeFunding(0, 'b', 'f2')).toMatchObject({ ok: false, reason: 'global' });
  });

  // Review item 2: a failed write of the faucet's count left the address marked in progress until a restart.
  it('leaves no address stuck when the faucet cannot store its count', async () => {
    const storage = new MemoryStorage();
    const { urls } = await serve({}, storage);
    const address = freshAgent(urls).address;
    const put = storage.put.bind(storage);
    let fail = true;
    storage.put = async (entries) => {
      if (fail && Object.keys(entries).some((k) => k.startsWith('fc:'))) throw new Error('storage down');
      return put(entries);
    };
    expect((await post(`${urls[0]}/v1/faucet`, { address }, 'f-1')).status).toBe(500);
    fail = false;
    expect((await post(`${urls[0]}/v1/faucet`, { address }, 'f-2')).status).toBe(200);
  }, 60_000);

  // Review item 4: LIVE_JUDGE_CALLS_PER_DAY fell back to 30 on a typo, so a mistyped quick stop left judging on.
  it('refuses to start on a malformed LIVE_JUDGE_CALLS_PER_DAY', async () => {
    await expect(PublicWorld.open({ storage: new MemoryStorage(), env: { LIVE_JUDGE_CALLS_PER_DAY: '0 ' } })).rejects.toThrow(/LIVE_JUDGE_CALLS_PER_DAY/);
    const off = await PublicWorld.open({ storage: new MemoryStorage(), env: { LIVE_JUDGE_CALLS_PER_DAY: '0' }, ...standIn() });
    expect(off).toBeDefined();
  });
});
