import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BudgetExhausted, compileSafeRegex, MAX_SUBJECT_CHARS, StepBudget } from './safe-regex.js';

const compile = (p: string) => {
  const r = compileSafeRegex(p);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('safe regex: supported subset agrees with RegExp', () => {
  const cases: Array<[string, string[], string[]]> = [
    ['abc', ['abc'], ['ab', 'abcd', '']],
    ['a|b|cd', ['a', 'b', 'cd'], ['c', 'ab']],
    ['a*', ['', 'a', 'aaaa'], ['b']],
    ['a+b?', ['a', 'ab', 'aaab'], ['b', 'abb']],
    ['a{2,3}', ['aa', 'aaa'], ['a', 'aaaa']],
    ['a{2}', ['aa'], ['a', 'aaa']],
    ['a{2,}', ['aa', 'aaaaa'], ['a']],
    ['[a-c]+', ['abc', 'cab'], ['abd', '']],
    ['[^a-c]', ['d', 'Z'], ['a', '']],
    ['\\d{3}-\\d{4}', ['555-1234'], ['5551234', '55-1234']],
    ['\\w+@\\w+\\.com', ['ada@x.com'], ['ada@x.org']],
    ['\\s', [' ', '\t'], ['a']],
    ['(ab)+', ['ab', 'abab'], ['aba', '']],
    ['(?:ab|cd)*e', ['e', 'abcde', 'cdabe'], ['abc']],
    ['.', ['a', '.'], ['', 'ab']],
    ['\\.', ['.'], ['a']],
    ['[.\\-]', ['.', '-'], ['a']],
    ['^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', ['a@b.co'], ['a@b', 'a b@c.d', '@b.c']],
    ['\u00E9+', ['\u00E9\u00E9'], ['e']],
    ['[\\d\\s]+', ['1 2'], ['a']],
    ['a+?', ['aa'], ['']],
  ];
  for (const [pattern, yes, no] of cases) {
    it(`/${pattern}/`, () => {
      const m = compile(pattern);
      const native = new RegExp(`^(?:${pattern.replace(/^\^/, '').replace(/\$$/, '')})$`, 'u');
      for (const s of yes) {
        expect(m.fullMatch(s), `${pattern} should match ${JSON.stringify(s)}`).toBe(true);
        expect(native.test(s)).toBe(true);
      }
      for (const s of no) {
        expect(m.fullMatch(s), `${pattern} should not match ${JSON.stringify(s)}`).toBe(false);
        expect(native.test(s)).toBe(false);
      }
    });
  }

  it('search() finds a match anywhere, like RegExp.test', () => {
    const m = compile('b+c');
    expect(m.search('aabbbcd')).toBe(true);
    expect(m.search('aabd')).toBe(false);
  });

  it('agrees with RegExp on random strings over a small alphabet (property)', () => {
    const patterns = ['(a|b)*c', 'a+b*', '(ab|a)+', '[ab]{1,3}c?', '(a*)*b'];
    fc.assert(
      fc.property(fc.constantFrom(...patterns), fc.string({ unit: fc.constantFrom('a', 'b', 'c'), maxLength: 12 }), (p, s) => {
        expect(compile(p).fullMatch(s)).toBe(new RegExp(`^(?:${p})$`, 'u').test(s));
        expect(compile(p).search(s)).toBe(new RegExp(p, 'u').test(s));
      }),
      { seed: 8, numRuns: 500 },
    );
  });

  it('character classes agree with RegExp across the code points', () => {
    const classes = ['[a-c]', '[^a-c]', '[\\d]', '[\\D]', '[^\\D]', '[\\w.\\-]', '[\\W]', '[\\s]', '[^\\s]', '[\\S\\d]', '[^@\\s]', '[\\s\\S]', '[a-ca-cb-d]', '[\\t\\n\\r\\f\\v]', '[é-ÿ　]', '[^\u{10000}-\u{10ffff}]'];
    const points: number[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp += cp < 0x3100 ? 1 : 251) points.push(cp);
    points.push(0x10ffff, 0xfeff, 0xd800, 0xdfff);
    for (const c of classes) {
      const m = compile(c);
      const native = new RegExp(`^${c}$`, 'u');
      for (const cp of points) {
        const s = String.fromCodePoint(cp);
        if (m.fullMatch(s) !== native.test(s)) expect.fail(`${c} on U+${cp.toString(16)}`);
      }
    }
  });

  it('agrees with RegExp on random nested patterns (property)', () => {
    const atom = fc.constantFrom('a', 'b', '.', '[ab]', '()', '(?:)', '(|)', '(a|)', '(|b)');
    const quant = fc.constantFrom('', '', '*', '+', '?', '{0}', '{1}', '{2}', '{0,0}', '{1,1}', '{0,1}', '{1,3}', '{2,}', '*?');
    const { part } = fc.letrec<{ part: string; seq: string }>((tie) => ({
      part: fc.oneof(
        { depthSize: 'small', withCrossShrink: true },
        fc.tuple(atom, quant).map(([a, q]) => a + q),
        fc.tuple(tie('seq'), quant).map(([s, q]) => `(${s})${q}`),
        fc.tuple(tie('seq'), tie('seq'), quant).map(([s, t, q]) => `(?:${s}|${t})${q}`),
      ),
      seq: fc.array(tie('part'), { minLength: 1, maxLength: 3 }).map((xs) => xs.join('')),
    }));
    fc.assert(
      fc.property(part.filter((p) => p.length <= 120), fc.string({ unit: fc.constantFrom('a', 'b', 'c'), maxLength: 8 }), (p, s) => {
        const m = compile(p);
        expect(m.fullMatch(s)).toBe(new RegExp(`^(?:${p})$`, 'u').test(s));
        expect(m.search(s)).toBe(new RegExp(p, 'u').test(s));
      }),
      { seed: 25, numRuns: 2000 },
    );
  });
});

describe('safe regex: refusals', () => {
  const refused = [
    ['(a)\\1', /backreference/],
    ['(?=a)a', /lookaround/],
    ['(?!a)b', /lookaround/],
    ['(?<=a)b', /lookaround/],
    ['(?<name>a)', /group/],
    ['a{1,5000}', /repeat/],
    ['a{3,2}', /repeat/],
    ['[z-a]', /range/],
    ['(ab', /\)/],
    ['ab)', /\)/],
    ['*a', /quantifier/],
    ['a**', /quantifier/],
    ['\\p{L}', /escape/],
    ['a^b', /anchor/],
    ['a$b', /anchor/],
    ['\\b', /escape/],
    ['((a{1,100}){1,100}){1,100}', /too large/],
  ] as const;
  for (const [pattern, why] of refused) {
    it(`refuses /${pattern}/`, () => {
      const r = compileSafeRegex(pattern);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(why);
    });
  }

  it('refuses patterns longer than 200 characters', () => expect(compileSafeRegex('a'.repeat(201)).ok).toBe(false));

  it('does not match subjects longer than the cap', () => {
    expect(compile('a*').fullMatch('a'.repeat(MAX_SUBJECT_CHARS + 1))).toBe(false);
    expect(compile('a*').fullMatch('a'.repeat(MAX_SUBJECT_CHARS))).toBe(true);
  });
});

