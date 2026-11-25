// ADR-0051: Crow's reference adjudicators hold a rubric deal's reject until the turn's window less the margin, and sign
// an accept, an escalation and the fallback's decision at once. The hold survives a restart, never misses the deadline
// and never judges twice.
import { plusSeconds, type Commitment, type Decision, type Timestamp } from '@holdback/core';
import { fakeProvider, loadRegistry, type FakeScript, type JudgeProvider, type JudgeRequest, type RegistryDoc } from '@holdback/judgment';
import { keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';
import { demoCsv, DOMAIN, makeCommitment, party, TestSettlement, tusd, type Party } from './_sim.js';
import { HOLD_MARGIN_SEC, HOLD_MAX_SEC, holdUntil } from './hold.js';
import { defaultPolicy, policyHashOf } from './policy.js';
import { Adjudicator, type AdjudicatorConfig, type JudgedStore, type KeptDraft, type KeptJudgment } from './service.js';

const entry = (id: string, family: string, provider: 'anthropic' | 'openai-compatible') => ({ id, provider, family, model: `${id}-20260601`, status: 'active' as const });
const REGISTRY: RegistryDoc = {
  version: 1,
  judges: [entry('claude-a', 'claude', 'anthropic'), entry('claude-b', 'claude', 'anthropic'), entry('gpt-a', 'gpt', 'openai-compatible'), entry('gpt-b', 'gpt', 'openai-compatible'), entry('qwen-a', 'qwen', 'openai-compatible'), entry('qwen-b', 'qwen', 'openai-compatible')],
};
const reg = (() => {
  const r = loadRegistry(REGISTRY);
  if (!r.ok) throw new Error(r.error.detail);
  return r.value;
})();
const A = party(1);
const B = party(2);
const C = party(3);
const BUYER = party(4);
const SELLER = party(5);
const FAIL_ALL: FakeScript = Object.fromEntries(REGISTRY.judges.map((j) => [j.id, 'fail' as const]));
/** Only one family answers at the primary, so it escalates. */
const SPLIT: FakeScript = { 'gpt-a': 'timeout', 'gpt-b': 'timeout', 'qwen-a': 'timeout', 'qwen-b': 'timeout' };

/** A day plus the margin: the window Crow's tools write for a rubric deal (ADR-0051). */
const DAY_WINDOW = 87_000;
const DELIVER_BY = '2026-11-01T10:00:00Z';
const JUDGE_BY = plusSeconds(DELIVER_BY, DAY_WINDOW);
const LONG = { deliverBy: DELIVER_BY, judgeBy: JUDGE_BY, fallbackBy: plusSeconds(JUDGE_BY, 300), appealDecideSec: DAY_WINDOW };

function memoryStore(): JudgedStore & { map: Map<string, KeptJudgment | KeptDraft> } {
  const map = new Map<string, KeptJudgment | KeptDraft>();
  return { map, get: async (k) => structuredClone(map.get(k)), put: async (k, v) => void map.set(k, structuredClone(v)) };
}

function bench(p: Party, name: string, s: TestSettlement, script: FakeScript = {}, over: Partial<AdjudicatorConfig> = {}) {
  const calls: JudgeRequest[] = [];
  const inner = fakeProvider(script);
  const provider: JudgeProvider = { complete: (r) => (calls.push(r), inner.complete(r)) };
  const adj = new Adjudicator({
    address: p.address,
    name,
    signingKey: p.key,
    encryptionSecretKey: p.enc.secretKey,
    seedSecret: keccak256(p.key),
    policy: defaultPolicy(`${name}/p1`),
    registry: reg,
    registryUri: 'file:///config/judges.yaml',
    fee: { min: tusd('25000000') },
    domain: DOMAIN,
    provider,
    settlement: s,
    trustedAdjudicators: [A.address, B.address, C.address],
    ...over,
  });
  s.register({ ...adj.registration(), pool: {} as never, poolTermsHash: `0x${'00'.repeat(32)}`, status: 'active' });
  return { adj, calls };
}

async function setup(o: { scriptA?: FakeScript; scriptC?: FakeScript; timing?: Partial<Commitment['timing']>; acceptance?: Commitment['acceptance']; storeA?: JudgedStore; phaseOne?: boolean } = {}) {
  const s = new TestSettlement();
  if (o.phaseOne) s.phaseOne = true;
  // ADR-0051: only a service with a judgedStore holds a reject (red team M2), so each one here keeps its results.
  const a = bench(A, 'bench-a', s, o.scriptA, { judgedStore: o.storeA ?? memoryStore() });
  const b = bench(B, 'bench-b', s, {}, { judgedStore: memoryStore() });
  const c = bench(C, 'bench-c', s, o.scriptC, { judgedStore: memoryStore() });
  const commitment = makeCommitment({
    primary: A.address,
    fallback: B.address,
    appeal: C.address,
    policyHash: policyHashOf(a.adj.policy),
    registryHash: reg.hash,
    buyer: BUYER,
    seller: SELLER,
    timing: { ...(o.phaseOne ? { appealWindowSec: 0 } : {}), ...o.timing },
    ...(o.acceptance ? { acceptance: o.acceptance } : {}),
  });
  s.offer(commitment);
  await a.adj.runOnce();
  s.fund(commitment.id);
  s.at('2026-11-01T09:59:00Z');
  await s.deliver(commitment.id, demoCsv(), [A, B, C, BUYER].map((p) => ({ recipient: p.address, publicKey: p.enc.publicKey })));
  return { s, a, b, c, commitment, id: commitment.id };
}

describe('holdUntil (ADR-0051)', () => {
  const c = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: `0x${'01'.repeat(32)}`, registryHash: reg.hash, buyer: BUYER, seller: SELLER, timing: LONG });
  const primary = { commitment: c, role: 'primary' as const, deadline: c.timing.judgeBy };
  const decidedAt = '2026-11-01T09:59:30Z';

  it('holds a primary reject for judgeWithinSec less the margin, and nothing else', () => {
    expect(holdUntil(primary, 'reject', decidedAt)).toBe(plusSeconds(decidedAt, DAY_WINDOW - HOLD_MARGIN_SEC));
    for (const outcome of ['accept', 'escalate', null] as const) expect(holdUntil(primary, outcome, decidedAt)).toBeNull();
    expect(holdUntil({ ...primary, role: 'fallback', deadline: c.timing.fallbackBy }, 'reject', decidedAt)).toBeNull();
    // A party appeal (SimChain) is not the escalation path.
    expect(holdUntil({ ...primary, role: 'appeal', firstOutcome: 'reject', deadline: c.timing.fallbackBy }, 'reject', decidedAt)).toBeNull();
  });

  it('holds the appeal adjudicator reject after an escalation for appealDecideSec less the margin', () => {
    const escalatedAt = '2026-11-01T10:00:00Z';
    const appeal = { commitment: c, role: 'appeal' as const, deadline: plusSeconds(escalatedAt, DAY_WINDOW) };
    expect(holdUntil(appeal, 'reject', '2026-11-01T10:00:00Z')).toBe(plusSeconds('2026-11-01T10:00:00Z', DAY_WINDOW - HOLD_MARGIN_SEC));
    // Decided 5 s into the turn: the deadline less the margin caps the hold.
    expect(holdUntil(appeal, 'reject', '2026-11-01T10:00:05Z')).toBe(plusSeconds(escalatedAt, DAY_WINDOW - HOLD_MARGIN_SEC));
  });

  it('holds nothing on a deal decided by checks alone, or with a window of the margin or less', () => {
    const checksOnly = { ...c, acceptance: { ...c.acceptance, rubric: { criteria: [], passThreshold: 0 } } } as Commitment;
    expect(holdUntil({ ...primary, commitment: checksOnly }, 'reject', decidedAt)).toBeNull();
    const short = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: `0x${'01'.repeat(32)}`, registryHash: reg.hash, buyer: BUYER, seller: SELLER, timing: { judgeBy: plusSeconds(DELIVER_BY, HOLD_MARGIN_SEC) } });
    expect(holdUntil({ commitment: short, role: 'primary', deadline: short.timing.judgeBy }, 'reject', '2026-11-01T09:59:00Z')).toBeNull();
  });

  // The rule's one safety property: whatever the windows and whenever the record was decided, a held reject is signed
  // no later than the deadline less the margin, and never before the record's own time.
  it('never holds past the deadline less the margin, over a grid of windows and decision times', () => {
    const deliverBy = Date.parse(DELIVER_BY) / 1000;
    const values = [0, 1, 599, 600, 601, 1_200, 3_600, 86_400, 87_000, 87_001, 400_000];
    let checked = 0;
    for (const window of values)
      for (const early of [0, 300, 86_400])
        for (const decidedOffset of [-100, 0, 1, 599, 600, 3_600, 86_399, 86_400, 86_401, 172_800, 500_000])
          for (const appeal of [false, true]) {
            const deadline = appeal ? deliverBy + early + window : deliverBy + window;
            const terms = { ...c, timing: { ...c.timing, deliverBy: DELIVER_BY, judgeBy: new Date((deliverBy + window) * 1000).toISOString(), appealDecideSec: window } } as Commitment;
            const from = deliverBy + decidedOffset;
            const until = holdUntil({ commitment: terms, role: appeal ? 'appeal' : 'primary', deadline: new Date(deadline * 1000).toISOString() }, 'reject', new Date(from * 1000).toISOString());
            checked++;
            if (until === null) continue;
            const u = Date.parse(until) / 1000;
            expect(u).toBeLessThanOrEqual(deadline - HOLD_MARGIN_SEC);
            expect(u).toBeGreaterThan(from);
            expect(u - from).toBeLessThanOrEqual(Math.min(window - HOLD_MARGIN_SEC, HOLD_MAX_SEC));
          }
    expect(checked).toBe(values.length * 3 * 11 * 2);
  });
});

