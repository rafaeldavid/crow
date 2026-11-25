import { createHash } from 'node:crypto';
import type { JudgeVerdict } from '@holdback/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { criterion, RUBRIC } from './_helpers.js';
import { AGGREGATION_VERSION, aggregate, preDecision, SCREEN_FLAGGED_REASON, signedOutcome, type AggregateInput, type PanelVerdict } from './aggregate.js';
import { KEPT } from './kept.js';
import type { CheckOutcome } from './checks/index.js';
import type { Fraction, JudgmentRubric } from './terms.js';

const IDS = RUBRIC.criteria.map((c) => c.id);
const v = (family: string, overall: JudgeVerdict['overall'], scores: number[] = [4, 4, 4], injectionSuspected = false): PanelVerdict => ({
  family,
  verdict: {
    criteria: IDS.map((id, i) => ({ id, score: scores[i] as 0 | 1 | 2 | 3 | 4, evidence: '' })),
    overall,
    injectionSuspected,
    rationale: '',
  },
});
const invalid = (family: string): PanelVerdict => ({ family, verdict: null });
const ok = (id: string, required = true): CheckOutcome => ({ checkId: id, required, passed: true });
const bad = (id: string, required = true): CheckOutcome => ({ checkId: id, required, passed: false, detail: 'failed' });
const frac = (numerator: number, denominator: number): Fraction => ({ numerator, denominator });
const T = { minValid: 2, acceptSupermajority: frac(2, 3), rejectSupermajority: frac(2, 3) };
const APPEAL = { minValid: 4, acceptSupermajority: frac(4, 5), rejectSupermajority: frac(4, 5) };
const EMPTY: JudgmentRubric = { criteria: [], passThreshold: 0 };
const input = (over: Partial<AggregateInput>): AggregateInput => ({
  checks: [ok('cols')],
  rubric: RUBRIC,
  screenFlagged: false,
  verdicts: [v('claude', 'pass'), v('gpt', 'pass'), v('gemini', 'pass')],
  thresholds: T,
  ...over,
});
const decide = (over: Partial<AggregateInput>) => aggregate(input(over)).decision;
const five = (passes: number) => ['a', 'b', 'c', 'd', 'e'].map((f, i) => (i < passes ? v(f, 'pass') : v(f, 'fail')));

describe('preDecision (the short circuits)', () => {
  it.each([
    ['required check failed', [bad('a')], RUBRIC, [], 'reject'],
    ['required failed, rubric empty', [bad('a')], EMPTY, [], 'reject'],
    ['all passed, rubric empty', [ok('a')], EMPTY, [], 'accept'],
    ['no checks, rubric empty', [], EMPTY, [], 'accept'],
    ['optional failed, rubric empty', [bad('a', false)], EMPTY, [], 'panel'],
    ['all passed, rubric present', [ok('a')], RUBRIC, [], 'panel'],
    ['optional failed, rubric present', [ok('a'), bad('b', false)], RUBRIC, [], 'panel'],
    ['required check inconclusive', [bad('a')], RUBRIC, ['a'], 'escalate'],
    ['inconclusive with an empty rubric', [bad('a', false)], EMPTY, ['a'], 'escalate'],
    ['a definite required failure beats an inconclusive check', [bad('a'), bad('b')], RUBRIC, ['b'], 'reject'],
  ] as const)('%s -> %s', (_n, checks, rubric, inconclusive, expected) => {
    expect(preDecision([...checks], { criteria: [...rubric.criteria], passThreshold: rubric.passThreshold }, [...inconclusive])).toBe(expected);
  });
});

