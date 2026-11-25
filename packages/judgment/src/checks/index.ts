// Stage 1, deterministic checks. The registry is a closed union: exactly the check types in
// commitment.schema.json, each evaluated by built-in code over data. Nothing from a commitment or a
// deliverable is executed.
//
// Checks run on the decoded text exactly as delivered (intake `raw`), never on normalized text, so
// fullwidth digits or hidden characters cannot be folded into passing values.
//
// A check that cannot be evaluated (bad pattern, unsupported schema keyword, missing reference,
// unknown type, hostile shape) fails closed. A check that runs out of the shared work budget is
// inconclusive: it is recorded as not passed, and the pipeline escalates instead of rejecting.
import { err, ok, type MimeType, type Result } from '@holdback/core';
import { MAX_CIPHERTEXT_BYTES as STORE_MAX_BYTES, sha256 } from '@holdback/core/crypto';
import { countHidden, type HiddenCounts } from '../hidden.js';
import { hasUnexplainedTagChars } from '../normalize.js';
import type { JudgmentCheck } from '../terms.js';
import type { UntrustedData } from '../untrusted.js';
import { chargeChars, codePoints, SET_UNITS } from './cost.js';
import { isIso8601 } from './iso8601.js';
import { compileJsonSchema, type Validator } from './json-schema.js';
import { BudgetExhausted, compileSafeRegex, StepBudget, type SafeRegex } from './safe-regex.js';
import { evaluateSignatureValid, validateSignatureCheck, type ParsedDelivery } from './signature-valid.js';
import { cellAt, cellText, isNonScalar, jsonTable, toTable, type Cell, type Table } from './table.js';

export type CheckType = JudgmentCheck['type'];

/** judgment.schema.json `deterministic[]`. */
export interface CheckOutcome {
  checkId: string;
  required: boolean;
  passed: boolean;
  detail?: string;
}

export interface CheckInput {
  /** The deliverable text as delivered (not normalized). */
  data: UntrustedData;
  mime: MimeType;
  /** Reference files by committed sha256, as fetched (unverified) bytes. */
  references?: ReadonlyMap<string, Uint8Array>;
}

export interface CheckRun {
  outcomes: CheckOutcome[];
  /** Ids of checks that ran out of budget: not evaluated, so neither passed nor failed. */
  inconclusive: string[];
}

const REGISTRY = {
  csv_columns_exact: true,
  row_count_range: true,
  unique_key: true,
  null_rate_max: true,
  regex_match_rate_min: true,
  iso8601_date_column: true,
  json_schema: true,
  reference_row_match_min: true,
  hidden_characters_max: true,
  signature_valid: true,
} as const satisfies Record<CheckType, true>;
export const CHECK_TYPES: ReadonlySet<CheckType> = new Set(Object.keys(REGISTRY) as CheckType[]);

/**
 * Work allowance per delivery across all checks. A unit is one regex state visit or schema node visit, or the
 * like for the other steps (cost.ts): one cell read, one name looked up, 16 characters scanned.
 */
export const CHECK_BUDGET = 50_000_000;
/** Units per cell of iso8601_date_column: the date patterns and the calendar test. */
const ISO_CELL_UNITS = 2;
/** Reference bytes per unit, for hashing, decoding and the tag scan. */
const REFERENCE_BYTES_PER_UNIT = 4;

/**
 * Cell values null_rate_max counts as null after trimming: built-in, case-insensitive. A per-check
 * list would need a schema field (see the task's Handoff).
 */
export const NULL_TOKENS: ReadonlySet<string> = new Set(['null', 'nil', 'n/a', 'nan', 'undefined', '-', '--', '?']);
/** Whitespace, format characters (zero-width, bidi, tags) and blank-looking letters such as fillers. */
const BLANK_CHAR = /[\s\p{Cf}\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u2800\u3164\uFE00-\uFE0F\uFFA0\u{E0100}-\u{E01EF}]/u;

const ASCII_BLANK = (cp: number) => cp === 0x20 || (cp >= 0x09 && cp <= 0x0d);
const isBlank = (cp: number) => (cp < 0x80 ? ASCII_BLANK(cp) : BLANK_CHAR.test(String.fromCodePoint(cp)));