describe('the held reject in the service (ADR-0051)', () => {
  it('publishes the record, signs nothing during the hold, and signs the reject at its end, before judgeBy', async () => {
    const { s, a, id } = await setup({ scriptA: FAIL_ALL, timing: LONG });
    s.at('2026-11-01T09:59:30Z');
    const first = await a.adj.runOnce();
    expect(first.held).toEqual([{ commitmentId: id, role: 'primary', until: plusSeconds('2026-11-01T09:59:30Z', DAY_WINDOW - HOLD_MARGIN_SEC) }]);
    expect(first.decided).toEqual([]);
    expect(s.state(id).kind).toBe('Delivered');
    // The record is public from the start: both parties read the same reject at the same time.
    expect([...s.records.values()]).toHaveLength(1);
    expect([...s.records.values()][0]!.aggregate.decision).toBe('reject');
    const until = first.held[0]!.until;
    // One second before the end: still held, and the panel never runs again.
    const calls = a.calls.length;
    s.at(plusSeconds(until, -1));
    expect((await a.adj.runOnce()).held).toHaveLength(1);
    expect(a.calls).toHaveLength(calls);
    s.at(until);
    const last = await a.adj.runOnce();
    expect(last.decided).toEqual([{ commitmentId: id, role: 'primary', outcome: 'reject' }]);
    expect(s.state(id).kind).toBe('Refunded');
    expect(Date.parse(until)).toBeLessThanOrEqual(Date.parse(JUDGE_BY) - HOLD_MARGIN_SEC * 1000);
    expect(a.calls).toHaveLength(calls);
  });

  it('signs an accept and an escalation at once on the same long windows (attack.accept-never-held)', async () => {
    const accept = await setup({ timing: LONG });
    accept.s.at('2026-11-01T09:59:30Z');
    expect((await accept.a.adj.runOnce()).decided).toEqual([{ commitmentId: accept.id, role: 'primary', outcome: 'accept' }]);
    const esc = await setup({ scriptA: SPLIT, timing: LONG });
    esc.s.at('2026-11-01T09:59:30Z');
    expect((await esc.a.adj.runOnce()).decided).toEqual([{ commitmentId: esc.id, role: 'primary', outcome: 'escalate' }]);
  });

  it('signs a reject at once when the window is short (today\'s deals)', async () => {
    const { s, a, id } = await setup({ scriptA: FAIL_ALL });
    s.at('2026-11-01T10:00:30Z');
    const r = await a.adj.runOnce();
    expect(r.held).toEqual([]);
    expect(r.decided).toEqual([{ commitmentId: id, role: 'primary', outcome: 'reject' }]);
  });

  it('signs at once a reject whose record was decided after the hold could end (a late panel)', async () => {
    const { s, a, id } = await setup({ scriptA: FAIL_ALL, timing: LONG });
    s.at(plusSeconds(JUDGE_BY, -HOLD_MARGIN_SEC + 60));
    expect((await a.adj.runOnce()).decided).toEqual([{ commitmentId: id, role: 'primary', outcome: 'reject' }]);
  });

  it('holds to the same second after a restart and never runs the panel again (attack.held-reject-restart-no-second-panel)', async () => {
    const store = memoryStore();
    const { s, a, id } = await setup({ scriptA: FAIL_ALL, timing: LONG, storeA: store });
    s.at('2026-11-01T09:59:30Z');
    const until = (await a.adj.runOnce()).held[0]!.until;
    // The restarted service reads the kept record: same decidedAt, same end, no judge called.
    const restarted = bench(A, 'bench-a', s, {}, { judgedStore: store });
    s.at(plusSeconds('2026-11-01T09:59:30Z', 3_600));
    expect((await restarted.adj.runOnce()).held).toEqual([{ commitmentId: id, role: 'primary', until }]);
    expect(restarted.calls).toHaveLength(0);
    s.at(until);
    expect((await restarted.adj.runOnce()).decided).toEqual([{ commitmentId: id, role: 'primary', outcome: 'reject' }]);
    expect(restarted.calls).toHaveLength(0);
    const decision = s.submitted.find((m): m is Decision => m.type === 'Decision' && m.commitmentId === id)!;
    expect(decision.judgmentRecordHash).toBe([...s.records.values()][0]!.recordHash);
  });

  it('a service that wakes late in the hold still signs before judgeBy', async () => {
    const { s, a, id } = await setup({ scriptA: FAIL_ALL, timing: LONG });
    s.at('2026-11-01T09:59:30Z');
    await a.adj.runOnce();
    s.at(plusSeconds(JUDGE_BY, -1));
    expect((await a.adj.runOnce()).decided).toEqual([{ commitmentId: id, role: 'primary', outcome: 'reject' }]);
  });

  it('the appeal adjudicator holds its reject after an escalation; the fallback never holds', async () => {
    const { s, a, c, id } = await setup({ scriptA: SPLIT, scriptC: FAIL_ALL, timing: LONG, phaseOne: true });
    s.at('2026-11-01T09:59:30Z');
    await a.adj.runOnce();
    expect(s.state(id).kind).toBe('Escalated');
    s.at('2026-11-01T09:59:32Z');
    const held = await c.adj.runOnce();
    expect(held.held).toHaveLength(1);
    expect(held.held[0]!.role).toBe('appeal');
    expect(s.state(id).kind).toBe('Escalated');
    s.at(held.held[0]!.until);
    expect((await c.adj.runOnce()).decided).toEqual([{ commitmentId: id, role: 'appeal', outcome: 'reject' }]);
    expect(s.state(id).kind).toBe('Refunded');
  });

  it('a held attempt handed another delivery is refused, not judged again (attack.held-reject-changed-delivery)', async () => {
    const { s, a, id } = await setup({ scriptA: FAIL_ALL, timing: LONG });
    s.at('2026-11-01T09:59:30Z');
    await a.adj.runOnce();
    const [task] = await s.tasks(A.address);
    const other = { ...task!, delivery: { ...task!.delivery, plaintextSha256: `sha256:${'ab'.repeat(32)}` as Timestamp } };
    const r = await a.adj.decideTask(other as typeof task & object);
    expect(r.ok).toBe(false);
    expect(s.state(id).kind).toBe('Delivered');
  });
});

describe('neutrality.held-reject-adjudicator-offline (ADR-0051)', () => {
  it('a primary that holds a reject and goes silent loses its turn at judgeBy; the fallback decides at once', async () => {
    const { s, a, b, id } = await setup({ scriptA: FAIL_ALL, timing: LONG });
    s.at('2026-11-01T09:59:30Z');
    expect((await a.adj.runOnce()).held).toHaveLength(1);
    // The primary goes silent: it runs no pass again. At judgeBy anyone triggers the fallback.
    s.at(JUDGE_BY);
    // The fallback triggers its takeover and decides in the same pass, with no hold.
    const fb = await b.adj.runOnce();
    expect(fb.triggered).toEqual([id]);
    expect(fb.held).toEqual([]);
    expect(fb.decided).toEqual([{ commitmentId: id, role: 'fallback', outcome: 'accept' }]);
    expect(s.state(id).kind).toBe('Released');
  });
});
