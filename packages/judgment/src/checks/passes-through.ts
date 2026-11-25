// The passes_through check (ADR-0047 section 2): the recorded path passes through each waypoint of the terms, in order.
// Row r is at waypoint k when every series is within `tolerance` of the waypoint's coordinate for that series, in
// integer units. One forward scan takes the earliest row for each waypoint: an earlier match never rules out a later one.
import type { JudgmentCheck } from '../terms.js';
import type { StepBudget } from './safe-regex.js';
import { DATA_WORK, SERIES_LIMITS as MAX, isSafeInt, isStep, readIntegers, validateSeries, type DataOutcome, type Sources } from './series.js';
import { hasShape } from './signature-valid.js';

type PassesThroughCheck = Extract<JudgmentCheck, { type: 'passes_through' }>;

/** Static validation for offer time: why the terms' check is malformed, or undefined. */
export function validatePassesThrough(check: unknown): string | undefined {
  if (!hasShape(check, ['id', 'type', 'required', 'series', 'waypoints', 'tolerance'])) return 'passes_through needs exactly id, type, required, series, waypoints and tolerance';
  const { series, waypoints, tolerance } = check;
  if (!Array.isArray(series) || series.length < 1 || series.length > MAX.series) return `series must list 1 to ${MAX.series} series`;
  for (const [i, s] of series.entries()) {
    const bad = validateSeries(s, `series[${i}]`);
    if (bad) return bad;
  }
  if (!Array.isArray(waypoints) || waypoints.length < 1 || waypoints.length > MAX.waypoints) return `waypoints must list 1 to ${MAX.waypoints} waypoints`;
  for (const [k, w] of waypoints.entries()) {
    if (!Array.isArray(w) || w.length !== series.length) return `waypoint ${k} must have one coordinate per series`;
    if (!w.every(isSafeInt)) return `waypoint ${k} must hold integers`;
  }
  if (!isStep(tolerance)) return 'tolerance must be a non-negative integer';
  return undefined;
}

/** The check's result on the delivery. A detail never quotes a delivered value. Throws only BudgetExhausted. */
export function evaluatePassesThrough(check: PassesThroughCheck, src: Sources, budget: StepBudget): DataOutcome {
  const invalid = validatePassesThrough(check);
  if (invalid) return { passed: false, detail: `check invalid: ${invalid}` };
  const columns: number[][] = [];
  for (const [i, s] of check.series.entries()) {
    const read = readIntegers(s, `series ${i + 1}`, src, budget);
    if (!read.ok) return { passed: false, detail: read.detail };
    if (i > 0 && read.value.length !== columns[0]!.length) return { passed: false, detail: `series ${i + 1} has ${read.value.length} rows; series 1 has ${columns[0]!.length}` };
    columns.push(read.value);
  }
  const rows = columns[0]!.length;
  const { waypoints, tolerance } = check;
  let next = 0;
  let last = 0;
  for (let r = 0; r < rows && next < waypoints.length; r++) {
    budget.spend(columns.length * DATA_WORK.perComparison);
    const w = waypoints[next]!;
    // Safe integers differ by at most 2^54. A difference above 2^53 may round, but never to a value at or below a
    // safe tolerance, so the comparison is exact where it matters.
    if (columns.every((c, s) => Math.abs(c[r]! - w[s]!) <= tolerance)) {
      next++;
      last = r + 1;
    }
  }
  if (next === waypoints.length) return { passed: true, detail: `reached ${next} of ${waypoints.length} waypoints in order` };
  const after = next === 0 ? 'in any row' : `after row ${last}`;
  return { passed: false, detail: `reached ${next} of ${waypoints.length} waypoints in order; waypoint ${next + 1} is not within tolerance ${after}` };
}