describe('aggregate: table', () => {
  const cases: Array<[string, Partial<AggregateInput>, 'accept' | 'reject' | 'escalate']> = [
    // Line 1: required deterministic failure rejects before anything else.
    ['required check failed beats unanimous pass', { checks: [bad('cols')] }, 'reject'],
    ['required check failed beats screen flag', { checks: [bad('cols')], screenFlagged: true }, 'reject'],
    ['optional check failed does not reject', { checks: [bad('cols', false)] }, 'accept'],
    // Line 2: a check out of budget escalates without the panel.
    ['inconclusive check escalates', { checks: [bad('cols')], inconclusive: ['cols'] }, 'escalate'],
    // Line 3: all checks passed and rubric empty accepts without the panel (D17 keeps it with a flag).
    ['rubric empty, checks pass, no verdicts', { rubric: EMPTY, verdicts: [] }, 'accept'],
    ['rubric empty, screen flagged, still accepts', { rubric: EMPTY, screenFlagged: true, verdicts: [] }, 'accept'],
    // Line 5: screen flag or any injectionSuspected escalates.
    ['screen flagged, unanimous pass', { screenFlagged: true }, 'escalate'],
    ['one judge suspects injection', { verdicts: [v('claude', 'pass'), v('gpt', 'pass', [4, 4, 4], true), v('gemini', 'pass')] }, 'escalate'],
    ['an abstaining judge suspects injection', { verdicts: [v('claude', 'pass'), v('gpt', 'pass'), v('gemini', 'abstain', [0, 0, 0], true)] }, 'escalate'],
    ['injection beats unanimous fail', { verdicts: [v('claude', 'fail', [0, 0, 0], true), v('gpt', 'fail', [0, 0, 0]), v('gemini', 'fail', [0, 0, 0])] }, 'escalate'],
    // Line 6: filter abstentions and sampled data escalate.
    ['a filter abstention escalates a unanimous pass', { escalate: ['judge x output rejected by a filter (url)'] }, 'escalate'],
    ['a filter abstention escalates a unanimous fail', { escalate: ['judge x output rejected by a filter (schema)'], verdicts: [v('a', 'fail'), v('b', 'fail'), v('c', 'fail')] }, 'escalate'],
    // Line 8: too few valid verdicts escalates.
    ['one valid of three', { verdicts: [v('claude', 'pass'), invalid('gpt'), v('gemini', 'abstain')] }, 'escalate'],
    ['no verdicts at all', { verdicts: [] }, 'escalate'],
    ['two valid is enough', { verdicts: [v('claude', 'pass'), v('gpt', 'pass'), invalid('gemini')] }, 'accept'],
    ['minValid 0 with no verdicts escalates', { thresholds: { ...T, minValid: 0 }, verdicts: [] }, 'escalate'],
    // Line 9: accept.
    ['unanimous pass, three families', {}, 'accept'],
    ['2 of 3 pass at 2/3 from two families accepts', { verdicts: [v('claude', 'pass'), v('gpt', 'pass'), v('gemini', 'fail', [1, 1, 1])] }, 'accept'],
    ['unanimous pass, one family', { verdicts: [v('claude', 'pass'), v('claude', 'pass'), v('claude', 'pass')] }, 'escalate'],
    ['3 pass but only one pass family', { verdicts: [v('claude', 'pass'), v('claude', 'pass'), v('gpt', 'fail', [0, 0, 0])] }, 'escalate'],
    ['unanimous pass, score below threshold', { verdicts: [v('claude', 'pass', [3, 3, 2]), v('gpt', 'pass', [3, 3, 2]), v('gemini', 'pass', [3, 3, 2])] }, 'escalate'],
    ['score exactly at threshold', { verdicts: [v('claude', 'pass', [3, 3, 3]), v('gpt', 'pass', [3, 3, 3])] }, 'accept'],
    // Line 10: reject.
    ['unanimous fail', { verdicts: [v('claude', 'fail', [0, 0, 0]), v('gpt', 'fail', [0, 0, 0]), v('gemini', 'fail', [0, 0, 0])] }, 'reject'],
    ['2 of 3 fail', { verdicts: [v('claude', 'fail', [0, 0, 0]), v('gpt', 'fail', [0, 0, 0]), v('gemini', 'pass')] }, 'reject'],
    ['2 of 3 fail from one family still rejects', { verdicts: [v('claude', 'fail', [0, 0, 0]), v('claude', 'fail', [0, 0, 0]), v('gpt', 'pass')] }, 'reject'],
    ['fail with high scores still rejects', { verdicts: [v('claude', 'fail'), v('gpt', 'fail'), v('gemini', 'fail')] }, 'reject'],
    // agg-4 (T-570): no decision on valid verdicts from one family, whatever removed the other family's seats.
    ['2 fail from one family, the other family timed out', { verdicts: [v('claude', 'fail', [0, 0, 0]), v('claude', 'fail', [0, 0, 0]), invalid('gpt')] }, 'escalate'],
    ['2 fail from one family, the other family abstains', { verdicts: [v('claude', 'fail', [0, 0, 0]), v('claude', 'fail', [0, 0, 0]), v('gpt', 'abstain')] }, 'escalate'],
    ['appeal 4/5: 4 fail from one family, the others timed out', { thresholds: APPEAL, verdicts: [v('a', 'fail'), v('a', 'fail'), v('a', 'fail'), v('a', 'fail'), invalid('b')] }, 'escalate'],
    ['2 fail from two families, one seat timed out, still rejects', { verdicts: [v('claude', 'fail', [0, 0, 0]), v('gpt', 'fail', [0, 0, 0]), invalid('gemini')] }, 'reject'],
    // agg-4 (T-570, red team M1): after a fault, a reject needs fails from two families.
    ['5 seats: 3 claude fail, 1 gpt pass, 1 gpt timed out escalates (the fails come from one family)', { thresholds: { ...T, minValid: 4 }, verdicts: [v('claude', 'fail', [0, 0, 0]), v('claude', 'fail', [0, 0, 0]), v('claude', 'fail', [0, 0, 0]), v('gpt', 'pass'), invalid('gpt')] }, 'escalate'],
    ['5 seats: 1 claude pass, 2 claude fail, 1 gpt fail, 1 gpt timed out still rejects (fails from two families)', { thresholds: { ...T, minValid: 4 }, verdicts: [v('claude', 'pass'), v('claude', 'fail', [0, 0, 0]), v('claude', 'fail', [0, 0, 0]), v('gpt', 'fail', [0, 0, 0]), invalid('gpt')] }, 'reject'],
    ['5 seats: 3 pass from two families, 1 fail, 1 timed out accepts (passes from two families; the existing design)', { thresholds: { ...T, minValid: 4 }, verdicts: [v('claude', 'pass'), v('gpt', 'pass'), v('gpt', 'pass'), v('qwen', 'fail', [0, 0, 0]), invalid('qwen')] }, 'accept'],
    ['3 seats, every seat answers: 2 claude fail, 1 gpt pass still rejects (the existing design)', { verdicts: [v('claude', 'fail', [0, 0, 0]), v('claude', 'fail', [0, 0, 0]), v('gpt', 'pass')] }, 'reject'],
    // Line 11: otherwise escalate; ties never decide.
    ['1 pass, 1 fail, 1 abstain', { verdicts: [v('claude', 'pass'), v('gpt', 'fail', [0, 0, 0]), v('gemini', 'abstain')] }, 'escalate'],
    ['2-2 tie escalates', { verdicts: [v('a', 'pass'), v('b', 'pass'), v('c', 'fail'), v('d', 'fail')] }, 'escalate'],
    // Appeal policy 4/5.
    ['appeal 4/5: 3 of 5 pass escalates', { thresholds: APPEAL, verdicts: five(3) }, 'escalate'],
    ['appeal 4/5: 4 of 5 pass accepts', { thresholds: APPEAL, verdicts: five(4) }, 'accept'],
    ['appeal 4/5: 4 of 5 fail rejects', { thresholds: APPEAL, verdicts: five(1) }, 'reject'],
  ];
  it.each(cases)('%s', (_name, over, expected) => expect(decide(over)).toBe(expected));
});

