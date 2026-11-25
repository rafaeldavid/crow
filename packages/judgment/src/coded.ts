// The coded verdict filter, agg-6 (ADR-0050 section 2). CLAUDE.md: judge output must match the output schema its bound
// policy names, or the judge abstains; in a coded verdict, evidence the pipeline cannot use (a reason code, a
// reference, an unknown key) is dropped and counted. Nothing else is repaired, and no judge is called again.
//
//   1. Output over 65,536 characters abstains (too_long).
//   2. The canary is scanned first, on the raw output and on every key and string of the parsed output, base64 runs
//      decoded, so a canary in a key, a code or a reference that would be dropped still abstains (canary_echo).
//   3. Output that is not one JSON value abstains (not_json).
//   4. Decision fields are strict, as today: criteria, each criterion's id and score, overall and injectionSuspected,
//      and the ids exactly the rubric's, each once (schema, criteria_mismatch). The detail is metadata only.
//   5. Evidence fields never cost the seat. An unknown reason code or injection kind, an item past the third, a
//      duplicate, a reference that is not a string, is over 512 code points or does not resolve in the work, kinds and
//      references without the injection flag, and every unknown key (a habitual rationale, say) are dropped, and the
//      seat's `dropped` counts them, each count capped at 9. A sampled read keeps no reference.
//   6. The record keeps the format, the scores, the codes and kinds, an anchor per kept reference (refs.ts) and the
//      counts: no string a judge or the work chose.
//
// Why dropping is safe [inferred, ADR-0050]: a filter abstention escalates, because a party could otherwise make only
// failing seats abstain; a dropped evidence field keeps the seat and its score whatever a party induces, and
// aggregation reads no evidence field. The counts are never an escalation reason.
import { parseCodedJudgeVerdict, type CodedJudgeVerdict, type CodedRecordVerdict, type InjectionKind, type ReasonCode } from '@holdback/core';
import { anchorOf, resolves, type WorkView } from './refs.js';
import { MAX_OUTPUT_CHARS } from './verdict.js';

export const CODED_FORMAT = 'coded-1' as const;
/** The schema's closed lists (judge-verdict.schema.json `$defs/ReasonCode` and `$defs/InjectionKind`). */
export const REASON_CODES: readonly ReasonCode[] = [
  'meets_terms',
  'complete',
  'accurate',
  'consistent',
  'well_formed',
  'missing_element',
  'incomplete',
  'inaccurate',
  'inconsistent',
  'malformed',
  'off_spec',
  'weak_execution',
  'filler_content',
  'unsupported_claim',
  'not_assessable',
  'other',
];
export const INJECTION_KINDS: readonly InjectionKind[] = ['instruction_override', 'addressed_to_judge', 'verdict_steer', 'prompt_probe', 'hidden_text', 'other'];
/** At most three items in each list. */
export const MAX_ITEMS = 3;
/** Each dropped count is capped, so the counts carry at most a few bits a judge could choose. */
export const DROP_CAP = 9;
const MAX_LOCATOR = 512;

export type CodedAbstainReason = 'too_long' | 'canary_echo' | 'not_json' | 'schema' | 'criteria_mismatch';
export type ParsedCoded =
  | { status: 'ok'; verdict: CodedJudgeVerdict; record: CodedRecordVerdict }
  | { status: 'abstain'; reason: CodedAbstainReason; detail: string };

export interface CodedOptions {
  /** The rubric's criterion IDs; the verdict must score each exactly once and nothing else. */
  criterionIds: readonly string[];
  /** This judge's canary; its appearance anywhere in the output is evidence of a hijack. */
  canary: string;
  /** What the references resolve against; NO_REFS for a sampled read. */
  work: WorkView;
  /** The anchor key of the work (refs.ts anchorKey). */
  anchorKey: Uint8Array;
}

const abstain = (reason: CodedAbstainReason, detail: string): ParsedCoded => ({ status: 'abstain', reason, detail });
const squash = (s: string) => s.toLowerCase().replace(/[^0-9a-z]/g, '');
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' && !Number.isFinite(v) ? 'non-finite number' : typeof v);

/** Every key and every string of a parsed output, in document order, iteratively. */
function allText(value: unknown): string[] {
  const out: string[] = [];
  const stack: unknown[] = [value];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]);
    else if (isRecord(v)) {
      const entries = Object.entries(v);
      for (let i = entries.length - 1; i >= 0; i--) stack.push(entries[i]![1], entries[i]![0]);
    }
  }
  return out;
}

