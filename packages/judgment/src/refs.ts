// References a coded verdict makes into the work, and the anchors the judgment record keeps instead (ADR-0050 sections
// 1 and 3).
//
// A reference is an RFC 6901 pointer for a JSON delivery, resolved against the delivered JSON with the grammar and the
// resolver the signature_valid check uses, or L<n> for CSV, plain text and Markdown: the line number template pair 3
// prints beside each line of the data section, counted under every Unicode line break the prompt splits on. A sampled
// read carries no references. A reference that does not resolve is dropped by the filter (coded.ts).
//
// The record keeps an anchor, never the locator: the first 8 bytes of HMAC-SHA-256 over the locator, keyed by
// SHA-256 of the domain tag and the work's plaintext, as 16 hex characters. A locator is built from the seller's own key
// names, which can hold content, a URL or an instruction to a reader's agent; an anchor shows only how many references
// a seat made and which ones match. Whoever holds the plaintext resolves an anchor by computing the anchor of each node
// or line (anchorIndex). An anchor adds no test of a guess beyond the public plaintextSha256.
import { createHash, createHmac } from 'node:crypto';
import type { Intaken } from './intake.js';
import type { MimeType } from '@holdback/core';
import { isPointer, resolve } from './checks/signature-valid.js';
import { LINE_BREAK } from './prompt.js';

export const ANCHOR_TAG = 'holdback/judgment/anchor/v1';

/** What a reference can point at: the parsed JSON delivery, the number of lines the judges read, or nothing. */
export type WorkView = { kind: 'json'; document: unknown } | { kind: 'lines'; count: number } | { kind: 'none' };
/** A sampled read, or a JSON delivery that does not parse: no reference resolves. */
export const NO_REFS: WorkView = { kind: 'none' };

const LINE_REF = /^L([1-9][0-9]{0,9})$/;

/** The work a coded verdict's references resolve against, once per panel. */
export function workView(intake: Pick<Intaken, 'raw' | 'data' | 'mime'>): WorkView {
  if (intake.mime === 'application/json') {
    try {
      return { kind: 'json', document: JSON.parse(intake.raw.reveal()) as unknown };
    } catch {
      return NO_REFS;
    }
  }
  return { kind: 'lines', count: intake.data.reveal().split(LINE_BREAK).length };
}

/** True when `locator` is a string that points at a node or a line of the work. */
export function resolves(work: WorkView, locator: unknown): locator is string {
  if (typeof locator !== 'string') return false;
  if (work.kind === 'json') return isPointer(locator) && resolve(work.document, locator) !== undefined;
  if (work.kind === 'lines') {
    const m = LINE_REF.exec(locator);
    return m !== null && Number(m[1]) <= work.count;
  }
  return false;
}

/** The anchor key: SHA-256 of the domain tag and the plaintext. */
export function anchorKey(plaintext: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(ANCHOR_TAG, 'utf8').update(plaintext).digest());
}

/** A locator's anchor: the first 8 bytes of HMAC-SHA-256 over the locator's UTF-8, as 16 lowercase hex characters. */
export function anchorOf(key: Uint8Array, locator: string): string {
  return createHmac('sha256', key).update(locator, 'utf8').digest('hex').slice(0, 16);
}

const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

/**
 * The plaintext as delivered. Intake decodes it and drops a leading byte-order mark; the record's byte count says
 * whether there was one, and only a leading mark can account for the three bytes.
 */
export function plaintextBytes(intake: Pick<Intaken, 'raw' | 'record'>): Uint8Array {
  const text = new TextEncoder().encode(intake.raw.reveal());
  if (intake.record.bytes !== text.length + BOM.length) return text;
  const out = new Uint8Array(intake.record.bytes);
  out.set(BOM);
  out.set(text, BOM.length);
  return out;
}

const escapeToken = (k: string) => k.replaceAll('~', '~0').replaceAll('/', '~1');

/**
 * For a holder of the work (the seller; the buyer after an accept; a court through either): every anchor the work's
 * nodes or lines give, mapped to its locator. A JSON delivery gives one per value, the root included; any other gives
 * one per line. Iterative, so deep nesting cannot overflow.
 */
export function anchorIndex(plaintext: Uint8Array, mime: MimeType): Map<string, string> {
  const key = anchorKey(plaintext);
  const out = new Map<string, string>();
  const decoded = new TextDecoder('utf-8').decode(plaintext);
  if (mime !== 'application/json') {
    const n = decoded.split(LINE_BREAK).length;
    for (let i = 1; i <= n; i++) out.set(anchorOf(key, `L${i}`), `L${i}`);
    return out;
  }
  const stack: Array<[unknown, string]> = [[JSON.parse(decoded) as unknown, '']];
  while (stack.length) {
    const [v, at] = stack.pop()!;
    out.set(anchorOf(key, at), at);
    if (Array.isArray(v)) v.forEach((x, i) => stack.push([x, `${at}/${i}`]));
    else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) stack.push([x, `${at}/${escapeToken(k)}`]);
  }
  return out;
}
