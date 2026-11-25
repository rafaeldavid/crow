// ADR-0045 §8 and §10: an adjudicator's record lists the check kinds its build runs, and as primary it declines an
// offer that names any other, before a hold can form. Stage 1 still fails such a check at judging time
// (packages/judgment/src/checks/checks.test.ts, "fails closed on an unknown check type").
import { readFileSync } from 'node:fs';
import { parseAdjudicator, policyHash, step, type Commitment } from '@holdback/core';
import { CHECK_TYPES, fakeProvider, loadRegistry, type RegistryDoc } from '@holdback/judgment';
import { keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';
import { DOMAIN, makeCommitment, party, TestSettlement, tusd } from './_sim.js';
import { defaultPolicy, policyHashOf } from './policy.js';
import { Adjudicator, type JudgedStore, type KeptDraft, type KeptJudgment } from './service.js';

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

/** The three checks of the signature_valid example: a json_schema check, then one signature_valid check per algorithm. */
const [ORDER, ECDSA, ED25519] = (JSON.parse(readFileSync(new URL('../../../spec/examples/commitment.signature-valid.example.json', import.meta.url), 'utf8')) as Commitment).acceptance.deterministicChecks;

/** A kind a later schema may add and this build does not run (ADR-0045 §8): the decline rule must still hold for it. */
const TREND = { id: 'trend', type: 'monotonic_column', required: true, column: 'ts' };
const TREND_OPTIONAL = { ...TREND, id: 'trend-b', required: false };

const NINE = ['csv_columns_exact', 'row_count_range', 'unique_key', 'null_rate_max', 'regex_match_rate_min', 'iso8601_date_column', 'json_schema', 'reference_row_match_min', 'hidden_characters_max'];

function bench(p: typeof A, name: string, s: TestSettlement, extra: { judgedStore?: JudgedStore } = {}) {
  const adj = new Adjudicator({
    ...extra,
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
    provider: fakeProvider({}),
    settlement: s,
    trustedAdjudicators: [A.address, B.address, C.address],
  });
  s.register({ ...adj.registration(), pool: {} as never, poolTermsHash: `0x${'00'.repeat(32)}`, status: 'active' });
  return adj;
}

async function offered(checks: readonly unknown[]) {
  const s = new TestSettlement();
  const a = bench(A, 'bench-a', s);
  const b = bench(B, 'bench-b', s);
  const c = bench(C, 'bench-c', s);
  const acceptance = { deterministicChecks: checks, rubric: { criteria: [], passThreshold: 0 } } as unknown as Commitment['acceptance'];
  const deal = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.policy), registryHash: reg.hash, buyer: BUYER, seller: SELLER, acceptance });
  s.offer(deal);
  return { s, a, b, c, deal, report: await a.runOnce() };
}

describe("an adjudicator's checkKinds (ADR-0045 §8)", () => {
  it('lists exactly the kinds stage 1 runs: the nine of schema v0.12 and signature_valid (ADR-0045)', () => {
    const adj = bench(A, 'bench-a', new TestSettlement());
    const listed = adj.registration().checkKinds!;
    expect(listed).toEqual([...CHECK_TYPES]);
    expect([...listed].sort()).toEqual([...NINE, 'signature_valid'].sort());
  });

  it('makes a record the adjudicator schema accepts, and leaves policyHash a hash of the policy alone', () => {
    const adj = bench(A, 'bench-a', new TestSettlement());
    const zero = tusd('0');
    const terms = { capitalChargeRateBps: 0, capitalChargeToPoolRateBps: 0, firstLossShareBps: 10_000, noticePeriodSec: 0 };
    const record = { ...adj.registration(), pool: { junior: zero, senior: zero, reserved: zero, terms }, poolTermsHash: `0x${'00'.repeat(32)}`, status: 'active' };
    const parsed = parseAdjudicator(record);
    expect(parsed.ok ? null : parsed.error.detail).toBeNull();
    expect(record.policyHash).toBe(policyHash(record.policy));
  });
});

