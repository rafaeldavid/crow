// The signature_valid check (ADR-0045): the exact bytes at one JSON pointer carry a valid signature by the key whose
// fingerprint the terms pin. Nothing is canonicalised and nothing from the delivery or the terms is executed. The only
// limits are sizes and the shared work budget; there is no timer, so every adjudicator reaches the same result.
import type { JudgmentCheck } from '../terms.js';
import { StepBudget } from './safe-regex.js';
import {
  ALGORITHMS,
  SIGNATURE_LIMITS as MAX,
  fingerprint,
  isStrictDer,
  keyShapeOk,
  pemPublicKey,
  strictBase64,
  verifySignature,
} from './signature.js';

type SignatureCheck = Extract<JudgmentCheck, { type: 'signature_valid' }>;
export type SignatureOutcome = { passed: boolean; detail?: string };

/** Work units (section 6). Part of the kind: a change to them is a change to judgment and takes a new policy version. */
export const SIGNATURE_WORK = { perVerification: 200_000, perComparedValue: 1 } as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** True when `value` is an object with every `required` key and no key outside `required` and `optional`. */
function hasShape(value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  return required.every((k) => keys.includes(k)) && keys.every((k) => required.includes(k) || optional.includes(k));
}

/** Code points, as the schema's maxLength counts them (a lone surrogate counts one), so both refuse the same pointers. */
const codePoints = (s: string): number => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};
const isPointer = (p: unknown): p is string => typeof p === 'string' && p.length <= 2 * MAX.pointer && codePoints(p) <= MAX.pointer && /^(\/([^~/]|~[01])*)*$/.test(p);

/** Static validation for offer time: why the terms' check is malformed, or undefined. Every parameter must be a string. */
export function validateSignatureCheck(check: unknown): string | undefined {
  if (!hasShape(check, ['id', 'type', 'required', 'alg', 'publicKey', 'message', 'signature'])) return 'signature_valid needs exactly id, type, required, alg, publicKey, message and signature';
  const { id, alg, publicKey, message, signature } = check;
  if (typeof id !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(id) || typeof check.required !== 'boolean' || check.type !== 'signature_valid') return 'id, type or required is malformed';
  if (typeof alg !== 'string' || !Object.hasOwn(ALGORITHMS, alg)) return 'alg must be ecdsa-p256-sha256 or ed25519';
  if (!hasShape(publicKey, ['pointer', 'format', 'spkiSha256'])) return 'publicKey needs exactly pointer, format and spkiSha256';
  if (!hasShape(message, ['pointer', 'encoding'], ['jsonEquals'])) return 'message needs pointer and encoding, and may have jsonEquals';
  if (!hasShape(signature, ['pointer', 'encoding', 'format'])) return 'signature needs exactly pointer, encoding and format';
  for (const [name, p] of [['publicKey.pointer', publicKey.pointer], ['message.pointer', message.pointer], ['message.jsonEquals', message.jsonEquals ?? ''], ['signature.pointer', signature.pointer]] as const) {
    if (!isPointer(p)) return `${name} must be an RFC 6901 JSON pointer of at most ${MAX.pointer} characters`;
  }
  if (publicKey.format !== 'spki-pem' && publicKey.format !== 'spki-base64') return 'publicKey.format must be spki-pem or spki-base64';
  if (typeof publicKey.spkiSha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(publicKey.spkiSha256)) return 'publicKey.spkiSha256 must be sha256: and 64 lowercase hex characters';
  if (message.encoding !== 'utf8' && message.encoding !== 'base64') return 'message.encoding must be utf8 or base64';
  if (signature.encoding !== 'base64') return 'signature.encoding must be base64';
  if (!(ALGORITHMS[alg as keyof typeof ALGORITHMS].signatureFormats as readonly unknown[]).includes(signature.format)) return `signature.format ${typeof signature.format === 'string' ? signature.format.slice(0, 20) : ''} is not accepted for ${alg}`;
  return undefined;
}

