// T-624 (red team H2): normalizeText's walk back over variation selectors keeps a memo, so a long run costs linear
// time. Every kept screen reads its output, so it must not change: this property test holds it to the walk it
// replaced, copied below from 5a865c0a, on strings built from the characters the walk and its rules read.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HIDDEN_GLOBAL, hiddenClass } from './hidden.js';
import { normalizeText, type Normalized } from './normalize.js';

const EMOJI_TAG_SEQUENCE = /\u{1F3F4}[\u{E0020}-\u{E007E}]{1,8}\u{E007F}/gu;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const KEYCAP_BASE = /[0-9#*]/;
const LETTER = /\p{L}/u;
const LATIN_LIKE = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]/u;
const NON_ASCII = /[^\x00-\x7f]/gu;
function prevBase(s: string, i: number): string {
  let j = i;
  for (;;) {
    if (j <= 0) return '';
    const lo = s.charCodeAt(j - 1);
    const start = lo >= 0xdc00 && lo <= 0xdfff && j >= 2 ? j - 2 : j - 1;
    const ch = String.fromCodePoint(s.codePointAt(start)!);
    const cp = ch.codePointAt(0)!;
    if (!((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef))) return ch;
    j = start;
  }
}
const nextChar = (s: string, i: number): string => (i < s.length ? String.fromCodePoint(s.codePointAt(i)!) : '');
function before(raw: string): Normalized {
  let explained = 0;
  let tagText = '';
  let tagChars = 0;
  let zeroWidth = 0;
  const vsBytes: number[] = [];
  const withoutFlags = raw.replace(EMOJI_TAG_SEQUENCE, (m) => {
    explained += [...m].length - 1;
    return '\u{1F3F4}';
  });
  const stripped = withoutFlags.replace(HIDDEN_GLOBAL, (c: string, offset: number, s: string) => {
    const cp = c.codePointAt(0)!;
    const cls = hiddenClass(cp);
    if (cls === 'tag') {
      tagChars++;
      const a = cp - 0xe0000;
      if (a >= 0x20 && a <= 0x7e) tagText += String.fromCharCode(a);
      return '';
    }
    const before = prevBase(s, offset);
    const after = nextChar(s, offset + c.length);
    if ((cp === 0xfe0e || cp === 0xfe0f) && (PICTOGRAPHIC.test(before) || KEYCAP_BASE.test(before))) {
      explained++;
      return '';
    }
    if (cp === 0x200d && PICTOGRAPHIC.test(before) && PICTOGRAPHIC.test(after)) {
      explained++;
      return '';
    }
    if ((cp === 0x200c || cp === 0x200d) && LETTER.test(before) && LETTER.test(after) && !LATIN_LIKE.test(before) && !LATIN_LIKE.test(after)) {
      explained++;
      return '';
    }
    zeroWidth++;
    if (cls === 'variationSelector' && cp >= 0xfe00) vsBytes.push(cp <= 0xfe0f ? cp - 0xfe00 : cp - 0xe0100 + 16);
    return '';
  });
  let nfkcChanged = 0;
  let nfkcLetters = 0;
  for (const m of stripped.matchAll(NON_ASCII)) {
    const n = m[0].normalize('NFKC');
    if (n !== m[0] && n !== ' ') {
      nfkcChanged++;
      if (LETTER.test(n)) nfkcLetters++;
    }
  }
  // A variation-selector run carries a message only when it is long.
  const vsText = vsBytes.length >= 8 ? Buffer.from(vsBytes).toString('latin1') : '';
  const hiddenTagText = tagText && vsText ? `${tagText}\n${vsText}` : tagText || vsText;
  return { text: stripped.normalize('NFKC'), tagChars, zeroWidth, explained, nfkcChanged, nfkcLetters, hiddenTagText };
}

/** The characters the walk and its rules read: bases, both kinds of variation selector, joiners, tags, surrogates. */
const PIECES = ['a', 'Z', '7', '#', 'ب', 'क', 'é', '́', '\u{1F600}', '\u{1F3F4}', '❤', '︎', '️', '︀', '\u{E0100}', '\u{E01EF}', '‌', '‍', '​', '‮', '\u{E0041}', '\u{E007F}', '\uD800', '\uDC00', 'ﷺ', 'ﬁ', ' ', '\n'];
const text = fc.array(fc.constantFrom(...PIECES), { maxLength: 60 }).map((p) => p.join(''));

describe('normalizeText with the memo', () => {
  it('gives the same result as the walk it replaced', () => {
    fc.assert(fc.property(text, (s) => {
      expect(normalizeText(s)).toEqual(before(s));
    }), { numRuns: 5000 });
  });

  it('reads a run of 300,000 variation selectors in linear time', () => {
    const run = `a${'︀'.repeat(300_000)}`;
    const t0 = performance.now();
    const n = normalizeText(run);
    // The walk it replaced took about 20 s on 160 kB (measured); the memo takes milliseconds. 5 s leaves room for a slow host.
    expect(performance.now() - t0).toBeLessThan(5_000);
    expect(n.zeroWidth).toBe(300_000);
  });
});
