// T-614 (D103): the pattern engine reads at most MAX_SUBJECT_CHARS code points of a string. A longer string has no
// answer, so no check may pass because of it. Before, it counted as "no match", which `not` turned into a pass.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { UntrustedData } from '../untrusted.js';
import { runChecks } from './index.js';
import { compileSafeRegex, MAX_SUBJECT_CHARS, StepBudget, SubjectTooLong } from './safe-regex.js';

const schemaCheck = (schema: unknown, required = true) => ({ id: 'rule', type: 'json_schema' as const, required, schema: schema as Record<string, unknown> });
const judge = (schema: unknown, value: unknown, required = true) =>
  runChecks([schemaCheck(schema, required)], { data: UntrustedData.wrap(JSON.stringify(value)), mime: 'application/json' });
const passes = (schema: unknown, value: unknown) => judge(schema, value).outcomes[0]!.passed;

/** `text` padded with "a" to `length` code points. */
const padded = (text: string, length = MAX_SUBJECT_CHARS + 1) => text + 'a'.repeat(length - [...text].length);
const NO_WORD = { not: { pattern: 'secret' } };
const UNREAD = `a pattern met a string over ${MAX_SUBJECT_CHARS} code points`;

describe('json_schema: a string too long to match cannot pass a check', () => {
  const rules: [string, unknown][] = [
    ['not', NO_WORD],
    ['anyOf over not', { anyOf: [NO_WORD, { const: 'x' }] }],
    ['anyOf whose other branch passes', { anyOf: [{ pattern: 'secret' }, { type: 'string' }] }],
    ['oneOf that two branches match', { oneOf: [{ pattern: 'secret' }, { type: 'string' }] }],
    ['allOf over not', { allOf: [{ type: 'string' }, NO_WORD] }],
    ['not of not of not', { not: { not: NO_WORD } }],
    ['not over anyOf', { not: { anyOf: [{ pattern: 'secret' }, { pattern: 'token' }] } }],
    ['not over oneOf', { not: { oneOf: [{ pattern: 'secret' }, { pattern: 'token' }] } }],
    ['not over allOf', { not: { allOf: [{ type: 'string' }, { pattern: 'secret' }] } }],
  ];

  for (const [name, rule] of rules) {
    it(`fails under ${name}`, () => {
      const run = judge({ properties: { s: rule } }, { s: padded('secret') });
      expect(run.outcomes[0]).toMatchObject({ passed: false, detail: UNREAD });
      expect(run.inconclusive).toEqual([]);
    });
  }

  it('fails through items, additionalProperties and a negated properties object', () => {
    expect(passes({ items: NO_WORD }, ['ok', padded('secret')])).toBe(false);
    expect(passes({ additionalProperties: NO_WORD }, { extra: padded('secret') })).toBe(false);
    expect(passes({ not: { required: ['s'], properties: { s: { pattern: 'secret' } } } }, { s: padded('secret') })).toBe(false);
    expect(passes({ not: { items: { pattern: 'secret' } } }, [padded('secret')])).toBe(false);
  });

  it('fails an optional check too, and the long string need not hold what the pattern names', () => {
    expect(judge({ properties: { s: NO_WORD } }, { s: padded('') }, false).outcomes[0]).toMatchObject({ required: false, passed: false, detail: UNREAD });
  });

  it('reads a string at the cap, counted in code points', () => {
    const rule = { properties: { s: NO_WORD } };
    expect(passes(rule, { s: padded('', MAX_SUBJECT_CHARS) })).toBe(true);
    expect(passes(rule, { s: padded('secret', MAX_SUBJECT_CHARS) })).toBe(false);
    expect(passes(rule, { s: '\u{1F600}'.repeat(MAX_SUBJECT_CHARS) })).toBe(true);
    expect(passes(rule, { s: `${'\u{1F600}'.repeat(MAX_SUBJECT_CHARS)}a` })).toBe(false);
    expect(passes(rule, { s: padded('', 2 * MAX_SUBJECT_CHARS + 1) })).toBe(false);
  });

  it('leaves a long string no pattern reads', () => {
    expect(passes({ properties: { s: { type: 'string', minLength: 1 }, t: NO_WORD } }, { s: padded('secret'), t: 'short' })).toBe(true);
    expect(passes({ properties: { s: NO_WORD } }, { other: padded('secret') })).toBe(true);
  });

  it('still holds the maxLength guard: a definite failure read first needs no pattern', () => {
    expect(passes({ properties: { s: { maxLength: MAX_SUBJECT_CHARS, ...NO_WORD } } }, { s: padded('secret') })).toBe(false);
    // Under anyOf, a branch that fails on its length before its pattern is read is truly false, so the other decides.
    const guarded = { anyOf: [{ maxLength: MAX_SUBJECT_CHARS, pattern: '^a*$' }, { minLength: MAX_SUBJECT_CHARS + 1 }] };
    expect(passes(guarded, padded(''))).toBe(true);
  });

  it('does not stop the checks after it', () => {
    const run = runChecks([schemaCheck({ properties: { s: NO_WORD } }), { id: 'has-t', type: 'json_schema', required: true, schema: { required: ['t'] } }], {
      data: UntrustedData.wrap(JSON.stringify({ s: padded('secret'), t: 1 })),
      mime: 'application/json',
    });
    expect(run.outcomes.map((o) => o.passed)).toEqual([false, true]);
    expect(run.inconclusive).toEqual([]);
  });
});

