// The equal_lengths check (ADR-0047 section 4): every named JSON array in the delivery has the same number of entries.
// It serves column-oriented JSON, where each column is its own array; a CSV's parser already refuses ragged rows. It
// reads each array's length and nothing inside it.
import type { JudgmentCheck } from '../terms.js';
import type { StepBudget } from './safe-regex.js';
import { SERIES_LIMITS as MAX, readArray, validateSeries, type DataOutcome, type Sources } from './series.js';
import { hasShape } from './signature-valid.js';

type EqualLengthsCheck = Extract<JudgmentCheck, { type: 'equal_lengths' }>;

/** Static validation for offer time: why the terms' check is malformed, or undefined. */
export function validateEqualLengths(check: unknown): string | undefined {
  if (!hasShape(check, ['id', 'type', 'required', 'series'])) return 'equal_lengths needs exactly id, type, required and series';
  const { series } = check;
  if (!Array.isArray(series) || series.length < 2 || series.length > MAX.series) return `series must list 2 to ${MAX.series} pointers`;
  for (const [i, s] of series.entries()) {
    const bad = validateSeries(s, `series[${i}]`, true);
    if (bad) return bad;
  }
  return undefined;
}

/** The check's result on the delivery. Throws only BudgetExhausted. */
export function evaluateEqualLengths(check: EqualLengthsCheck, src: Pick<Sources, 'json'>, budget: StepBudget): DataOutcome {
  const invalid = validateEqualLengths(check);
  if (invalid) return { passed: false, detail: `check invalid: ${invalid}` };
  let first = 0;
  for (const [i, s] of check.series.entries()) {
    const arr = readArray(s.pointer, `series ${i + 1}`, src.json, budget);
    if (!arr.ok) return { passed: false, detail: arr.detail };
    if (i === 0) first = arr.value.length;
    else if (arr.value.length !== first) return { passed: false, detail: `series ${i + 1} has ${arr.value.length} entries; series 1 has ${first}` };
  }
  return { passed: true, detail: `${check.series.length} series of ${first} entries` };
}