/** Null for null_rate_max: empty, blank-looking, a null token, or a non-scalar JSON value. Each code point read costs one unit. */
export function isNullish(c: Cell, budget?: StepBudget): boolean {
  if (c === null || isNonScalar(c)) return true;
  // Code point by code point from each end, without copying the cell: a regex loop over a multi-megabyte cell can
  // overflow the stack.
  let start = 0;
  let end = c.length;
  while (start < end) {
    budget?.spend(1);
    const cp = c.codePointAt(start)!;
    if (!isBlank(cp)) break;
    start += cp > 0xffff ? 2 : 1;
  }
  while (end > start) {
    budget?.spend(1);
    const lo = c.charCodeAt(end - 1);
    const hi = end - 2 >= start ? c.charCodeAt(end - 2) : 0;
    const at = lo >= 0xdc00 && lo <= 0xdfff && hi >= 0xd800 && hi <= 0xdbff ? end - 2 : end - 1;
    if (!isBlank(c.codePointAt(at)!)) break;
    end = at;
  }
  if (start === end) return true;
  // A token has at most 16 code points, so at most 32 UTF-16 units.
  if (end - start > 32) return false;
  const core = c.slice(start, end);
  return codePoints(core) <= 16 && NULL_TOKENS.has(core.toLowerCase());
}

const DETAIL_MAX = 300;
/**
 * A detail cut to DETAIL_MAX UTF-16 units, never inside a surrogate pair. Details quote delivered text (a CSV header,
 * a JSON key), and half a pair left at the cut made the judgment record's RFC 8785 hash throw (T-570, red team of
 * PR 722). runPipeline's well-forming pass stays as the net under this.
 */
