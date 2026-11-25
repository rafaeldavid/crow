// ADR-0050 section 1 and 3: the references a coded verdict makes into the work, and the anchors the record keeps.
import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ANCHOR_TAG, anchorIndex, anchorKey, anchorOf, NO_REFS, plaintextBytes, resolves, workView, type WorkView } from './refs.js';
import { UntrustedData } from './untrusted.js';
import { utf8 } from './_helpers.js';

const KIT = { kit: { logo: '<svg/>', 'a/b': 1, 'c~d': 2, colours: [{ role: 'ink' }, { role: 'paper' }], __proto__x: null } };
const json: WorkView = { kind: 'json', document: JSON.parse(JSON.stringify(KIT)) };
const lines: WorkView = { kind: 'lines', count: 4 };

describe('a reference resolves in the work, or it is dropped', () => {
  it.each(['', '/kit', '/kit/logo', '/kit/a~1b', '/kit/c~0d', '/kit/colours/0', '/kit/colours/1/role', '/kit/__proto__x'])('the pointer %j resolves in a JSON delivery', (p) => {
    expect(resolves(json, p)).toBe(true);
  });
  it.each(['/kit/nope', '/kit/colours/2', '/kit/colours/01', '/kit/colours/-', 'kit', '/kit/~2', '/kit/logo/0', '/__proto__', '/constructor', '/kit/colours/length', 'L1', `/${'a'.repeat(512)}`])('the pointer %j does not', (p) => {
    expect(resolves(json, p)).toBe(false);
  });
  it.each(['L1', 'L2', 'L4'])('the line %s resolves in a four-line text', (l) => expect(resolves(lines, l)).toBe(true));
  it.each(['L0', 'L5', 'L01', 'l2', 'L 2', 'L2 ', 'L-1', 'L1.0', 'L99999999999', '/kit', '', '2'])('the line %j does not', (l) => expect(resolves(lines, l)).toBe(false));
  it.each([1, null, ['L1'], { L: 1 }, undefined])('a reference that is not a string does not: %j', (l) => {
    expect(resolves(lines, l)).toBe(false);
    expect(resolves(json, l)).toBe(false);
  });
  it('a sampled read or a delivery that is not JSON carries no references', () => {
    for (const r of ['', 'L1', '/kit']) expect(resolves(NO_REFS, r)).toBe(false);
    expect(workView({ data: UntrustedData.wrap('{not json'), mime: 'application/json' })).toEqual(NO_REFS);
  });
  it('a JSON delivery resolves against the JSON the judges read; any other delivery counts the lines they read, under every Unicode line break', () => {
    const view = workView({ data: UntrustedData.wrap('{"a":[1,2]}'), mime: 'application/json' });
    expect(view.kind).toBe('json');
    expect(resolves(view, '/a/1')).toBe(true);
    const text = 'one\ntwo\r\nthree four\u0085five';
    expect(workView({ data: UntrustedData.wrap(text), mime: 'text/plain' })).toEqual({ kind: 'lines', count: 5 });
    expect(workView({ data: UntrustedData.wrap('a,b\n1,2\n'), mime: 'text/csv' })).toEqual({ kind: 'lines', count: 3 });
  });
});

describe('an anchor: the first 8 bytes of HMAC-SHA-256 over the locator, keyed by SHA-256 of the tag and the plaintext', () => {
  const plaintext = utf8(JSON.stringify(KIT));
  it('matches the definition in ADR-0050 section 3', () => {
    const key = createHash('sha256').update(Buffer.concat([Buffer.from(ANCHOR_TAG, 'utf8'), Buffer.from(plaintext)])).digest();
    expect(Buffer.from(anchorKey(plaintext))).toEqual(key);
    expect(anchorOf(anchorKey(plaintext), '/kit/logo')).toBe(createHmac('sha256', key).update('/kit/logo', 'utf8').digest('hex').slice(0, 16));
    expect(anchorOf(anchorKey(plaintext), '/kit/logo')).toMatch(/^[0-9a-f]{16}$/);
  });
  it('differs by locator and by work, so it carries no locator and no content', () => {
    const k = anchorKey(plaintext);
    expect(anchorOf(k, '/kit/logo')).not.toBe(anchorOf(k, '/kit'));
    expect(anchorOf(anchorKey(utf8('other work')), 'L1')).not.toBe(anchorOf(anchorKey(utf8('other work.')), 'L1'));
    expect(ANCHOR_TAG).toBe('holdback/judgment/anchor/v1');
  });
  it('a holder of the work resolves every anchor to its node or line', () => {
    const index = anchorIndex(plaintext, 'application/json');
    const k = anchorKey(plaintext);
    for (const p of ['', '/kit/logo', '/kit/a~1b', '/kit/colours/1/role']) expect(index.get(anchorOf(k, p))).toBe(p);
    const text = utf8('a\nb\nc');
    const lineIndex = anchorIndex(text, 'text/plain');
    expect([...lineIndex.values()]).toEqual(['L1', 'L2', 'L3']);
    expect(lineIndex.get(anchorOf(anchorKey(text), 'L2'))).toBe('L2');
  });
  it('is keyed by the plaintext as delivered, a leading byte-order mark included', () => {
    const text = 'a\nb';
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(text)]);
    expect(plaintextBytes({ raw: UntrustedData.wrap(text), record: { plaintextHashVerified: true, mime: 'text/plain', bytes: bom.length, normalized: true } })).toEqual(bom);
    expect(plaintextBytes({ raw: UntrustedData.wrap(text), record: { plaintextHashVerified: true, mime: 'text/plain', bytes: 3, normalized: true } })).toEqual(utf8(text));
  });
});
