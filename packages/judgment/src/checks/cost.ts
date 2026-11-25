// What stage-1 work costs in the shared check budget (CHECK_BUDGET). Every step a check takes on a party's
// delivery or terms is charged, so one unit stands for about the same time on every check and the budget
// bounds the time of a judging pass. Charges are counts, never timers, so every adjudicator on one build
// reaches the same result.
import type { StepBudget } from './safe-regex.js';

/** UTF-16 code units a scan reads for one budget unit. */
export const CHARS_PER_UNIT = 16;
/** Units to keep or find one key in a set or map, beside the key's length: hashing and memory cost several steps. */
export const SET_UNITS = 8;

/** Charges a scan of `chars` UTF-16 code units. */
export function chargeChars(budget: StepBudget | undefined, chars: number): void {
  if (chars > 0) budget?.spend(Math.ceil(chars / CHARS_PER_UNIT));
}

/** Charges a sort of `n` items: n times the bit length of n - 1, which is log2 n rounded up, in integers. */
export function chargeSort(budget: StepBudget | undefined, n: number): void {
  if (n > 1) budget?.spend(n * (32 - Math.clz32(n - 1)));
}

/**
 * How deep canonical() follows nested arrays and objects. Past it the value is refused as canonical form refuses
 * other values, at a fixed depth, so the answer does not depend on how much stack the engine has at that moment.
 */
export const MAX_CANONICAL_DEPTH = 1000;

/** The number of code points in `s` (lone surrogates count one each), in one pass that allocates nothing. */
export function codePoints(s: string): number {
  let n = s.length;
  for (let i = 0; i < s.length - 1; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n--;
        i++;
      }
    }
  }
  return n;
}

const LONE_SURROGATE = /\p{Cs}/u;

function str(s: string, budget: StepBudget | undefined): string {
  chargeChars(budget, s.length);
  if (LONE_SURROGATE.test(s)) throw new TypeError('canonical JSON: lone surrogate in string');
  return JSON.stringify(s);
}

/** A scalar's canonical form, or undefined for an array or object. */
function scalar(v: unknown, budget: StepBudget | undefined): string | undefined {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false';
    case 'string':
      return str(v, budget);
    case 'number':
      if (!Number.isFinite(v)) throw new TypeError(`canonical JSON: non-finite number ${v}`);
      // Number.prototype.toString, which JSON.stringify uses (and which maps -0 to 0).
      return String(v);
  }
  return undefined;
}

function write(v: unknown, budget: StepBudget | undefined, parts: string[], depth: number): void {
  budget?.spend(1);
  if (depth > MAX_CANONICAL_DEPTH) throw new TypeError(`canonical JSON: nested deeper than ${MAX_CANONICAL_DEPTH}`);
  const s = scalar(v, budget);
  if (s !== undefined) parts.push(s);
  else if (Array.isArray(v)) {
    parts.push('[');
    for (let i = 0; i < v.length; i++) {
      if (i > 0) parts.push(',');
      write(v[i], budget, parts, depth + 1);
    }
    parts.push(']');
  } else if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const entries = Object.entries(v as Record<string, unknown>);
    for (const [k, x] of entries) if (x === undefined) throw new TypeError(`canonical JSON: undefined at key ${k}`);
    chargeSort(budget, entries.length);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    parts.push('{');
    for (let i = 0; i < entries.length; i++) {
      if (i > 0) parts.push(',');
      parts.push(str(entries[i]![0], budget), ':');
      write(entries[i]![1], budget, parts, depth + 1);
    }
    parts.push('}');
  } else throw new TypeError(`canonical JSON: unsupported ${typeof v}`);
}

/**
 * The RFC 8785 form of a JSON value, the same string `canonicalJson` (core) writes and throwing where it throws,
 * and also past MAX_CANONICAL_DEPTH.
 * Each node costs one unit, each string and key its length, and each object its key sort. The pieces are joined
 * once at the end, so no part is copied more than once however deep the value nests.
 */
export function canonical(v: unknown, budget?: StepBudget): string {
  if (typeof v !== 'object' || v === null) {
    budget?.spend(1);
    const s = scalar(v, budget);
    if (s === undefined) throw new TypeError(`canonical JSON: unsupported ${typeof v}`);
    return s;
  }
  const parts: string[] = [];
  write(v, budget, parts, 1);
  return parts.join('');
}