function cap(s: string): string {
  if (s.length <= DETAIL_MAX) return s;
  let end = DETAIL_MAX - 3;
  const last = s.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${s.slice(0, end)}...`;
}
/** Display only; decisions use integer cross-multiplication. */
const pct = (count: number, total: number) => (total ? `${count}/${total}` : '0/0');
const bps = (b: number) => `${b} bps`;
const isBps = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 10_000;
const isCount = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const HIDDEN_KEYS = ['tag', 'bidi', 'variationSelector', 'otherIgnorable', 'total'] as const;

/** A check validated, with its pattern or schema compiled once for the run. */
type Prepared = { error: string } | { error?: undefined; regex?: SafeRegex; schema?: Validator };

function prepare(check: JudgmentCheck): Prepared {
  const type: string = check.type;
  if (!CHECK_TYPES.has(type as CheckType)) return { error: `unknown check type ${type.slice(0, 40)}` };
  const reason = (error: string | undefined): Prepared => (error === undefined ? {} : { error });
  switch (check.type) {
    case 'row_count_range':
      return reason(check.min > check.max ? 'min is greater than max' : undefined);
    case 'null_rate_max':
      return reason(isBps(check.maxBps) ? undefined : 'maxBps must be an integer 0..10000');
    case 'reference_row_match_min':
      return reason(isBps(check.minBps) ? undefined : 'minBps must be an integer 0..10000');
    case 'regex_match_rate_min': {
      if (!isBps(check.minBps)) return { error: 'minBps must be an integer 0..10000' };
      const r = compileSafeRegex(check.pattern);
      return r.ok ? { regex: r.value } : { error: `pattern refused: ${r.error}` };
    }
    case 'hidden_characters_max': {
      const keys = Object.keys(check.max ?? {});
      if (keys.length === 0) return { error: 'max must name at least one class' };
      for (const k of keys) {
        if (!(HIDDEN_KEYS as readonly string[]).includes(k)) return { error: `unknown hidden-character class ${k.slice(0, 40)}` };
        if (!isCount((check.max as Record<string, unknown>)[k])) return { error: `max.${k} must be a non-negative integer` };
      }
      return {};
    }
    case 'json_schema': {
      const r = compileJsonSchema(check.schema);
      return r.ok ? { schema: r.value } : { error: `schema refused: ${r.error}` };
    }
    case 'signature_valid':
      return reason(validateSignatureCheck(check));
    default:
      return {};
  }
}

/** Static validation, usable at offer time. Returns a reason the check cannot be evaluated, or undefined. */
export function validateCheck(check: JudgmentCheck): string | undefined {
  return prepare(check).error;
}

/** A table with its column names indexed: the first column of each name, as indexOf finds it. */
type Indexed = Table & { index: Map<string, number> };

function indexed(t: Table, budget: StepBudget): Indexed {
  const index = new Map<string, number>();
  for (const [i, c] of t.columns.entries()) {
    budget.spend(1);
    if (!index.has(c)) index.set(c, i);
  }
  return { ...t, index };
}

function column(t: Indexed, name: string, budget: StepBudget): number | string {
  budget.spend(1);
  return t.index.get(name) ?? `column ${name} not found`;
}

/**
 * The items joined by ", ", built only as far as a detail can show: past DETAIL_MAX characters the rest is cut by
 * cap anyway, so the capped detail is the same as with the whole list.
 */
function list(items: readonly string[]): string {
  let out = '';
  for (const [i, item] of items.entries()) {
    out += i === 0 ? item : `, ${item}`;
    if (out.length > DETAIL_MAX) break;
  }
  return out;
}

type Outcome = { passed: boolean; detail?: string };
const pass = (detail?: string): Outcome => (detail === undefined ? { passed: true } : { passed: true, detail });
const fail = (detail: string): Outcome => ({ passed: false, detail });

/** What one run reads once and shares among its checks, each computed on first use and charged then. */
interface Run {
  input: CheckInput;
  budget: StepBudget;
  table(): Result<Indexed, string>;
  /** The delivery read as JSON, shared by every JSON check and the JSON table, none of which changes it. */
  json(): ParsedDelivery;
  hidden(): HiddenCounts;
  /** A reference read once and kept only until the last check that names it has used it. */
  reference(sha: string, bytes: Uint8Array): Result<Indexed, string>;
}

/** Charges `f` and keeps its result, unless the budget runs out first: then the next caller tries again and runs out too. */
function once<T>(f: () => T): () => T {
  let done: { value: T } | undefined;
  return () => {
    done ??= { value: f() };
    return done.value;
  };
}

function newRun(input: CheckInput, budget: StepBudget, checks: readonly JudgmentCheck[]): Run {
  // One parse per run, not charged (T-597): signature_valid's charges are part of its kind (ADR-0045, section 6).
  const json = once((): ParsedDelivery => {
    try {
      return { ok: true, value: JSON.parse(input.data.reveal()) as unknown };
    } catch {
      return { ok: false };
    }
  });
  const table = once((): Result<Indexed, string> => {
    try {
      let t: Result<Table, string>;
      if (input.mime === 'application/json') {
        const doc = json();
        t = doc.ok ? jsonTable(doc.value, budget) : err('deliverable is not valid JSON');
      } else t = toTable(input.data.reveal(), input.mime, budget);
      return t.ok ? ok(indexed(t.value, budget)) : t;
    } catch (e) {
      if (e instanceof BudgetExhausted) throw e;
      return err('deliverable could not be read as a table');
    }
  });
  const hidden = once((): HiddenCounts => {
    const text = input.data.reveal();
    chargeChars(budget, text.length);
    const counts = countHidden(text);
    budget.spend(counts.total);
    return counts;
  });
  // Uses left per reference, so a table no later check needs is not held: twenty references at once would not fit.
  const uses = new Map<string, number>();
  for (const c of checks) if (c.type === 'reference_row_match_min') uses.set(c.reference.sha256, (uses.get(c.reference.sha256) ?? 0) + 1);
  const references = new Map<string, () => Result<Indexed, string>>();
  const reference = (sha: string, bytes: Uint8Array) => {
    const left = (uses.get(sha) ?? 1) - 1;
    uses.set(sha, left);
    let f = references.get(sha);
    if (!f) {
      f = once(() => readReference(sha, bytes, input.mime, budget));
      references.set(sha, f);
    }
    const r = f();
    if (left <= 0) references.delete(sha);
    return r;
  };
  return { input, budget, table, json, hidden, reference };
}

function readReference(sha: string, bytes: Uint8Array, mime: MimeType, budget: StepBudget): Result<Indexed, string> {
  // The most any content store keeps (references.ts, REFERENCE_MAX_BYTES): checked before hashing or parsing.
  if (bytes.length > STORE_MAX_BYTES) return err(`reference is ${bytes.length} bytes; the cap is ${STORE_MAX_BYTES}`);
  budget.spend(Math.ceil(bytes.length / REFERENCE_BYTES_PER_UNIT));
  if (sha256(bytes) !== sha) return err('reference bytes do not match the committed hash');
  let text: string;
  try {
    // The reference is compared as committed: decoded, not normalized, like the deliverable.
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return err('reference is not valid UTF-8');
  }
  if (hasUnexplainedTagChars(text)) return err('reference contains Unicode tag characters');
  const rr = toTable(text, mime, budget);
  return rr.ok ? ok(indexed(rr.value, budget)) : err(`reference: ${rr.error}`);
}

/** The cell as a JSON string, for keys and comparisons, charged for its length. */
function keyOf(c: Cell, budget: StepBudget): string {
  const k = JSON.stringify(c);
  budget.spend(1);
  chargeChars(budget, k.length);
  return k;
}

function evaluate(check: JudgmentCheck, prepared: Prepared, run: Run): Outcome {
  if (prepared.error !== undefined) return fail(`check invalid: ${prepared.error}`);
  const { input, budget } = run;
  if (check.type === 'json_schema') {
    const doc = run.json();
    if (!doc.ok) return fail('deliverable is not valid JSON');
    const e = prepared.schema!(doc.value, budget);
    return e === undefined ? pass() : fail(`schema: ${e}`);
  }
  if (check.type === 'signature_valid') return evaluateSignatureValid(check, run.json, budget);
  if (check.type === 'hidden_characters_max') {
    // Counted on the text as delivered, every occurrence, legitimate or not (D17).
    budget.spend(1);
    const counts = run.hidden();
    const over = HIDDEN_KEYS.filter((k) => check.max[k] !== undefined && counts[k] > check.max[k]!);
    const summary = HIDDEN_KEYS.map((k) => `${k} ${counts[k]}`).join(', ');
    return over.length ? fail(`over the limit for ${over.join(', ')} (${summary})`) : pass(summary);
  }
  if (check.type === 'csv_columns_exact' && input.mime !== 'text/csv') return fail(`csv_columns_exact needs a text/csv deliverable, not ${input.mime}`);
  const tr = run.table();
  if (!tr.ok) return fail(tr.error);
  const t = tr.value;
  switch (check.type) {
    case 'csv_columns_exact': {
      const n = t.columns.length === check.columns.length ? check.columns.length : 0;
      budget.spend(n + 1);
      const same = n === check.columns.length && t.columns.every((c, i) => c === check.columns[i]);
      return same ? pass() : fail(`columns are [${list(t.columns)}]; expected [${list(check.columns)}]`);
    }
    case 'row_count_range': {
      const n = t.rows;
      return n >= check.min && n <= check.max ? pass(`${n} rows`) : fail(`${n} rows; expected ${check.min} to ${check.max}`);
    }
    case 'unique_key': {
      const named = check.columns.map((c) => column(t, c, budget));
      const missing = named.find((i) => typeof i === 'string');
      if (missing !== undefined) return fail(missing as string);
      // A column named twice adds nothing to what makes a key unique, so each column is read once.
      const idx = [...new Set(named as number[])];
      const seen = new Set<string>();
      for (let r = 0; r < t.rows; r++) {
        const key = JSON.stringify(idx.map((i) => cellAt(t, r, i)));
        budget.spend(SET_UNITS);
        chargeChars(budget, key.length);
        if (seen.has(key)) return fail(`duplicate key at row ${r + 1}`);
        seen.add(key);
      }
      return pass();
    }
    case 'null_rate_max': {
      const i = column(t, check.column, budget);
      if (typeof i === 'string') return fail(i);
      let nulls = 0;
      for (let r = 0; r < t.rows; r++) {
        budget.spend(1);
        if (isNullish(cellAt(t, r, i), budget)) nulls++;
      }
      const ok = nulls * 10_000 <= check.maxBps * t.rows;
      return ok ? pass(`null ${pct(nulls, t.rows)}`) : fail(`null ${pct(nulls, t.rows)} exceeds ${bps(check.maxBps)}`);
    }
    case 'regex_match_rate_min': {
      const i = column(t, check.column, budget);
      if (typeof i === 'string') return fail(i);
      const re = prepared.regex!;
      let matches = 0;
      for (let r = 0; r < t.rows; r++) {
        budget.spend(1);
        const s = cellText(cellAt(t, r, i));
        if (s !== null && re.fullMatch(s, budget)) matches++;
      }
      // Zero rows match vacuously; row_count_range governs emptiness.
      const ok = t.rows === 0 || matches * 10_000 >= check.minBps * t.rows;
      return ok ? pass(`match ${pct(matches, t.rows)}`) : fail(`match ${pct(matches, t.rows)} below ${bps(check.minBps)}`);
    }
    case 'iso8601_date_column': {
      const i = column(t, check.column, budget);
      if (typeof i === 'string') return fail(i);
      for (let r = 0; r < t.rows; r++) {
        const c = cellAt(t, r, i);
        budget.spend(ISO_CELL_UNITS);
        if (c !== null && (isNonScalar(c) || !isIso8601(c))) return fail(`row ${r + 1} is not an ISO 8601 date`);
      }
      return pass();
    }
    case 'reference_row_match_min': {
      const bytes = input.references?.get(check.reference.sha256);
      if (!bytes) return fail('reference not available');
      const rr = run.reference(check.reference.sha256, bytes);
      if (!rr.ok) return fail(rr.error);
      const ref = rr.value;
      const rk = column(ref, check.keyColumn, budget);
      const dk = column(t, check.keyColumn, budget);
      if (typeof rk === 'string') return fail(`reference: ${rk}`);
      if (typeof dk === 'string') return fail(dk);
      const byKey = new Map<string, number>();
      for (let r = 0; r < t.rows; r++) {
        const k = keyOf(cellAt(t, r, dk), budget);
        budget.spend(SET_UNITS);
        if (!byKey.has(k)) byKey.set(k, r);
      }
      const map = ref.columns.map((c) => {
        budget.spend(1);
        return t.index.get(c) ?? -1;
      });
      let matched = 0;
      for (let r = 0; r < ref.rows; r++) {
        const k = keyOf(cellAt(ref, r, rk), budget);
        budget.spend(SET_UNITS);
        const d = byKey.get(k);
        if (d !== undefined && map.every((di, ri) => di >= 0 && keyOf(cellAt(t, d, di), budget) === keyOf(cellAt(ref, r, ri), budget))) matched++;
      }
      const ok = ref.rows === 0 || matched * 10_000 >= check.minBps * ref.rows;
      return ok ? pass(`reference match ${pct(matched, ref.rows)}`) : fail(`reference match ${pct(matched, ref.rows)} below ${bps(check.minBps)}`);
    }
  }
}

/** Evaluates every check in declaration order under one shared budget, reporting inconclusive ones. */
export function runChecks(checks: readonly JudgmentCheck[], input: CheckInput, budget = new StepBudget(CHECK_BUDGET)): CheckRun {
  const run = newRun(input, budget, checks);
  const inconclusive: string[] = [];
  const outcomes = checks.map((check) => {
    let o: Outcome;
    try {
      o = evaluate(check, prepare(check), run);
    } catch (e) {
      if (e instanceof BudgetExhausted) {
        inconclusive.push(check.id);
        o = fail('inconclusive: the check work budget for this delivery ran out');
      } else {
        // Hostile shapes (for example JSON nested deep enough to exhaust the stack) fail the check, never the pipeline.
        o = fail('check could not be evaluated on this input');
      }
    }
    const out: CheckOutcome = { checkId: check.id, required: check.required, passed: o.passed };
    if (o.detail !== undefined) out.detail = cap(o.detail);
    return out;
  });
  return { outcomes, inconclusive };
}

/** Evaluates every check, in declaration order. See runChecks for inconclusive results. */
export function evaluateChecks(checks: readonly JudgmentCheck[], input: CheckInput, budget?: StepBudget): CheckOutcome[] {
  return runChecks(checks, input, budget).outcomes;
}
