// ADR-0045 build: the signature_valid evaluator against the committed vectors (spec/test-vectors/signature-valid/), the attack
// cases the task names, the work budget, determinism, and a property test.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import { p256 } from '@noble/curves/nist';
import fc from 'fast-check';
import { parseCommitment } from '@holdback/core';
import { describe, expect, it, vi } from 'vitest';
import type { JudgmentCheck } from '../terms.js';
import { UntrustedData } from '../untrusted.js';
import { CHECK_TYPES, evaluateChecks, runChecks, validateCheck } from './index.js';
import { StepBudget } from './safe-regex.js';
import { strictBase64 } from './signature.js';

type Check = Extract<JudgmentCheck, { type: 'signature_valid' }>;
interface Vector {
  name: string;
  alg: string;
  case: string;
  check: Record<string, unknown>;
  delivery: string;
  expect: { outcome: 'pass' | 'fail' | 'refused'; detail?: string };
}
const file = JSON.parse(readFileSync(new URL('../../../../spec/test-vectors/signature-valid/vectors.json', import.meta.url), 'utf8')) as { vectors: Vector[] };
const named = (name: string): Vector => {
  const v = file.vectors.find((x) => x.name === name);
  if (!v) throw new Error(`no vector ${name}`);
  return v;
};
const run = (check: unknown, delivery: string, budget?: StepBudget) =>
  runChecks([check as JudgmentCheck], { data: UntrustedData.wrap(delivery), mime: 'application/json' }, budget);
const one = (check: unknown, delivery: string) => run(check, delivery).outcomes[0]!;

describe('signature_valid: every committed vector', () => {
  it('has vectors for both algorithms', () => {
    expect(file.vectors.length).toBeGreaterThan(90);
    expect(new Set(file.vectors.map((v) => v.alg))).toEqual(new Set(['p256', 'ed25519']));
  });

  it.each(file.vectors.map((v) => [v.name, v] as const))('%s', (_, v) => {
    const out = one(v.check, v.delivery);
    if (v.expect.outcome === 'refused') {
      // A malformed check is refused at offer time (validateCheck) and, if it ever reaches stage 1, fails closed.
      expect(validateCheck(v.check as unknown as JudgmentCheck)).toBeTypeOf('string');
      expect(out.passed).toBe(false);
      expect(out.detail).toMatch(/^check invalid: /);
    } else {
      expect(validateCheck(v.check as unknown as JudgmentCheck)).toBeUndefined();
      expect({ passed: out.passed, detail: out.detail }).toEqual(v.expect.outcome === 'pass' ? { passed: true, detail: undefined } : { passed: false, detail: v.expect.detail });
    }
  });
});

describe('signature_valid: registry', () => {
  it('is in the closed registry, so an adjudicator lists it in checkKinds', () => {
    expect(CHECK_TYPES.has('signature_valid')).toBe(true);
    expect(CHECK_TYPES.size).toBe(13);
  });
});

