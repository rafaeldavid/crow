// T-631: a panel larger than the registry repeats seats. Rafa, 2026-11-26: "5 seats, repeat models". The second live
// registry has three judges from three families, and the escalation panel stays five seats (appealPanelSize 5, the
// rulebook's panelPolicyMin). So two models sit twice, each at most twice, and the seed chooses which. A repeated seat
// is its own seat (its own id, nonces and criteria order) of the same model and family, so it never counts as a
// second family, and no decision rests on one family.
import type { Hex32, JudgeVerdict } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import { RUBRIC } from './_helpers.js';
import { aggregate, type PanelVerdict } from './aggregate.js';
import { judgeNonces, selectPanel } from './panel.js';
import { loadRegistry, type RegistryDoc } from './providers/registry.js';

const CID: Hex32 = `0x${'11'.repeat(32)}`;
const seed = (n: number): Hex32 => `0x${n.toString(16).padStart(64, '0')}`;
const THREE: RegistryDoc = {
  version: 1,
  judges: [
    { id: 'claude-opus-5-5', provider: 'anthropic', family: 'claude', model: 'claude-opus-5-5@2026-09-21', status: 'active' },
    { id: 'gemini-4-neon', provider: 'google', family: 'gemini', model: 'gemini-4-neon@2026-11-26', status: 'active' },
    { id: 'deepseek-v4-pro', provider: 'openai-compatible', family: 'deepseek', model: 'deepseek-v4-pro@2026-11-01', status: 'active' },
  ],
};
const reg = () => {
  const r = loadRegistry(THREE);
  if (!r.ok) throw new Error(r.error.detail);
  return r.value;
};
const seats = (n: number, size: number, minFamilies = 3) => {
  const s = selectPanel({ registry: reg(), seed: seed(n), commitmentId: CID, size, minFamilies });
  if (!s.ok) throw new Error(s.error);
  return s.value;
};

describe('a panel larger than the registry repeats seats (T-631)', () => {
  it('a first-instance panel of three seats each model once: no repeat', () => {
    for (let n = 1; n <= 200; n++) {
      const s = seats(n, 3);
      expect(new Set(s.map((x) => x.model)).size).toBe(3);
      expect(s.every((x) => !x.judgeId.includes(':'))).toBe(true);
    }
  });

  it('an escalation panel of five seats all three models, two of them twice, never one three times', () => {
    for (let n = 1; n <= 200; n++) {
      const s = seats(n, 5);
      expect(s).toHaveLength(5);
      expect(new Set(s.map((x) => x.judgeId)).size).toBe(5);
      const per = new Map<string, number>();
      for (const x of s) per.set(x.model, (per.get(x.model) ?? 0) + 1);
      expect([...per.values()].sort()).toEqual([1, 2, 2]);
      // The repeat is the same model, provider and family, under its own seat id.
      for (const x of s.filter((y) => y.judgeId.endsWith(':2'))) {
        const first = s.find((y) => y.judgeId === x.judgeId.slice(0, -2))!;
        expect([x.model, x.provider, x.family]).toEqual([first.model, first.provider, first.family]);
      }
    }
  });

  it('the seed chooses which models repeat: over 200 seeds every pair repeats, and one seed always gives the same panel', () => {
    const pairs = new Set<string>();
    for (let n = 1; n <= 200; n++) pairs.add(seats(n, 5).filter((x) => x.judgeId.endsWith(':2')).map((x) => x.family).sort().join('+'));
    expect([...pairs].sort()).toEqual(['claude+deepseek', 'claude+gemini', 'deepseek+gemini']);
    expect(seats(7, 5)).toEqual(seats(7, 5));
  });

  it('a repeated seat gets its own boundary and canary, so its prompt differs from the first seat of the model', () => {
    const s = seats(3, 5);
    const twice = s.find((x) => x.judgeId.endsWith(':2'))!;
    const a = judgeNonces(seed(3), CID, twice.judgeId.slice(0, -2));
    const b = judgeNonces(seed(3), CID, twice.judgeId);
    expect(b.boundary).not.toBe(a.boundary);
    expect(b.canary).not.toBe(a.canary);
  });

  it('a seat id with ":" can never be a registry id, so a repeat never collides with a real judge', () => {
    const doc = { version: 1, judges: [{ ...THREE.judges[0]!, id: 'claude-opus-5-5:2' }] };
    expect(loadRegistry(doc).ok).toBe(false);
  });

  it('refuses more than twice the registry: no model sits three times', () => {
    expect(selectPanel({ registry: reg(), seed: seed(1), commitmentId: CID, size: 7, minFamilies: 2 }).ok).toBe(false);
  });

  it('a registry at least as large as the panel seats exactly as before (panel-1 unchanged)', () => {
    const doc: RegistryDoc = { version: 1, judges: [...THREE.judges, { id: 'claude-x', provider: 'anthropic', family: 'claude', model: 'claude-x@2026-01-01', status: 'active' }, { id: 'deepseek-y', provider: 'openai-compatible', family: 'deepseek', model: 'deepseek-y@2026-01-01', status: 'active' }] };
    const r = loadRegistry(doc);
    if (!r.ok) throw new Error(r.error.detail);
    for (let n = 1; n <= 50; n++) {
      const s = selectPanel({ registry: r.value, seed: seed(n), commitmentId: CID, size: 5, minFamilies: 3 });
      if (!s.ok) throw new Error(s.error);
      expect(s.value.every((x) => !x.judgeId.includes(':'))).toBe(true);
      expect(new Set(s.value.map((x) => x.model)).size).toBe(5);
    }
  });
});

