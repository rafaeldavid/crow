// The telemetry-run deal template (T-572): the terms file fixtures/terms/telemetry-run.yaml and its synthetic files
// in fixtures/data/telemetry-run/. Every check here runs through @holdback/judgment's own check library, the one an
// adjudicator runs. The failing files are made from the passing one, one change each, so each is refused by the
// name of the check it breaks and by no other.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileSafeRegex, runChecks, UntrustedData, validateCheck, validateTerms, type JudgmentCheck } from '../packages/judgment/src/index.ts';
import { loadTermsFile } from '../packages/testkit/src/fixture-files.ts';

const root = new URL('..', import.meta.url).pathname;
const read = (name: string) => readFileSync(join(root, 'fixtures/data/telemetry-run', name), 'utf8');
const terms = loadTermsFile(join(root, 'fixtures/terms/telemetry-run.yaml'));
const checks = terms.acceptance.deterministicChecks;
type Regex = Extract<JudgmentCheck, { type: 'regex_match_rate_min' }>;
const patternOf = (id: string) => (checks.find((c) => c.id === id) as Regex).pattern;

/** The ids of the required checks a file fails, as an adjudicator's stage 1 would report them. */
const failed = (text: string) =>
  runChecks(checks, { data: UntrustedData.wrap(text), mime: 'text/csv' })
    .outcomes.filter((o) => o.required && !o.passed)
    .map((o) => o.checkId);

const RUN = read('run.csv');
const [HEADER, ...ROWS] = RUN.trimEnd().split('\n') as [string, ...string[]];
const csv = (rows: readonly string[], header = HEADER) => [header, ...rows].join('\n') + '\n';
const COLUMN = HEADER.split(',');
/** The run with one cell changed: row `i` (0-based, data rows), column `col`. */
const withCell = (i: number, col: string, value: string) =>
  csv(ROWS.map((r, k) => (k === i ? r.split(',').map((v, c) => (COLUMN[c] === col ? value : v)).join(',') : r)));
/** The run with every value of `col` replaced by `f(row index)`. */
const withColumn = (col: string, f: (k: number) => string) =>
  csv(ROWS.map((r, k) => r.split(',').map((v, c) => (COLUMN[c] === col ? f(k) : v)).join(',')));

describe('the telemetry-run terms (fixtures/terms/telemetry-run.yaml)', () => {
  it('is a checks-only deal for one CSV file, with eight required checks of existing types the library accepts', () => {
    expect(terms.deliverable).toMatchObject({ kind: 'dataset', format: 'text/csv' });
    expect(terms.acceptance.rubric).toEqual({ passThreshold: 0, criteria: [] });
    expect(checks.map((c) => [c.id, c.type, c.required])).toEqual([
      ['columns', 'csv_columns_exact', true],
      ['rows', 'row_count_range', true],
      ['run', 'regex_match_rate_min', true],
      ['time-grid', 'regex_match_rate_min', true],
      ['time-unique', 'unique_key', true],
      ['position', 'regex_match_rate_min', true],
      ['velocity', 'regex_match_rate_min', true],
      ['current', 'regex_match_rate_min', true],
    ]);
    for (const c of checks) expect(validateCheck(c), c.id).toBeUndefined();
    expect(validateTerms(terms.acceptance, terms.deliverable.description)).toEqual([]);
    for (const c of checks) if (c.type === 'regex_match_rate_min') expect(c.minBps, c.id).toBe(10_000);
  });

  it('names the run, the columns, the rate, the row count and the ranges in the description as the checks hold them', () => {
    const d = terms.deliverable.description;
    expect(d).toContain(`robot run ${patternOf('run').slice(1, -1)} `);
    expect(d).toContain((checks[0] as Extract<JudgmentCheck, { type: 'csv_columns_exact' }>).columns.slice(0, -1).join(', '));
    expect(checks[0]).toMatchObject({ columns: COLUMN });
    expect(checks[1]).toMatchObject({ min: 1000, max: 1000 });
    for (const s of ['100 Hz', '10 s', '1,000 rows', 'from 0 to 9990 in steps of 10 ms', '-360000 to 360000', '-223000 to 223000', '-10000 to 10000', 'No cell is empty']) expect(d).toContain(s);
  });

  it('holds each range pattern to exactly its integers, in the library\'s own pattern engine', () => {
    const ranges: [string, number][] = [['position', 360_000], ['velocity', 223_000], ['current', 10_000]];
    for (const [id, max] of ranges) {
      const re = compileSafeRegex(patternOf(id));
      if (!re.ok) throw new Error(re.error);
      const js = new RegExp(patternOf(id));
      // Every integer from -(max + 1000) to max + 1000 in JavaScript's engine, which reads this subset alike; the
      // edges and a stride across the range in the library's own.
      const wrong: number[] = [];
      for (let v = -max - 1000; v <= max + 1000; v++) if (js.test(String(v)) !== (Math.abs(v) <= max)) wrong.push(v);
      expect(wrong, id).toEqual([]);
      const edges = [-2, -1, 0, 1, 2].flatMap((d) => [-max + d, max + d]);
      const stride = Array.from({ length: Math.floor((2 * max) / 997) }, (_, k) => -max + k * 997);
      for (const v of [...edges, ...stride]) if (re.value.fullMatch(String(v)) !== (Math.abs(v) <= max)) wrong.push(v);
      expect(wrong, id).toEqual([]);
      for (const s of ['', '-0', '01', '-01', '+5', '5.0', '1e3', ' 5', '5 ', '0x10', `${max}0`]) expect(re.value.fullMatch(s), `${id} "${s}"`).toBe(false);
    }
  });

  it('holds the time grid to the 1,000 timestamps 0, 10, ..., 9990 and nothing else', () => {
    const re = compileSafeRegex(patternOf('time-grid'));
    if (!re.ok) throw new Error(re.error);
    const on: number[] = [];
    for (let t = -10; t <= 20_000; t++) if (re.value.fullMatch(String(t))) on.push(t);
    expect(on).toEqual(Array.from({ length: 1000 }, (_, k) => k * 10));
    for (const s of ['00', '010', '-0', '-10', '10.0', '']) expect(re.value.fullMatch(s), `"${s}"`).toBe(false);
  });
});