describe('signature_valid: attacks fail', () => {
  const good = named('p256/good');
  const doc = JSON.parse(good.delivery) as Record<string, unknown>;
  const withDoc = (patch: Record<string, unknown>) => JSON.stringify({ ...doc, ...patch });
  const FAIL = { passed: false };

  it('random signature bytes', () => {
    const random = Buffer.from(Array.from({ length: 70 }, (_, i) => (i * 37 + 11) & 0xff)).toString('base64');
    expect(one(good.check, withDoc({ manifest_sig: random }))).toMatchObject({ ...FAIL, detail: 'signature: not valid DER' });
    const raw = named('p256/random-signature-bytes-raw');
    expect(one(raw.check, raw.delivery)).toMatchObject({ ...FAIL, detail: 'signature does not verify' });
  });

  it('a wrong key, either as the delivered key or as a key that signed', () => {
    const ed = named('ed25519/good');
    expect(one(good.check, withDoc({ pubkey: (JSON.parse(ed.delivery) as { pubkey: string }).pubkey }))).toMatchObject({ detail: 'publicKey: fingerprint differs from the terms' });
    expect(one(named('p256/wrong-key-signed').check, named('p256/wrong-key-signed').delivery)).toMatchObject({ detail: 'signature does not verify' });
  });

  it('oversized input', () => {
    expect(one(good.check, withDoc({ manifest_sig: 'A'.repeat(257) }))).toMatchObject({ detail: 'signature: too long' });
    expect(one(good.check, withDoc({ pubkey: 'A'.repeat(1025) }))).toMatchObject({ detail: 'publicKey: too long' });
  });

  it('a number respelled after signing', () => {
    const v = named('p256/float-respelled-after-signing');
    expect(one(v.check, v.delivery)).toMatchObject({ detail: 'signature does not verify' });
  });

  it('a non-integer or non-string check parameter is refused at offer time', () => {
    type Loose = { id: unknown; required: unknown; publicKey: Record<string, unknown>; message: Record<string, unknown>; [k: string]: unknown };
    const mutated = (f: (c: Loose) => void) => {
      const c = structuredClone(good.check) as Loose;
      f(c);
      return validateCheck(c as unknown as JudgmentCheck);
    };
    expect(mutated((c) => (c.publicKey.pointer = 1.5))).toMatch(/pointer/);
    expect(mutated((c) => (c.message.pointer = 7))).toMatch(/pointer/);
    expect(mutated((c) => (c.message.jsonEquals = 1.0))).toMatch(/jsonEquals/);
    // Second-family review (s02 C3): a null jsonEquals passed as absent here, then threw at judging; check-terms asks this.
    expect(mutated((c) => (c.message.jsonEquals = null))).toMatch(/jsonEquals must be an RFC 6901/);
    expect(mutated((c) => (c.maxBytes = 5))).toBeTypeOf('string');
    expect(mutated((c) => (c.required = 1))).toBeTypeOf('string');
    expect(mutated((c) => (c.id = 'Bad Id'))).toBeTypeOf('string');
  });

  it('accepts every pointer the commitment schema accepts: the 512 limit counts code points, as the schema does', () => {
    // Red team of PR 795: a check the schema lets into signed terms but validateCheck refuses fails every delivery.
    const example = JSON.parse(readFileSync(new URL('../../../../spec/examples/commitment.signature-valid.example.json', import.meta.url), 'utf8')) as {
      acceptance: { deterministicChecks: Record<string, unknown>[] };
    };
    const at = example.acceptance.deterministicChecks.findIndex((k) => k.type === 'signature_valid');
    const withPointer = (p: string) => {
      const c = structuredClone(example);
      (c.acceptance.deterministicChecks[at]!.message as Record<string, unknown>).jsonEquals = p;
      return { schema: parseCommitment(c).ok, check: validateCheck(c.acceptance.deterministicChecks[at] as unknown as JudgmentCheck) };
    };
    const astral = (n: number) => `/${'\u{1F600}'.repeat(n - 1)}`;
    expect(withPointer(astral(512))).toEqual({ schema: true, check: undefined });
    expect(withPointer(astral(513)).schema).toBe(false);
    expect(withPointer(astral(513)).check).toMatch(/jsonEquals must be an RFC 6901 JSON pointer/);
    expect(withPointer(`/${'a'.repeat(511)}`)).toEqual({ schema: true, check: undefined });
    expect(withPointer(`/${'a'.repeat(512)}`).check).toMatch(/at most 512 characters/);
  });

  it('an unknown algorithm fails closed', () => {
    const c = { ...(good.check as object), alg: 'rsa-pkcs1-sha256' };
    expect(validateCheck(c as unknown as JudgmentCheck)).toMatch(/alg must be/);
    expect(one(c, good.delivery)).toMatchObject({ ...FAIL, detail: expect.stringMatching(/^check invalid: alg/) });
  });

  it('a jsonEquals mismatch', () => {
    const v = named('p256/float-in-object-signed-integer');
    expect(one(v.check, v.delivery)).toMatchObject({ detail: 'message: differs from the value at jsonEquals' });
    const changed = withDoc({ manifest: { ...(doc.manifest as object), status: 'failed' } });
    expect(one(good.check, changed)).toMatchObject({ detail: 'message: differs from the value at jsonEquals' });
  });

  it.each([
    ['padding removed', (s: string) => s.replace(/=+$/, ''), 'signature: not valid base64'],
    ['whitespace', (s: string) => `${s.slice(0, 8)} ${s.slice(8)}`, 'signature: not valid base64'],
    ['a line end', (s: string) => `${s}\n`, 'signature: not valid base64'],
    ['the URL alphabet', (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_'), 'signature: not valid base64'],
  ])('malformed base64: %s', (_, edit, detail) => {
    // Use a signature that has + or / so the URL case changes it.
    const v = named('p256/good-64-byte-der');
    const sig = (JSON.parse(v.delivery) as { manifest_sig: string }).manifest_sig;
    const edited = edit(sig);
    if (edited === sig) return;
    expect(one(v.check, JSON.stringify({ ...JSON.parse(v.delivery), manifest_sig: edited }))).toMatchObject({ detail });
  });

  it('base64 with non-zero trailing bits has no second spelling', () => {
    expect(strictBase64('QQ==')).toEqual(new Uint8Array([0x41]));
    expect(strictBase64('QR==')).toBeUndefined();
    expect(strictBase64('QUE=')).toEqual(new Uint8Array([0x41, 0x41]));
    expect(strictBase64('QUF=')).toBeUndefined();
    expect(strictBase64('QQ=')).toBeUndefined();
    expect(strictBase64('Q===')).toBeUndefined();
    expect(strictBase64('====')).toBeUndefined();
    expect(strictBase64('')).toEqual(new Uint8Array());
  });

  it('hostile shapes fail without throwing', () => {
    for (const d of ['', 'null', '[]', '"x"', '{"pubkey":{}}', `[${'['.repeat(100_000)}`]) {
      expect(() => one(good.check, d)).not.toThrow();
      expect(one(good.check, d).passed).toBe(false);
    }
  });
});

describe('signature_valid: work budget and determinism', () => {
  const good = named('p256/good');

  it('a delivery that spends the budget is inconclusive, not failed', () => {
    const r = run(good.check, good.delivery, new StepBudget(10));
    expect(r.inconclusive).toEqual(['manifest-signature']);
    expect(r.outcomes[0]).toMatchObject({ passed: false, detail: 'inconclusive: the check work budget for this delivery ran out' });
  });

  it('charges a utf8 message before scanning it, so a message refused as text still spends its length', () => {
    // Second-family review (s07 C1): the lone-surrogate scan and the encode ran before any charge, so 20 checks over a
    // 10 MiB message refused at the scan spent nothing (measured 692 ms on an M-series Mac).
    const doc = JSON.parse(good.delivery) as Record<string, unknown>;
    doc.manifest_text = `${'a'.repeat(100_000)}\ud800`;
    const b = new StepBudget(50_000_000);
    expect(run(good.check, JSON.stringify(doc), b).outcomes[0]).toMatchObject({ passed: false, detail: 'message: not well-formed text' });
    expect(50_000_000 - b.remaining).toBe(100_001);
  });

  it('charges a passing utf8 message once per byte plus one verification, as section 6 sets', () => {
    const doc = JSON.parse(good.delivery) as Record<string, unknown>;
    const bytes = Buffer.byteLength(doc.manifest_text as string, 'utf8');
    const b = new StepBudget(50_000_000);
    expect(run(good.check, good.delivery, b).outcomes[0]!.passed).toBe(true);
    // The jsonEquals comparison spends one unit per value on top; it is the only other charge.
    expect(50_000_000 - b.remaining - bytes - 200_000).toBeGreaterThan(0);
    expect(50_000_000 - b.remaining - bytes - 200_000).toBeLessThan(1_000);
  });

  it('gives the same outcome and the same remaining budget on every run', () => {
    const outs = Array.from({ length: 3 }, () => {
      const b = new StepBudget(50_000_000);
      return JSON.stringify([run(good.check, good.delivery, b), b.remaining]);
    });
    expect(new Set(outs).size).toBe(1);
  });

  it('parses the delivery once per run, however many JSON checks the terms hold', () => {
    const checks = [
      ...Array.from({ length: 10 }, (_, i) => ({ ...(good.check as object), id: `sig-${i}` })),
      ...Array.from({ length: 10 }, (_, i) => ({ id: `schema-${i}`, type: 'json_schema', required: true, schema: { type: 'object' } })),
    ] as unknown as JudgmentCheck[];
    const parse = vi.spyOn(JSON, 'parse');
    try {
      const r = runChecks(checks, { data: UntrustedData.wrap(good.delivery), mime: 'application/json' });
      expect(r.outcomes.every((o) => o.passed)).toBe(true);
      expect(parse.mock.calls.filter(([text]) => text === good.delivery)).toHaveLength(1);
    } finally {
      parse.mockRestore();
    }
    // A delivery that is not JSON fails each kind with its own detail line, as before.
    const bad = runChecks([checks[0]!, checks[10]!], { data: UntrustedData.wrap('{'), mime: 'application/json' }).outcomes;
    expect(bad.map((o) => o.detail)).toEqual(['not a JSON document', 'deliverable is not valid JSON']);
  });

  it('opens no timer: the source holds no clock or timer call', () => {
    for (const f of ['signature-valid.ts', 'signature.ts']) {
      expect(readFileSync(new URL(f, import.meta.url), 'utf8')).not.toMatch(/Date\.now|performance\.now|setTimeout|setInterval|fetch\(|new Date\(/);
    }
  });
});

describe('signature_valid: fresh keys signed in Node', () => {
  const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
  const spkiP256 = (pub: Uint8Array) => Buffer.concat([Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'), Buffer.from(pub)]);
  const fp = (b: Uint8Array) => `sha256:${createHash('sha256').update(b).digest('hex')}`;
  const makeCheck = (alg: Check['alg'], spki: Uint8Array, format: 'der' | 'raw'): Check => ({
    id: 'sig',
    type: 'signature_valid',
    required: true,
    alg,
    publicKey: { pointer: '/key', format: 'spki-base64', spkiSha256: fp(spki) as `sha256:${string}` },
    message: { pointer: '/msg', encoding: 'utf8' },
    signature: { pointer: '/sig', encoding: 'base64', format },
  });

  it('a P-256 signature made in Node passes, and a change to any one byte of it fails (property)', () => {
    const priv = p256.utils.randomPrivateKey();
    const spki = spkiP256(p256.getPublicKey(priv, false));
    const text = '{"a":1.0,"b":[2,3]}';
    const digest = createHash('sha256').update(text).digest();
    const der = p256.sign(digest, priv, { lowS: false, prehash: false }).toDERRawBytes();
    const check = makeCheck('ecdsa-p256-sha256', spki, 'der');
    const doc = (sig: Uint8Array, msg = text, key: Uint8Array = spki) => JSON.stringify({ key: b64(key), msg, sig: b64(sig) });
    expect(one(check, doc(der)).passed).toBe(true);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: der.length - 1 }), fc.integer({ min: 1, max: 255 }), (i, x) => {
        const t = Uint8Array.from(der);
        t[i] = t[i]! ^ x;
        return !one(check, doc(t)).passed;
      }),
      { numRuns: 60 },
    );
    fc.assert(
      fc.property(fc.integer({ min: 0, max: text.length - 1 }), (i) => !one(check, doc(der, text.slice(0, i) + (text[i] === 'z' ? 'y' : 'z') + text.slice(i + 1))).passed),
      { numRuns: 40 },
    );
    // A changed key byte changes the fingerprint.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: spki.length - 1 }), (i) => {
        const k = Uint8Array.from(spki);
        k[i] = k[i]! ^ 1;
        return !one(check, doc(der, text, k)).passed;
      }),
      { numRuns: 40 },
    );
  });

  it('an Ed25519 signature made in Node passes, and one byte changed fails', () => {
    const priv = ed25519.utils.randomPrivateKey();
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(ed25519.getPublicKey(priv))]);
    const text = 'hello 1.0';
    const sig = ed25519.sign(new TextEncoder().encode(text), priv);
    const check = makeCheck('ed25519', spki, 'raw');
    const doc = (s: Uint8Array, m = text) => JSON.stringify({ key: b64(spki), msg: m, sig: b64(s) });
    expect(one(check, doc(sig)).passed).toBe(true);
    expect(one(check, doc(sig, 'hello 1')).passed).toBe(false);
    const t = Uint8Array.from(sig);
    t[5] = t[5]! ^ 4;
    expect(one(check, doc(t)).passed).toBe(false);
  });

  it('the comparison spends one unit per value: a wide signed array runs out of budget that covers the verification', () => {
    const priv = ed25519.utils.randomPrivateKey();
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(ed25519.getPublicKey(priv))]);
    const array = Array.from({ length: 3000 }, (_, i) => i);
    const text = JSON.stringify(array);
    const sig = ed25519.sign(new TextEncoder().encode(text), priv);
    const check: Check = { ...makeCheck('ed25519', spki, 'raw'), message: { pointer: '/msg', encoding: 'utf8', jsonEquals: '/obj' } };
    const delivery = JSON.stringify({ key: b64(spki), msg: text, sig: b64(sig), obj: array });
    const enough = 200_000 + text.length + 3001;
    expect(run(check, delivery, new StepBudget(enough)).outcomes[0]!.passed).toBe(true);
    const short = run(check, delivery, new StepBudget(enough - 1000));
    expect(short.inconclusive).toEqual(['sig']);
  });

  it('evaluateChecks and runChecks agree', () => {
    const v = named('p256/good');
    const input = { data: UntrustedData.wrap(v.delivery), mime: 'application/json' as const };
    expect(evaluateChecks([v.check as unknown as JudgmentCheck], input)).toEqual(runChecks([v.check as unknown as JudgmentCheck], input).outcomes);
  });
});
