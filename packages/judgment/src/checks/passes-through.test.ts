// ADR-0047 section 2: the passes_through check. Shuffled rows and invented arrival points fail, every bound is an
// integer, the work budget bounds the scan, and the greedy scan agrees with a brute-force search.
import fc from 'fast-check';
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

const check = (over: Record<string, unknown> = {}) => ({
  id: 'waypoints',
  type: 'passes_through',
  required: true,
  series: [{ pointer: '/telemetry/q1' }, { pointer: '/telemetry/q2' }],
  waypoints: [
    [10000, -45000],
    [30000, -20000],
  ],
  tolerance: 500,
  ...over,
});
const doc = (q1: unknown[], q2: unknown[]) => JSON.stringify({ telemetry: { q1, q2 } });
// A path through both waypoints: row 3 is within 500 of the first, and row 6 of the second.
const Q1 = [0, 5000, 9800, 10100, 20000, 29600, 30400, 31000];
const Q2 = [-50000, -47000, -45300, -44800, -30000, -20200, -19900, -19000];

describe('passes_through: the path reaches each waypoint in order', () => {
  it('passes a path that reaches both waypoints in order', () => {
    expect(one(check(), doc(Q1, Q2))).toEqual({ checkId: 'waypoints', required: true, passed: true, detail: 'reached 2 of 2 waypoints in order' });
  });

  it('takes the tolerance as inclusive, and fails one unit beyond it', () => {
    const at = check({ waypoints: [[100, 200]], tolerance: 5 });
    expect(one(at, doc([95], [205])).passed).toBe(true);
    expect(one(at, doc([94], [205]))).toMatchObject({ passed: false, detail: 'reached 0 of 1 waypoints in order; waypoint 1 is not within tolerance in any row' });
    expect(one(at, doc([95], [206])).passed).toBe(false);
  });

  it('fails shuffled rows: the same samples with the second waypoint first', () => {
    const order = [5, 6, 7, 4, 0, 1, 2, 3];
    const r = one(check(), doc(order.map((i) => Q1[i]), order.map((i) => Q2[i])));
    expect(r).toMatchObject({ passed: false, detail: 'reached 1 of 2 waypoints in order; waypoint 2 is not within tolerance after row 7' });
  });

  it('fails invented arrival points: each joint reaches its coordinate, but never in the same row', () => {
    // q1 is at 10000 in row 2 while q2 is far off, and q2 at -45000 in row 3 while q1 has moved on.
    const r = one(check({ waypoints: [[10000, -45000]] }), doc([0, 10000, 20000, 20000], [0, 0, -45000, 0]));
    expect(r).toMatchObject({ passed: false, detail: 'reached 0 of 1 waypoints in order; waypoint 1 is not within tolerance in any row' });
  });

  it('fails a path that stops short of the last waypoint', () => {
    expect(one(check(), doc(Q1.slice(0, 5), Q2.slice(0, 5)))).toMatchObject({ passed: false, detail: 'reached 1 of 2 waypoints in order; waypoint 2 is not within tolerance after row 3' });
  });

  it('needs one row per waypoint: two equal waypoints in a row need two matching rows', () => {
    const twice = check({ waypoints: [[1, 1], [1, 1]], tolerance: 0 });
    expect(one(twice, doc([1], [1])).passed).toBe(false);
    expect(one(twice, doc([1, 1], [1, 1])).passed).toBe(true);
  });

  it('reads a CSV column and a column of a JSON table', () => {
    const c = check({ series: [{ column: 'q1' }, { column: 'q2' }] });
    const csv = ['t,q1,q2', ...Q1.map((q, i) => `${i},${q},${Q2[i]}`)].join('\n');
    expect(one(c, csv, 'text/csv').passed).toBe(true);
    const table = JSON.stringify(Q1.map((q, i) => ({ q1: q, q2: Q2[i] })));
    expect(one(c, table).passed).toBe(true);
    expect(one(check({ series: [{ column: 'q1' }, { column: 'q3' }] }), csv, 'text/csv')).toMatchObject({ passed: false, detail: 'series 2: column not found' });
  });

  it('compares exactly at the ends of the safe range', () => {
    expect(one(check({ waypoints: [[MAX, -MAX]], tolerance: 0 }), doc([MAX], [-MAX])).passed).toBe(true);
    // The difference is 2^54 - 2: far beyond any tolerance, and never rounded back under it.
    expect(one(check({ waypoints: [[MAX, MAX]], tolerance: MAX }), doc([-MAX], [MAX])).passed).toBe(false);
    expect(one(check({ waypoints: [[MAX, 0]], tolerance: MAX }), doc([0], [0])).passed).toBe(true);
    expect(one(check({ waypoints: [[MAX, 0]], tolerance: MAX - 1 }), doc([0], [0])).passed).toBe(false);
  });
});