describe('safe regex: the match budget counts every engine step', () => {
  const spent = (p: string, s: string, mode: 'fullMatch' | 'search' = 'fullMatch') => {
    const b = new StepBudget(1_000_000);
    compile(p)[mode](s, b);
    return 1_000_000 - b.remaining;
  };

  it('charges one unit per code point and per state in the current set', () => {
    // abc: one state in the set at each of three code points, and no empty move.
    expect(spent('abc', 'abc')).toBe(6);
  });

  it('charges one unit per empty move', () => {
    // a?: the split state is one empty move before the first code point.
    expect(spent('a?', '')).toBe(1);
    expect(spent('a?', 'a')).toBe(4);
    // Each optional part adds its empty move.
    expect(spent('(?:a?){20}', 'b') - spent('(?:a?){10}', 'b')).toBeGreaterThanOrEqual(10);
    expect(spent('(?:a?){20}', '', 'search')).toBeGreaterThanOrEqual(20);
  });

  it('runs out of budget on an empty subject too', () => {
    expect(() => compile('(?:a?){50}').fullMatch('', new StepBudget(10))).toThrow(BudgetExhausted);
  });

  it('gives the same answers when one compiled pattern runs many times (property)', () => {
    const patterns = ['(a|b)*c', 'a?b?c?', '(ab|a)+', '[ab]{1,3}c?', '(a*)*b', '(a?b?)*'];
    const compiled = new Map(patterns.map((p) => [p, compile(p)]));
    fc.assert(
      fc.property(fc.constantFrom(...patterns), fc.string({ unit: fc.constantFrom('a', 'b', 'c'), maxLength: 12 }), (p, s) => {
        expect(compiled.get(p)!.fullMatch(s)).toBe(new RegExp(`^(?:${p})$`, 'u').test(s));
        expect(compiled.get(p)!.search(s, new StepBudget(1_000_000))).toBe(new RegExp(p, 'u').test(s));
      }),
      { seed: 11, numRuns: 1000 },
    );
  });
});

describe('safe regex: linear time on catastrophic patterns', () => {
  for (const p of ['(a+)+$', '(a|a)*b', '(a*)*b', '(a|aa)+c', '(\\w+\\s?)+$']) {
    it(`/${p}/ on a 4000-char adversarial subject`, () => {
      const m = compile(p);
      const started = performance.now();
      m.fullMatch(`${'a'.repeat(4000)}!`);
      m.search(`${'a'.repeat(4000)}!`);
      expect(performance.now() - started).toBeLessThan(1000);
    });
  }
});

describe('safe regex: anchors beside alternation', () => {
  it('binds a leading ^ to the first alternative and a trailing $ to the last, as RegExp does (property)', () => {
    const alt = fc.array(fc.constantFrom('a', 'b', 'ab', 'a*', '(?:b|a)', '[ab]c', ''), { minLength: 1, maxLength: 4 });
    fc.assert(
      fc.property(fc.boolean(), alt, fc.boolean(), fc.string({ unit: fc.constantFrom('a', 'b', 'c', 'x'), maxLength: 8 }), (start, options, end, s) => {
        const p = `${start ? '^' : ''}${options.join('|')}${end ? '$' : ''}`;
        const m = compile(p);
        expect(m.search(s), `${p} on ${s}`).toBe(new RegExp(p, 'u').test(s));
        expect(m.fullMatch(s), `${p} on ${s}`).toBe(new RegExp(`^(?:${p})$`, 'u').test(s));
      }),
      { seed: 31, numRuns: 3000 },
    );
  });
});

describe('safe regex: subject length', () => {
  it('measures the cap in code points, surrogate pairs counted once', () => {
    const wide = '\u{1F600}';
    expect(compile('.*').fullMatch(wide.repeat(MAX_SUBJECT_CHARS))).toBe(true);
    expect(compile('.*').fullMatch(`${wide.repeat(MAX_SUBJECT_CHARS)}a`)).toBe(false);
    expect(compile('a').search(`${'\uD800'.repeat(MAX_SUBJECT_CHARS)}a`)).toBe(false);
    expect(compile('a').search(`${'\uD800'.repeat(MAX_SUBJECT_CHARS - 1)}a`)).toBe(true);
  });
});