// L3-1 and D27a (ADR-0021 amendment, red-team review of PR 52): at the appeal there is no further instance,
// so an escalation there means no decision and the default outcome pays the seller from the appeal bond.
// A flagged appeal (screen flag, a judge's injection suspicion, or a filter abstention) therefore never
// escalates: it accepts only on a unanimous valid panel from all required families with no injection
// suspected and the score met, and otherwise rejects.
describe('aggregate: a flagged appeal accepts only unanimously, else rejects (L3-1, D27a)', () => {
  const appeal = (over: Partial<AggregateInput>) => input({ appeal: 'escalated', appealFamilies: 3, thresholds: APPEAL, ...over });
  const injected = (passes: number) => ['a', 'b', 'c', 'd', 'e'].map((f, i) => (i < passes ? v(f, 'pass') : v(f, 'fail', [0, 0, 0], true)));
  const fams = (...f: string[]) => f.map((x) => v(x, 'pass'));
  const FILTER = ['judge x output rejected by a filter (url)'];
  const SAMPLED = 'the judges saw a sample of the deliverable, not all of it';
  it.each([
    ['screen flagged, 5 of 5 fail rejects', { screenFlagged: true, verdicts: five(0) }, 'reject'],
    ['screen flagged, 5 of 5 pass from 5 families accepts', { screenFlagged: true, verdicts: five(5) }, 'accept'],
    ['screen flagged, 4 of 5 pass rejects (a supermajority is not enough)', { screenFlagged: true, verdicts: five(4) }, 'reject'],
    ['screen flagged, 3 of 5 pass rejects, never escalates', { screenFlagged: true, verdicts: five(3) }, 'reject'],
    ['screen flagged, 2 of 5 pass rejects, never escalates', { screenFlagged: true, verdicts: five(2) }, 'reject'],
    ['screen flagged, unanimous pass from 2 families rejects when 3 are required', { screenFlagged: true, verdicts: fams('a', 'a', 'b', 'b', 'a') }, 'reject'],
    ['screen flagged, unanimous pass from 3 families accepts', { screenFlagged: true, verdicts: fams('a', 'a', 'b', 'b', 'c') }, 'accept'],
    ['screen flagged, unanimous pass but one judge suspects injection rejects', { screenFlagged: true, verdicts: [...five(4), v('e', 'pass', [4, 4, 4], true)] }, 'reject'],
    ['screen flagged, unanimous pass below the score threshold rejects', { screenFlagged: true, verdicts: ['a', 'b', 'c', 'd', 'e'].map((f) => v(f, 'pass', [2, 2, 2])) }, 'reject'],
    ['screen flagged, a timeout seat rejects even if the rest pass', { screenFlagged: true, verdicts: [...five(5).slice(0, 4), invalid('e')] }, 'reject'],
    ['screen flagged, an abstaining seat rejects', { screenFlagged: true, verdicts: [...five(5).slice(0, 4), v('e', 'abstain')] }, 'reject'],
    ['screen flagged, too few valid verdicts rejects, never escalates', { screenFlagged: true, verdicts: [v('a', 'fail'), v('b', 'fail'), invalid('c'), invalid('d'), invalid('e')] }, 'reject'],
    ['screen flagged, a filter abstention rejects, never escalates', { screenFlagged: true, verdicts: five(0), escalate: FILTER, filterAbstentions: 1 }, 'reject'],
    ['unflagged, a filter abstention alone flags the appeal: 4 pass then reject', { verdicts: [...five(5).slice(0, 4), invalid('e')], escalate: FILTER, filterAbstentions: 1 }, 'reject'],
    ['unflagged, a judge suspects injection: 4 of 5 fail rejects', { verdicts: injected(1) }, 'reject'],
    ['unflagged, a judge suspects injection while 4 pass: rejects', { verdicts: [...five(4), v('e', 'fail', [0, 0, 0], true)] }, 'reject'],
    // D27b: a forced even-stride sample (a seller can pad one record past the sampling budget) is seller-controllable
    // too: after an escalation it never ends in no decision, and the judges never read the whole file, so reject.
    ['unflagged, sampled data, 5 of 5 pass: rejects (path 5)', { verdicts: five(5), escalate: [SAMPLED] }, 'reject'],
    ['unflagged, sampled data, 3 of 5 pass: rejects, never escalates', { verdicts: five(3), escalate: [SAMPLED] }, 'reject'],
    // Without a seller-controllable condition the appeal keeps the normal rule (an escalation there maps to no
    // decision, and a genuine split goes to the default outcome; backlog).
    ['unflagged, 4 of 5 pass accepts by the supermajority', { verdicts: five(4) }, 'accept'],
    ['unflagged, 3 of 5 pass escalates', { verdicts: five(3) }, 'escalate'],
  ] as const)('%s', (_name, over, expected) => expect(aggregate(appeal(over as Partial<AggregateInput>)).decision).toBe(expected));

  it('the primary and fallback (first instance) still escalate a flag under the same thresholds', () => {
    expect(decide({ thresholds: APPEAL, screenFlagged: true, verdicts: five(0) })).toBe('escalate');
    expect(decide({ appealFamilies: 3, thresholds: APPEAL, screenFlagged: true, verdicts: five(5) })).toBe('escalate');
    expect(decide({ thresholds: APPEAL, verdicts: five(5), escalate: FILTER, filterAbstentions: 1 })).toBe('escalate');
    expect(decide({ thresholds: APPEAL, verdicts: five(5), escalate: [SAMPLED] })).toBe('escalate');
  });

  // D27c: on a party appeal (the first decision exists), judge-level noise must not overturn it. Flags escalate
  // as at first instance, and signedOutcome then keeps the first decision.
  it.each([
    ['party appeal, 5 of 5 pass but one false injection suspicion: escalates (the first decision stands)', { verdicts: [...five(4), v('e', 'pass', [4, 4, 4], true)] }, 'escalate'],
    ['party appeal, one filter abstention (not_json): escalates', { verdicts: [...five(5).slice(0, 4), invalid('e')], escalate: ['judge e output rejected by a filter (not_json)'], filterAbstentions: 1 }, 'escalate'],
    ['party appeal, screen flagged: escalates', { screenFlagged: true, verdicts: five(5) }, 'escalate'],
    ['party appeal, sampled data: escalates', { verdicts: five(5), escalate: [SAMPLED] }, 'escalate'],
    ['party appeal, unflagged 5 of 5 fail: rejects (an overturn)', { verdicts: five(0) }, 'reject'],
    ['party appeal, unflagged 4 of 5 pass: accepts', { verdicts: five(4) }, 'accept'],
  ] as const)('%s', (_name, over, expected) => {
    const d = aggregate(input({ appeal: 'party', appealFamilies: 3, thresholds: APPEAL, ...(over as Partial<AggregateInput>) })).decision;
    expect(d).toBe(expected);
    expect(signedOutcome(d, { appeal: true, firstOutcome: 'accept' })).toBe(expected === 'escalate' ? 'accept' : expected);
  });

  it('keeps the flag in the record: a flagged appeal decision carries the screen and injection reasons', () => {
    const r = aggregate(appeal({ screenFlagged: true, verdicts: injected(0) }));
    expect(r.decision).toBe('reject');
    expect(r.reasons[0]).toMatch(/^flagged appeal: rejected/);
    expect(r.reasons).toContain(SCREEN_FLAGGED_REASON);
    expect(r.reasons).toContain('a judge suspected injection');
    const a = aggregate(appeal({ screenFlagged: true, verdicts: five(5) }));
    expect(a.decision).toBe('accept');
    expect(a.reasons[0]).toMatch(/^flagged appeal: 5 of 5 seats pass/);
    expect(a.reasons).toContain(SCREEN_FLAGGED_REASON);
  });
});

