// FROZEN: the verdict filter of agg-3 and agg-4, as released by T-615 (commit 6f123c73, packages/judgment/src/verdict.ts).
// ADR-0036 section 1: aggregationVersion covers the verdict filter, so a kept version never changes it under its
// label. Only this header differs from that commit; the replay (packages/testkit/src/replay.ts) holds it to its
// results. agg-5 cuts free text over its cap instead of abstaining (ADR-0049, verdict.ts). Two counts here differ from
// the schema's: the policy's rationale cap counts UTF-16 units, and a redacted evidence is cut at 300 UTF-16 units.
//
// Verdict parsing (CLAUDE.md: judge output must match judge-verdict.schema.json, or the judge
// abstains). Any doubt about the output is an abstention, never a guess: no repair, no fence
// stripping, no partial reads. Every abstention here is a filter abstention, and the pipeline
// escalates the case on any of them, so a seller cannot shrink the panel by inducing one.
//
// URLs: a URL in the rationale or injectionEvidence abstains; a URL in a criterion's evidence is
// redacted, because honest evidence may quote a URL-like cell from the deliverable.
import { parseJudgeVerdict, type JudgeVerdict } from '@holdback/core';

export const MAX_OUTPUT_CHARS = 64 * 1024;
export const URL_REDACTION = '[link removed]';

export type AbstainReason = 'too_long' | 'canary_echo' | 'not_json' | 'schema' | 'criteria_mismatch' | 'url';
export type ParsedVerdict =
  | { status: 'ok'; verdict: JudgeVerdict; redactedUrls: number }
  | { status: 'abstain'; reason: AbstainReason; detail: string };

export interface VerdictOptions {
  /** The rubric's criterion IDs; the verdict must score each exactly once and nothing else. */
  criterionIds: readonly string[];
  /** This judge's canary; its appearance anywhere in the output is evidence of a hijack. */
  canary: string;
  /** The policy's rationale cap; the schema's 600 applies regardless. */
  rationaleMaxChars: number;
}

const SPACE = /\s/;
const DEFANGED_DOT = /\[\.\]|\(\.\)|\{\.\}|\[dot\]|\(dot\)/iy;
const WIDE_DOT = /[\u3002\uFF0E\uFF61]/;
const isSpace = (s: string, i: number) => SPACE.test(s.charAt(i));
/** The first index at or after i that holds no whitespace. */
function spacesEnd(s: string, i: number): number {
  while (isSpace(s, i)) i++;
  return i;
}
/** The length of the defanged dot that starts at index i, or 0. */
function defangedDotAt(s: string, i: number): number {
  DEFANGED_DOT.lastIndex = i;
  return DEFANGED_DOT.exec(s)?.[0].length ?? 0;
}

/**
 * Refang's dot step, in one scan whose time grows with the string's length. It replaces exactly what the regex
 * /\s*(?:\[\.\]|\(\.\)|\{\.\}|\[dot\]|\(dot\))\s*|\s+\.\s+|[\u3002\uFF0E\uFF61]/gi replaced. That regex restarted
 * its leading \s* at every whitespace character of a run, so its time grew with the square of the run's length
 * (CodeQL js/polynomial-redos).
 */
function undot(s: string): string {
  let out = '';
  let kept = 0; // s[kept, i) is copied as it is
  let i = 0;
  while (i < s.length) {
    const j = spacesEnd(s, i); // s[i, j) is whitespace, possibly none
    const dot = defangedDotAt(s, j);
    // A defanged dot and the whitespace around it, or a dot with whitespace on both sides, become one dot.
    const end = dot > 0 ? spacesEnd(s, j + dot) : j > i && s[j] === '.' && isSpace(s, j + 1) ? spacesEnd(s, j + 1) : -1;
    if (end >= 0) {
      out += `${s.slice(kept, i)}.`;
      i = kept = end;
      continue;
    }
    // Otherwise the whitespace stays, and an ideographic or fullwidth dot right after it becomes a dot.
    if (WIDE_DOT.test(s.charAt(j))) {
      out += `${s.slice(kept, j)}.`;
      kept = j + 1;
    }
    i = j + 1;
  }
  return out + s.slice(kept);
}