/**
 * Each base64 or base64url text in a string, decoded, for the canary scan: agg-5's decoder (verdict.ts, red team M1
 * and L1 of T-618), copied so agg-5's filter stays as it was released. Each run is decoded whole, at each of the four
 * offsets from the base64 grid, split at `=` padding; runs broken by whitespace are joined and decoded too.
 */
function* decodedBase64(t: string): Generator<string> {
  for (const text of [t, t.replace(/\s+/g, '')]) {
    for (const m of text.matchAll(/[A-Za-z0-9+/_=-]{16,65536}/g)) {
      const encoding = /[-_]/.test(m[0]) ? 'base64url' : 'base64';
      for (const piece of m[0].split(/=+/)) {
        if (piece.length < 16) continue;
        for (let o = 0; o < 4; o++) yield Buffer.from(piece.slice(o), encoding).toString('latin1');
      }
    }
  }
}

/** The canary in any case, with any separators, in a key or a value, split across them, or base64-encoded. */
function echoesCanary(raw: string, parsed: unknown, canary: string): boolean {
  const c = squash(canary);
  if (!c) return false;
  if (squash(raw).includes(c)) return true;
  const texts = parsed === undefined ? [] : allText(parsed);
  if (squash(texts.join('')).includes(c)) return true;
  for (const t of [raw, ...texts]) for (const decoded of decodedBase64(t)) if (squash(decoded).includes(c)) return true;
  return false;
}

/** Code points, as the schema's maxLength counts them; stops counting past `max`. */
function codePointsOver(s: string, max: number): boolean {
  if (s.length <= max) return false;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) i++;
    if (++n > max) return true;
  }
  return false;
}

/**
 * Which decision field a coded output broke, as metadata only: a path built from the schema's own names and array
 * indices, a limit, and a JSON type. Never a value, a key or text from the output. Undefined when the decision fields
 * hold.
 */
function decisionFault(json: unknown): string | undefined {
  if (!isRecord(json)) return `the output is a JSON ${typeOf(json)}, not an object`;
  for (const k of ['criteria', 'overall', 'injectionSuspected']) if (!Object.hasOwn(json, k)) return `${k}: missing`;
  const cs = json['criteria'];
  if (!Array.isArray(cs)) return `criteria: ${typeOf(cs)}, not an array`;
  if (cs.length > 12) return `criteria: ${cs.length > 24 ? 'more than 24' : cs.length} items > 12`;
  for (const [i, c] of cs.entries()) {
    const at = `criteria[${i}]`;
    if (!isRecord(c)) return `${at}: ${typeOf(c)}, not an object`;
    for (const k of ['id', 'score']) if (!Object.hasOwn(c, k)) return `${at}.${k}: missing`;
    if (typeof c['id'] !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(c['id'])) return `${at}.id: not a criterion id`;
    const score = c['score'];
    if (typeof score !== 'number' || !Number.isFinite(score)) return `${at}.score: ${typeOf(score)}, not an integer`;
    if (!Number.isInteger(score)) return `${at}.score: not an integer`;
    if (score < 0 || score > 4) return `${at}.score: outside 0 to 4`;
  }
  if (!['pass', 'fail', 'abstain'].includes(json['overall'] as string)) return 'overall: not pass, fail or abstain';
  if (typeof json['injectionSuspected'] !== 'boolean') return `injectionSuspected: ${typeOf(json['injectionSuspected'])}, not a boolean`;
  return undefined;
}

/** A counter that stops at DROP_CAP. */
class Dropped {
  reasons = 0;
  refs = 0;
  keys = 0;
  add(k: 'reasons' | 'refs' | 'keys', n = 1) {
    this[k] = Math.min(DROP_CAP, this[k] + n);
  }
  get value() {
    return { reasons: this.reasons, refs: this.refs, keys: this.keys };
  }
}

/** The items of an evidence list a judge wrote that `accept` takes, at most three, each once; the rest counted. */
function keepList<T extends string>(v: unknown, accept: (x: unknown) => x is T, drop: (n?: number) => void): T[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    drop();
    return [];
  }
  const kept: T[] = [];
  for (const x of v) {
    if (accept(x) && !kept.includes(x) && kept.length < MAX_ITEMS) kept.push(x);
    else drop();
  }
  return kept;
}