// D27 (red-team review of PR 52): the policy hash binds AGGREGATION_VERSION, so the rule must not change
// under the same version. This digest covers the decisions on a fixed seeded corpus; changing aggregate's
// semantics changes it, and the test then demands a new version and a new pinned entry.
describe('aggregate: the decision table is pinned to AGGREGATION_VERSION', () => {
  const PINNED: Readonly<Record<string, string>> = {
    // Re-pinned for D27b/c before agg-3 reached main (no policy outside this repository bound the earlier table).
    'agg-3': '4cbc921977c5e5ad282d4eb1b66f197222b5fd6a04b25d3de17b913db6e50f25',
    // T-570, ADR-0043: agg-3 plus two rules for judge faults (valid verdicts from two families; after a fault, fails from two).
    'agg-4': 'ce2941a18e78b435a7c7b5011562b7e79f098db8ea6925a5702c878846b7de52',
    // ADR-0049: agg-4's decisions; agg-5 adds the cut reasons and the cut filter, which the next test and cut.test.ts pin.
    'agg-5': 'ce2941a18e78b435a7c7b5011562b7e79f098db8ea6925a5702c878846b7de52',
  };
  // Built inside each test: the arbitraries are declared further down this file.
  const corpus = () => fc.sample(arbInputPublic, { seed: 2718, numRuns: 3000 }).map(buildPublic);
  /** Each decision, then what each role signs for it (signedOutcome is part of the rule a policy binds). */
  const digestOf = (impl: { aggregate: typeof aggregate; signedOutcome: typeof signedOutcome }) => {
    const row = (i: AggregateInput) => {
      const d = impl.aggregate(i).decision;
      return [d, impl.signedOutcome(d, { appeal: false }), impl.signedOutcome(d, { appeal: true }), impl.signedOutcome(d, { appeal: true, firstOutcome: 'accept' }), impl.signedOutcome(d, { appeal: true, firstOutcome: 'reject' })].join(':');
    };
    return createHash('sha256').update(corpus().map(row).join(',')).digest('hex');
  };
  it('the digest of decisions and signed outcomes on a seeded corpus matches the pinned digest for this version', () => {
    const digest = digestOf({ aggregate, signedOutcome });
    expect(PINNED[AGGREGATION_VERSION], `aggregate semantics changed: bump AGGREGATION_VERSION and pin ${digest} under it`).toBe(digest);
  });
  // T-570: the corpus above rarely reaches the panel's own rules (most samples carry a flag, an injection suspicion or a
  // filter abstention). This one does: unflagged panels of 3 to 7 seats with faults and abstentions, at the primary,
  // the party appeal and the escalated appeal. Each kept version pins its digest here too.
  const PANEL_PINNED: Readonly<Record<string, string>> = {
    'agg-3': '54149ef79b20c9a607bcad0f694be045ae556effc4ab0d10915e8f1f7e488b21',
    'agg-4': '164860c833455d206e1cf3910fc5e6a5467105e77d026d36b8990a844a028e6d',
    'agg-5': '164860c833455d206e1cf3910fc5e6a5467105e77d026d36b8990a844a028e6d',
  };
  const panelCorpus = unflaggedPanelCorpus;
  const panelDigestOf = (impl: { aggregate: typeof aggregate }) => createHash('sha256').update(panelCorpus().map((i) => impl.aggregate(i).decision).join(',')).digest('hex');
  it.each([...KEPT.aggregations.keys()])('kept %s keeps its pinned digest on unflagged panels with faults', (version) => {
    const digest = panelDigestOf(KEPT.aggregations.get(version)!);
    expect(PANEL_PINNED[version], `pin ${digest} for ${version}`).toBe(digest);
  });
  it('agg-3 and agg-4 decide differently on that corpus, so the digest pins the new rules', () => {
    expect(PANEL_PINNED['agg-3']).not.toBe(PANEL_PINNED['agg-4']);
  });
  // ADR-0049 section 7: agg-5's rule is agg-4's with the cut reasons appended after the decision's own reasons.
  it('agg-5 returns what agg-4 returns, and with cut lines it appends them and nothing else', () => {
    const agg4 = KEPT.aggregations.get('agg-4')!;
    const agg5 = KEPT.aggregations.get('agg-5')!;
    const cuts = ['judge claude-a free text cut to its cap (rationale)', `judge ${'x'.repeat(300)} free text cut`];
    for (const input of [...corpus(), ...panelCorpus()]) {
      const four = agg4.aggregate(input);
      expect(agg5.aggregate(input)).toEqual(four);
      const five = agg5.aggregate({ ...input, cuts });
      expect(five).toEqual({ ...four, reasons: [...four.reasons, cuts[0], `${cuts[1]!.slice(0, 197)}...`] });
    }
  });
  // ADR-0036: every kept version keeps its pinned digest, so a version bound by open deals never changes under its label.
  it.each([...KEPT.aggregations.keys()])('kept %s keeps its pinned digest', (version) => {
    expect(PINNED[version]).toBeDefined();
    expect(digestOf(KEPT.aggregations.get(version)!)).toBe(PINNED[version]);
  });
});

