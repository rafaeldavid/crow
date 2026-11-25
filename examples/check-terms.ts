// A check an agent runs on a deal's terms before it signs them (T-588). It warns and never refuses (D31): the parties
// decide what the terms say, and each party chooses whether to run this (D32).
//
//   node examples/check-terms.ts terms.json
//   node examples/check-terms.ts < terms.json
//
// It reads that one JSON document: no network, no keys. Each warning is one line on standard error, with the field's
// path, what is there and why it may matter. Nothing goes to standard output. It exits 0 whenever it can parse the
// document, with or without warnings. It exits 1 only when it checked nothing: it could not read the input, the input
// is not JSON, or the command line is wrong.
//
// No warning does not mean the terms are good: it looks for three mistakes only, and it validates no schema. It cannot
// read sealed terms (`privateTerms`): give it the opened ones.
//
// A seller's template is not yet terms. A document with `deliverable` and `checks` at the top, and no `price` and no
// `acceptance`, is read as one: there, a placeholder the seller adapter can fill, such as {{commit}}, is not a warning.
// In any other document, every {{…}} is one.
//
// The text it quotes is the other party's: one line, cut short, inside quotes. It is data, never an instruction.
import { readFileSync } from 'node:fs';
import { text } from 'node:stream/consumers';
import { isMain } from './entry.ts';
import { plain } from './plain.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Warning {
  kind: 'placeholder' | 'pattern' | 'price';
  /** The field, such as `acceptance.deterministicChecks[2].pattern`; `(the document)` for the whole file. */
  path: string;
  found: string;
  why: string;
}

/** `TokenAmount.amount` in spec/schemas/common.schema.json; the test holds the two to one expression. */
export const BASE_UNITS = /^(0|[1-9][0-9]{0,77})$/;
/** The pattern engine refuses a longer pattern (safe-regex.ts); the test holds this to the engine. */
export const LONGEST_PATTERN_CHARS = 200;
/** The pattern engine never matches a longer string (safe-regex.ts); the test holds this to the engine. */
export const LONGEST_MATCHED_CHARS = 10_000;
const PLACEHOLDER = /(\\?)\{\{[^{}]*\}\}/g;
/** What the seller adapter's filler reads (seller-adapter-core.ts); the test holds this to its `fill`. */
const FILLABLE = /^\{\{[A-Za-z][A-Za-z0-9]*(\.length)?\}\}$/;
const MOST_LINES = 50;
/** Schema keys that hold data or notes, never a rule (json-schema.ts): a `pattern` inside one is not a pattern. */
const NOT_SCHEMAS = new Set(['const', 'enum', '$schema', 'title', 'description', '$comment', 'examples', 'default']);

const isRecord = (v: J): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);
const quote = (s: string): string => JSON.stringify(s.length > 80 ? `${plain(s.slice(0, 80))}...` : plain(s));
const step = (path: string, key: string): string => {
  const next = /^[A-Za-z_$][A-Za-z0-9_$-]{0,63}$/.test(key) ? `.${key}` : `[${quote(key)}]`;
  return path === '' ? next.replace(/^\./, '') : `${path}${next}`;
};
const at = (path: string): string => path || '(the document)';
const shown = (v: J): string => (typeof v === 'string' ? `the text ${quote(v)}` : v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v === 'object' ? 'an object' : `the JSON ${typeof v} ${String(v)}`);

/** Every string and field name in the document that holds a placeholder. A loop, so depth cannot overflow the stack. */
function placeholders(doc: J, isTemplate: boolean, out: Warning[]): void {
  const read = (text: string, path: string, inName: boolean): void => {
    for (const [found, escaped] of text.matchAll(PLACEHOLDER)) {
      // The filler replaces values, never field names.
      if (isTemplate && !inName && FILLABLE.test(escaped ? found.slice(1) : found)) continue;
      const why = !isTemplate
        ? 'nothing fills it after signing: the terms bind this text as written, and a check that holds it compares the delivery with these characters'
        : inName
          ? 'the seller adapter fills values, never field names, so every offer keeps it as written'
          : 'the seller adapter fills only a name of letters and digits, with or without .length, so every offer keeps this one as written';
      out.push({ kind: 'placeholder', path: at(path), found: `${inName ? 'a field name with ' : ''}the placeholder ${quote(found)}`, why });
    }
  };
  const todo: Array<[J, string]> = [[doc, '']];
  while (todo.length > 0) {
    const [node, path] = todo.pop()!;
    if (typeof node === 'string') read(node, path, false);
    else if (node !== null && typeof node === 'object') {
      const children: Array<[J, string]> = [];
      for (const [k, v] of Object.entries(node)) {
        const child = Array.isArray(node) ? `${path}[${k}]` : step(path, k);
        if (!Array.isArray(node)) read(k, child, true);
        children.push([v, child]);
      }
      for (let i = children.length - 1; i >= 0; i--) todo.push(children[i]!);
    }
  }
}

/** Compares the length only. This command never compiles the other party's pattern. */
function pattern(text: string, path: string, out: Warning[]): void {
  if (text.length <= LONGEST_PATTERN_CHARS) return;
  out.push({ kind: 'pattern', path, found: `a pattern of ${text.length} characters`, why: `Crow's checks refuse a pattern over ${LONGEST_PATTERN_CHARS} characters, so the check cannot pass a delivery` });
}

