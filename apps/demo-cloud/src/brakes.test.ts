// T-581 (roadmap N222, security review 2026-11-21, section 5): the brakes on what a stranger can spend. Each test here is
// also an attack that failed before the change: one client holding the day's judge budget with judged deals, many
// clients draining the relayer, a restart resetting the faucet's per-client count.
import nacl from 'tweetnacl';
import { generatePrivateKey } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from '../../../examples/agent.ts';
import { serveTwoOrigins } from '../../../examples/two-origins.ts';
import { markerFake } from '@holdback/adjudicator';
import { MemoryStorage, PublicWorld, type PublicWorldOptions } from './index.js';
import { DailyCaps } from './limits.js';

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

/** An accepted offer, the buyer and seller each at `urls`. `judged` makes it a rubric deal; otherwise one required check. */
async function offered(urls: string[], judged: boolean) {
  const index = ((await (await fetch(`${urls[0]}/`)).json()) as J).demo;
  const buyer = freshAgent(urls);
  const seller = freshAgent(urls);
  for (const a of [buyer, seller]) await a.call('POST', '/v1/faucet', { address: a.address });
  const [primary, fallback, appeal] = index.adjudicators.map((x: J) => x.address);
  const common = {
    clubId: index.clubId,
    seller: seller.address,
    buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
    adjudicators: { primary, fallback, appeal },
    price: { token: 'tUSD', amount: '25000000' },
    timing: TIMING,
  };
  const offer = judged
    ? await seller.offer({
        ...common,
        template: 'default',
        deliverable: { kind: 'other', description: 'A diff', format: 'text/plain' },
        checks: [{ id: 'hidden', type: 'hidden_characters_max', required: true, max: { tag: 0, bidi: 0, total: 0 } }],
        rubric: { passThreshold: 300, criteria: [{ id: 'fixes', description: 'Fixes it.', weight: 100, anchors: { '0': 'No', '2': 'Partly', '4': 'Yes' } }] },
      })
    : await seller.offer({
        ...common,
        template: 'checks-only',
        deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' },
        checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] }],
      });
  await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
  return { buyer, seller, offer };
}
const fund = (d: Awaited<ReturnType<typeof offered>>) => d.buyer.agreeAndFund(d.offer.terms, 40_000_000n);
const standIn = () => ({ judgeProvider: markerFake() as never });