describe('json_schema: the order of keys in the terms', () => {
  // The commitment ID hashes the terms with sorted keys, so two nodes may hold one deal's schema in two key orders.
  // Order can decide pass or fail only inside `not`, `anyOf` and `oneOf`, so the order is fixed there.
  const reversed = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(reversed);
    if (typeof v !== 'object' || v === null) return v;
    return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)]));
  };

  const cases: [unknown, unknown][] = [
    [{ not: { pattern: 'secret', maxLength: 5 } }, padded('secret')],
    [{ not: { pattern: 'secret', type: 'number' } }, padded('secret')],
    [{ not: { properties: { a: { pattern: 'secret' }, b: { const: 1 } } } }, { a: padded('secret'), b: 2 }],
    [{ not: { required: ['z'], properties: { a: { pattern: 'secret' } } } }, { a: padded('secret') }],
    [{ anyOf: [{ pattern: 'secret', type: 'number' }, { type: 'string' }] }, padded('secret')],
    [{ oneOf: [{ allOf: [{ items: { properties: { b: { const: 1 }, a: { pattern: 'x' } } } }] }, { type: 'array' }] }, [{ a: padded('x'), b: 2 }]],
  ];

  it('gives one result under not, anyOf and oneOf for either order', () => {
    for (const [schema, value] of cases) {
      expect(judge(reversed(schema), value), JSON.stringify(schema)).toEqual(judge(schema, value));
    }
  });

  // Elsewhere any failure fails the check, and keywords are read as written: a cheap failure the author put first still
  // rejects, where reading later work first would run out of budget and escalate the deal.
  const costly = { items: { pattern: '((a|b)(a|b)(a|b)(a|b))*c' } };
  const work = { a: Array.from({ length: 20 }, () => `${'ab'.repeat(500)}c`) };
  const onBudget = (schema: unknown) =>
    runChecks([schemaCheck(schema)], { data: UntrustedData.wrap(JSON.stringify(work)), mime: 'application/json' }, new StepBudget(5_000));

  it('reads keywords and property names as written elsewhere', () => {
    expect(onBudget({ required: ['must'], properties: { a: costly } })).toMatchObject({ outcomes: [{ detail: 'schema: missing must' }], inconclusive: [] });
    expect(onBudget({ type: 'array', properties: { a: costly } }).inconclusive).toEqual([]);
    expect(onBudget({ properties: { z: { const: 1 }, a: costly } }).inconclusive).toEqual(['rule']);
    expect(judge({ properties: { b: { const: 1 }, a: { const: 1 } } }, { a: 2, b: 2 }).outcomes[0]!.detail).toBe('schema: /b: not equal to const');
  });

  it('reads the cheap keywords first under not, anyOf and oneOf', () => {
    const run = onBudget({ anyOf: [{ properties: { a: costly }, required: ['must'] }] });
    expect(run).toMatchObject({ outcomes: [{ detail: 'schema: anyOf not satisfied' }], inconclusive: [] });
  });
});

describe('regex_match_rate_min: a cell too long to match is not counted as a match', () => {
  const rate = (cells: string[], minBps: number, pattern = '^a*$') =>
    runChecks([{ id: 'rate', type: 'regex_match_rate_min', required: true, column: 's', pattern, minBps }], {
      data: UntrustedData.wrap(JSON.stringify(cells.map((s) => ({ s })))),
      mime: 'application/json',
    }).outcomes[0]!;

  it('counts it as not matching, between one and two caps and past that', () => {
    for (const length of [MAX_SUBJECT_CHARS + 1, 2 * MAX_SUBJECT_CHARS + 1]) {
      expect(rate([padded('', length), 'a'], 10_000)).toEqual({ checkId: 'rate', required: true, passed: false, detail: 'match 1/2 below 10000 bps' });
      expect(rate([padded('', length), 'a'], 5_000)).toEqual({ checkId: 'rate', required: true, passed: true, detail: 'match 1/2' });
    }
  });

  it('never passes where the same rows with that cell read as a match would fail (property)', () => {
    // A pass needs at least minBps proven matches. Reading the long cell could only add a match.
    fc.assert(
      fc.property(fc.array(fc.constantFrom('a', 'b'), { maxLength: 6 }), fc.integer({ min: 0, max: 10_000 }), (cells, minBps) => {
        if (!rate([...cells, padded('')], minBps).passed) return;
        expect(rate([...cells, 'a'], minBps).passed).toBe(true);
        expect(rate([...cells, 'b'], minBps).passed).toBe(true);
      }),
      { seed: 614, numRuns: 60 },
    );
  });
});

describe('the pattern engine gives no answer for a subject over the cap', () => {
  const engine = (p: string) => {
    const r = compileSafeRegex(p);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };

  it('throws from search and fullMatch, so a caller that does nothing fails closed', () => {
    for (const length of [MAX_SUBJECT_CHARS + 1, 2 * MAX_SUBJECT_CHARS + 1]) {
      expect(() => engine('a*').search(padded('', length))).toThrow(SubjectTooLong);
      expect(() => engine('a*').fullMatch(padded('', length))).toThrow(SubjectTooLong);
    }
  });

  it('charges what it charged before', () => {
    // Between one and two caps in UTF-16 units the engine counts code points, charged at 16 characters a unit.
    const budget = new StepBudget(1_000_000);
    expect(() => engine('a').search(padded('', 16_000), budget)).toThrow(SubjectTooLong);
    expect(1_000_000 - budget.remaining).toBe(1_000);
    // Past two caps the length alone decides, and nothing is charged.
    expect(() => engine('a').search(padded('', 2 * MAX_SUBJECT_CHARS + 1), budget)).toThrow(SubjectTooLong);
    expect(1_000_000 - budget.remaining).toBe(1_000);
  });
});