/** Undo common URL defanging: [.] (.) {.} " . " ideographic and fullwidth dots, hxxp, [:]. */
function refang(s: string): string {
  return undot(s).replace(/hxxp/gi, 'http').replace(/\[:\]/g, ':');
}

// Exfiltration (T15): a scheme://, mailto:, data:, javascript:, a www. host, an IPv4 address, or a
// domain followed by a slash.
const URL_TEST = /\b[a-z][a-z0-9+.-]{1,20}:\/\/|\bmailto:\S|\bdata:[a-z]+\/|\bjavascript:|\bwww\.[a-z0-9-]|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b[a-z0-9-][a-z0-9.-]{0,252}\.[a-z]{2,24}\//i;
const URL_ALL = /\b[a-z][a-z0-9+.-]{1,20}:\/\/\S*|\bmailto:\S+|\bdata:[a-z]+\/\S*|\bjavascript:\S*|\bwww\.[a-z0-9-]\S*|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b\S*|\b[a-z0-9-][a-z0-9.-]{0,252}\.[a-z]{2,24}\/\S*/gi;

export const hasUrl = (s: string): boolean => URL_TEST.test(refang(s));

const abstain = (reason: AbstainReason, detail: string): ParsedVerdict => ({ status: 'abstain', reason, detail });
const squash = (s: string) => s.toLowerCase().replace(/[^0-9a-z]/g, '');

/** Free-text string values in document order (everything except ids and enum fields), iteratively. */
function freeText(value: unknown): string[] {
  const out: string[] = [];
  const stack: Array<[unknown, string]> = [[value, '']];
  while (stack.length) {
    const [v, key] = stack.pop()!;
    if (typeof v === 'string') {
      if (key !== 'id' && key !== 'overall') out.push(v);
    } else if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push([v[i], key]);
    } else if (v !== null && typeof v === 'object') {
      const entries = Object.entries(v);
      for (let i = entries.length - 1; i >= 0; i--) stack.push([entries[i]![1], entries[i]![0]]);
    }
  }
  return out;
}

/** The canary in any case, with any separators, split across fields, or base64-encoded. */
function echoesCanary(raw: string, parsed: unknown, canary: string): boolean {
  const c = squash(canary);
  if (!c) return false;
  if (squash(raw).includes(c)) return true;
  const texts = parsed === undefined ? [] : freeText(parsed);
  if (squash(texts.join('')).includes(c)) return true;
  for (const t of [raw, ...texts]) {
    for (const m of t.matchAll(/[A-Za-z0-9+/_=-]{16,4096}/g)) {
      if (squash(Buffer.from(m[0], /[-_]/.test(m[0]) ? 'base64url' : 'base64').toString('latin1')).includes(c)) return true;
    }
  }
  return false;
}

/**
 * Which verdict-schema rule an output broke, as metadata only: a field path built from the schema's own names and
 * array indices, the limit, and the actual length, count or JSON type. Never a value, a key or text from the output:
 * a judge's text quotes the delivery, which is untrusted and private to the deal. Lengths count code points, as the
 * schema's maxLength does. The pipeline puts this detail in the judgment record, so a filter abstention names its rule.
 */