describe('signedOutcome: what a role signs (shared by the service and the snap runner)', () => {
  it.each([
    ['primary signs an escalation', 'escalate', { appeal: false }, 'escalate'],
    ['primary signs a reject', 'reject', { appeal: false }, 'reject'],
    ['appeal after escalation, undecided: no decision', 'escalate', { appeal: true }, null],
    ['party appeal, undecided: the first decision stands', 'escalate', { appeal: true, firstOutcome: 'accept' }, 'accept'],
    ['appeal decides a reject', 'reject', { appeal: true }, 'reject'],
  ] as const)('%s', (_n, decision, role, expected) => expect(signedOutcome(decision, role)).toBe(expected));
});

describe('aggregate: reported fields', () => {
  it('weighted score is integer hundredths of the mean over valid verdicts', () => {
    const r = aggregate(input({ verdicts: [v('claude', 'pass', [4, 4, 3]), v('gpt', 'pass', [2, 2, 2]), v('gemini', 'abstain', [0, 0, 0]), invalid('x')] }));
    // (4*4000+4*4000+3*2000)/10000 = 3.8 ; 2 ; mean 2.9 -> 290
    expect(r.weightedScore).toBe(290);
    expect(r.decision).toBe('escalate');
  });

  it('floors the score and compares it exactly by cross-multiplication', () => {
    const rubric: JudgmentRubric = { criteria: [criterion('a', 1), criterion('b', 2)], passThreshold: 334 };
    const mk = (f: string, a: number, b: number): PanelVerdict => ({ family: f, verdict: { criteria: [{ id: 'a', score: a as 4, evidence: '' }, { id: 'b', score: b as 4, evidence: '' }], overall: 'pass', injectionSuspected: false, rationale: '' } });
    // (1*4 + 2*3) / 3 = 3.333... -> 333, below 334 -> no accept.
    const r = aggregate(input({ rubric, verdicts: [mk('f', 4, 3), mk('g', 4, 3)] }));
    expect(r.weightedScore).toBe(333);
    expect(r.decision).toBe('escalate');
    expect(aggregate(input({ rubric: { ...rubric, passThreshold: 333 }, verdicts: [mk('f', 4, 3), mk('g', 4, 3)] })).decision).toBe('accept');
  });

  it('reports counts among valid verdicts and sorted distinct pass families', () => {
    const r = aggregate(input({ verdicts: [v('gpt', 'pass'), v('claude', 'pass'), v('claude', 'pass'), v('gemini', 'fail', [0, 0, 0]), invalid('z')] }));
    expect([r.passCount, r.failCount, r.validCount]).toEqual([3, 1, 4]);
    expect(r.passFamilies).toEqual(['claude', 'gpt']);
  });

  it('has a null score and no counts when the panel did not run', () => {
    const r = aggregate(input({ checks: [bad('cols')] }));
    expect(r).toEqual({ decision: 'reject', weightedScore: null, reasons: ['required deterministic check failed: cols'] });
  });

  it('an empty-rubric accept with a flagged screen says so (D17)', () => {
    const r = aggregate(input({ rubric: EMPTY, screenFlagged: true, verdicts: [] }));
    expect(r.decision).toBe('accept');
    expect(r.reasons).toEqual(['all deterministic checks passed and the rubric is empty', SCREEN_FLAGGED_REASON]);
  });

  it('always gives at least one reason, each at most 200 characters', () => {
    const long = 'x'.repeat(40);
    const all: Array<Partial<AggregateInput>> = [{}, { screenFlagged: true }, { verdicts: [] }, { escalate: ['y'.repeat(300)] }, { checks: [bad(long), bad(`${long}2`), bad(`${long}3`), bad(`${long}4`), bad(`${long}5`)] }];
    for (const over of all) {
      const r = aggregate(input(over));
      expect(r.reasons.length).toBeGreaterThan(0);
      for (const reason of r.reasons) expect(reason.length).toBeLessThanOrEqual(200);
    }
  });
});

