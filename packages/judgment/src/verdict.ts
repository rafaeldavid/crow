// Verdict parsing for agg-5 (CLAUDE.md: judge output must match judge-verdict.schema.json, or the judge abstains. One
// exception: free text over its length cap is cut to the cap and the cut is recorded. Nothing else is repaired). Any
// other doubt about the output is an abstention, never a guess: no fence stripping, no partial reads, no other repair.
// Every abstention here is a filter abstention, and the pipeline escalates the case on any of them, so a seller cannot
// shrink the panel by inducing one. agg-3 and agg-4 keep the filter they were released with (kept/verdict-0.ts).
//
// The cut (ADR-0049): a criterion's evidence, the injectionEvidence and the rationale, each only where it is a string,
// keep their first cap - 5 code points and end with [cut]. The caps are the schema's (300, 300, 600) and, for the
// rationale, the policy's cap when it is lower. Every count is in Unicode code points, as the schema's maxLength
// counts, so a cut never splits a surrogate pair. The canary scan reads the whole output before any cut; the URL step
// reads only the text that stays. The text past a cut is discarded and never reaches the record.
//
// URLs: a URL in the rationale or injectionEvidence abstains; a URL in a criterion's evidence is
// redacted, because honest evidence may quote a URL-like cell from the deliverable.
import { parseJudgeVerdict, type JudgeVerdict } from '@holdback/core';

export const MAX_OUTPUT_CHARS = 64 * 1024;
export const URL_REDACTION = '[link removed]';

/** The mark a cut field ends with. A judge can write it too: the record of a cut is the aggregate's reason line. */
export const CUT_MARK = '[cut]';
/** The schema's caps on free text, in code points (judge-verdict.schema.json maxLength). */
export const EVIDENCE_MAX = 300;
export const INJECTION_EVIDENCE_MAX = 300;
export const RATIONALE_MAX = 600;

export type AbstainReason = 'too_long' | 'canary_echo' | 'not_json' | 'schema' | 'criteria_mismatch' | 'url';
/** Which free text the filter cut to its cap (agg-5): never a value, only the fields and a count. */
export interface VerdictCuts {
  rationale: boolean;
  injectionEvidence: boolean;
  /** How many criteria had their evidence cut. */
  evidence: number;
}
export type ParsedVerdict =
  | { status: 'ok'; verdict: JudgeVerdict; redactedUrls: number; cut?: VerdictCuts }
  | { status: 'abstain'; reason: AbstainReason; detail: string };