describe('the primary and a check kind it does not run (ADR-0045 §10)', () => {
  it.each([
    ['a required check of a kind it does not run', [ORDER, TREND], 'trend'],
    ['an optional one, which the panel could otherwise pass over', [ORDER, TREND_OPTIONAL], 'trend-b'],
    ['two of them, naming the first', [ORDER, TREND_OPTIONAL, TREND], 'trend-b'],
  ])('declines an offer with %s, signs no acceptance and says why', async (_, checks, id) => {
    const { s, a, deal, report } = await offered(checks);
    const why = `bench-a does not run the check kind monotonic_column, which check ${id} names, so it declines the offer; checkKinds on its adjudicator record lists the kinds it runs`;
    expect(report.accepted).toEqual([]);
    expect(report.declined).toEqual([{ commitmentId: deal.id, reason: why }]);
    expect(report.refused).toEqual([]);
    expect(s.state(deal.id).kind).toBe('Offered');
    // The operator's read for its notices (`declines`) answers the same.
    expect(await a.declines(deal, 'primary')).toMatchObject({ type: 'adjudicator_unavailable', detail: why });
  });

  it('accepts an offer with signature_valid checks of both algorithms, which this build runs', async () => {
    const { s, a, deal, report } = await offered([ORDER, ECDSA, ED25519]);
    expect(report.accepted).toEqual([deal.id]);
    expect(report.declined).toEqual([]);
    expect(s.state(deal.id).kind).toBe('AcceptedByAdjudicator');
    expect(await a.declines(deal, 'primary')).toBeNull();
  });

  it('accepts the same offer without that check', async () => {
    const { s, a, deal, report } = await offered([ORDER]);
    expect(report.accepted).toEqual([deal.id]);
    expect(s.state(deal.id).kind).toBe('AcceptedByAdjudicator');
    expect(await a.declines(deal, 'primary')).toBeNull();
  });

  it('answers the fallback and the appeal role the same way: they sign no decision on a kind they do not run (D92)', async () => {
    const { b, c, deal } = await offered([ORDER, TREND]);
    const why = (role: string) =>
      `bench-${role === 'fallback' ? 'b' : 'c'} does not run the check kind monotonic_column, which check trend names, so as ${role} adjudicator it signs no decision; the deal passes to the next adjudicator or its default outcome, which returns the price and the fee`;
    expect(await b.declines(deal, 'fallback')).toMatchObject({ type: 'adjudicator_unavailable', detail: why('fallback') });
    expect(await c.declines(deal, 'appeal')).toMatchObject({ type: 'adjudicator_unavailable', detail: why('appeal') });
    // Without that kind they answer as before.
    const plain = await offered([ORDER]);
    expect(await plain.b.declines(plain.deal, 'fallback')).toBeNull();
    expect(await plain.c.declines(plain.deal, 'appeal')).toBeNull();
  });
});

