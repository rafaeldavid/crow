// ADR-0047 section 4: the equal_lengths check. Unequal columns fail; it reads lengths only, one budget unit per series.
import { describe, expect, it } from 'vitest';
import type { JudgmentCheck } from '../terms.js';
import { UntrustedData } from '../untrusted.js';
import { runChecks, validateCheck } from './index.js';
import { StepBudget } from './safe-regex.js';

const run = (check: unknown, delivery: string, budget?: StepBudget) =>
  runChecks([check as JudgmentCheck], { data: UntrustedData.wrap(delivery), mime: 'application/json' }, budget);
const one = (check: unknown, delivery: string) => run(check, delivery).outcomes[0]!;
const check = (over: Record<string, unknown> = {}) => ({
  id: 'lengths',
  type: 'equal_lengths',
  required: true,
  series: [{ pointer: '/telemetry/t_ms' }, { pointer: '/telemetry/q1' }, { pointer: '/telemetry/q2' }],
  ...over,
});
const doc = (t: unknown[], q1: unknown[], q2: unknown[]) => JSON.stringify({ telemetry: { t_ms: t, q1, q2 } });

describe('equal_lengths: every named array has the same number of entries', () => {
  it('passes equal columns', () => {
    expect(one(check(), doc([0, 8, 16], [1, 2, 3], [4, 5, 6]))).toEqual({ checkId: 'lengths', required: true, passed: true, detail: '3 series of 3 entries' });
    expect(one(check(), doc([], [], [])).passed).toBe(true);
  });

  it('counts entries of any type: the other checks read the values', () => {
    expect(one(check(), doc([0, 8], ['a', null], [{}, [1, 2, 3]])).passed).toBe(true);
  });

  it('fails unequal columns: one sample dropped from one joint', () => {
    expect(one(check(), doc([0, 8, 16], [1, 2, 3], [4, 5]))).toMatchObject({ passed: false, detail: 'series 3 has 2 entries; series 1 has 3' });
    expect(one(check(), doc([0, 8], [1, 2, 3], [4, 5]))).toMatchObject({ passed: false, detail: 'series 2 has 3 entries; series 1 has 2' });
  });

  it.each<[string, string, string]>([
    ['a pointer that finds nothing', JSON.stringify({ telemetry: { t_ms: [], q1: [] } }), 'series 3: nothing at the pointer'],
    ['a pointer at a number', JSON.stringify({ telemetry: { t_ms: 3, q1: [], q2: [] } }), 'series 1: not an array'],
    ['a delivery that is not JSON', 't_ms,q1,q2\n0,1,2', 'not a JSON document'],
  ])('fails %s', (_, delivery, detail) => {
    expect(one(check(), delivery)).toMatchObject({ passed: false, detail });
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    ['a column series', { series: [{ column: 't_ms' }, { pointer: '/q1' }] }, /must be exactly \{ pointer \}/],
    ['one series', { series: [{ pointer: '/a' }] }, /series must list 2 to 32 pointers/],
    ['33 series', { series: Array.from({ length: 33 }, () => ({ pointer: '/a' })) }, /series must list 2 to 32 pointers/],
    ['a length to match', { length: 3 }, /needs exactly/],
    ['a bad pointer', { series: [{ pointer: '/a~2' }, { pointer: '/b' }] }, /RFC 6901/],
  ])('refuses %s', (_, over, reason) => {
    const c = check(over);
    expect(validateCheck(c as JudgmentCheck)).toMatch(reason);
    expect(one(c, doc([], [], [])).passed).toBe(false);
  });

  it('charges each series and the pointer it walks, and reads no entry, however long the arrays', () => {
    const n = 200_000;
    const long = Array.from({ length: n }, () => 0);
    const budget = new StepBudget(10);
    expect(run(check(), doc(long, long, long), budget).outcomes[0]!.passed).toBe(true);
    // Per series: 1 unit, and 1 per 16 characters of its pointer walked (all three are under 16).
    expect(10 - budget.remaining).toBe(3 * 2);
    expect(run(check(), doc(long, long, long), new StepBudget(2)).inconclusive).toEqual(['lengths']);
  });
});
