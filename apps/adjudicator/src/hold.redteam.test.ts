// Red team of ADR-0051 (T-619): the held reject. Each test states the expected outcome of an attack and measures it.
// The tests named "FIXED" pinned a weak behaviour the red team measured (M1, M2); they now assert the fix.
import { plusSeconds, type Commitment } from '@holdback/core';
import { fakeProvider, loadRegistry, type FakeScript, type JudgeProvider, type JudgeRequest, type RegistryDoc } from '@holdback/judgment';
import { keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';
import { demoCsv, DOMAIN, makeCommitment, party, TestSettlement, tusd, type Party } from './_sim.js';
import { HOLD_MARGIN_SEC, HOLD_MAX_SEC, holdUntil } from './hold.js';
import { defaultPolicy, policyHashOf } from './policy.js';
import { Adjudicator, type AdjudicatorConfig, type JudgedStore, type KeptDraft, type KeptJudgment } from './service.js';

function memoryStore(): JudgedStore {
  const map = new Map<string, KeptJudgment | KeptDraft>();
  return { get: async (k) => structuredClone(map.get(k)), put: async (k, v) => void map.set(k, structuredClone(v)) };
}

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
const DELIVER_BY = '2026-11-01T10:00:00Z';

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

async function setup(judgeWithinSec: number, scriptA: FakeScript = FAIL_ALL) {
  const s = new TestSettlement();
  const a = bench(A, 'bench-a', s, scriptA, { judgedStore: memoryStore() });
  bench(B, 'bench-b', s);
  bench(C, 'bench-c', s);
  const judgeBy = plusSeconds(DELIVER_BY, judgeWithinSec);
  const commitment = makeCommitment({
    primary: A.address,
    fallback: B.address,
    appeal: C.address,
    policyHash: policyHashOf(a.adj.policy),
    registryHash: reg.hash,
    buyer: BUYER,
    seller: SELLER,
    timing: { deliverBy: DELIVER_BY, judgeBy, fallbackBy: plusSeconds(judgeBy, 300), appealDecideSec: 87_000 },
  });
  s.offer(commitment);
  await a.adj.runOnce();
  s.fund(commitment.id);
  s.at('2026-11-01T09:59:00Z');
  await s.deliver(commitment.id, demoCsv(), [A, B, C, BUYER].map((p) => ({ recipient: p.address, publicKey: p.enc.publicKey })));
  return { s, a, id: commitment.id, commitment };
}

describe('attack.held-reject-window-chosen-by-seller (ADR-0051 red team)', () => {
  it('FIXED (M1): a seller-chosen window of 2^32-1 s holds a reject one day, not ~136 years', () => {
    const big = 2 ** 32 - 1;
    const c = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: `0x${'01'.repeat(32)}`, registryHash: reg.hash, buyer: BUYER, seller: SELLER, timing: { deliverBy: DELIVER_BY, judgeBy: plusSeconds(DELIVER_BY, big) } });
    const until = holdUntil({ commitment: c, role: 'primary', deadline: c.timing.judgeBy }, 'reject', '2026-11-01T09:59:30Z');
    expect(Date.parse(until!) - Date.parse('2026-11-01T09:59:30Z')).toBe(HOLD_MAX_SEC * 1000);
  });

  it('FIXED (M1): a 30-day judge window holds a day, and the passes during the hold make no preflight reads', async () => {
    const { s, a, id } = await setup(30 * 86_400);
    s.at('2026-11-01T09:59:30Z');
    const first = await a.adj.runOnce();
    expect(first.held).toHaveLength(1);
    expect(Date.parse(first.held[0]!.until) - Date.parse('2026-11-01T09:59:30Z')).toBe(HOLD_MAX_SEC * 1000);
    let reads = 0;
    const registration = s.registration.bind(s);
    s.registration = async (addr) => (reads++, registration(addr));
    for (let i = 1; i <= 10; i++) {
      s.at(plusSeconds('2026-11-01T09:59:30Z', i * 3_600));
      expect((await a.adj.runOnce()).held.map((h) => h.commitmentId)).toEqual([id]);
    }
    expect(reads).toBe(0);
    s.at(first.held[0]!.until);
    expect((await a.adj.runOnce()).decided).toEqual([{ commitmentId: id, role: 'primary', outcome: 'reject' }]);
  });
});

