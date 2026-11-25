// The pure half of the signature_valid check (ADR-0045 sections 2, 4 and 7): strict decoders, the one accepted key shape
// per algorithm, and the library call with every strictness option named. No pointer handling, no budget: a later proof
// check (N226) can call verifySignature on bytes of its own. Nothing here reads a clock, opens a connection or loads code.
import { DER } from '@noble/curves/abstract/weierstrass';
import { ed25519 } from '@noble/curves/ed25519';
import { p256 } from '@noble/curves/nist';
import { sha256 } from '@holdback/core/crypto';

export type SignatureAlg = 'ecdsa-p256-sha256' | 'ed25519';
export type SignatureFormat = 'der' | 'raw';

const hex = (s: string): Uint8Array => Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16));

/** One accepted DER SubjectPublicKeyInfo shape per algorithm: a fixed prefix, then the key (section 4, step 4). */
export const ALGORITHMS = {
  'ecdsa-p256-sha256': {
    signatureFormats: ['der', 'raw'] as readonly SignatureFormat[],
    prefix: hex('3059301306072a8648ce3d020106082a8648ce3d030107034200'),
    spkiLength: 91,
    wrongKey: 'publicKey: not a P-256 key',
  },
  ed25519: {
    signatureFormats: ['raw'] as readonly SignatureFormat[],
    prefix: hex('302a300506032b6570032100'),
    spkiLength: 44,
    wrongKey: 'publicKey: not an Ed25519 key',
  },
} as const;

/** Section 6 limits, in characters and bytes. A pointer counts code points, as the schema does; the key and the signature count UTF-16 units. */
export const SIGNATURE_LIMITS = { pointer: 512, publicKey: 1024, signature: 256, derBytes: 72, rawBytes: 64 } as const;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map([...B64].map((c, i) => [c.charCodeAt(0), i]));

/** RFC 4648 section 4: standard alphabet, padded, no whitespace, zero trailing bits. One byte string has one spelling. */
export function strictBase64(text: string): Uint8Array | undefined {
  const n = text.length;
  if (n % 4 !== 0) return undefined;
  const pad = n >= 2 && text.endsWith('==') ? 2 : n >= 1 && text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((n / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < n; i += 4) {
    const last = i + 4 === n;
    const quad: number[] = [];
    for (let k = 0; k < 4; k++) {
      if (last && k >= 4 - pad) {
        if (text.charCodeAt(i + k) !== 0x3d) return undefined;
        quad.push(0);
      } else {
        const v = B64_INDEX.get(text.charCodeAt(i + k));
        if (v === undefined) return undefined;
        quad.push(v);
      }
    }
    const word = (quad[0]! << 18) | (quad[1]! << 12) | (quad[2]! << 6) | quad[3]!;
    // Non-zero trailing bits in the last quad would give a second spelling of the same bytes.
    if (last && pad === 2 && (word & 0xffff) !== 0) return undefined;
    if (last && pad === 1 && (word & 0xff) !== 0) return undefined;
    if (o < out.length) out[o++] = (word >> 16) & 0xff;
    if (o < out.length) out[o++] = (word >> 8) & 0xff;
    if (o < out.length) out[o++] = word & 0xff;
  }
  return out;
}

const PEM = /^-----BEGIN PUBLIC KEY-----\r?\n((?:[A-Za-z0-9+/=]+\r?\n)+)-----END PUBLIC KEY-----(?:\r?\n)?$/;

/** One PEM block labelled PUBLIC KEY, LF or CRLF, an optional final line end, nothing before or after. */
export function pemPublicKey(text: string): Uint8Array | undefined {
  const block = PEM.exec(text);
  return block ? strictBase64(block[1]!.replace(/\r?\n/g, '')) : undefined;
}

/** SHA-256 of `bytes` as the `sha256:<64 hex>` string the terms pin. */
export const fingerprint = (bytes: Uint8Array): string => sha256(bytes);

/** True when the DER SubjectPublicKeyInfo has the one accepted shape for `alg`, and for P-256 a valid uncompressed point. */
export function keyShapeOk(alg: SignatureAlg, spki: Uint8Array): boolean {
  const a = ALGORITHMS[alg];
  if (spki.length !== a.spkiLength || !a.prefix.every((b, i) => spki[i] === b)) return false;
  if (alg === 'ed25519') return true;
  if (spki[a.prefix.length] !== 4) return false;
  try {
    p256.ProjectivePoint.fromHex(spki.subarray(a.prefix.length)).assertValidity();
    return true;
  } catch {
    return false;
  }
}

/** DER read strictly. The library reads an empty INTEGER as 0 (and refuses DER's own 0), so a 0 here is an empty one. */
export function isStrictDer(signature: Uint8Array): boolean {
  try {
    const { r, s } = DER.toSig(signature);
    return r !== 0n && s !== 0n;
  } catch {
    return false;
  }
}

/**
 * The library call (section 4, step 7). Every strictness option is named, so a changed library default cannot change a
 * result: P-256 accepts a high s and SHA-256 is taken here, Ed25519 uses the strict rule (zip215 false). Never throws.
 */
export function verifySignature(alg: SignatureAlg, spki: Uint8Array, message: Uint8Array, signature: Uint8Array, format: SignatureFormat): boolean {
  const key = spki.subarray(ALGORITHMS[alg].prefix.length);
  try {
    if (alg === 'ed25519') return ed25519.verify(signature, message, key, { zip215: false });
    const digest = hex(sha256(message).slice('sha256:'.length));
    return p256.verify(signature, digest, key, { lowS: false, prehash: false, format: format === 'der' ? 'der' : 'compact' });
  } catch {
    return false;
  }
}
