// Partner C's appeal of 2026-11-25, replayed from its own record (ADR-0049). The record lives in the maintainers'
// private repository (docs/private-materials.md), so this runs only where CROW_PARTNER_C_DEAL names the deal's folder,
// and says so when skipped; template-limits.test.ts carries a public model of the same panel that runs everywhere.
//
// The record keeps the two DeepSeek seats' verdicts and no output for the three Claude seats. The cause of their
// abstention is inferred, not measured: an evidence over its 300-character cap. So each Claude seat is rebuilt as the
// DeepSeek flash verdict with its first evidence run to 340 code points. Under agg-4 the replay must give the
// recorded decision and reasons; under agg-5 the same outputs must accept.
//
// T-616 (ADR-0050): under template pair 3 and agg-6 each seat answers in codes. The DeepSeek seats keep their recorded
// scores, overall and flag; each Claude seat answers as DeepSeek flash did and adds a habitual rationale, the
// evidence of the prose it was used to. The rationale is an unknown key: dropped and counted, and the seat counts.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JudgeVerdict } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import type { PanelVerdict } from './aggregate.js';
import { KEPT, type AggregationImpl } from './kept.js';
import { anchorKey, NO_REFS } from './refs.js';
import { cutReason } from './pipeline.js';
import type { JudgmentRubric } from './terms.js';

const DIR = process.env['CROW_PARTNER_C_DEAL'];
const present = !!DIR && existsSync(join(DIR, 'judgment-latest.json')) && existsSync(join(DIR, 'quote.json'));
const json = (f: string) => JSON.parse(readFileSync(join(DIR!, f), 'utf8'));

type Member = { judgeId: string; family: string; status: string; verdict?: JudgeVerdict };

function replayUnder(version: 'agg-4' | 'agg-5') {
  const record = json('judgment-latest.json');
  const rubric = json('quote.json').rubric as JudgmentRubric;
  const members = record.panel.members as Member[];
  const flash = members.find((m) => m.judgeId === 'deepseek-flash')!.verdict!;
  const overlong = (): JudgeVerdict => {
    const v = structuredClone(flash);
    const first = v.criteria[0]!;
    first.evidence = [...`${first.evidence} ${v.criteria.map((c) => c.evidence).join(' ')}`].slice(0, 340).join('');
    return v;
  };
  const impl = KEPT.aggregations.get(version) as Extract<AggregationImpl, { format: 'prose-1' }>;
  const ids = rubric.criteria.map((c) => c.id);
  const seats = members.map((m) => {
    const raw = JSON.stringify(m.verdict ?? overlong());
    return { m, parsed: impl.parseVerdict(raw, { criterionIds: ids, canary: 'replay-canary-not-in-any-output', rationaleMaxChars: 600 }) };
  });
  const filtered = seats.filter((s) => s.parsed.status === 'abstain');
  const cuts = seats.flatMap((s) => (s.parsed.status === 'ok' && s.parsed.cut ? [cutReason(s.m.judgeId, s.parsed.cut)] : []));
  const verdicts: PanelVerdict[] = seats.map((s) => ({ family: s.m.family, verdict: s.parsed.status === 'ok' ? s.parsed.verdict : null }));
  return impl.aggregate({
    checks: record.deterministic,
    rubric,
    screenFlagged: record.screen.flagged,
    appeal: 'escalated',
    appealFamilies: 2,
    filterAbstentions: filtered.length,
    verdicts,
    thresholds: { minValid: 4, acceptSupermajority: { numerator: 2, denominator: 3 }, rejectSupermajority: { numerator: 2, denominator: 3 } },
    escalate: filtered.map((s) => `judge ${s.m.judgeId} output rejected by a filter`),
    ...(cuts.length ? { cuts } : {}),
  });
}

