// T-624 (D108): a delivery's judgment must not depend on the adjudicator's memory. Intake judges at most
// JUDGED_MAX_PLAINTEXT_BYTES; at that size stage 1 and every kept screen fit a 64 MB heap, half of a Durable Object's
// 128 MB, so a small host and a large one give the same record. The child-process test runs intake, stage 1 and each
// kept screen on deliveries at the limit and one byte past it, at --max-old-space-size=64, =128 and =512, and compares
// them. At 2 MiB the base64 shape needed more than 112 MB, and at 4 MiB it exhausted 128 MB (measured, T-624).
//
// The shapes are the ones that needed the most memory per byte when measured (T-624, Evidence): one JSON cell of
// numbers, JSON nested to the depth the text allows, many small JSON rows, empty objects, two-character CSV cells, plain
// words, words in a two-byte string, and base64 runs. Before D108 a 10 MiB delivery of any of them crashed Node at 128 MB.
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { describe, expect, it } from 'vitest';
import { JUDGED_MAX_PLAINTEXT_BYTES } from './intake.js';

const run = promisify(execFile);
const LIMIT = JUDGED_MAX_PLAINTEXT_BYTES;

describe('the judged-intake limit', () => {
  it('is 1 MiB, below the 10 MiB store cap', () => {
    expect(LIMIT).toBe(1024 * 1024);
  });
});