describe('attack.held-reject-restart-without-store (ADR-0051 red team)', () => {
  it('FIXED (M2): an adjudicator without judgedStore holds nothing: it signs the reject at once, so a restart finds no turn to judge again', async () => {
    const s = new TestSettlement();
    const a = bench(A, 'bench-a', s, FAIL_ALL);
    bench(B, 'bench-b', s);
    bench(C, 'bench-c', s);
    const judgeBy = plusSeconds(DELIVER_BY, 87_000);
    const commitment = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.adj.policy), registryHash: reg.hash, buyer: BUYER, seller: SELLER, timing: { deliverBy: DELIVER_BY, judgeBy, fallbackBy: plusSeconds(judgeBy, 300), appealDecideSec: 87_000 } });
    s.offer(commitment);
    await a.adj.runOnce();
    s.fund(commitment.id);
    s.at('2026-11-01T09:59:00Z');
    await s.deliver(commitment.id, demoCsv(), [A, B, C, BUYER].map((p) => ({ recipient: p.address, publicKey: p.enc.publicKey })));
    s.at('2026-11-01T09:59:30Z');
    const r = await a.adj.runOnce();
    expect(r.held).toEqual([]);
    expect(r.decided).toEqual([{ commitmentId: commitment.id, role: 'primary', outcome: 'reject' }]);
    const restarted = bench(A, 'bench-a', s, {});
    expect((await restarted.adj.runOnce()).decided).toEqual([]);
    expect(restarted.calls).toHaveLength(0);
    expect(s.state(commitment.id).kind).not.toBe('Delivered');
  });
});

describe('attack.held-reject-checks-only-and-malformed (ADR-0051 red team)', () => {
  const c = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: `0x${'01'.repeat(32)}`, registryHash: reg.hash, buyer: BUYER, seller: SELLER, timing: { deliverBy: DELIVER_BY, judgeBy: plusSeconds(DELIVER_BY, 87_000), appealDecideSec: 87_000 } });
  it('PASS: a malformed decidedAt or deadline signs at once (fails toward the contract deadline, not past it)', () => {
    expect(holdUntil({ commitment: c, role: 'primary', deadline: c.timing.judgeBy }, 'reject', 'not-a-time' as never)).toBeNull();
    expect(holdUntil({ commitment: c, role: 'primary', deadline: 'garbage' as never }, 'reject', '2026-11-01T09:59:30Z')).toBeNull();
    const inverted = { ...c, timing: { ...c.timing, judgeBy: '2026-11-01T09:00:00Z' } } as Commitment;
    expect(holdUntil({ commitment: inverted, role: 'primary', deadline: inverted.timing.judgeBy }, 'reject', '2026-11-01T09:59:30Z')).toBeNull();
  });
  it('PASS: a task deadline later than the signed judgeBy cannot stretch the primary hold past judgeBy less the margin', () => {
    const until = holdUntil({ commitment: c, role: 'primary', deadline: plusSeconds(c.timing.judgeBy, 10 * 86_400) }, 'reject', '2026-11-01T10:00:00Z');
    expect(Date.parse(until!)).toBeLessThanOrEqual(Date.parse(c.timing.judgeBy) - HOLD_MARGIN_SEC * 1000);
  });
  it('PASS (L5): the appeal hold takes its deadline from the port, and a late one moves the end by decidedAt - t1 at most', () => {
    // The appeal deadline is the escalation's chain time t1 plus appealDecideSec; holdUntil cannot recompute t1 from the
    // terms, so a port that reports a later deadline moves the hold's end later. Decided 10 s into the turn:
    const t1 = '2026-11-02T10:00:00Z';
    const honest = holdUntil({ commitment: c, role: 'appeal', deadline: plusSeconds(t1, 87_000) }, 'reject', plusSeconds(t1, 10));
    const late = holdUntil({ commitment: c, role: 'appeal', deadline: plusSeconds(t1, 87_000 + 3_600) }, 'reject', plusSeconds(t1, 10));
    expect(Date.parse(late!) - Date.parse(honest!)).toBe(10 * 1000);
    // Measured: bounded by decidedAt + appealDecideSec - margin, so a lying port moves it at most by (decidedAt - t1).
  });
});