describe('a turn on a funded deal whose terms name a kind the adjudicator does not run (D92)', () => {
  /** A funded, delivered deal whose terms name a kind; its build then lacks the kind the terms name. */
  async function funded(store?: JudgedStore) {
    const s = new TestSettlement();
    const a = bench(A, 'bench-a', s, store ? { judgedStore: store } : {});
    const b = bench(B, 'bench-b', s);
    bench(C, 'bench-c', s);
    const acceptance = { deterministicChecks: [ORDER, TREND], rubric: { criteria: [], passThreshold: 0 } } as unknown as Commitment['acceptance'];
    const deal = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.policy), registryHash: reg.hash, buyer: BUYER, seller: SELLER, acceptance });
    s.offer(deal);
    // The primary's acceptance models a build that ran the kind then (an outside primary, or one rolled back since).
    const kinds = CHECK_TYPES as Set<string>;
    kinds.add('monotonic_column');
    try {
      expect((await a.runOnce()).accepted).toEqual([deal.id]);
    } finally {
      kinds.delete('monotonic_column');
    }
    s.fund(deal.id);
    s.at('2026-11-01T09:59:00Z');
    await s.deliver(deal.id, '{"manifest":{}}', [A, B, C, BUYER].map((p) => ({ recipient: p.address, publicKey: p.enc.publicKey })));
    return { s, a, b, deal };
  }

  it('the primary signs nothing on its own turn, and nothing is published', async () => {
    const { s, a, deal } = await funded();
    const [task] = await s.tasks(A.address);
    const r = await a.decideTask(task!);
    expect(!r.ok && r.error.type).toBe('adjudicator_unavailable');
    expect(!r.ok && r.error.detail).toMatch(/as primary adjudicator it signs no decision/);
    expect(s.decisions(deal.id)).toEqual([]);
    expect(s.records.size).toBe(0);
  });

  it('the fallback triggers no takeover, signs nothing when someone else triggers one, and the deal defaults', async () => {
    const { s, b, deal } = await funded();
    s.at('2026-11-01T10:02:00Z'); // judgeBy: the primary is silent
    const report = await b.runOnce();
    expect(report.triggered).toEqual([]);
    expect(report.refused).toEqual([{ commitmentId: deal.id, problem: expect.objectContaining({ type: 'adjudicator_unavailable' }) }]);
    expect((await s.triggerFallback(deal.id)).ok).toBe(true);
    const again = await b.runOnce();
    expect(again.decided).toEqual([]);
    const [task] = await s.tasks(B.address);
    const direct = await b.decideTask(task!);
    expect(!direct.ok && direct.error.type).toBe('adjudicator_unavailable');
    expect(s.decisions(deal.id)).toEqual([]);
    expect(s.records.size).toBe(0);
    // fallbackBy passes with no decision: the default outcome returns the buyer's price and fee.
    s.at(s.cases.get(deal.id)!.commitment.timing.fallbackBy);
    const c = s.cases.get(deal.id)!;
    for (const e of [{ type: 'trigger_default' as const, at: s.now() }, { type: 'apply_default_outcome' as const, at: s.now() }]) {
      const r = step(c.state, e);
      if (!r.ok) throw new Error(r.error.detail);
      c.state = r.value;
    }
    expect(s.state(deal.id)).toMatchObject({ kind: 'Refunded', via: { kind: 'default_outcome', from: 'FallbackJudging' } });
  });

  it('a turn whose result was kept before a restart still completes on a build that lost the kind (D92, ADR-0036 section 2)', async () => {
    // Red team of PR 795: the exemption read only the in-memory map, which is empty after a restart, so the kept result
    // was refused and the deal ran on to the fallback with a published record of this turn already out.
    const rows = new Map<string, KeptJudgment | KeptDraft>();
    const store: JudgedStore = { get: async (k) => structuredClone(rows.get(k)), put: async (k, v) => void rows.set(k, structuredClone(v)) };
    const { s, deal } = await funded(store);
    const kinds = CHECK_TYPES as Set<string>;
    // The build that ran the kind judges and keeps its result; its decision does not land.
    kinds.add('monotonic_column');
    try {
      const first = bench(A, 'bench-a', s, { judgedStore: store });
      s.failNextDecisions = 1;
      await first.runOnce();
      expect(s.decisions(deal.id)).toEqual([]);
      expect(rows.size).toBe(1);
    } finally {
      kinds.delete('monotonic_column');
    }
    // After a restart onto a build without the kind, the kept decision is signed, and no new judgment is made.
    const restarted = bench(A, 'bench-a', s, { judgedStore: store });
    const [task] = await s.tasks(A.address);
    const r = await restarted.decideTask(task!);
    expect(r.ok ? null : r.error.detail).toBeNull();
    expect(r.ok && r.value.record.recordHash).toBe(([...rows.values()][0] as KeptJudgment).record.recordHash);
  });

  it('a turn with no kept result is still refused after a restart', async () => {
    const rows = new Map<string, KeptJudgment | KeptDraft>();
    const store: JudgedStore = { get: async (k) => structuredClone(rows.get(k)), put: async (k, v) => void rows.set(k, structuredClone(v)) };
    const { s, a, deal } = await funded(store);
    const [task] = await s.tasks(A.address);
    const r = await a.decideTask(task!);
    expect(!r.ok && r.error.detail).toMatch(/as primary adjudicator it signs no decision/);
    expect([rows.size, s.decisions(deal.id).length, s.records.size]).toEqual([0, 0, 0]);
  });
});