const CRITERION_KEYS = ['id', 'refs', 'reasons', 'score'];
const TOP_KEYS = ['criteria', 'overall', 'injectionSuspected', 'injectionKinds', 'injectionRefs'];
const isReason = (x: unknown): x is ReasonCode => typeof x === 'string' && (REASON_CODES as readonly string[]).includes(x);
const isKind = (x: unknown): x is InjectionKind => typeof x === 'string' && (INJECTION_KINDS as readonly string[]).includes(x);

export function parseCodedVerdict(raw: string, opts: CodedOptions): ParsedCoded {
  if (raw.length > MAX_OUTPUT_CHARS) return abstain('too_long', `output is ${raw.length} characters`);
  let json: unknown;
  let jsonOk = true;
  try {
    json = JSON.parse(raw);
  } catch {
    jsonOk = false;
  }
  if (echoesCanary(raw, jsonOk ? json : undefined, opts.canary)) return abstain('canary_echo', 'output contains the canary');
  if (!jsonOk) return abstain('not_json', `output is not a single JSON value${/^\s*```/.test(raw) ? ' (it starts with a code fence)' : ''}`);

  const fault = decisionFault(json);
  if (fault) return abstain('schema', fault);
  const top = json as Record<string, unknown>;
  const cs = top['criteria'] as Array<Record<string, unknown>>;
  const want = new Set(opts.criterionIds);
  const got = cs.map((c) => c['id'] as string);
  if (got.length !== want.size || new Set(got).size !== got.length || !got.every((id) => want.has(id))) {
    return abstain('criteria_mismatch', 'criterion ids differ from the rubric');
  }

  const dropped = new Dropped();
  const isRef = (x: unknown): x is string => typeof x === 'string' && !codePointsOver(x, MAX_LOCATOR) && resolves(opts.work, x);
  const unknownKeys = (o: Record<string, unknown>, allowed: readonly string[]) => dropped.add('keys', Object.keys(o).filter((k) => !allowed.includes(k)).length);
  unknownKeys(top, TOP_KEYS);
  const criteria = cs.map((c) => {
    unknownKeys(c, CRITERION_KEYS);
    const refs = keepList(Object.hasOwn(c, 'refs') ? c['refs'] : undefined, isRef, () => dropped.add('refs'));
    const reasons = keepList(Object.hasOwn(c, 'reasons') ? c['reasons'] : undefined, isReason, () => dropped.add('reasons'));
    return { id: c['id'] as string, refs, reasons, score: c['score'] as 0 | 1 | 2 | 3 | 4 };
  });
  const injectionSuspected = top['injectionSuspected'] as boolean;
  // The boolean alone flags a case; kinds and references without it are dropped.
  const kindsIn = Object.hasOwn(top, 'injectionKinds') ? top['injectionKinds'] : undefined;
  const refsIn = Object.hasOwn(top, 'injectionRefs') ? top['injectionRefs'] : undefined;
  const injectionKinds = keepList(kindsIn, (x): x is InjectionKind => injectionSuspected && isKind(x), () => dropped.add('reasons'));
  const injectionRefs = keepList(refsIn, (x): x is string => injectionSuspected && isRef(x), () => dropped.add('refs'));

  const verdict: CodedJudgeVerdict = { criteria, overall: top['overall'] as CodedJudgeVerdict['overall'], injectionSuspected, injectionKinds, injectionRefs };
  // The normalized verdict is checked against the schema's coded branch: a defence in depth, never expected to fail.
  if (!parseCodedJudgeVerdict(verdict).ok) return abstain('schema', 'another schema rule');
  const anchor = (l: string) => anchorOf(opts.anchorKey, l);
  const record: CodedRecordVerdict = {
    format: CODED_FORMAT,
    // Two locators sharing an anchor (a 64-bit collision) keep one, so the record's anchors stay unique.
    criteria: criteria.map((c) => ({ id: c.id, refs: [...new Set(c.refs.map(anchor))], reasons: [...c.reasons], score: c.score })),
    overall: verdict.overall,
    injectionSuspected,
    injectionKinds: [...injectionKinds],
    injectionRefs: [...new Set(injectionRefs.map(anchor))],
    dropped: dropped.value,
  };
  return { status: 'ok', verdict, record };
}