/** The record's panel under pair 3 and agg-6: coded outputs built from the recorded verdicts, read by agg-6's filter. */
function replayCoded() {
  const record = json('judgment-latest.json');
  const rubric = json('quote.json').rubric as JudgmentRubric;
  const members = record.panel.members as Member[];
  const toCoded = (v: JudgeVerdict) => ({
    criteria: v.criteria.map((c) => ({ id: c.id, refs: [], reasons: [c.score >= 3 ? 'meets_terms' : 'incomplete'], score: c.score })),
    overall: v.overall,
    injectionSuspected: v.injectionSuspected,
  });
  const flash = members.find((m) => m.judgeId === 'deepseek-flash')!.verdict!;
  const impl = KEPT.aggregations.get('agg-6') as Extract<AggregationImpl, { format: 'coded-1' }>;
  const ids = rubric.criteria.map((c) => c.id);
  const seats = members.map((m) => {
    const out = m.verdict ? toCoded(m.verdict) : { ...toCoded(flash), rationale: [...flash.criteria.map((c) => c.evidence).join(' ')].slice(0, 900).join('') };
    return { m, parsed: impl.parseCoded(JSON.stringify(out), { criterionIds: ids, canary: 'replay-canary-not-in-any-output', work: NO_REFS, anchorKey: anchorKey(new Uint8Array()) }) };
  });
  const filtered = seats.filter((s) => s.parsed.status === 'abstain');
  const verdicts: PanelVerdict[] = seats.map((s) => ({ family: s.m.family, verdict: s.parsed.status === 'ok' ? impl.scored(s.parsed.record) : null }));
  const a = impl.aggregate({
    checks: record.deterministic,
    rubric,
    screenFlagged: record.screen.flagged,
    appeal: 'escalated',
    appealFamilies: 2,
    filterAbstentions: filtered.length,
    verdicts,
    thresholds: { minValid: 4, acceptSupermajority: { numerator: 2, denominator: 3 }, rejectSupermajority: { numerator: 2, denominator: 3 } },
    escalate: filtered.map((s) => `judge ${s.m.judgeId} output rejected by a filter`),
  });
  return { a, seats };
}

describe.skipIf(!present)(`partner C's appeal record, replayed${present ? '' : ' (SKIPPED: set CROW_PARTNER_C_DEAL to the private deal folder)'}`, () => {
  it('agg-4 gives the recorded decision and reasons', () => {
    const recorded = json('judgment-latest.json').aggregate;
    const a = replayUnder('agg-4');
    expect(a.decision).toBe('reject');
    expect(a.reasons).toEqual(recorded.reasons);
    expect({ passCount: a.passCount, validCount: a.validCount, weightedScore: a.weightedScore }).toEqual({ passCount: recorded.passCount, validCount: recorded.validCount, weightedScore: recorded.weightedScore });
  });

  it('agg-5 accepts the same outputs, five passes from two families, and names each cut seat', () => {
    const a = replayUnder('agg-5');
    expect(a.decision).toBe('accept');
    expect(a.passCount).toBe(5);
    expect(a.passFamilies).toEqual(['claude', 'deepseek']);
    expect(a.reasons.filter((r) => r.includes('free text cut'))).toEqual(['claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-5-5'].map((id) => `judge ${id} free text cut to its cap (evidence of 1 criterion)`));
  });

  it('agg-6 accepts it with every Claude seat adding a habitual rationale: dropped, counted, and the seat counts (ADR-0050)', () => {
    const { a, seats } = replayCoded();
    expect(a.decision).toBe('accept');
    expect(a.passCount).toBe(5);
    expect(a.passFamilies).toEqual(['claude', 'deepseek']);
    const dropped = seats.map((s) => (s.parsed.status === 'ok' ? `${s.m.judgeId}:${s.parsed.record.dropped.keys}` : `${s.m.judgeId}:abstain`));
    expect(dropped.filter((x) => x.startsWith('claude')).every((x) => x.endsWith(':1'))).toBe(true);
    expect(dropped.filter((x) => x.startsWith('claude'))).toHaveLength(3);
    expect(a.reasons.some((r) => r.includes('rejected by a filter'))).toBe(false);
  });
});
