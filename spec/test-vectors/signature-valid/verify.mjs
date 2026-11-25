#!/usr/bin/env node
// A standalone verifier for the `signature_valid` check (ADR-0045). It imports Node built-ins and @noble/curves 1.9.1,
// and nothing from this repository, so a seller can run it on its own document before it delivers. It is not the
// adjudicator's evaluator (that is built in packages/judgment): it has no work budget.
//
//   node verify.mjs [vectors.json]                     every vector; exit 0 when each gives its expected result
//   node verify.mjs --check check.json delivery.json   one document against one check; exit 0 only on a pass
//
// Exit 2: wrong arguments, or a file that cannot be read.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DER } from '@noble/curves/abstract/weierstrass';
import { ed25519 } from '@noble/curves/ed25519';
import { p256 } from '@noble/curves/nist';

// One accepted DER SubjectPublicKeyInfo shape per algorithm: a fixed prefix, then the key (section 4, step 4).
const ALGORITHMS = {
  'ecdsa-p256-sha256': {
    signatureFormats: ['der', 'raw'],
    prefix: Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'),
    spkiLength: 91,
    wrongKey: 'publicKey: not a P-256 key',
  },
  ed25519: {
    signatureFormats: ['raw'],
    prefix: Buffer.from('302a300506032b6570032100', 'hex'),
    spkiLength: 44,
    wrongKey: 'publicKey: not an Ed25519 key',
  },
};
const MAX = { pointer: 512, publicKey: 1024, signature: 256, derBytes: 72, rawBytes: 64 };

const pass = { outcome: 'pass' };
const refused = { outcome: 'refused' };
const fail = (detail) => ({ outcome: 'fail', detail });

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** True when `value` is an object with every `required` key and no key outside `required` and `optional`. */
function hasShape(value, required, optional = []) {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  return required.every((k) => keys.includes(k)) && keys.every((k) => required.includes(k) || optional.includes(k));
}

const isPointer = (p) => typeof p === 'string' && p.length <= MAX.pointer && /^(\/([^~/]|~[01])*)*$/.test(p);

/** Whether the check in the terms is well formed. A malformed check is refused at offer time and never passes. */
function wellFormed(check) {
  if (!hasShape(check, ['id', 'type', 'required', 'alg', 'publicKey', 'message', 'signature'])) return false;
  const { id, type, required, alg, publicKey, message, signature } = check;
  if (typeof id !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(id) || type !== 'signature_valid' || typeof required !== 'boolean') return false;
  if (typeof alg !== 'string' || !Object.hasOwn(ALGORITHMS, alg)) return false;
  if (!hasShape(publicKey, ['pointer', 'format', 'spkiSha256'])) return false;
  if (!hasShape(message, ['pointer', 'encoding'], ['jsonEquals'])) return false;
  if (!hasShape(signature, ['pointer', 'encoding', 'format'])) return false;
  return (
    isPointer(publicKey.pointer) &&
    ['spki-pem', 'spki-base64'].includes(publicKey.format) &&
    typeof publicKey.spkiSha256 === 'string' &&
    /^sha256:[0-9a-f]{64}$/.test(publicKey.spkiSha256) &&
    isPointer(message.pointer) &&
    ['utf8', 'base64'].includes(message.encoding) &&
    (!Object.hasOwn(message, 'jsonEquals') || isPointer(message.jsonEquals)) &&
    isPointer(signature.pointer) &&
    signature.encoding === 'base64' &&
    ALGORITHMS[alg].signatureFormats.includes(signature.format)
  );
}

/** The value at an RFC 6901 pointer, through own members only, as `{ value }`; `undefined` when nothing is there. */
function resolve(document, pointer) {
  let value = document;
  for (const token of pointer.split('/').slice(1)) {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(value)) {
      if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) return undefined;
    } else if (!isObject(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return { value };
}

/** RFC 4648 section 4, padded, in its one canonical spelling; `undefined` otherwise. */
function base64(text) {
  const bytes = Buffer.from(text, 'base64');
  return bytes.toString('base64') === text ? bytes : undefined;
}

/** One PEM block labelled PUBLIC KEY, LF or CRLF, an optional final line end, nothing before or after. */
function pemPublicKey(text) {
  const block = /^-----BEGIN PUBLIC KEY-----\r?\n((?:[A-Za-z0-9+/=]+\r?\n)+)-----END PUBLIC KEY-----(?:\r?\n)?$/.exec(text);
  return block ? base64(block[1].replace(/\r?\n/g, '')) : undefined;
}

/** Equality of two parsed JSON values (section 3). A stack, so deep nesting cannot overflow. */
function jsonEqual(left, right) {
  const pending = [[left, right]];
  while (pending.length > 0) {
    const [a, b] = pending.pop();
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      a.forEach((item, i) => pending.push([item, b[i]]));
    } else if (isObject(a)) {
      if (!isObject(b)) return false;
      const keys = Object.keys(a);
      if (keys.length !== Object.keys(b).length || !keys.every((k) => Object.hasOwn(b, k))) return false;
      for (const k of keys) pending.push([a[k], b[k]]);
    } else if (a !== b) return false;
  }
  return true;
}