describe('passes_through: the delivery must hold integer series', () => {
  it.each<[string, string, string]>([
    ['a decimal sample', doc([0, 10000.5], [0, -45000]), 'series 1: row 2 is not an integer'],
    ['a number written as a string', doc([0, '10000'], [0, -45000]), 'series 1: row 2 is not an integer'],
    ['a null sample', doc([0, null], [0, -45000]), 'series 1: row 2 is not an integer'],
    ['a value beyond the safe range', doc([0, 2 ** 53], [0, 1]), 'series 1: row 2 is not an integer'],
    ['series of different lengths', doc([0, 10000], [-45000]), 'series 2 has 1 rows; series 1 has 2'],
    ['a pointer that finds nothing', JSON.stringify({ telemetry: { q1: [] } }), 'series 2: nothing at the pointer'],
    ['a pointer at an object', JSON.stringify({ telemetry: { q1: {}, q2: [] } }), 'series 1: not an array'],
    ['a delivery that is not JSON', 'q1,q2\n1,2', 'not a JSON document'],
  ])('fails %s', (_, delivery, detail) => {
    expect(one(check(), delivery)).toMatchObject({ passed: false, detail });
  });

  it.each<[string, string]>([
    ['a decimal', '1.0'],
    ['a leading plus', '+5'],
    ['a leading zero', '05'],
    ['a space', ' 5'],
    ['an exponent', '1e3'],
    ['a negative zero', '-0'],
    ['an empty cell', ''],
    ['17 digits', '12345678901234567'],
  ])('fails a CSV cell with %s', (_, cell) => {
    const r = one(check({ series: [{ column: 'q1' }], waypoints: [[5]] }), `q1\n5\n${cell}\n`, 'text/csv');
    expect(r).toMatchObject({ passed: false, detail: 'series 1: row 2 is not an integer' });
  });
});

describe('passes_through: every bound is an integer (ADR-0022)', () => {
  it.each<[string, Record<string, unknown>, RegExp]>([
    ['a decimal tolerance', { tolerance: 0.5 }, /tolerance must be a non-negative integer/],
    ['a negative tolerance', { tolerance: -1 }, /tolerance must be a non-negative integer/],
    ['a tolerance as a string', { tolerance: '500' }, /tolerance must be a non-negative integer/],
    ['a tolerance beyond the safe range', { tolerance: 2 ** 53 }, /tolerance must be a non-negative integer/],
    ['a decimal coordinate', { waypoints: [[10000.5, -45000]] }, /waypoint 0 must hold integers/],
    ['a coordinate as a string', { waypoints: [['10000', -45000]] }, /waypoint 0 must hold integers/],
    ['a waypoint with too few coordinates', { waypoints: [[10000]] }, /one coordinate per series/],
    ['no waypoints', { waypoints: [] }, /waypoints must list 1 to 1024/],
    ['1,025 waypoints', { waypoints: Array.from({ length: 1025 }, () => [0, 0]) }, /waypoints must list 1 to 1024/],
    ['no series', { series: [], waypoints: [[]] }, /series must list 1 to 32/],
    ['33 series', { series: Array.from({ length: 33 }, () => ({ column: 'a' })), waypoints: [Array(33).fill(0)] }, /series must list 1 to 32/],
    ['a series with both forms', { series: [{ pointer: '/a', column: 'a' }, { pointer: '/b' }] }, /exactly \{ pointer \} or \{ column \}/],
    ['a pointer without a leading slash', { series: [{ pointer: 'a' }, { pointer: '/b' }] }, /RFC 6901/],
    ['a column name of 129 characters', { series: [{ column: 'a'.repeat(129) }, { pointer: '/b' }] }, /at most 128 characters/],
    ['an extra parameter', { ordered: false }, /needs exactly/],
  ])('refuses %s', (_, over, reason) => {
    const c = check(over);
    expect(validateCheck(c as JudgmentCheck)).toMatch(reason);
    expect(one(c, doc(Q1, Q2))).toMatchObject({ passed: false, detail: expect.stringMatching(/^check invalid: /) });
  });
});

