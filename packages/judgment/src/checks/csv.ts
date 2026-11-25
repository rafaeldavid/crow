// A strict RFC 4180 CSV parser (comma separator, double-quote quoting, CRLF or LF line ends).
// Single pass, no backtracking. Ragged rows, unterminated quotes and stray quotes are refused.
import { err, ok, type Result } from '@holdback/core';
import { chargeChars } from './cost.js';
import type { StepBudget } from './safe-regex.js';

export interface Csv {
  header: string[];
  /** Data rows, the header not included. */
  rows: number;
  /** Fields row by row (row r, column c at r * header length + c); an empty field is null. */
  cells: Array<string | null>;
}

const QUOTE = 0x22;
const COMMA = 0x2c;
const LF = 0x0a;
const CR = 0x0d;

/** Parses `text`, charging the budget for its length and one unit per field. */
export function parseCsv(text: string, budget?: StepBudget): Result<Csv, string> {
  chargeChars(budget, text.length);
  const n = text.length;
  const header: string[] = [];
  const cells: Array<string | null> = [];
  let inHeader = true;
  let records = 0;
  let rows = 0;
  let field = 0;
  // The first row whose field count differs from the header's; reported only if the whole text parses.
  let ragged: { row: number; fields: number } | undefined;
  const addField = (v: string) => {
    budget?.spend(1);
    if (inHeader) header.push(v);
    else if (field < header.length) cells.push(v === '' ? null : v);
    field++;
  };
  const endRecord = () => {
    if (inHeader) inHeader = false;
    else {
      if (field !== header.length) {
        ragged ??= { row: rows + 1, fields: field };
        for (let j = field; j < header.length; j++) cells.push(null);
      }
      rows++;
    }
    records++;
    field = 0;
  };
  let i = 0;
  while (i < n) {
    let value: string;
    if (text.charCodeAt(i) === QUOTE) {
      value = '';
      let from = i + 1;
      for (;;) {
        const q = text.indexOf('"', from);
        if (q < 0) return err('unterminated quoted field');
        if (text.charCodeAt(q + 1) === QUOTE) {
          value += text.slice(from, q + 1);
          from = q + 2;
          continue;
        }
        value += text.slice(from, q);
        i = q + 1;
        break;
      }
      const c = text.charCodeAt(i);
      if (i < n && c !== COMMA && c !== LF && c !== CR) return err(`line ${records + 1}: text after closing quote`);
    } else {
      let j = i;
      for (; j < n; j++) {
        const c = text.charCodeAt(j);
        if (c === COMMA || c === LF || c === CR) break;
        if (c === QUOTE) return err(`line ${records + 1}: quote inside an unquoted field`);
      }
      value = text.slice(i, j);
      i = j;
    }
    addField(value);
    if (i >= n) {
      endRecord();
      break;
    }
    const c = text.charCodeAt(i);
    if (c === COMMA) {
      i++;
      // A comma at the very end ends the record with one more, empty field.
      if (i >= n) {
        addField('');
        endRecord();
      }
      continue;
    }
    // A trailing line break does not add a record; a blank line in the middle is a one-empty-field record.
    i += c === CR && text.charCodeAt(i + 1) === LF ? 2 : 1;
    endRecord();
  }
  if (records === 0) return err('empty CSV');
  if (ragged) return err(`row ${ragged.row} has ${ragged.fields} fields; the header has ${header.length}`);
  return ok({ header, rows, cells });
}
