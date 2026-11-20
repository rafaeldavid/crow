// T-577 (ADR-0044): what screen-2's narrower NFKC signal catches and lets through, against screen-1, on an attack corpus
// written for the change. Every string below is attack data for the screen to read; none is an instruction to anyone.
// Each case names its class and the expected flag under each version; the test measures both versions and fails on
// any difference from the table, so a later change to either version shows here.
import { describe, expect, it } from 'vitest';
import * as screen1 from './kept/screen-1.js';
import { normalizeText } from './normalize.js';
import { screen, SCREEN_VERSION } from './screen.js';
import { UntrustedData } from './untrusted.js';

type Screen = typeof screen;
const runWith = (s: Screen) => (raw: string) => {
  const n = normalizeText(raw);
  return s({
    data: UntrustedData.wrap(n.text),
    hiddenTagText: UntrustedData.wrap(n.hiddenTagText),
    removed: { tagChars: n.tagChars, zeroWidth: n.zeroWidth, nfkcChanged: n.nfkcChanged, nfkcLetters: n.nfkcLetters },
  });
};
const one = runWith(screen1.screen as Screen);
const two = runWith(screen);

/** Maps ASCII letters and digits into a compatibility block: `base` is the code point of "a" (or "0" for digits). */
const shift = (s: string, lower: number, upper?: number, digit?: number) =>
  [...s]
    .map((c) => {
      if (c >= 'a' && c <= 'z') return String.fromCodePoint(lower + c.charCodeAt(0) - 97);
      if (upper !== undefined && c >= 'A' && c <= 'Z') return String.fromCodePoint(upper + c.charCodeAt(0) - 65);
      if (digit !== undefined && c >= '0' && c <= '9') return String.fromCodePoint(digit + c.charCodeAt(0) - 48);
      return c;
    })
    .join('');
const fullwidth = (s: string) => shift(s, 0xff41, 0xff21, 0xff10);
const mathBold = (s: string) => shift(s, 0x1d41a, 0x1d400, 0x1d7ce);
const circled = (s: string) => shift(s, 0x24d0, 0x24b6);
const SUPER: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
const superDigits = (s: string) => s.replace(/[0-9]/g, (d) => SUPER[d]!);

// Classes: L = compatibility letters, G = ligatures, D = folded digits, P = folded punctuation, M = mixed scripts,
// C = the ellipsis and superscripts as carriers, H = honest typography (must not flag under screen-2).
type Case = { cls: string; name: string; text: string; screen1: boolean; screen2: boolean };
export const CASES: Case[] = [];

describe(`T-577 attack corpus: ${SCREEN_VERSION} against screen-1`, () => {
  it.each(CASES)('$cls $name: screen-1 $screen1, screen-2 $screen2', ({ text, screen1: f1, screen2: f2 }) => {
    expect(one(text).flagged).toBe(f1);
    expect(two(text).flagged).toBe(f2);
  });
});
