// The versions this build keeps (ADR-0036 section 1): every screen version, template pair and aggregation version a released
// build registered, selected by the values a deal's bound policy names. A kept version is frozen in behaviour: a fix
// that changes what it flags or decides is a new version under a new label, and the replay
// (packages/testkit/src/replay.ts) holds each one to the results recorded when it was new. A version leaves this table
// only by a reviewed retirement that shows no open deal binds it (apps/adjudicator/src/kept-policies.json).
//
// What each value covers:
// - screenVersion: everything between the delivered bytes and the prompt the screen reads (normalization, the screen,
//   the read limit, the sampling, the rendering of the data section);
// - the two template hashes: the template text;
// - aggregationVersion: the verdict filter, the aggregation rule and signedOutcome.
//
// A template pair and an aggregation each name a verdict format (ADR-0050): pairs 1 and 2 and agg-3 to agg-5 are
// prose-1, pair 3 and agg-6 coded-1. A policy that pairs two formats is refused before any judge is called.
import type { AdjudicatorPolicy, CodedRecordVerdict, Hex32, JudgeVerdict, VerdictFormat } from '@holdback/core';
import { err, ok, type Result } from '@holdback/core';
import { aggregate, AGGREGATION_VERSION, preDecision, signedOutcome } from './aggregate.js';
import * as agg3 from './kept/agg-3.js';
import * as agg4 from './kept/agg-4.js';
import * as screen0 from './kept/screen-0.js';
import * as screen1 from './kept/screen-1.js';
import { strideSample0 } from './kept/stride-0.js';
import * as verdict0 from './kept/verdict-0.js';
import { parseCodedVerdict } from './coded.js';
import { strideSample1, TEMPLATE_PAIR, TEMPLATE_PAIR_2, TEMPLATE_PAIR_3, type StrideSampler, type TemplatePair } from './prompt.js';
import { screen, screenTerms, SCREEN_VERSION, type ScreenInput, type ScreenResult } from './screen.js';
import { parseVerdict } from './verdict.js';

export interface ScreenImpl {
  screen(input: ScreenInput): ScreenResult;
  /** The signals in the party-written terms the judges read. */
  screenTerms(texts: readonly string[]): ScreenResult['signals'];
  /** How it reads a deliverable over the budget without a seed. */
  stride: StrideSampler;
}

interface AggregationRule {
  preDecision: typeof preDecision;
  aggregate: typeof aggregate;
  signedOutcome: typeof signedOutcome;
}
/** An aggregation that reads prose verdicts through its prose filter (agg-3 to agg-5). */
export interface ProseAggregation extends AggregationRule {
  format: 'prose-1';
  parseVerdict: typeof parseVerdict;
}
/** An aggregation that reads coded verdicts (agg-6, ADR-0050). */
export interface CodedAggregation extends AggregationRule {
  format: 'coded-1';
  parseCoded: typeof parseCodedVerdict;
  /** The coded seat as the rule's input: its scores, overall and flag; the rule reads no other field. */
  scored(record: CodedRecordVerdict): JudgeVerdict;
}
export type AggregationImpl = ProseAggregation | CodedAggregation;

/** What a build carries, by label (and the template pairs by their two hashes). */
export interface KeptTable {
  screens: ReadonlyMap<string, ScreenImpl>;
  templatePairs: readonly TemplatePair[];
  aggregations: ReadonlyMap<string, AggregationImpl>;
}

/** The four policy values that name implementations. */
export type PolicyVersions = Pick<AdjudicatorPolicy, 'screenVersion' | 'promptTemplateHash' | 'appealPromptTemplateHash' | 'aggregationVersion'>;

/** The implementations a policy's values name. */
export interface PolicyImpl {
  versions: PolicyVersions;
  screen: ScreenImpl;
  templates: TemplatePair;
  aggregation: AggregationImpl;
}

const SCREEN_2: ScreenImpl = { screen, screenTerms, stride: strideSample1 };
const SCREEN_1: ScreenImpl = { screen: screen1.screen, screenTerms: screen1.screenTerms, stride: strideSample1 };
const SCREEN_0: ScreenImpl = { screen: screen0.screen, screenTerms: screen0.screenTerms, stride: strideSample0 };
// agg-3 and agg-4 read verdicts through the filter they were released with (kept/verdict-0.ts, ADR-0049 section 7).
const AGG_3: ProseAggregation = { format: 'prose-1', parseVerdict: verdict0.parseVerdict, preDecision: agg3.preDecision, aggregate: agg3.aggregate, signedOutcome: agg3.signedOutcome };
const AGG_4: ProseAggregation = { format: 'prose-1', parseVerdict: verdict0.parseVerdict, preDecision: agg4.preDecision, aggregate: agg4.aggregate, signedOutcome: agg4.signedOutcome };
// agg-5: agg-4's rule with the cut filter (ADR-0049).
const AGG_5: ProseAggregation = { format: 'prose-1', parseVerdict, preDecision, aggregate, signedOutcome };
/**
 * The coded seat in the shape agg-5's rule reads: ids and scores, overall and the flag. The free-text fields are empty
 * because a coded verdict has none and the rule reads none (aggregate.ts); the view never reaches the record.
 */
