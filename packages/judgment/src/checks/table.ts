// A tabular view of a deliverable for the column checks: CSV (header plus rows) or a JSON array of
// flat objects. A cell is a string, null (empty CSV cell, JSON null or ""), or a non-scalar JSON
// value (object, array, boolean) kept apart so no check mistakes it for text.
import { err, ok, type MimeType, type Result } from '@holdback/core';
import { canonical, chargeChars, chargeSort, MAX_CANONICAL_DEPTH, TooDeep } from './cost.js';
import { parseCsv } from './csv.js';
import type { StepBudget } from './safe-regex.js';

export interface NonScalar {
  nonScalar: 'object' | 'array' | 'boolean';
  text: string;
}
export type Cell = string | null | NonScalar;

export interface Table {
  columns: string[];
  /** Data rows. */
  rows: number;
  /** Cells row by row, in one array: see cellAt. */
  cells: Cell[];
}

export const isNonScalar = (c: Cell): c is NonScalar => typeof c === 'object' && c !== null;
/** The cell as text for string checks; null and non-scalars have none. */
export const cellText = (c: Cell): string | null => (typeof c === 'string' ? c : null);
/** Units per JSON row, beside its cells: reading the row object and listing its keys. */
const ROW_UNITS = 4;
/** The cell in row `r` (from 0) and column `c`. */
export const cellAt = (t: Table, r: number, c: number): Cell => t.cells[r * t.columns.length + c]!;

function cell(v: unknown, budget: StepBudget | undefined): Cell {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return { nonScalar: 'boolean', text: String(v) };
  return { nonScalar: Array.isArray(v) ? 'array' : 'object', text: canonical(v, budget) };
}

/**
 * A parsed JSON delivery as a table, charging the budget for each cell and each row's keys. A cell nested deeper than
 * MAX_CANONICAL_DEPTH levels makes it no table.
 */
export function jsonTable(parsed: unknown, budget?: StepBudget): Result<Table, string> {
  if (!Array.isArray(parsed)) return err('JSON deliverable is not an array of objects');
  const first: unknown = parsed[0];
  if (parsed.length > 0 && (typeof first !== 'object' || first === null || Array.isArray(first))) return err('JSON row 0 is not an object');
  const columns = parsed.length ? Object.keys(first as object) : [];
  const keysOf = (keys: string[]) => {
    chargeSort(budget, keys.length);
    return canonical(keys.sort(), budget);
  };
  const key = keysOf([...columns]);
  const cells: Cell[] = [];
  for (const [i, r] of parsed.entries()) {
    budget?.spend(ROW_UNITS);
    if (typeof r !== 'object' || r === null || Array.isArray(r)) return err(`JSON row ${i} is not an object`);
    if (keysOf(Object.keys(r)) !== key) return err(`JSON row ${i} has different keys from row 0`);
    for (const c of columns) {
      budget?.spend(1);
      try {
        cells.push(cell((r as Record<string, unknown>)[c], budget));
      } catch (e) {
        // D102: a fixed count, never the stack, so every adjudicator fails the same cell with the same line.
        if (e instanceof TooDeep) return err(`JSON row ${i} has a cell nested deeper than ${MAX_CANONICAL_DEPTH} levels`);
        throw e;
      }
    }
  }
  return ok({ columns, rows: parsed.length, cells });
}

/** Reads `text` as a table, charging the budget for its length, each cell, and each row's keys. */
export function toTable(text: string, mime: MimeType, budget?: StepBudget): Result<Table, string> {
  if (mime === 'application/json') {
    chargeChars(budget, text.length);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return err('deliverable is not valid JSON');
    }
    return jsonTable(parsed, budget);
  }
  const csv = parseCsv(text, budget);
  if (!csv.ok) return err(`CSV: ${csv.error}`);
  return ok({ columns: csv.value.header, rows: csv.value.rows, cells: csv.value.cells });
}
