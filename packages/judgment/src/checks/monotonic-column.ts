// The monotonic_column check (ADR-0047 section 3): a series of integers never decreases, and each step from one row to
// the next lies between minStep (default 0) and maxStep (default none). minStep 1 makes it strictly increasing; minStep
// equal to maxStep holds a fixed sample rate. Shuffled, repeated or spliced rows break it.
import type { JudgmentCheck } from '../terms.js';
import type { StepBudget } from './safe-regex.js';
import { DATA_WORK, isStep, readIntegers, validateSeries, type DataOutcome, type Sources } from './series.js';
import { hasShape } from './signature-valid.js';

type MonotonicCheck = Extract<JudgmentCheck, { type: 'monotonic_column' }>;

/** Static validation for offer time: why the terms' check is malformed, or undefined. */
export function validateMonotonicColumn(check: unknown): string | undefined {
  if (!hasShape(check, ['id', 'type', 'required', 'series'], ['minStep', 'maxStep'])) return 'monotonic_column needs exactly id, type, required and series, and may have minStep and maxStep';
  const bad = validateSeries(check.series, 'series');
  if (bad) return bad;
  const { minStep, maxStep } = check;
  if (minStep !== undefined && !isStep(minStep)) return 'minStep must be a non-negative integer';
  if (maxStep !== undefined && !isStep(maxStep)) return 'maxStep must be a non-negative integer';
  if (isStep(minStep) && isStep(maxStep) && minStep > maxStep) return 'minStep is greater than maxStep';
  return undefined;
}

/** The check's result on the delivery. A detail never quotes a delivered value. Throws only BudgetExhausted. */
export function evaluateMonotonicColumn(check: MonotonicCheck, src: Sources, budget: StepBudget): DataOutcome {
  const invalid = validateMonotonicColumn(check);
  if (invalid) return { passed: false, detail: `check invalid: ${invalid}` };
  const read = readIntegers(check.series, 'series', src, budget);
  if (!read.ok) return { passed: false, detail: read.detail };
  const v = read.value;
  const min = check.minStep ?? 0;
  const max = check.maxStep;
  for (let i = 1; i < v.length; i++) {
    budget.spend(DATA_WORK.perComparison);
    // Exact for every step a safe bound can hold: see passes-through.ts on differences of safe integers.
    const step = v[i]! - v[i - 1]!;
    if (step < 0) return { passed: false, detail: `row ${i + 1} is lower than row ${i}` };
    if (step < min) return { passed: false, detail: `row ${i + 1} steps less than minStep after row ${i}` };
    if (max !== undefined && step > max) return { passed: false, detail: `row ${i + 1} steps more than maxStep after row ${i}` };
  }
  return { passed: true, detail: `${v.length} rows in order` };
}