export interface VerdictOptions {
  /** The rubric's criterion IDs; the verdict must score each exactly once and nothing else. */
  criterionIds: readonly string[];
  /** This judge's canary; its appearance anywhere in the output is evidence of a hijack. */
  canary: string;
  /** The policy's rationale cap, in code points; the schema's 600 applies regardless. */
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

/**
 * Each base64 or base64url text in a string, decoded, for the canary scan (agg-5; red team M1 and L1 of T-618). A
 * run is decoded whole, at each of the four offsets from the base64 grid, and split at `=` padding, where Node's
 * decoder stops; runs broken by whitespace (MIME lines) are joined and decoded too. The output is capped at
 * MAX_OUTPUT_CHARS, so the work grows linearly with it. agg-4's filter decoded windows of at most 4,096 characters
 * from the start of each run, which a canary across a window boundary, off the grid or after padding escaped; inside
 * agg-4's caps no such run fit a field, but agg-5 cuts the field and counts the seat.
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

/** The canary in any case, with any separators, split across fields, or base64-encoded. */
function echoesCanary(raw: string, parsed: unknown, canary: string): boolean {
  const c = squash(canary);
  if (!c) return false;
  if (squash(raw).includes(c)) return true;
  const texts = parsed === undefined ? [] : freeText(parsed);
  if (squash(texts.join('')).includes(c)) return true;
  for (const t of [raw, ...texts]) {
    for (const decoded of decodedBase64(t)) if (squash(decoded).includes(c)) return true;
  }
  return false;
}

/**
 * The UTF-16 index just after the first n code points of s, or -1 when s holds n code points or fewer. It reads at most
 * n code points, so a long string costs no more than the cap. A surrogate pair is one code point and a lone surrogate
 * is one, as Ajv's ucs2length counts them.
 */
function afterCodePoints(s: string, n: number): number {
  let i = 0;
  for (let k = 0; k < n; k++) {
    if (i >= s.length) return -1;
    const hi = s.charCodeAt(i);
    i += hi >= 0xd800 && hi <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00 ? 2 : 1;
  }
  return i < s.length ? i : -1;
}

/**
 * s cut to `cap` code points, ending with the mark, or undefined when s fits. A cap too small to hold the mark keeps
 * its first `cap` code points without one; the reason line still records the cut.
 */
export function cutToCap(s: string, cap: number): string | undefined {
  if (afterCodePoints(s, cap) < 0) return undefined;
  if (cap < CUT_MARK.length) return s.slice(0, Math.max(0, afterCodePoints(s, cap)));
  return `${s.slice(0, afterCodePoints(s, cap - CUT_MARK.length))}${CUT_MARK}`;
}

/** s with the mark at its end, within `cap` code points: its first cap - 5 code points and the mark. */
function withMark(s: string, cap: number): string {
  const end = afterCodePoints(s, cap - CUT_MARK.length);
  return `${end < 0 ? s : s.slice(0, end)}${CUT_MARK}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Cuts the three free-text paths of a parsed output in place, each only where it holds a string, and says which it cut.
 * Nothing else is read or changed: a score, an id, a boolean, overall, a key or a value of another type stays as the
 * judge wrote it, for the schema to accept or refuse.
 */
function cutFreeText(json: unknown, rationaleCap: number): { cut: VerdictCuts; evidenceCut: Set<number> } {
  const cut: VerdictCuts = { rationale: false, injectionEvidence: false, evidence: 0 };
  const evidenceCut = new Set<number>();
  if (!isRecord(json)) return { cut, evidenceCut };
  const field = (o: Record<string, unknown>, k: string, cap: number): boolean => {
    const v = Object.hasOwn(o, k) ? o[k] : undefined;
    if (typeof v !== 'string') return false;
    const c = cutToCap(v, cap);
    if (c === undefined) return false;
    o[k] = c;
    return true;
  };
  const cs = Object.hasOwn(json, 'criteria') ? json['criteria'] : undefined;
  if (Array.isArray(cs)) cs.forEach((c, i) => isRecord(c) && field(c, 'evidence', EVIDENCE_MAX) && evidenceCut.add(i));
  cut.evidence = evidenceCut.size;
  cut.injectionEvidence = field(json, 'injectionEvidence', INJECTION_EVIDENCE_MAX);
  cut.rationale = field(json, 'rationale', rationaleCap);
  return { cut, evidenceCut };
}

const anyCut = (c: VerdictCuts) => c.rationale || c.injectionEvidence || c.evidence > 0;

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
  // The canary scan reads the raw output and the whole free text, before any cut: a canary past a cap still abstains.
  if (echoesCanary(raw, jsonOk ? json : undefined, opts.canary)) return abstain('canary_echo', 'output contains the canary');
  if (!jsonOk) return abstain('not_json', `output is not a single JSON value${/^\s*```/.test(raw) ? ' (it starts with a code fence)' : ''}`);

  // ADR-0049: free text over its cap is cut, the one repair. The rationale's cap is the lower of the schema's and the
  // policy's, both in code points (kept/verdict-0.ts counts the policy's cap in UTF-16 units).
  const { cut, evidenceCut } = cutFreeText(json, Math.max(0, Math.min(RATIONALE_MAX, opts.rationaleMaxChars)));

  let parsed: ReturnType<typeof parseJudgeVerdict>;
  try {
    parsed = parseJudgeVerdict(json);
  } catch {
    return abstain('schema', 'output could not be validated');
  }
  if (!parsed.ok) return abstain('schema', schemaFault(json));
  const verdict = parsed.value;

  const want = new Set(opts.criterionIds);
  const got = verdict.criteria.map((c) => c.id);
  if (got.length !== want.size || new Set(got).size !== got.length || !got.every((id) => want.has(id))) {
    return abstain('criteria_mismatch', 'criterion ids differ from the rubric');
  }

  // The URL step reads only the text that stays.
  if (hasUrl(verdict.rationale) || hasUrl(verdict.injectionEvidence ?? '')) return abstain('url', 'rationale or injectionEvidence contains a URL');
  let redactedUrls = 0;
  for (const [i, c] of verdict.criteria.entries()) {
    if (!hasUrl(c.evidence)) continue;
    let kept = refang(c.evidence).replace(URL_ALL, () => {
      redactedUrls++;
      return URL_REDACTION;
    });
    // A replacement can lengthen the evidence past its cap: the same cut, recorded the same way. A redaction that
    // swallowed the mark of an earlier cut gets it back (red team I1).
    const recut = cutToCap(kept, EVIDENCE_MAX);
    if (recut !== undefined) evidenceCut.add(i);
    else if (evidenceCut.has(i) && !kept.endsWith(CUT_MARK)) kept = withMark(kept, EVIDENCE_MAX);
    kept = recut ?? kept;
    // A cut can complete a URL pattern ("203.0.113.77x" cut to "203.0.113.77[cut]", red team L2): then the evidence
    // keeps only the redaction.
    if (hasUrl(kept)) kept = URL_REDACTION;
    c.evidence = kept;
  }
  cut.evidence = evidenceCut.size;
  return anyCut(cut) ? { status: 'ok', verdict, redactedUrls, cut } : { status: 'ok', verdict, redactedUrls };
}
