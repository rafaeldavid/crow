// ADR-0047 section 3: the monotonic_column check. Shuffled, repeated and spliced rows fail, every bound is an integer,
// and the work budget bounds the scan.
import type { MimeType } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import type { JudgmentCheck } from '../terms.js';
import { UntrustedData } from '../untrusted.js';
import { runChecks, validateCheck } from './index.js';
import { StepBudget } from './safe-regex.js';

const MAX = Number.MAX_SAFE_INTEGER;
const run = (check: unknown, delivery: string, mime: MimeType = 'application/json', budget?: StepBudget) =>
  runChecks([check as JudgmentCheck], { data: UntrustedData.wrap(delivery), mime }, budget);
const one = (check: unknown, delivery: string, mime?: MimeType) => run(check, delivery, mime).outcomes[0]!;
const check = (over: Record<string, unknown> = {}) => ({ id: 'time', type: 'monotonic_column', required: true, series: { pointer: '/t_ms' }, ...over });
const doc = (t: unknown[]) => JSON.stringify({ t_ms: t });
const T = [0, 8, 16, 24, 32, 40];

describe('monotonic_column: the series never decreases', () => {
  it('passes an increasing series, and a repeated value by default', () => {
    expect(one(check(), doc(T))).toEqual({ checkId: 'time', required: true, passed: true, detail: '6 rows in order' });
    expect(one(check(), doc([0, 8, 8, 16])).passed).toBe(true);
  });

  it('passes an empty series and a single row', () => {
    expect(one(check(), doc([])).passed).toBe(true);
    expect(one(check({ minStep: 1, maxStep: 1 }), doc([7])).passed).toBe(true);
  });

  it('fails shuffled rows', () => {
    expect(one(check(), doc([0, 16, 8, 24, 32, 40]))).toMatchObject({ passed: false, detail: 'row 3 is lower than row 2' });
  });

  it('fails a repeated row with minStep 1', () => {
    expect(one(check({ minStep: 1 }), doc([0, 8, 8, 16]))).toMatchObject({ passed: false, detail: 'row 3 steps less than minStep after row 2' });
  });

  it('fails a spliced gap with maxStep', () => {
    expect(one(check({ minStep: 1, maxStep: 16 }), doc([0, 8, 16, 40, 48]))).toMatchObject({ passed: false, detail: 'row 4 steps more than maxStep after row 3' });
  });

  it('holds a fixed sample rate with minStep equal to maxStep', () => {
    const fixed = check({ minStep: 8, maxStep: 8 });
    expect(one(fixed, doc(T)).passed).toBe(true);
    expect(one(fixed, doc([0, 8, 17, 24])).passed).toBe(false);
  });

  it('reads a CSV column and a column of a JSON table', () => {
    const c = check({ series: { column: 't_ms' }, minStep: 1 });
    expect(one(c, `t_ms,q1\n${T.map((t) => `${t},0`).join('\n')}\n`, 'text/csv').passed).toBe(true);
    expect(one(c, 't_ms,q1\n0,0\n16,0\n8,0\n', 'text/csv')).toMatchObject({ passed: false, detail: 'row 3 is lower than row 2' });
    expect(one(c, JSON.stringify(T.map((t) => ({ t_ms: t })))).passed).toBe(true);
    expect(one(c, JSON.stringify([{ t_ms: 0 }, { t_ms: 0.5 }]))).toMatchObject({ passed: false, detail: 'series: row 2 is not an integer' });
  });

  it('compares exactly at the ends of the safe range', () => {
    expect(one(check(), doc([-MAX, MAX])).passed).toBe(true);
    // The step is 2^54 - 2: beyond any safe maxStep.
    expect(one(check({ maxStep: MAX }), doc([-MAX, MAX])).passed).toBe(false);
    expect(one(check({ maxStep: MAX }), doc([0, MAX])).passed).toBe(true);
    expect(one(check({ minStep: MAX }), doc([0, MAX - 1])).passed).toBe(false);
    expect(one(check(), doc([MAX, -MAX]))).toMatchObject({ passed: false, detail: 'row 2 is lower than row 1' });
  });

  it.each<[string, string, string]>([
    ['a decimal sample', doc([0, 8.5]), 'series: row 2 is not an integer'],
    ['a sample as a string', doc([0, '8']), 'series: row 2 is not an integer'],
    ['a sample beyond the safe range', doc([0, 2 ** 53]), 'series: row 2 is not an integer'],
    ['a pointer that finds nothing', JSON.stringify({ t: [] }), 'series: nothing at the pointer'],
    ['a pointer at a string', JSON.stringify({ t_ms: '0,8,16' }), 'series: not an array'],
  ])('fails %s', (_, delivery, detail) => {
    expect(one(check(), delivery)).toMatchObject({ passed: false, detail });
  });
});

describe('monotonic_column: every bound is an integer (ADR-0022)', () => {
  it.each<[string, Record<string, unknown>, RegExp]>([
    ['a decimal minStep', { minStep: 0.5 }, /minStep must be a non-negative integer/],
    ['a negative minStep', { minStep: -1 }, /minStep must be a non-negative integer/],
    ['a decimal maxStep', { maxStep: 16.5 }, /maxStep must be a non-negative integer/],
    ['a maxStep as a string', { maxStep: '16' }, /maxStep must be a non-negative integer/],
    ['a maxStep beyond the safe range', { maxStep: 2 ** 53 }, /maxStep must be a non-negative integer/],
    ['minStep above maxStep', { minStep: 9, maxStep: 8 }, /minStep is greater than maxStep/],
    ['a list of series', { series: [{ pointer: '/t_ms' }] }, /exactly \{ pointer \} or \{ column \}/],
    ['an extra parameter', { strict: true }, /needs exactly/],
  ])('refuses %s', (_, over, reason) => {
    const c = check(over);
    expect(validateCheck(c as JudgmentCheck)).toMatch(reason);
    expect(one(c, doc(T))).toMatchObject({ passed: false, detail: expect.stringMatching(/^check invalid: /) });
  });
});

describe('monotonic_column: work budget', () => {
  it('charges the series, its pointer, each entry read and each step compared', () => {
    const budget = new StepBudget(1_000);
    run(check(), doc(T), 'application/json', budget);
    // 1 for the series, 1 for its 5-character pointer, 6 entries and 5 steps.
    expect(1_000 - budget.remaining).toBe(2 + 6 + 5);
  });

  it('is inconclusive on an oversized series', () => {
    const big = doc(Array.from({ length: 300_000 }, (_, i) => i));
    expect(run(check(), big, 'application/json', new StepBudget(299_999)).inconclusive).toEqual(['time']);
    expect(run(check(), big).outcomes[0]!.passed).toBe(true);
  });
});