export function schemaFault(json: unknown): string {
  const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' && !Number.isFinite(v) ? 'non-finite number' : typeof v);
  const isObject = (v: unknown): v is Record<string, unknown> => typeOf(v) === 'object';
  const extra = (o: Record<string, unknown>, allowed: readonly string[]) => Object.keys(o).filter((k) => !allowed.includes(k)).length;
  // Numbers the judge controls are bucketed, so the detail carries no more than a few bits a judge could choose.
  const length = (n: number, max: number) => (n > 2 * max ? `more than ${2 * max}` : String(n));
  const keys = (n: number) => (n === 1 ? '1 unexpected key' : `${n > 9 ? 'more than 9' : n} unexpected keys`);
  const text = (v: unknown, path: string, max: number): string | undefined => {
    if (typeof v !== 'string') return `${path}: ${typeOf(v)}, not a string`;
    const n = [...v].length;
    return n > max ? `${path}: ${length(n, max)} > ${max}` : undefined;
  };
  if (!isObject(json)) return `the output is a JSON ${typeOf(json)}, not an object`;
  const top = ['criteria', 'overall', 'injectionSuspected', 'injectionEvidence', 'rationale'];
  for (const k of ['criteria', 'overall', 'injectionSuspected', 'rationale']) if (!Object.hasOwn(json, k)) return `${k}: missing`;
  const unexpected = extra(json, top);
  if (unexpected) return `top level: ${keys(unexpected)}`;
  const cs = json['criteria'];
  if (!Array.isArray(cs)) return `criteria: ${typeOf(cs)}, not an array`;
  if (cs.length > 12) return `criteria: ${cs.length > 24 ? 'more than 24' : cs.length} items > 12`;
  for (const [i, c] of cs.entries()) {
    const at = `criteria[${i}]`;
    if (!isObject(c)) return `${at}: ${typeOf(c)}, not an object`;
    for (const k of ['id', 'score', 'evidence']) if (!Object.hasOwn(c, k)) return `${at}.${k}: missing`;
    const more = extra(c, ['id', 'score', 'evidence']);
    if (more) return `${at}: ${keys(more)}`;
    if (typeof c['id'] !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(c['id'])) return `${at}.id: not a criterion id`;
    const score = c['score'];
    if (typeof score !== 'number' || !Number.isFinite(score)) return `${at}.score: ${typeOf(score)}, not an integer`;
    if (!Number.isInteger(score)) return `${at}.score: not an integer`;
    if (score < 0 || score > 4) return `${at}.score: outside 0 to 4`;
    const e = text(c['evidence'], `${at}.evidence`, 300);
    if (e) return e;
  }
  if (!['pass', 'fail', 'abstain'].includes(json['overall'] as string)) return `overall: not pass, fail or abstain`;
  if (typeof json['injectionSuspected'] !== 'boolean') return `injectionSuspected: ${typeOf(json['injectionSuspected'])}, not a boolean`;
  if (Object.hasOwn(json, 'injectionEvidence')) {
    const e = text(json['injectionEvidence'], 'injectionEvidence', 300);
    if (e) return e;
  }
  return text(json['rationale'], 'rationale', 600) ?? 'another schema rule';
}

export function parseVerdict(raw: string, opts: VerdictOptions): ParsedVerdict {
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

  let parsed: ReturnType<typeof parseJudgeVerdict>;
  try {
    parsed = parseJudgeVerdict(json);
  } catch {
    return abstain('schema', 'output could not be validated');
  }
  if (!parsed.ok) return abstain('schema', schemaFault(json));
  const verdict = parsed.value;
  // The policy cap counts UTF-16 units, as it always has; the schema's caps count code points.
  if (verdict.rationale.length > opts.rationaleMaxChars) return abstain('schema', `rationale: ${verdict.rationale.length > 1200 ? 'more than 1200' : verdict.rationale.length} > ${opts.rationaleMaxChars} (the policy cap, in UTF-16 units)`);

  const want = new Set(opts.criterionIds);
  const got = verdict.criteria.map((c) => c.id);
  if (got.length !== want.size || new Set(got).size !== got.length || !got.every((id) => want.has(id))) {
    return abstain('criteria_mismatch', 'criterion ids differ from the rubric');
  }

  if (hasUrl(verdict.rationale) || hasUrl(verdict.injectionEvidence ?? '')) return abstain('url', 'rationale or injectionEvidence contains a URL');
  let redactedUrls = 0;
  for (const c of verdict.criteria) {
    if (!hasUrl(c.evidence)) continue;
    c.evidence = refang(c.evidence).replace(URL_ALL, () => {
      redactedUrls++;
      return URL_REDACTION;
    }).slice(0, 300);
  }
  return { status: 'ok', verdict, redactedUrls };
}
