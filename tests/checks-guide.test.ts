// T-612: site/ref/checks.txt held to the check code. The page names every kind stage 1 runs; its signature and
// recorded-data examples are checks the schema and the engine accept; and the failure lines and limits it states are
// the ones the engine writes. Written because four shipped kinds were missing from the page.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UntrustedData, validateCheck, type JudgmentCheck } from '../packages/judgment/src/index.ts';
import { CHECK_BUDGET, CHECK_TYPES, runChecks } from '../packages/judgment/src/checks/index.ts';
import { MAX_CANONICAL_DEPTH } from '../packages/judgment/src/checks/cost.ts';
import { MAX_COMPILE_STEPS, MAX_PATTERN_CHARS, MAX_REPEAT, MAX_STATES, MAX_SUBJECT_CHARS } from '../packages/judgment/src/checks/safe-regex.ts';
import { MAX_SCHEMA_STATES } from '../packages/judgment/src/checks/json-schema.ts';
import { SERIES_LIMITS } from '../packages/judgment/src/checks/series.ts';
import { SIGNATURE_LIMITS } from '../packages/judgment/src/checks/signature.ts';
import { SIGNATURE_WORK } from '../packages/judgment/src/checks/signature-valid.ts';
// @ts-expect-error -- plain ESM helper without type declarations
import { loadSpec } from '../scripts/spec.mjs';

const root = join(import.meta.dirname, '..');
const page = readFileSync(join(root, 'site/ref/checks.txt'), 'utf8');
const section = (title: string): string => {
  const start = page.indexOf(`\n## ${title}\n`);
  expect(start, title).toBeGreaterThan(0);
  const end = page.indexOf('\n## ', start + 1);
  return page.slice(start + 1, end < 0 ? undefined : end);
};
const jsonIn = (text: string): unknown => JSON.parse(/```json\n([\s\S]*?)\n```/.exec(text)![1]!);
const n = (value: number): string => value.toLocaleString('en-US');

const signature = jsonIn(section('Checking a signature')) as JudgmentCheck;
const data = jsonIn(section('Checking recorded data')) as JudgmentCheck[];
const run = (checks: JudgmentCheck[], delivery: string, mime: 'application/json' | 'text/csv' = 'application/json') =>
  runChecks(checks, { data: UntrustedData.wrap(delivery), mime }).outcomes;