// An independent, literal transcription of the rule (docs pseudo-code plus D17 and D18), as an oracle.
function oracle(i: AggregateInput): 'accept' | 'reject' | 'escalate' {
  const inc = new Set(i.inconclusive ?? []);
  if (i.checks.some((c) => c.required && !c.passed && !inc.has(c.checkId))) return 'reject';
  if (inc.size) return 'escalate';
  if (i.checks.every((c) => c.passed) && i.rubric.criteria.length === 0) return 'accept';
  const injection = i.verdicts.some((x) => x.verdict?.injectionSuspected);
  const valid = i.verdicts.filter((x) => x.verdict && x.verdict.overall !== 'abstain');
  const W = i.rubric.criteria.reduce((s, c) => s + c.weight, 0);
  const sum = valid.reduce((s, x) => s + i.rubric.criteria.reduce((t, c) => t + c.weight * x.verdict!.criteria.find((k) => k.id === c.id)!.score, 0), 0);
  const pass = valid.filter((x) => x.verdict!.overall === 'pass').length;
  const fail = valid.filter((x) => x.verdict!.overall === 'fail').length;
  const fams = new Set(valid.filter((x) => x.verdict!.overall === 'pass').map((x) => x.family)).size;
  const n = valid.length;
  const scoreOk = i.rubric.criteria.length === 0 || sum * 100 >= i.rubric.passThreshold * W * n;
  // D27a/b: after an escalation, any seller-controllable condition (screen flag, injection suspicion, filter
  // abstention, sampled data) accepts only on a whole, unanimous, cross-family panel; otherwise reject.
  // D27c: a party appeal handles those conditions as at first instance (below).
  const sampled = (i.escalate?.length ?? 0) > (i.filterAbstentions ?? 0);
  if (i.appeal === 'escalated' && (i.screenFlagged || injection || (i.filterAbstentions ?? 0) > 0 || sampled)) {
    const whole = i.verdicts.length > 0 && n === i.verdicts.length && pass === n;
    return whole && !injection && !sampled && fams >= Math.max(2, i.appealFamilies ?? 2) && scoreOk ? 'accept' : 'reject';
  }
  if (i.screenFlagged || injection) return 'escalate';
  if (i.escalate?.length) return 'escalate';
  if (valid.length < i.thresholds.minValid || valid.length === 0) return 'escalate';
  // agg-4 (T-570): an accept or a reject needs valid verdicts from at least two families.
  if (new Set(valid.map((x) => x.family)).size < 2) return 'escalate';
  const a = i.thresholds.acceptSupermajority;
  const r = i.thresholds.rejectSupermajority;
  if (pass * a.denominator >= a.numerator * n && pass > fail && fams >= 2 && scoreOk) return 'accept';
  // agg-4 (T-570): after a fault, a reject needs fails from two families.
  const failFams = new Set(valid.filter((x) => x.verdict!.overall === 'fail').map((x) => x.family)).size;
  if (fail * r.denominator >= r.numerator * n && fail > pass && (n === i.verdicts.length || failFams >= 2)) return 'reject';
  return 'escalate';
}

