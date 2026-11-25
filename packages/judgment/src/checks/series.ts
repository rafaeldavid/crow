// The series the data checks read (ADR-0047): passes_through, monotonic_column and equal_lengths. A series is a JSON
// array at an RFC 6901 pointer in a JSON delivery, or one column of the tabular view (CSV, or a JSON array of flat
// objects). Every entry must be an integer; nothing is rounded, so no float reaches a decision.
import type { Result } from '@holdback/core';
import type { StepBudget } from './safe-regex.js';
import { hasShape, isPointer, resolve, type ParsedDelivery } from './signature-valid.js';
import { cellText, type Table } from './table.js';

export type Series = { pointer: string } | { column: string };

/** Limits of the kinds (ADR-0047 section 5). They bound the work `validateCheck` does on every pass over the terms. */
export const SERIES_LIMITS = { column: 128, series: 32, waypoints: 1024 } as const;
/** Work units (ADR-0047 section 5). Part of the kinds: a change to them is a change to judgment and takes a new policy version. */
export const DATA_WORK = { perEntry: 1, perComparison: 1, perSeries: 1 } as const;

/** The delivery, read lazily and once per run by stage 1. */
export interface Sources {
  table: () => Result<Table, string>;
  json: () => ParsedDelivery;
}
export type DataOutcome = { passed: boolean; detail?: string };
export type Read<T> = { ok: true; value: T } | { ok: false; detail: string };

export const isSafeInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);
export const isStep = (n: unknown): n is number => isSafeInt(n) && n >= 0;

/** Why a series in the terms is malformed, or undefined. `pointers` refuses a column series. */
export function validateSeries(s: unknown, name: string, pointers = false): string | undefined {
  if (hasShape(s, ['pointer'])) return isPointer(s.pointer) ? undefined : `${name}.pointer must be an RFC 6901 JSON pointer of at most 512 characters`;
  if (pointers) return `${name} must be exactly { pointer }`;
  // Code points, as the schema's maxLength counts them (a lone surrogate counts one), so both refuse the same names.
  if (hasShape(s, ['column'])) return typeof s.column === 'string' && s.column.length <= 2 * SERIES_LIMITS.column && [...s.column].length <= SERIES_LIMITS.column ? undefined : `${name}.column must be a string of at most ${SERIES_LIMITS.column} characters`;
  return `${name} must be exactly { pointer } or { column }`;
}

/** The JSON array a pointer names. Reads nothing inside it. */
export function readArray(pointer: string, label: string, json: () => ParsedDelivery): Read<readonly unknown[]> {
  const parsed = json();
  if (!parsed.ok) return { ok: false, detail: 'not a JSON document' };
  const found = resolve(parsed.value, pointer);
  if (!found) return { ok: false, detail: `${label}: nothing at the pointer` };
  if (!Array.isArray(found.value)) return { ok: false, detail: `${label}: not an array` };
  return { ok: true, value: found.value };
}

/** One spelling per integer: no sign on zero, no leading zero, no plus, no space. At most 16 digits, then the safe range. */
const INTEGER_TEXT = /^(0|-?[1-9][0-9]{0,15})$/;

/**
 * The series' entries as safe integers, `-0` read as `0`. Charges one unit per entry before it reads them, so a refused
 * series still spends its length. Throws only BudgetExhausted.
 */
export function readIntegers(s: Series, label: string, src: Sources, budget: StepBudget): Read<number[]> {
  if ('pointer' in s) {
    const arr = readArray(s.pointer, label, src.json);
    if (!arr.ok) return arr;
    budget.spend(arr.value.length * DATA_WORK.perEntry);
    const out: number[] = new Array<number>(arr.value.length);
    for (let i = 0; i < arr.value.length; i++) {
      const v = arr.value[i];
      if (!isSafeInt(v)) return { ok: false, detail: `${label}: row ${i + 1} is not an integer` };
      out[i] = v + 0;
    }
    return { ok: true, value: out };
  }
  const t = src.table();
  if (!t.ok) return { ok: false, detail: t.error };
  const col = t.value.columns.indexOf(s.column);
  if (col < 0) return { ok: false, detail: `${label}: column not found` };
  // A CSV may repeat a header name. Readers disagree on which column it names, so the check reads neither.
  if (t.value.columns.lastIndexOf(s.column) !== col) return { ok: false, detail: `${label}: the column name appears twice` };
  const rows = t.value.rows;
  budget.spend(rows.length * DATA_WORK.perEntry);
  const out: number[] = new Array<number>(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const text = cellText(rows[i]![col]!);
    const v = text !== null && text.length <= 17 && INTEGER_TEXT.test(text) ? Number(text) : NaN;
    if (!isSafeInt(v)) return { ok: false, detail: `${label}: row ${i + 1} is not an integer` };
    out[i] = v;
  }
  return { ok: true, value: out };
}