describe('site/ref/checks.txt and the check code', () => {
  it('lists every kind stage 1 runs, and no other', () => {
    const line = page.split('\n').find((l) => l.startsWith('The check types: '))!;
    const listed = [...line.split(' Each takes ')[0]!.matchAll(/`([a-z0-9]+(?:_[a-z0-9]+)+)` \(/g)].map((m) => m[1]!);
    expect([...listed].sort()).toEqual([...CHECK_TYPES].sort());
  });

  it('shows a signature check and three data checks that the schema and the engine accept', () => {
    const { ajv, schemas } = loadSpec();
    const validate = ajv.getSchema(`${schemas.get('commitment')}#/$defs/DeterministicCheck`)!;
    // The page writes the pinned fingerprint as a placeholder.
    const filled = JSON.parse(JSON.stringify(signature).replace('<64 hex>', 'a'.repeat(64))) as JudgmentCheck;
    expect(data.map((c) => c.type)).toEqual(['equal_lengths', 'monotonic_column', 'passes_through']);
    for (const check of [filled, ...data]) {
      expect(validateCheck(check), check.id).toBeUndefined();
      expect(validate(check), `${check.id}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it('shows data checks that pass a recording through their waypoints and fail a changed one', () => {
    const recording = { t_ms: [0, 16, 32], q1_mdeg: [10000, 20000, 30000], q2_mdeg: [-45000, -30000, -20000] };
    expect(run(data, JSON.stringify({ telemetry: recording })).map((o) => o.passed)).toEqual([true, true, true]);
    const changed = { t_ms: [32, 16, 0], q1_mdeg: [10000, 20000], q2_mdeg: [-45000, -30000] };
    expect(run(data, JSON.stringify({ telemetry: changed })).map((o) => o.detail)).toEqual([
      'series 2 has 2 entries; series 1 has 3',
      'row 2 is lower than row 1',
      'reached 1 of 2 waypoints in order; waypoint 2 is not within tolerance after row 1',
    ]);
  });

  it('states the limits the code holds', () => {
    const limits = section('Pattern and work limits');
    expect(limits).toContain(`${n(MAX_PATTERN_CHARS)} characters; repeat counts up to ${n(MAX_REPEAT)}; compiled, ${n(MAX_STATES)} states and ${n(MAX_COMPILE_STEPS)} compile steps`);
    expect(limits).toContain(`${n(MAX_SCHEMA_STATES)} states together`);
    expect(limits).toContain(`No pattern reads a string over ${n(MAX_SUBJECT_CHARS)} code points`);
    expect(limits).toContain(`\`a pattern met a string over ${MAX_SUBJECT_CHARS} code points\``);
    expect(limits).toContain(`"maxLength": ${MAX_SUBJECT_CHARS}`);
    expect(limits).toContain(`share ${n(CHECK_BUDGET)} work units`);
    const signed = section('Checking a signature');
    expect(signed).toContain(`at most ${n(SIGNATURE_LIMITS.publicKey)} characters, the signature string at most ${SIGNATURE_LIMITS.signature} (DER at most ${SIGNATURE_LIMITS.derBytes} bytes, raw exactly ${SIGNATURE_LIMITS.rawBytes})`);
    expect(signed).toContain(`pointer at most ${SIGNATURE_LIMITS.pointer}`);
    expect(signed).toContain(`${n(SIGNATURE_WORK.perVerification)} per verification`);
    const recorded = section('Checking recorded data');
    expect(recorded).toContain(`name at most ${SERIES_LIMITS.column} characters`);
    expect(recorded).toContain(`\`series\`, 2 to ${SERIES_LIMITS.series}, \`pointer\` only`);
    expect(recorded).toContain(`\`series\`, 1 to ${SERIES_LIMITS.series}, one per axis; \`waypoints\`, 1 to ${n(SERIES_LIMITS.waypoints)}`);
  });

  it('states the nesting cap and its lines as the code writes them', () => {
    const limits = section('Pattern and work limits');
    expect(limits).toContain(`nested deeper than ${n(MAX_CANONICAL_DEPTH)} levels`);
    // `arrays` arrays, one inside the next, around `inner`: the outermost is level 1.
    const nest = (arrays: number, inner = '') => `${'['.repeat(arrays)}${inner}${']'.repeat(arrays)}`;
    const column: JudgmentCheck = { id: 'rows', type: 'row_count_range', required: true, min: 1, max: 1 };
    const unique: JudgmentCheck = { id: 'items', type: 'json_schema', required: true, schema: { uniqueItems: true } };
    const constant: JudgmentCheck = { id: 'pin', type: 'json_schema', required: true, schema: { const: [] } };
    const enumerated: JudgmentCheck = { id: 'one-of', type: 'json_schema', required: true, schema: { enum: [[]] } };
    const cell = (value: string) => run([column], `[{"c":${value}}]`)[0]!;
    // At the cap the cell is read; one level more, an array or a number, is not.
    expect(cell(nest(MAX_CANONICAL_DEPTH)).passed).toBe(true);
    const cellLine = `JSON row 0 has a cell nested deeper than ${MAX_CANONICAL_DEPTH} levels`;
    expect(cell(nest(MAX_CANONICAL_DEPTH + 1)).detail).toBe(cellLine);
    expect(cell(nest(MAX_CANONICAL_DEPTH, '1')).detail).toBe(cellLine);
    expect(limits).toContain(cellLine.replace('row 0', 'row <n>'));
    // For uniqueItems the item is level 1; for const and enum the compared value is.
    const valueLine = `a value is nested deeper than ${MAX_CANONICAL_DEPTH} levels`;
    expect(run([unique], `[${nest(MAX_CANONICAL_DEPTH)}]`)[0]!.passed).toBe(true);
    expect(run([unique], `[${nest(MAX_CANONICAL_DEPTH + 1)}]`)[0]!.detail).toBe(valueLine);
    for (const check of [constant, enumerated]) expect(run([check], nest(MAX_CANONICAL_DEPTH + 1))[0]!.detail, check.id).toBe(valueLine);
    expect(limits).toContain(`\`${valueLine}\``);
  });

  it('is right that a pattern that meets a longer string fails the check, and what lets a branch take one', () => {
    const long = 'a'.repeat(MAX_SUBJECT_CHARS + 1);
    const check = (schema: object): JudgmentCheck => ({ id: 'no-word', type: 'json_schema', required: true, schema });
    const outcome = (rule: object) => run([check({ properties: { s: rule } })], JSON.stringify({ s: long }))[0]!;
    const unread = { checkId: 'no-word', required: true, passed: false, detail: `a pattern met a string over ${MAX_SUBJECT_CHARS} code points` };
    for (const rule of [{ not: { pattern: 'secret' } }, { anyOf: [{ pattern: 'secret' }, { type: 'string' }] }, { oneOf: [{ pattern: 'secret' }, { type: 'string' }] }]) {
      expect(outcome(rule), JSON.stringify(rule)).toEqual(unread);
    }
    expect(outcome({ anyOf: [{ pattern: '^b', maxLength: MAX_SUBJECT_CHARS }, { minLength: MAX_SUBJECT_CHARS + 1 }] }).passed).toBe(true);
    // At the limit itself the string is still read.
    expect(run([check({ not: { pattern: 'secret' } })], JSON.stringify('a'.repeat(MAX_SUBJECT_CHARS)))[0]!.passed).toBe(true);
    const column: JudgmentCheck = { id: 'cells', type: 'regex_match_rate_min', required: true, column: 's', pattern: 'a*', minBps: 5000 };
    expect(run([column], JSON.stringify([{ s: long }, { s: 'a' }]))[0]!.detail).toBe('match 1/2');
  });
});