// Strict-majority fractions only (the pipeline refuses others).
const arbFraction = fc.integer({ min: 1, max: 20 }).chain((den) => fc.integer({ min: Math.floor(den / 2) + 1, max: den }).map((num) => frac(num, den)));
const arbVerdict = fc.record({
  family: fc.constantFrom('claude', 'gpt', 'gemini'),
  kind: fc.constantFrom('pass', 'fail', 'abstain', 'invalid'),
  scores: fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 3, maxLength: 3 }),
  inj: fc.boolean(),
});
const arbInputPublic = fc.record({
  checks: fc.array(fc.record({ checkId: fc.constantFrom('a', 'b'), required: fc.boolean(), passed: fc.boolean() }), { maxLength: 3 }),
  inconclusive: fc.subarray(['a', 'b']),
  emptyRubric: fc.boolean(),
  passThreshold: fc.integer({ min: 0, max: 400 }),
  screenFlagged: fc.boolean(),
  appeal: fc.constantFrom(undefined, 'escalated' as const, 'party' as const),
  appealFamilies: fc.integer({ min: 1, max: 3 }),
  filtered: fc.integer({ min: 0, max: 2 }),
  sampled: fc.boolean(),
  verdicts: fc.array(arbVerdict, { maxLength: 7 }),
  minValid: fc.integer({ min: 0, max: 4 }),
  accept: arbFraction,
  reject: arbFraction,
});
type ArbIn = typeof arbInputPublic extends fc.Arbitrary<infer T> ? T : never;
function buildPublic(a: ArbIn): AggregateInput {
  const i: AggregateInput = {
    checks: a.checks,
    inconclusive: a.inconclusive.filter((id) => a.checks.some((c) => c.checkId === id && !c.passed)),
    rubric: a.emptyRubric ? { criteria: [], passThreshold: a.passThreshold } : { ...RUBRIC, passThreshold: a.passThreshold },
    screenFlagged: a.screenFlagged,
    ...(a.appeal ? { appeal: a.appeal } : {}),
    appealFamilies: a.appealFamilies,
    filterAbstentions: a.filtered,
    verdicts: a.verdicts.map((x) => (x.kind === 'invalid' ? invalid(x.family) : v(x.family, x.kind as JudgeVerdict['overall'], x.scores, x.inj))),
    thresholds: { minValid: a.minValid, acceptSupermajority: a.accept, rejectSupermajority: a.reject },
    escalate: [...Array.from({ length: a.filtered }, (_, k) => `judge f${k} output rejected by a filter (url)`), ...(a.sampled ? ['the judges saw a sample of the deliverable, not all of it'] : [])],
  };
  if (a.emptyRubric) for (const x of i.verdicts) if (x.verdict) x.verdict.criteria = [];
  return i;
}

describe('aggregate: properties', () => {
  const arbInput = arbInputPublic;
  const build = buildPublic;

  it('agrees with the oracle for 2000 seeded random inputs', () => {
    fc.assert(fc.property(arbInput, (a) => {
      const i = build(a);
      expect(aggregate(i).decision).toBe(oracle(i));
    }), { seed: 6, numRuns: 2000 });
  });

  // T-570: the corpus above seldom reaches the panel's own rules, so the oracle also runs over unflagged panels with faults.
  it('agrees with the oracle on every unflagged panel with faults in the pinned corpus', () => {
    for (const i of unflaggedPanelCorpus()) expect(aggregate(i).decision).toBe(oracle(i));
  });
});

