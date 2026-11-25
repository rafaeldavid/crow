// T-589 (roadmap row N225): the `signature_valid` test vectors in spec/test-vectors/signature-valid/. Documents signed in
// Python must give their expected result in the standalone Node verifier. The test runs the script as a seller would:
// as its own Node process.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

interface Result {
  outcome: 'pass' | 'fail' | 'refused';
  detail?: string;
}
interface Vector {
  name: string;
  alg: 'p256' | 'ed25519';
  case: string;
  check: Record<string, unknown>;
  delivery: string;
  expect: Result;
}

const folder = fileURLToPath(new URL('../spec/test-vectors/signature-valid/', import.meta.url));
const script = join(folder, 'verify.mjs');
const file = JSON.parse(readFileSync(join(folder, 'vectors.json'), 'utf8')) as {
  signedWith: { language: string };
  vectors: Vector[];
};
const scratch = mkdtempSync(join(tmpdir(), 'signature-vectors-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const verify = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const write = (name: string, content: string) => {
  const path = join(scratch, name);
  writeFileSync(path, content);
  return path;
};
const named = (name: string) => {
  const vector = file.vectors.find((v) => v.name === name);
  if (!vector) throw new Error(`no vector ${name}`);
  return vector;
};

describe('signature_valid test vectors', () => {
  it('every vector gives its expected result in the standalone Node verifier', () => {
    const run = verify();
    const lines = run.stdout.split('\n');
    expect(lines.filter((l) => l.startsWith('FAIL'))).toEqual([]);
    expect(lines.filter((l) => l.startsWith('ok ')).map((l) => l.slice(5, l.indexOf(': ')))).toEqual(
      file.vectors.map((v) => v.name),
    );
    expect(run.status, run.stderr).toBe(0);
  });

  it.each(['p256', 'ed25519'] as const)('%s: signed in Python, with each required case', (alg) => {
    expect(file.signedWith.language).toBe('Python');
    expect(named(`${alg}/good`).expect).toEqual({ outcome: 'pass' });
    const outcomes = (kind: string) =>
      new Set(file.vectors.filter((v) => v.alg === alg && v.case === kind).map((v) => v.expect.outcome));
    expect(outcomes('good')).toEqual(new Set(['pass']));
    for (const kind of ['wrong-key', 'flipped-byte', 'random-signature']) expect(outcomes(kind), kind).toEqual(new Set(['fail']));
    for (const kind of ['oversize', 'unknown-algorithm']) {
      expect(outcomes(kind).size, kind).toBeGreaterThan(0);
      expect(outcomes(kind).has('pass'), kind).toBe(false);
    }
  });

  // ADR-0045 sections 2 and 3: decimals in the signed bytes are allowed. A number respelled after signing changes the
  // bytes, a number in the readable object that differs from the signed one fails, and no number enters the check.
  it.each(['p256', 'ed25519'] as const)('%s: what a float does', (alg) => {
    const expected = {
      'good-decimals-in-signed-bytes': { outcome: 'pass' },
      'float-spelling-equal-under-jsonequals': { outcome: 'pass' },
      'float-respelled-after-signing': { outcome: 'fail', detail: 'signature does not verify' },
      'float-introduced-after-signing': { outcome: 'fail', detail: 'signature does not verify' },
      'float-in-object-signed-integer': { outcome: 'fail', detail: 'message: differs from the value at jsonEquals' },
      'float-in-check-parameters': { outcome: 'refused' },
    };
    for (const [name, result] of Object.entries(expected)) expect(named(`${alg}/${name}`).expect, name).toEqual(result);
    expect(named(`${alg}/good-decimals-in-signed-bytes`).delivery).toContain('1e-07');
  });

  it('the verifier exits 1 when an expected result is wrong', () => {
    const forged = named('p256/random-signature-bytes');
    const path = write('wrong.json', JSON.stringify({ ...file, vectors: [{ ...forged, expect: { outcome: 'pass' } }] }));
    const run = verify(path);
    expect(run.stdout).toContain('FAIL p256/random-signature-bytes');
    expect(run.status).toBe(1);
  });

  it('the verifier refuses a file with no vectors, so an empty run cannot pass', () => {
    expect(verify(write('empty.json', JSON.stringify({ ...file, vectors: [] }))).status).toBe(2);
  });

  it.each(['p256/good', 'ed25519/good', 'p256/flipped-byte-message', 'ed25519/unknown-algorithm'])(
    '--check verifies one document: %s',
    (name) => {
      const vector = named(name);
      const run = verify('--check', write('check.json', JSON.stringify(vector.check)), write('delivery.json', vector.delivery));
      expect(JSON.parse(run.stdout)).toEqual(vector.expect);
      expect(run.status).toBe(vector.expect.outcome === 'pass' ? 0 : 1);
    },
  );

  it('the folder holds no private key', () => {
    for (const name of readdirSync(folder)) expect(readFileSync(join(folder, name), 'utf8'), name).not.toMatch(/PRIVATE KEY-----/);
  });
});