/** The library call (section 4, step 7). Every strictness option is named, so a library default cannot change it. */
function signatureVerifies(alg, spki, message, signature, format) {
  const key = spki.subarray(ALGORITHMS[alg].prefix.length);
  try {
    if (alg === 'ed25519') return ed25519.verify(signature, message, key, { zip215: false });
    const digest = createHash('sha256').update(message).digest();
    return p256.verify(signature, digest, key, { lowS: false, prehash: false, format: format === 'der' ? 'der' : 'compact' });
  } catch {
    return false;
  }
}

function isP256Point(bytes) {
  try {
    p256.ProjectivePoint.fromHex(bytes).assertValidity();
    return true;
  } catch {
    return false;
  }
}

/** DER read strictly. The library reads an empty INTEGER as 0 (and refuses DER's own 0), so a 0 here is an empty one. */
function isDer(signature) {
  try {
    const { r, s } = DER.toSig(signature);
    return r !== 0n && s !== 0n;
  } catch {
    return false;
  }
}

/** The check's result on the delivered bytes, in the order of ADR-0045 section 4. */
function evaluate(check, delivered) {
  if (!wellFormed(check)) return refused;
  let document;
  try {
    // As stage 1 reads a delivery today: fatal UTF-8 decoding, then JSON.parse.
    document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(delivered));
  } catch {
    return fail('not a JSON document');
  }

  const strings = {};
  for (const name of ['publicKey', 'message', 'signature']) {
    const found = resolve(document, check[name].pointer);
    if (!found) return fail(`${name}: nothing at the pointer`);
    if (typeof found.value !== 'string') return fail(`${name}: not a string`);
    if (Object.hasOwn(MAX, name) && found.value.length > MAX[name]) return fail(`${name}: too long`);
    strings[name] = found.value;
  }

  const pem = check.publicKey.format === 'spki-pem';
  const spki = pem ? pemPublicKey(strings.publicKey) : base64(strings.publicKey);
  if (!spki) return fail(pem ? 'publicKey: not a PEM public key' : 'publicKey: not valid base64');
  if (`sha256:${createHash('sha256').update(spki).digest('hex')}` !== check.publicKey.spkiSha256) {
    return fail('publicKey: fingerprint differs from the terms');
  }
  const algorithm = ALGORITHMS[check.alg];
  const shaped = spki.length === algorithm.spkiLength && spki.subarray(0, algorithm.prefix.length).equals(algorithm.prefix);
  if (!shaped || (check.alg === 'ecdsa-p256-sha256' && !(spki[algorithm.prefix.length] === 4 && isP256Point(spki.subarray(algorithm.prefix.length))))) {
    return fail(algorithm.wrongKey);
  }

  const signature = base64(strings.signature);
  if (!signature) return fail('signature: not valid base64');
  const { format } = check.signature;
  if (format === 'der' ? signature.length > MAX.derBytes : signature.length !== MAX.rawBytes) return fail('signature: wrong length');

  let message;
  if (check.message.encoding === 'utf8') {
    if (!strings.message.isWellFormed()) return fail('message: not well-formed text');
    message = Buffer.from(strings.message, 'utf8');
  } else {
    message = base64(strings.message);
    if (!message) return fail('message: not valid base64');
  }

  if (format === 'der' && !isDer(signature)) return fail('signature: not valid DER');
  if (!signatureVerifies(check.alg, spki, message, signature, format)) return fail('signature does not verify');

  if (Object.hasOwn(check.message, 'jsonEquals')) {
    let signed;
    try {
      // A byte order mark stays in the text, so JSON.parse refuses it (README, open questions).
      signed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(message));
    } catch {
      return fail('message: not JSON');
    }
    const named = resolve(document, check.message.jsonEquals);
    if (!named || !jsonEqual(signed, named.value)) return fail('message: differs from the value at jsonEquals');
  }
  return pass;
}

const show = (result) => (result.detail ? `${result.outcome} (${result.detail})` : result.outcome);

function runVectors(path) {
  const file = JSON.parse(readFileSync(path, 'utf8'));
  if (file.format !== 'crow-signature-valid-vectors/1' || !Array.isArray(file.vectors) || file.vectors.length === 0) {
    console.error(`${path}: not a signature_valid vector file`);
    return 2;
  }
  let wrong = 0;
  for (const vector of file.vectors) {
    const got = evaluate(vector.check, Buffer.from(vector.delivery, 'utf8'));
    const ok = got.outcome === vector.expect.outcome && got.detail === vector.expect.detail;
    if (!ok) wrong += 1;
    console.log(ok ? `ok   ${vector.name}: ${show(got)}` : `FAIL ${vector.name}: expected ${show(vector.expect)}, got ${show(got)}`);
  }
  console.log(`${file.vectors.length - wrong}/${file.vectors.length} vectors as expected`);
  return wrong === 0 ? 0 : 1;
}

function main(args) {
  if (args[0] === '--check' && args.length === 3) {
    const result = evaluate(JSON.parse(readFileSync(args[1], 'utf8')), readFileSync(args[2]));
    console.log(JSON.stringify(result));
    return result.outcome === 'pass' ? 0 : 1;
  }
  if (args.length <= 1 && !args[0]?.startsWith('-')) {
    return runVectors(args[0] ?? fileURLToPath(new URL('vectors.json', import.meta.url)));
  }
  console.error('usage: node verify.mjs [vectors.json] | node verify.mjs --check check.json delivery.json');
  return 2;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
