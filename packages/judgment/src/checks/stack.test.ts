// T-613 (D102): how deep a value may nest is a count, never the engine's stack. A JSON-table cell, enum, const and
// uniqueItems read a delivered value through canonical(); its depth cap must give one result on every adjudicator,
// whatever stack size each one runs with. The child-process test runs the same checks at a small and a large
// --stack-size and compares the outcomes.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MimeType } from '@holdback/core';
import { rolldown } from 'rolldown';
import { describe, expect, it } from 'vitest';
import { sha256, utf8 } from '../_helpers.js';
import type { JudgmentCheck } from '../terms.js';
import { UntrustedData } from '../untrusted.js';
import { MAX_CANONICAL_DEPTH } from './cost.js';
import { runChecks, type CheckOutcome } from './index.js';

const CAP = MAX_CANONICAL_DEPTH;
/** A value `n` levels deep: n - 1 arrays around one number, as canonical counts depth. */
const nested = (n: number): string => `${'['.repeat(n - 1)}0${']'.repeat(n - 1)}`;
/** A one-row JSON table whose cell `a` nests `n` levels. */
const table = (n: number): string => `[{"k":"1","a":${nested(n)}}]`;
const SHALLOW = table(1);
const TOO_DEEP = `JSON row 0 has a cell nested deeper than ${CAP} levels`;

interface Case {
  name: string;
  text: string;
  mime: MimeType;
  checks: JudgmentCheck[];
  references?: Array<[string, string]>;
}

const base = { required: true } as const;
const columnChecks = (): JudgmentCheck[] => [
  { ...base, id: 'rows', type: 'row_count_range', min: 1, max: 1 },
  { ...base, id: 'nulls', type: 'null_rate_max', column: 'a', maxBps: 10_000 },
  { ...base, id: 'key', type: 'unique_key', columns: ['k'] },
];
const schemaChecks = (): JudgmentCheck[] => [
  { ...base, id: 'const', type: 'json_schema', schema: { type: 'array', items: { type: 'object', properties: { a: { const: 0 } } } } },
  { ...base, id: 'unique', type: 'json_schema', schema: { type: 'array', uniqueItems: true } },
];
const referenceCheck = (ref: string): JudgmentCheck => ({
  ...base,
  id: 'ref',
  type: 'reference_row_match_min',
  reference: { uri: 'file:///ref.json', sha256: sha256(utf8(ref)) },
  keyColumn: 'k',
  minBps: 0,
});

/** Depths around the cap, and depths that overflowed a 100 KB stack before D102 (500, 900; measured). */
const DEPTHS = [1, 500, 900, CAP - 1, CAP, CAP + 1, 5 * CAP, 100 * CAP];
const CASES: Case[] = DEPTHS.flatMap((n): Case[] => [
  { name: `delivery ${n}`, text: table(n), mime: 'application/json', checks: [...columnChecks(), ...schemaChecks()] },
  { name: `reference ${n}`, text: SHALLOW, mime: 'application/json', checks: [referenceCheck(table(n))], references: [[sha256(utf8(table(n))), table(n)]] },
]);

const run = (c: Case): CheckOutcome[] =>
  runChecks(c.checks, {
    data: UntrustedData.wrap(c.text),
    mime: c.mime,
    ...(c.references ? { references: new Map(c.references.map(([k, v]) => [k, utf8(v)])) } : {}),
  }).outcomes;

describe('a JSON-table cell at the nesting cap', () => {
  it(`passes at ${CAP} levels and fails one level more with a named detail`, () => {
    const at = run(CASES.find((c) => c.name === `delivery ${CAP}`)!);
    expect(at.find((o) => o.checkId === 'rows')).toEqual({ checkId: 'rows', required: true, passed: true, detail: '1 rows' });
    expect(at.find((o) => o.checkId === 'nulls')!.passed).toBe(true);
    expect(at.find((o) => o.checkId === 'key')!.passed).toBe(true);
    for (const n of [CAP + 1, 5 * CAP, 100 * CAP]) {
      const over = run(CASES.find((c) => c.name === `delivery ${n}`)!);
      for (const id of ['rows', 'nulls', 'key']) expect(over.find((o) => o.checkId === id)).toEqual({ checkId: id, required: true, passed: false, detail: TOO_DEEP });
    }
  });

  it('names a delivered value past the cap for const and uniqueItems', () => {
    const over = run(CASES.find((c) => c.name === `delivery ${CAP + 1}`)!);
    for (const id of ['const', 'unique']) expect(over.find((o) => o.checkId === id)).toEqual({ checkId: id, required: true, passed: false, detail: `a value is nested deeper than ${CAP} levels` });
    expect(run(CASES.find((c) => c.name === `delivery ${CAP}`)!).find((o) => o.checkId === 'const')!.detail).toBe('schema: /0: /a: not equal to const');
  });

  it('names a reference table nested past the cap as the reference', () => {
    expect(run(CASES.find((c) => c.name === `reference ${CAP}`)!)[0]!.passed).toBe(true);
    expect(run(CASES.find((c) => c.name === `reference ${CAP + 1}`)!)[0]).toEqual({ checkId: 'ref', required: true, passed: false, detail: `reference: ${TOO_DEEP}` });
  });
});

describe('the same outcomes at every stack size', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  /** The probe the child runs: the cases from stdin, the outcomes to stdout. */
  const PROBE = `
    import { readFileSync } from 'node:fs';
    import { runChecks } from ${JSON.stringify(join(here, 'index.ts'))};
    import { UntrustedData } from ${JSON.stringify(join(here, '../untrusted.ts'))};
    const enc = new TextEncoder();
    const cases = JSON.parse(readFileSync(0, 'utf8'));
    const out = cases.map((c) => runChecks(c.checks, {
      data: UntrustedData.wrap(c.text),
      mime: c.mime,
      ...(c.references ? { references: new Map(c.references.map(([k, v]) => [k, enc.encode(v)])) } : {}),
    }).outcomes);
    process.stdout.write(JSON.stringify(out));
  `;

  it('gives one result at --stack-size=100 and --stack-size=4000, and the same as this process', async () => {
    const dir = mkdtempSync(join(tmpdir(), 't613-'));
    try {
      const bundle = await rolldown({
        input: 'probe',
        platform: 'node',
        logLevel: 'silent',
        plugins: [{ name: 'probe', resolveId: (id) => (id === 'probe' ? id : null), load: (id) => (id === 'probe' ? PROBE : null) }],
      });
      const file = join(dir, 'probe.mjs');
      try {
        const { output } = await bundle.generate({ format: 'esm', codeSplitting: false });
        writeFileSync(file, output[0].code);
      } finally {
        await bundle.close();
      }
      const input = JSON.stringify(CASES);
      const at = (kb: number): CheckOutcome[][] => JSON.parse(execFileSync(process.execPath, [`--stack-size=${kb}`, file], { input, encoding: 'utf8', maxBuffer: 64 << 20 })) as CheckOutcome[][];
      const small = at(100);
      const large = at(4000);
      expect(small).toEqual(large);
      expect(large).toEqual(CASES.map(run));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