describe('judged deals per client per day (T-581 item 1)', () => {
  // Attack: one address funds judged deal after judged deal. Each reserves 6 of the 30 daily judge calls, so five hold
  // the day for everyone. Before the change every one of the five was relayed.
  it('relays one judged deal per client a day, so one client reserves 6 of the 30 judge calls at most', async () => {
    const { world, urls } = await serve({ ...standIn(), liveCallsPerDay: 30 });
    const first = await offered(urls, true);
    const second = await offered(urls, true);
    await fund(first);
    await expect(fund(second)).rejects.toThrow(/rate_limited.*judge panel/);
    expect(world.reservedJudgeCalls()).toBe(6);
    // A deal with required checks only costs no judge call: the same client still funds it.
    await fund(await offered(urls, false));
    // The refusal gave nothing away: the refused deal is still unfunded and a second client can fund it.
    expect((await second.buyer.call('GET', `/v1/commitments/${second.offer.id}`)).escrowState).toBe('AcceptedByAdjudicator');
  }, 90_000);

  it('is a configured value: 2 lets a second judged deal through, 0 refuses every judged deal', async () => {
    const two = await serve({ ...standIn(), liveCallsPerDay: 30, judgedDealsPerClientPerDay: 2 });
    await fund(await offered(two.urls, true));
    await fund(await offered(two.urls, true));
    expect(two.world.reservedJudgeCalls()).toBe(12);
    const none = await serve({ ...standIn(), liveCallsPerDay: 30, env: { JUDGED_DEALS_PER_CLIENT_PER_DAY: '0' } });
    await expect(fund(await offered(none.urls, true))).rejects.toThrow(/rate_limited/);
    await fund(await offered(none.urls, false));
  }, 90_000);

  it('refuses a malformed value at start, as the other limits do', async () => {
    await expect(PublicWorld.open({ storage: new MemoryStorage(), env: { JUDGED_DEALS_PER_CLIENT_PER_DAY: '1.5' } })).rejects.toThrow(/JUDGED_DEALS_PER_CLIENT_PER_DAY/);
    await expect(PublicWorld.open({ storage: new MemoryStorage(), env: { FUNDED_DEALS_PER_DAY: 'many' } })).rejects.toThrow(/FUNDED_DEALS_PER_DAY/);
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

describe('DailyCaps, the new counts (T-581)', () => {
  const limits = { fundedDeals: 10, ciphertextBytes: 10, judgedDeals: 1, fundedDealsAll: 2 };
  const day = () => Date.parse('2026-11-24T12:00:00Z');

  it('tells a refusal apart: the client, its judged cap, or every client together', async () => {
    const caps = new DailyCaps(new MemoryStorage(), day, 's', limits);
    expect(await caps.takeFunding(0, 'a', 'f1', true)).toEqual({ ok: true, counted: true });
    expect(await caps.takeFunding(0, 'a', 'f2', true)).toMatchObject({ ok: false, reason: 'judged' });
    expect((await caps.takeFunding(0, 'a', 'f3', false)).ok).toBe(true);
    expect(await caps.takeFunding(1, 'b', 'f4', false)).toMatchObject({ ok: false, reason: 'global' });
  });

  it('gives all three counts back when the relay refuses, and keeps the replay rule', async () => {
    const caps = new DailyCaps(new MemoryStorage(), day, 's', limits);
    await caps.takeFunding(0, 'a', 'f1', true);
    expect(await caps.takeFunding(0, 'a', 'f1', true)).toEqual({ ok: true, counted: false });
    await caps.settleFunding(0, 'a', 'f1', false, true);
    expect(await caps.takeFunding(0, 'a', 'f2', true)).toEqual({ ok: true, counted: true });
    expect(await caps.takeFunding(0, 'c', 'f3', false)).toEqual({ ok: true, counted: true });
    expect(await caps.takeFunding(0, 'd', 'f4', false)).toMatchObject({ ok: false, reason: 'global' });
  });

  it('opens again at 00:00 UTC', async () => {
    let now = day();
    const caps = new DailyCaps(new MemoryStorage(), () => now, 's', limits);
    await caps.takeFunding(0, 'a', 'f1', false);
    await caps.takeFunding(0, 'b', 'f2', false);
    expect((await caps.takeFunding(0, 'c', 'f3', false)).ok).toBe(false);
    now = Date.parse('2026-11-25T00:00:01Z');
    expect((await caps.takeFunding(0, 'c', 'f3', false)).ok).toBe(true);
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
    const caps = new DailyCaps(new MemoryStorage(), () => Date.parse('2026-11-24T12:00:00Z'), 's', { fundedDeals: 3, ciphertextBytes: 10, judgedDeals: 1, fundedDealsAll: 100 });
    const judged = await Promise.all(Array.from({ length: 20 }, (_, i) => caps.takeFunding(0, 'a', `j${i}`, true)));
    expect(judged.filter((t) => t.ok)).toHaveLength(1);
    const plain = await Promise.all(Array.from({ length: 20 }, (_, i) => caps.takeFunding(0, 'b', `p${i}`, false)));
    expect(plain.filter((t) => t.ok)).toHaveLength(3);
    // And concurrent give-backs leave the counts right: all three of b's back, so three more fit.
    await Promise.all(['p0', 'p1', 'p2'].map((f) => caps.settleFunding(0, 'b', f, false)));
    expect((await Promise.all(Array.from({ length: 5 }, (_, i) => caps.takeFunding(0, 'b', `q${i}`, false)))).filter((t) => t.ok)).toHaveLength(3);
  });

  it('counts a take that straddles 00:00 UTC on one day only', async () => {
    let calls = 0;
    const times = [Date.parse('2026-11-24T23:59:59.999Z'), Date.parse('2026-11-25T00:00:00.001Z')];
    const caps = new DailyCaps(new MemoryStorage(), () => times[Math.min(calls++, 1)]!, 's', { fundedDeals: 1, ciphertextBytes: 10, judgedDeals: 1, fundedDealsAll: 1 });
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
