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
// Every vector and what it must give: `pass`, `refused`, or the detail line of a failure. This list states the results a
// second time, so a regenerated vectors.json cannot drop a strictness vector or change a result unseen.
const NO_VERIFY = 'signature does not verify';
const FINGERPRINT = 'publicKey: fingerprint differs from the terms';
const BOTH: Record<string, string> = {
  good: 'pass',
  'good-decimals-in-signed-bytes': 'pass',
  'good-binary-message-spki-base64': 'pass',
  'good-base64-message-jsonequals': 'pass',
  'good-object-keys-in-another-order': 'pass',
  'good-pem-crlf-no-final-line-end': 'pass',
  'wrong-key-in-delivery': FINGERPRINT,
  'wrong-key-signed': NO_VERIFY,
  'flipped-byte-message': NO_VERIFY,
  'flipped-byte-signature': NO_VERIFY,
  'flipped-byte-public-key': FINGERPRINT,
  // ADR-0045 sections 2 and 3: decimals in the signed bytes are allowed. A number respelled after signing changes the
  // bytes, a number in the readable object that differs from the signed one fails, and no number enters the check.
  'float-respelled-after-signing': NO_VERIFY,
  'float-introduced-after-signing': NO_VERIFY,
  'float-in-object-signed-integer': 'message: differs from the value at jsonEquals',
  'float-spelling-equal-under-jsonequals': 'pass',
  'float-in-check-parameters': 'refused',
  'oversize-public-key': 'publicKey: too long',
  'oversize-public-key-boundary': 'publicKey: not a PEM public key',
  'oversize-signature': 'signature: too long',
  'oversize-signature-boundary': 'signature: wrong length',
  'oversize-pointer': 'refused',
  'unknown-algorithm': 'refused',
};
const P256_ONLY: Record<string, string> = {
  'random-signature-bytes': 'signature: not valid DER',
  'wrong-algorithm-for-the-key': 'publicKey: not an Ed25519 key',
  'good-raw-signature': 'pass',
  'good-high-s': 'pass',
  'good-raw-high-s': 'pass',
  'random-signature-bytes-raw': NO_VERIFY,
  'raw-signature-in-der-check': 'signature: not valid DER',
  'der-signature-in-raw-check': 'signature: wrong length',
  'good-64-byte-der': 'pass',
  '64-byte-der-in-raw-check': NO_VERIFY,
  'der-empty-integers': 'signature: not valid DER',
  'der-trailing-byte': 'signature: not valid DER',
  'der-over-72-bytes': 'signature: wrong length',
  'r-zero': NO_VERIFY,
  's-zero': NO_VERIFY,
  'r-is-the-order': NO_VERIFY,
  's-is-the-order': NO_VERIFY,
  'compressed-point': 'publicKey: not a P-256 key',
  'point-not-on-the-curve': 'publicKey: not a P-256 key',
  'delivery-not-json': 'not a JSON document',
  'publicKey-pointer-to-nothing': 'publicKey: nothing at the pointer',
  'publicKey-not-a-string': 'publicKey: not a string',
  'message-pointer-to-nothing': 'message: nothing at the pointer',
  'message-not-a-string': 'message: not a string',
  'signature-pointer-to-nothing': 'signature: nothing at the pointer',
  'signature-not-a-string': 'signature: not a string',
  'pointer-to-an-inherited-property': 'publicKey: nothing at the pointer',
  'pointer-not-rfc6901': 'refused',
  'ed25519-with-der': 'refused',
  'extra-property': 'refused',
  'check-id-outside-the-pattern': 'refused',
  'pem-second-block': 'publicKey: not a PEM public key',
  'pem-other-label': 'publicKey: not a PEM public key',
  'pem-leading-text': 'publicKey: not a PEM public key',
  'key-base64-with-a-line-end': 'publicKey: not valid base64',
  'signature-base64-whitespace': 'signature: not valid base64',
  'signature-base64-no-padding': 'signature: not valid base64',
  'signature-base64-url-alphabet': 'signature: not valid base64',
  'signature-base64-trailing-bits': 'signature: not valid base64',
  'message-base64-no-padding': 'message: not valid base64',
  'message-lone-surrogate': 'message: not well-formed text',
  'signed-bytes-not-json': 'message: not JSON',
  'signed-bytes-with-a-byte-order-mark': 'message: not JSON',
  'jsonequals-pointer-to-nothing': 'message: differs from the value at jsonEquals',
};
const ED25519_ONLY: Record<string, string> = {
  'random-signature-bytes': NO_VERIFY,
  'wrong-algorithm-for-the-key': 'publicKey: not a P-256 key',
  's-plus-the-group-order': NO_VERIFY,
  'small-order-key': NO_VERIFY,
  'non-canonical-r': NO_VERIFY,
  'short-signature': 'signature: wrong length',
  'der-format': 'refused',
};
const EXPECTED = Object.fromEntries(
  Object.entries({ p256: { ...BOTH, ...P256_ONLY }, ed25519: { ...BOTH, ...ED25519_ONLY } }).flatMap(([alg, cases]) =>
    Object.entries(cases).map(([name, result]) => [`${alg}/${name}`, result]),
  ),
);

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

  it('holds each pinned vector with its result', () => {
    expect(file.vectors.map((v) => v.name).sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(Object.fromEntries(file.vectors.map((v) => [v.name, v.expect.detail ?? v.expect.outcome]))).toEqual(EXPECTED);
  });

  it.each(['p256', 'ed25519'] as const)('%s: signed in Python, with each required case', (alg) => {
    expect(file.signedWith.language).toBe('Python');
    expect(named(`${alg}/good`).expect).toEqual({ outcome: 'pass' });
    expect(named(`${alg}/good-decimals-in-signed-bytes`).delivery).toContain('1e-07');
    const cases = new Set(file.vectors.filter((v) => v.alg === alg).map((v) => v.case));
    for (const kind of ['good', 'wrong-key', 'flipped-byte', 'random-signature', 'float', 'oversize', 'unknown-algorithm']) {
      expect(cases.has(kind), kind).toBe(true);
    }
  });

  it.each<[string, Result]>([
    ['outcome', { outcome: 'pass' }],
    ['detail line', { outcome: 'fail', detail: NO_VERIFY }],
  ])('the verifier exits 1 when the expected %s is wrong', (_, wrong) => {
    const forged = named('p256/random-signature-bytes');
    const run = verify(write('wrong.json', JSON.stringify({ ...file, vectors: [{ ...forged, expect: wrong }] })));
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