export const scoredView = (r: CodedRecordVerdict): JudgeVerdict => ({
  criteria: r.criteria.map((c) => ({ id: c.id, score: c.score, evidence: '' })),
  overall: r.overall,
  injectionSuspected: r.injectionSuspected,
  rationale: '',
});
// agg-6 (ADR-0050): agg-5's rule, unchanged, over the scores of a coded verdict, which no filter cuts. Its label binds
// the coded filter (coded.ts); aggregate.test.ts pins its decision digests to agg-5's.
export const AGGREGATION_VERSION_CODED = 'agg-6';
const AGG_6: CodedAggregation = { format: 'coded-1', parseCoded: parseCodedVerdict, scored: scoredView, preDecision, aggregate, signedOutcome };

export const KEPT: KeptTable = {
  screens: new Map([
    [screen0.SCREEN_VERSION, SCREEN_0],
    [screen1.SCREEN_VERSION, SCREEN_1],
    [SCREEN_VERSION, SCREEN_2],
  ]),
  templatePairs: [TEMPLATE_PAIR, TEMPLATE_PAIR_2, TEMPLATE_PAIR_3],
  aggregations: new Map<string, AggregationImpl>([
    [agg3.AGGREGATION_VERSION, AGG_3],
    [agg4.AGGREGATION_VERSION, AGG_4],
    [AGGREGATION_VERSION, AGG_5],
    [AGGREGATION_VERSION_CODED, AGG_6],
  ]),
};

/**
 * The newest version of each: what a new build offers as its default unless its kept-policies file says otherwise. The
 * template pair stays pair 1 until a default names pair 2: pair 2 changes the prompt every recording was taken under.
 * The aggregation stays agg-5, the newest prose one: agg-6 reads coded verdicts, which only pair 3 asks for, and the
 * default moves to pair 3 and agg-6 only after the live calibration (ADR-0050 section 7).
 */
export const NEWEST_VERSIONS: PolicyVersions = {
  screenVersion: SCREEN_VERSION,
  promptTemplateHash: TEMPLATE_PAIR.firstHash,
  appealPromptTemplateHash: TEMPLATE_PAIR.appealHash,
  aggregationVersion: AGGREGATION_VERSION,
};

const short = (h: Hex32) => `${h.slice(0, 10)}...`;

/** The labels and hashes a table carries, for a data file or a guard to compare with. */
export function keptLabels(kept: KeptTable = KEPT): { screens: string[]; templatePairs: Array<{ promptTemplateHash: Hex32; appealPromptTemplateHash: Hex32 }>; aggregations: string[] } {
  return {
    screens: [...kept.screens.keys()],
    templatePairs: kept.templatePairs.map((p) => ({ promptTemplateHash: p.firstHash, appealPromptTemplateHash: p.appealHash })),
    aggregations: [...kept.aggregations.keys()],
  };
}

/**
 * The implementations the four values name, or the first one this build does not carry ("this build does not carry
 * screen-0"). Never another version in its place.
 */
export function implementationsFor(v: PolicyVersions, kept: KeptTable = KEPT): Result<PolicyImpl, string> {
  const s = kept.screens.get(v.screenVersion);
  if (!s) return err(`this build does not carry screen ${JSON.stringify(String(v.screenVersion).slice(0, 40))}`);
  const templates = kept.templatePairs.find((p) => p.firstHash === v.promptTemplateHash && p.appealHash === v.appealPromptTemplateHash);
  if (!templates) return err(`this build does not carry the template pair ${short(v.promptTemplateHash)} / ${short(v.appealPromptTemplateHash)}`);
  const aggregation = kept.aggregations.get(v.aggregationVersion);
  if (!aggregation) return err(`this build does not carry aggregation ${JSON.stringify(String(v.aggregationVersion).slice(0, 40))}`);
  // ADR-0050: one format per policy, checked before any judge is called.
  const asks: VerdictFormat = templates.format ?? 'prose-1';
  if (asks !== aggregation.format) {
    return err(`the template pair ${short(v.promptTemplateHash)} / ${short(v.appealPromptTemplateHash)} asks judges for ${asks} verdicts, and aggregation ${String(v.aggregationVersion).slice(0, 40)} reads ${aggregation.format} verdicts; a policy pairs a template and an aggregation of one format`);
  }
  return ok({ versions: { screenVersion: v.screenVersion, promptTemplateHash: v.promptTemplateHash, appealPromptTemplateHash: v.appealPromptTemplateHash, aggregationVersion: v.aggregationVersion }, screen: s, templates, aggregation });
}