describe('passes_through: work budget', () => {
  it('charges one unit per entry read and one per coordinate compared', () => {
    const budget = new StepBudget(1_000);
    run(check(), doc(Q1, Q2), 'application/json', budget);
    // 16 entries read; rows 1 to 6 compared on two series until the second waypoint matches at row 6.
    expect(1_000 - budget.remaining).toBe(16 + 6 * 2);
  });

  it('is inconclusive on an oversized series and never reads past the budget', () => {
    const n = 200_000;
    const big = doc(
      Array.from({ length: n }, () => 0),
      Array.from({ length: n }, () => 0),
    );
    const tight = run(check(), big, 'application/json', new StepBudget(100_000));
    expect(tight.inconclusive).toEqual(['waypoints']);
    expect(tight.outcomes[0]).toMatchObject({ passed: false, detail: 'inconclusive: the check work budget for this delivery ran out' });
    // The default budget covers it: two series of 200,000 rows cost 400,000 units to read and 400,000 to compare.
    const full = run(check(), big);
    expect(full.inconclusive).toEqual([]);
    expect(full.outcomes[0]!.passed).toBe(false);
  });

  it('gives the same outcome and the same remaining budget on every run', () => {
    const a = new StepBudget(10_000);
    const b = new StepBudget(10_000);
    expect(run(check(), doc(Q1, Q2), 'application/json', a)).toEqual(run(check(), doc(Q1, Q2), 'application/json', b));
    expect(a.remaining).toBe(b.remaining);
  });
});

/** Brute force: is there a strictly increasing choice of rows, one per waypoint, each within tolerance? */
function exists(cols: number[][], wps: number[][], tol: number): boolean {
  const rows = cols[0]!.length;
  const near = (r: number, k: number) => cols.every((c, s) => Math.abs(c[r]! - wps[k]![s]!) <= tol);
  const go = (k: number, from: number): boolean => k === wps.length || Array.from({ length: rows - from }, (_, i) => from + i).some((r) => near(r, k) && go(k + 1, r + 1));
  return go(0, 0);
}

describe('passes_through: the greedy scan agrees with a full search', () => {
  it('on random small paths', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3 }).chain((s) =>
          fc.record({
            cols: fc.integer({ min: 0, max: 8 }).chain((n) => fc.array(fc.array(fc.integer({ min: -5, max: 5 }), { minLength: n, maxLength: n }), { minLength: s, maxLength: s })),
            wps: fc.array(fc.array(fc.integer({ min: -5, max: 5 }), { minLength: s, maxLength: s }), { minLength: 1, maxLength: 4 }),
            tol: fc.integer({ min: 0, max: 3 }),
          }),
        ),
        ({ cols, wps, tol }) => {
          const c = { id: 'p', type: 'passes_through', required: true, series: cols.map((_, i) => ({ pointer: `/${i}` })), waypoints: wps, tolerance: tol };
          expect(one(c, JSON.stringify(cols)).passed).toBe(exists(cols, wps, tol));
        },
      ),
      { numRuns: 500 },
    );
  });
});