describe('the files that pass', () => {
  it('passes the synthetic run: 1,000 rows, every timestamp of the grid once, in time order', () => {
    expect(failed(RUN)).toEqual([]);
    expect(ROWS.map((r) => Number(r.split(',')[1]))).toEqual(Array.from({ length: 1000 }, (_, k) => k * 10));
  });

  it('passes the run with values at the edge of every range, and with Windows line endings', () => {
    const edges = withColumn('position_mdeg', (k) => String(k % 2 ? 360_000 : -360_000));
    expect(failed(edges)).toEqual([]);
    expect(failed(withColumn('velocity_mdeg_s', (k) => String(k % 2 ? 223_000 : -223_000)))).toEqual([]);
    expect(failed(withColumn('current_ma', (k) => String([10_000, -10_000, 0][k % 3])))).toEqual([]);
    expect(failed(RUN.replaceAll('\n', '\r\n'))).toEqual([]);
  });

  it('passes the same rows out of time order: the checks hold the set of timestamps, not their order', () => {
    // A limit of the check types, kept visible: a buyer that needs the rows sorted sorts them (Handoff, missing checks).
    expect(failed(csv([...ROWS].reverse()))).toEqual([]);
  });
});

describe('one failing file per check, refused by that check alone', () => {
  const cases: [string, string, string][] = [
    ['columns', 'an extra column', csv(ROWS.map((r) => `${r},21`), `${HEADER},temp_c`)],
    ['rows', 'one sample missing at 5,000 ms (the file run.gap.csv)', read('run.gap.csv')],
    ['run', 'one row from another run', withCell(400, 'run_id', 'run-0b5d11aa')],
    ['time-grid', 'one timestamp off the grid', withCell(500, 't_ms', '5005')],
    ['time-unique', 'one timestamp twice, the sample at 5,000 ms replaced by a second 4,990 ms', withCell(500, 't_ms', '4990')],
    ['position', 'one position past the joint range', withCell(250, 'position_mdeg', '360001')],
    ['velocity', 'one speed past the arm limit', withCell(250, 'velocity_mdeg_s', '-223001')],
    ['current', 'one empty current reading', withCell(750, 'current_ma', '')],
  ];
  it('covers every check of the terms once', () => expect(cases.map(([id]) => id)).toEqual(checks.map((c) => c.id)));
  for (const [id, what, text] of cases) it(`fails ${id}: ${what}`, () => expect(failed(text)).toEqual([id]));

  it('keeps run.gap.csv as the run with only the 5,000 ms row removed', () => {
    expect(read('run.gap.csv')).toBe(csv(ROWS.filter((r) => r.split(',')[1] !== '5000')));
  });
});

describe('the counting rule holds only with minBps 10000 on the time grid', () => {
  // The review of PR 718 (Medium): the rule needs every row on the grid. With one row allowed off it, a file can swap
  // a grid timestamp for one off the grid, and then the run has a gap that the count does not see.
  const offGrid = withCell(500, 't_ms', '5005');
  it('refuses a timestamp off the grid at 10000 basis points and passes it at 9990', () => {
    expect(failed(offGrid)).toEqual(['time-grid']);
    const loose = checks.map((c) => (c.id === 'time-grid' ? { ...c, minBps: 9990 } : c));
    expect(runChecks(loose, { data: UntrustedData.wrap(offGrid), mime: 'text/csv' }).outcomes.filter((o) => !o.passed)).toEqual([]);
  });
  it('says so in site/ref/checks.txt, with the check type and not the template\'s check ID', () => {
    const text = readFileSync(join(root, 'site/ref/checks.txt'), 'utf8');
    const section = text.slice(text.indexOf('## Writing checks for a telemetry run'), text.indexOf("## The buyer's own check run"));
    expect(section).toContain('`regex_match_rate_min` check on the timestamp column with `minBps: 10000`');
    expect(section).not.toContain('time-grid');
  });
});

describe('a run at the wrong rate or with a gap', () => {
  it('refuses a run at 50 Hz over 20 s by its timestamps, and at 50 Hz over 10 s by its row count', () => {
    expect(failed(withColumn('t_ms', (k) => String(k * 20)))).toEqual(['time-grid']);
    expect(failed(csv(ROWS.filter((_, k) => k % 2 === 0)))).toEqual(['rows']);
  });
  it('refuses a run at 200 Hz by its timestamps, and a run of 2,000 samples by its row count too', () => {
    expect(failed(withColumn('t_ms', (k) => String(k * 5)))).toEqual(['time-grid']);
    const doubled = csv(Array.from({ length: 2000 }, (_, k) => ROWS[k >> 1]!.split(',').map((v, c) => (c === 1 ? String(k * 5) : v)).join(',')));
    expect(failed(doubled)).toEqual(['rows', 'time-grid']);
  });
  it('refuses a gap filled by stretching the run: one step of 20 ms makes the last timestamp 10,000 ms', () => {
    expect(failed(withColumn('t_ms', (k) => String(k < 500 ? k * 10 : k * 10 + 10)))).toEqual(['time-grid']);
  });
});