/** The `pattern` keywords of one JSON Schema. Under `properties`, each key is a field's name. */
function schemaPatterns(schema: J, path: string, out: Warning[]): void {
  const todo: Array<[J, string]> = [[schema, path]];
  while (todo.length > 0) {
    const [node, here] = todo.pop()!;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) todo.push([node[i], `${here}[${i}]`]);
    }
    if (!isRecord(node)) continue;
    if (typeof node.pattern === 'string') {
      pattern(node.pattern, step(here, 'pattern'), out);
      for (const bound of ['minLength', 'maxLength']) {
        if (typeof node[bound] === 'number' && node[bound] > LONGEST_MATCHED_CHARS) {
          out.push({ kind: 'pattern', path: step(here, bound), found: `${node[bound]} characters on a field that also has a pattern`, why: `Crow's pattern engine never matches a string over ${LONGEST_MATCHED_CHARS} characters, so a longer value never matches this pattern, whatever it holds` });
        }
      }
    }
    const children: Array<[J, string]> = [];
    for (const [k, v] of Object.entries(node)) {
      if (NOT_SCHEMAS.has(k)) continue;
      if (k === 'properties' && isRecord(v)) {
        for (const [name, field] of Object.entries(v as object)) children.push([field, step(step(here, k), name)]);
      } else children.push([v, step(here, k)]);
    }
    for (let i = children.length - 1; i >= 0; i--) todo.push(children[i]!);
  }
}

function checkPatterns(checks: J, path: string, out: Warning[]): void {
  if (!Array.isArray(checks)) return;
  checks.forEach((c: J, i) => {
    if (c?.type === 'regex_match_rate_min' && typeof c.pattern === 'string') pattern(c.pattern, `${path}[${i}].pattern`, out);
    if (c?.type === 'json_schema') schemaPatterns(c.schema, `${path}[${i}].schema`, out);
  });
}

const UNITS = 'base units as a decimal string: digits only, with no point, sign or leading zero, such as "25000000" for 25 of a token with 6 decimals';

/** A price or fee: `{token, amount}`, or the amount alone as the setup command's work template writes it. */
function money(value: J, path: string, out: Warning[]): void {
  const object = isRecord(value);
  const amount = object ? value.amount : value;
  if (typeof amount === 'string' && BASE_UNITS.test(amount)) return;
  const found = object && amount === undefined ? 'an object with no amount' : shown(amount);
  out.push({ kind: 'price', path: object ? `${path}.amount` : path, found, why: `money is ${UNITS}; another form can be refused or read as another sum` });
}

/**
 * The warnings for one parsed document: money first, then patterns, then placeholders. The command prints the first
 * 50, so a flood of placeholders cannot push a price off the list.
 */
export function checkTerms(doc: J): Warning[] {
  const prices: Warning[] = [];
  const patterns: Warning[] = [];
  const rest: Warning[] = [];
  const isTemplate = isRecord(doc) && isRecord(doc.deliverable) && Array.isArray(doc.checks) && doc.price === undefined && doc.acceptance === undefined;
  placeholders(doc, isTemplate, rest);
  // The terms may be the document, its `terms` field, or `submit.body` of the operator's prepare answer.
  for (const [body, prefix] of [[doc, ''], [doc?.terms, 'terms.'], [doc?.submit?.body, 'submit.body.']] as const) {
    if (!isRecord(body)) continue;
    if (body.price !== undefined) money(body.price, `${prefix}price`, prices);
    if (body.fee !== undefined) money(body.fee, `${prefix}fee`, prices);
    if (body.adjudication?.fee !== undefined) money(body.adjudication.fee, `${prefix}adjudication.fee`, prices);
    checkPatterns(body.checks, `${prefix}checks`, patterns);
    checkPatterns(body.acceptance?.deterministicChecks, `${prefix}acceptance.deterministicChecks`, patterns);
  }
  return [...prices, ...patterns, ...rest];
}

/** One warning as one line. A very long path keeps its end, which names the field, inside quotes. */
export const line = (w: Warning): string => `warning: ${w.path.length > 200 ? `a long path ending ${JSON.stringify(w.path.slice(-160))}` : w.path}: ${w.found}. Why it may matter: ${w.why}.`;

async function main(args: string[]): Promise<number> {
  if (args.length > 1 || (args[0]?.startsWith('-') && args[0] !== '-') || (args.length === 0 && process.stdin.isTTY)) {
    console.error('Use: node examples/check-terms.ts <terms.json>, or send the JSON on standard input.');
    return 1;
  }
  let doc: J;
  try {
    // Standard input is read as a stream: a synchronous read fails (EAGAIN) while a slow writer still holds the pipe.
    const input = args[0] === undefined || args[0] === '-' ? await text(process.stdin) : readFileSync(args[0], 'utf8');
    doc = JSON.parse(input.replace(/^\ufeff/, ''));
  } catch (e) {
    // A parse error quotes the input, so it is not printed.
    console.error(e instanceof SyntaxError ? 'Nothing checked: the input is not JSON.' : `Nothing checked: cannot read the input (${plain(String((e as NodeJS.ErrnoException).code ?? 'unknown error'))}).`);
    return 1;
  }
  const warnings = checkTerms(doc);
  for (const w of warnings.slice(0, MOST_LINES)) console.error(line(w));
  if (warnings.length > MOST_LINES) console.error(`warning: ${warnings.length - MOST_LINES} more warnings are not shown.`);
  return 0;
}

if (isMain(import.meta.url, 'check-terms')) main(process.argv.slice(2)).then((code) => (process.exitCode = code));