// The escalation runs at the live policy's appeal thresholds: 4 valid verdicts of 5, and 2/3 supermajorities.
describe('no decision rests on one family when seats repeat (ADR-0043)', () => {
  const IDS = RUBRIC.criteria.map((c) => c.id);
  const verdict = (overall: JudgeVerdict['overall']): JudgeVerdict => ({ criteria: IDS.map((id) => ({ id, score: overall === 'pass' ? 4 : 0, evidence: '' })), overall, injectionSuspected: false, rationale: '' });
  const T = { minValid: 4, acceptSupermajority: { numerator: 2, denominator: 3 }, rejectSupermajority: { numerator: 2, denominator: 3 } };
  /** The panel's verdicts, each seat's family taken from its seat, as the pipeline does. */
  const panel = (n: number, answer: (family: string) => JudgeVerdict['overall'] | null): PanelVerdict[] =>
    seats(n, 5).map((x) => {
      const a = answer(x.family);
      return { family: x.family, verdict: a === null ? null : verdict(a) };
    });
  const decide = (verdicts: PanelVerdict[], filtered = 0) =>
    aggregate({ checks: [], rubric: RUBRIC, screenFlagged: false, verdicts, thresholds: T, appeal: 'escalated', appealFamilies: 3, filterAbstentions: filtered, escalate: filtered ? ['filtered'] : [] });

  it('one family never decides alone: its two seats agreeing, every other seat failing to answer, is no accept', () => {
    for (let n = 1; n <= 100; n++) {
      for (const fam of ['claude', 'gemini', 'deepseek']) {
        const d = decide(panel(n, (f) => (f === fam ? 'pass' : null)));
        expect(d.decision).not.toBe('accept');
      }
    }
  });

  it('every accept or reject is carried by at least two families, whichever models repeat', () => {
    const answers: Array<(f: string) => JudgeVerdict['overall']> = [
      (f) => (f === 'deepseek' ? 'fail' : 'pass'),
      (f) => (f === 'gemini' ? 'fail' : 'pass'),
      (f) => (f === 'claude' ? 'pass' : 'fail'),
      (f) => (f === 'deepseek' ? 'pass' : 'fail'),
    ];
    for (let n = 1; n <= 100; n++) {
      for (const answer of answers) {
        const vs = panel(n, answer);
        const d = decide(vs);
        if (d.decision === 'accept' || d.decision === 'reject') {
          const side = d.decision === 'accept' ? 'pass' : 'fail';
          expect(new Set(vs.filter((v) => v.verdict?.overall === side).map((v) => v.family)).size).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('a repeated seat never counts as a second family: a flagged appeal needing three families is not met by two models with one repeated', () => {
    for (let n = 1; n <= 100; n++) {
      const s = seats(n, 5);
      const twice = new Set(s.filter((x) => x.judgeId.endsWith(':2')).map((x) => x.family));
      const missing = ['claude', 'gemini', 'deepseek'].find((f) => !twice.has(f))!;
      // The model seated once gives no valid verdict; the two repeated models pass on all four of their seats.
      const vs = panel(n, (f) => (f === missing ? null : 'pass'));
      const d = decide(vs, 1);
      expect(d.decision).toBe('reject');
      expect(d.passFamilies).toEqual([...twice].sort());
    }
  });
});

describe('the pipeline seats a repeat only as the judge\'s own second seat (T-631)', () => {
  const opus = { judgeId: 'claude-opus-5-5', provider: 'anthropic', family: 'claude', model: 'claude-opus-5-5@2026-09-21' };
  const neon = { judgeId: 'gemini-4-neon', provider: 'google', family: 'gemini', model: 'gemini-4-neon@2026-11-26' };
  const run = async (panel: Array<typeof opus>) => {
    const { runPipeline } = await import('./pipeline.js');
    const { fakeProvider } = await import('./providers/fake.js');
    const { intake } = await import('./intake.js');
    const { ADJUDICATOR, delivery, fakeUnwrap, NONCES, POLICY, seal, utf8 } = await import('./_helpers.js');
    const pt = utf8('a,b\n1,2\n');
    const ct = seal(pt);
    const r = await intake({ delivery: delivery(pt, ct), ciphertext: ct, recipient: ADJUDICATOR, unwrapKey: fakeUnwrap });
    if (!r.ok) throw new Error(r.error.detail);
    return runPipeline({ intake: r.value, acceptance: { deterministicChecks: [], rubric: RUBRIC }, deliverable: { description: 'd' }, policy: POLICY, seats: panel, provider: fakeProvider(), nonces: (_s, i) => ({ boundary: NONCES.boundary.replace(/.$/, String(i)), canary: NONCES.canary.replace(/.$/, String(i)) }) });
  };
  it('accepts a judge and its `:2` repeat', async () => {
    expect((await run([opus, { ...opus, judgeId: 'claude-opus-5-5:2' }, neon])).ok).toBe(true);
  });
  it.each([
    ['the same model under another id', [opus, { ...opus, judgeId: 'claude-opus-5-5-b' }, neon]],
    ['a repeat with no first seat', [{ ...opus, judgeId: 'claude-opus-5-5:2' }, { ...opus, judgeId: 'x:2' }, neon]],
    ['a model three times', [opus, { ...opus, judgeId: 'claude-opus-5-5:2' }, { ...opus, judgeId: 'claude-opus-5-5:3' }, neon]],
  ])('refuses %s', async (_n, panel) => {
    const r = await run(panel);
    expect(!r.ok && r.error.detail).toContain('duplicate model ID in the panel');
  });
});