describe('aggregate: the tie guard is defense in depth', () => {
  it('a 2-2 split escalates even under a non-majority fraction (which the pipeline refuses)', () => {
    const half = { minValid: 2, acceptSupermajority: frac(1, 2), rejectSupermajority: frac(1, 2) };
    expect(decide({ thresholds: half, verdicts: [v('a', 'pass'), v('b', 'pass'), v('c', 'fail'), v('d', 'fail')] })).toBe('escalate');
  });
});

/** Unflagged panels of 3 to 7 seats with faults and abstentions, at the primary and both appeals (T-570). */
function unflaggedPanelCorpus(): AggregateInput[] {
  return fc
    .sample(
      fc.record({
        verdicts: fc.array(fc.record({ family: fc.constantFrom('claude', 'gpt', 'gemini'), kind: fc.constantFrom('pass', 'fail', 'abstain', 'invalid') }), { minLength: 3, maxLength: 7 }),
        minValid: fc.integer({ min: 1, max: 4 }),
        accept: arbFraction,
        reject: arbFraction,
        appeal: fc.constantFrom(undefined, 'escalated' as const, 'party' as const),
      }),
      { seed: 5701, numRuns: 3000 },
    )
    .map((a): AggregateInput => ({
      checks: [ok('cols')],
      rubric: { ...RUBRIC, passThreshold: 0 },
      screenFlagged: false,
      ...(a.appeal ? { appeal: a.appeal } : {}),
      verdicts: a.verdicts.map((x) => (x.kind === 'invalid' ? invalid(x.family) : v(x.family, x.kind as JudgeVerdict['overall']))),
      thresholds: { minValid: a.minValid, acceptSupermajority: a.accept, rejectSupermajority: a.reject },
    }));
}

// ADR-0043 section 3: what agg-4 changes against agg-3, over every pattern of five outcomes per seat (pass, fail,
// schema-valid abstain, timeout, filter abstention) on the shipped panels. Pinned so the ADR's counts stay reproducible.
describe('aggregate: ADR-0043 section 3, the patterns agg-4 changes', () => {
  const OUT = ['pass', 'fail', 'abstain', 'timeout', 'filter'] as const;
  const changes = (families: string[], minValid: number, appeal?: 'escalated' | 'party') => {
    const agg3 = KEPT.aggregations.get('agg-3')!;
    const thresholds = { minValid, acceptSupermajority: frac(2, 3), rejectSupermajority: frac(2, 3) };
    const out: Record<string, number> = {};
    let allAnswered = 0;
    for (let k = 0; k < OUT.length ** families.length; k++) {
      const outs = families.map((_, j) => OUT[Math.floor(k / OUT.length ** j) % OUT.length]!);
      const filtered = outs.filter((o) => o === 'filter').length;
      const i: AggregateInput = {
        checks: [ok('cols')],
        rubric: { ...RUBRIC, passThreshold: 0 },
        screenFlagged: false,
        ...(appeal ? { appeal } : {}),
        appealFamilies: 2,
        filterAbstentions: filtered,
        verdicts: outs.map((o, j) => (o === 'timeout' || o === 'filter' ? invalid(families[j]!) : v(families[j]!, o, o === 'pass' ? [4, 4, 4] : [0, 0, 0]))),
        thresholds,
        escalate: Array.from({ length: filtered }, () => 'judge output rejected by a filter (schema)'),
      };
      const a = agg3.aggregate(i).decision;
      const b = aggregate(i).decision;
      if (a !== b) {
        out[`${a}->${b}`] = (out[`${a}->${b}`] ?? 0) + 1;
        if (outs.every((o) => o === 'pass' || o === 'fail')) allAnswered++;
      }
    }
    return { ...out, allAnswered };
  };
  it.each([
    ['primary, claude, claude, gpt', ['claude', 'claude', 'gpt'], 2, undefined, { 'reject->escalate': 2, allAnswered: 0 }],
    ['primary, three families', ['claude', 'gpt', 'qwen'], 2, undefined, { allAnswered: 0 }],
    ['escalated appeal, families 2, 2, 1', ['claude', 'claude', 'gpt', 'gpt', 'qwen'], 4, 'escalated', { allAnswered: 0 }],
    ['party appeal, families 2, 2, 1', ['claude', 'claude', 'gpt', 'gpt', 'qwen'], 4, 'party', { allAnswered: 0 }],
    ['escalated appeal, families 3, 2', ['claude', 'claude', 'claude', 'deepseek', 'deepseek'], 4, 'escalated', { 'reject->escalate': 4, allAnswered: 0 }],
    ['party appeal, families 3, 2', ['claude', 'claude', 'claude', 'deepseek', 'deepseek'], 4, 'party', { 'reject->escalate': 4, allAnswered: 0 }],
  ] as const)('%s', (_name, families, minValid, appeal, expected) => {
    expect(changes([...families], minValid, appeal)).toEqual(expected);
  });
});