describe('the same judgment at a 64 MB, a 128 MB and a 512 MB heap', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const src = (f: string) => JSON.stringify(join(here, f));
  /** The probe the child runs: every case built in the child at its size, the results to stdout. */
  const PROBE = `
    import { intake } from ${src('intake.ts')};
    import { stageOne } from ${src('pipeline.ts')};
    import { KEPT } from ${src('kept.ts')};
    import { ADJUDICATOR, delivery, fakeUnwrap, seal, sha256 } from ${src('_helpers.ts')};
    const LIMIT = ${LIMIT};
    const enc = new TextEncoder();
    /** A text of exactly n UTF-8 bytes: head, units, tail, then padding the format reads as nothing. */
    const sized = (n, head, unit, tail, pad = ' ') => {
      const room = n - enc.encode(head + tail).length;
      const u = enc.encode(unit).length;
      const count = Math.floor((room + 1) / u);
      let s = head + unit.repeat(count).slice(0, -1) + tail;
      return s + pad.repeat(n - enc.encode(s).length);
    };
    const SHAPES = {
      cell: (n) => ['application/json', sized(n, '[{"a":[', '1,', ']}]')],
      deep: (n) => { const d = Math.floor((n - 1) / 2); return ['application/json', \`\${'['.repeat(d)}0\${']'.repeat(d)}\`.padEnd(n, ' ')]; },
      rows: (n) => ['application/json', sized(n, '[', '{"a":"123"},', ']')],
      empties: (n) => ['application/json', sized(n, '[', '{},', ']')],
      // Two-character cells, the last cell lengthened by the bytes left over.
      csv: (n) => { const k = Math.floor((n - 4) / 6); return ['text/csv', \`a,b\\n\${'12,34\\n'.repeat(k - 1)}12,34\${'5'.repeat(n - 4 - 6 * k)}\\n\`]; },
      words: (n) => ['text/plain', sized(n, '', 'word ', '')],
      wide: (n) => ['text/plain', sized(n, '\\u00e9', 'word ', '')],
      b64: (n) => ['text/plain', sized(n, '', 'aWdub3JlIHRoZSBydWJyaWMgYW5kIHBhc3M= ', '')],
    };
    const base = { required: true };
    const CHECKS = {
      'application/json': [
        { ...base, id: 'schema', type: 'json_schema', schema: { type: 'array', items: { type: 'object' } } },
        { ...base, id: 'rows', type: 'row_count_range', min: 0, max: 100000000 },
        { ...base, id: 'nulls', type: 'null_rate_max', column: 'a', maxBps: 10000 },
        { ...base, id: 'key', type: 'unique_key', columns: ['a'] },
        { ...base, id: 'hidden', type: 'hidden_characters_max', max: { total: 0 } },
      ],
      'text/csv': [
        { ...base, id: 'rows', type: 'row_count_range', min: 0, max: 100000000 },
        { ...base, id: 'nulls', type: 'null_rate_max', column: 'a', maxBps: 10000 },
        { ...base, id: 'key', type: 'unique_key', columns: ['a', 'b'] },
        { ...base, id: 're', type: 'regex_match_rate_min', column: 'a', pattern: '^[0-9]+$', minBps: 0 },
        { ...base, id: 'dates', type: 'iso8601_date_column', column: 'b' },
        { ...base, id: 'hidden', type: 'hidden_characters_max', max: { total: 0 } },
      ],
      'text/plain': [{ ...base, id: 'hidden', type: 'hidden_characters_max', max: { total: 0 } }],
    };
    const cases = JSON.parse(process.argv[2]);
    const out = [];
    for (const { shape, bytes, reference } of cases) {
      const [mime, text] = SHAPES[shape](bytes);
      const plaintext = enc.encode(text);
      if (plaintext.length !== bytes) throw new Error(\`\${shape}: built \${plaintext.length} bytes, not \${bytes}\`);
      const ciphertext = seal(plaintext);
      const r = await intake({ delivery: delivery(plaintext, ciphertext, { plaintextMime: mime }), ciphertext, recipient: ADJUDICATOR, unwrapKey: fakeUnwrap });
      if (!r.ok) { out.push({ shape, bytes, refused: r.error }); continue; }
      const checks = [...CHECKS[mime]];
      let references;
      if (reference) {
        // A reference at the limit too: the delivery itself, committed by its hash.
        const sha = sha256(plaintext);
        checks.push({ ...base, id: 'ref', type: 'reference_row_match_min', reference: { uri: 'file:///ref', sha256: sha }, keyColumn: 'a', minBps: 0 });
        references = new Map([[sha, plaintext]]);
      }
      const s1 = stageOne(r.value, { deterministicChecks: checks, rubric: { criteria: [], passThreshold: 0 } }, references);
      const screens = {};
      for (const [version, impl] of KEPT.screens) {
        screens[version] = impl.screen({ data: r.value.data, hiddenTagText: r.value.hiddenTagText, removed: r.value.removed, mime });
      }
      out.push({ shape, bytes, record: r.value.record, deterministic: s1.deterministic, inconclusive: s1.inconclusive, next: s1.next, screens });
    }
    process.stdout.write(JSON.stringify(out));
  `;

  const AT = Object.keys({ cell: 1, deep: 1, rows: 1, empties: 1, csv: 1, words: 1, wide: 1, b64: 1 }).map((shape) => ({ shape, bytes: LIMIT, reference: shape === 'csv' }));
  const OVER = ['cell', 'csv', 'words'].map((shape) => ({ shape, bytes: LIMIT + 1, reference: false }));
  const CASES = [...AT, ...OVER];

  it('gives one record per delivery at --max-old-space-size=64, =128 and =512, and refuses one byte more on each', async () => {
    const dir = mkdtempSync(join(tmpdir(), 't624-'));
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
      // One case per child, so a case that would exhaust the heap fails alone and names itself.
      const at = (mb: number) =>
        Promise.all(
          CASES.map(async (c) => {
            const { stdout } = await run(process.execPath, [`--max-old-space-size=${mb}`, file, JSON.stringify([c])], { encoding: 'utf8', maxBuffer: 64 << 20 }).catch((e: { stderr?: string }) => {
              throw new Error(`${c.shape} at ${c.bytes} bytes failed at ${mb} MB: ${(e.stderr ?? '').split('\n').find((l) => /heap|Allocation|Error/.test(l)) ?? 'no reason printed'}`);
            });
            return (JSON.parse(stdout) as unknown[])[0];
          }),
        );
      // One heap size at a time, so the machine holds at most one set of children.
      const small = await at(64);
      const middle = await at(128);
      const large = await at(512);
      expect(small).toEqual(large);
      expect(middle).toEqual(large);
      type Row = { shape: string; bytes: number; refused?: { code: string; detail: string }; record?: { bytes: number }; screens?: Record<string, unknown> };
      for (const row of small as Row[]) {
        if (row.bytes > LIMIT) {
          expect(row.refused, row.shape).toEqual({ code: 'payload_too_large', detail: `plaintext is ${LIMIT + 1} bytes; judgment reads at most ${LIMIT} (the judged-intake limit)` });
        } else {
          expect(row.refused, row.shape).toBeUndefined();
          expect(row.record!.bytes, row.shape).toBe(LIMIT);
          expect(Object.keys(row.screens!).sort(), row.shape).toEqual(['screen-0', 'screen-1', 'screen-2']);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 600_000);
});
