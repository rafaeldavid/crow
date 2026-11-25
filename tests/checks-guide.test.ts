// T-612: site/ref/checks.txt held to the check code. The page names every kind stage 1 runs; its signature and
// recorded-data examples are checks the schema and the engine accept; and the failure lines and limits it states are
// the ones the engine writes. Written because four shipped kinds were missing from the page.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UntrustedData, validateCheck, type JudgmentCheck } from '../packages/judgment/src/index.ts';
import { CHECK_BUDGET, CHECK_TYPES, runChecks } from '../packages/judgment/src/checks/index.ts';
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
    expect(limits).toContain(`over ${n(MAX_SUBJECT_CHARS)} code points matches no pattern`);
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

  it('is right that a `not` pattern passes a string too long to match, and that maxLength stops it', () => {
    const delivery = JSON.stringify({ s: 'secret'.padEnd(MAX_SUBJECT_CHARS + 1, 'a') });
    const check = (rule: object): JudgmentCheck => ({ id: 'no-word', type: 'json_schema', required: true, schema: { properties: { s: rule } } });
    expect(run([check({ not: { pattern: 'secret' } })], delivery)[0]!.passed).toBe(true);
    expect(run([check({ maxLength: MAX_SUBJECT_CHARS, not: { pattern: 'secret' } })], delivery)[0]!.passed).toBe(false);
    // Nested under other keywords, the gap is the same.
    expect(run([check({ allOf: [{ not: { anyOf: [{ pattern: 'secret' }, { pattern: 'token' }] } }] })], delivery)[0]!.passed).toBe(true);
    // At the limit itself the string is still read, so the rule holds.
    const atLimit = JSON.stringify({ s: 'secret'.padEnd(MAX_SUBJECT_CHARS, 'a') });
    expect(run([check({ not: { pattern: 'secret' } })], atLimit)[0]!.passed).toBe(false);
  });
});