/** The value at an RFC 6901 pointer, through own members only, as `{ value }`; `undefined` when nothing is there. */
function resolve(document: unknown, pointer: string): { value: unknown } | undefined {
  let value = document;
  for (const token of pointer.split('/').slice(1)) {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(value)) {
      if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) return undefined;
    } else if (!isObject(value) || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return { value };
}

/** Equality of two parsed JSON values (section 3), one budget unit per value visited. A stack, so deep nesting cannot overflow. */
function jsonEqual(left: unknown, right: unknown, budget: StepBudget): boolean {
  const pending: [unknown, unknown][] = [[left, right]];
  while (pending.length > 0) {
    const [a, b] = pending.pop()!;
    budget.spend(SIGNATURE_WORK.perComparedValue);
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

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const fail = (detail: string): SignatureOutcome => ({ passed: false, detail });

/**
 * The check's result on the delivered text, in the order of ADR-0045 section 4, stopping at the first failure. A detail
 * names the step and never quotes the message, the key or the signature. Throws only BudgetExhausted.
 */
export function evaluateSignatureValid(check: SignatureCheck, delivered: string, budget: StepBudget): SignatureOutcome {
  const invalid = validateSignatureCheck(check);
  if (invalid) return fail(`check invalid: ${invalid}`);
  let document: unknown;
  try {
    document = JSON.parse(delivered);
  } catch {
    return fail('not a JSON document');
  }

  const strings = {} as Record<'publicKey' | 'message' | 'signature', string>;
  for (const name of ['publicKey', 'message', 'signature'] as const) {
    const found = resolve(document, check[name].pointer);
    if (!found) return fail(`${name}: nothing at the pointer`);
    if (typeof found.value !== 'string') return fail(`${name}: not a string`);
    if (name !== 'message' && found.value.length > MAX[name]) return fail(`${name}: too long`);
    strings[name] = found.value;
  }

  const pem = check.publicKey.format === 'spki-pem';
  const spki = pem ? pemPublicKey(strings.publicKey) : strictBase64(strings.publicKey);
  if (!spki) return fail(pem ? 'publicKey: not a PEM public key' : 'publicKey: not valid base64');
  if (fingerprint(spki) !== check.publicKey.spkiSha256) return fail('publicKey: fingerprint differs from the terms');
  if (!keyShapeOk(check.alg, spki)) return fail(ALGORITHMS[check.alg].wrongKey);

  const signature = strictBase64(strings.signature);
  if (!signature) return fail('signature: not valid base64');
  const { format } = check.signature;
  if (format === 'der' ? signature.length > MAX.derBytes : signature.length !== MAX.rawBytes) return fail('signature: wrong length');

  let message: Uint8Array;
  if (check.message.encoding === 'utf8') {
    if (LONE_SURROGATE.test(strings.message)) return fail('message: not well-formed text');
    message = new TextEncoder().encode(strings.message);
  } else {
    // One unit per byte decoded, charged before the decode allocates; the hashing below charges the bytes again.
    budget.spend((strings.message.length / 4) * 3);
    const decoded = strictBase64(strings.message);
    if (!decoded) return fail('message: not valid base64');
    message = decoded;
  }

  if (format === 'der' && !isStrictDer(signature)) return fail('signature: not valid DER');
  budget.spend(message.length + SIGNATURE_WORK.perVerification);
  if (!verifySignature(check.alg, spki, message, signature, format)) return fail('signature does not verify');

  if (check.message.jsonEquals !== undefined) {
    let signed: unknown;
    try {
      // A byte order mark stays in the text, so JSON.parse refuses it.
      signed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(message));
    } catch {
      return fail('message: not JSON');
    }
    const named = resolve(document, check.message.jsonEquals);
    if (!named || !jsonEqual(signed, named.value, budget)) return fail('message: differs from the value at jsonEquals');
  }
  return { passed: true };
}
