import { canonicalJson } from '@holdback/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonical, codePoints } from './cost.js';
import { BudgetExhausted, StepBudget } from './safe-regex.js';

const utf16 = fc.array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 24 }).map((units) => String.fromCharCode(...units));
const outcome = (f: () => string) => {
  try {
    return { text: f() };
  } catch (e) {
    return { threw: e instanceof TypeError || e instanceof RangeError };
  }
};

describe('canonical', () => {
  it('writes what canonicalJson writes, and throws where it throws (property)', () => {
    const value = fc.letrec<{ v: unknown }>((tie) => ({
      v: fc.oneof(
        { depthSize: 'small' },
        fc.constantFrom(null, true, false, 0, -0, 1e21, 1e-7, 0.1, Infinity, -Infinity, Number.NaN),
        fc.double(),
        utf16,
        fc.array(tie('v'), { maxLength: 4 }),
        fc.dictionary(utf16, tie('v'), { maxKeys: 4 }),
      ),
    })).v;
    fc.assert(
      fc.property(value, (v) => {
        expect(outcome(() => canonical(v))).toEqual(outcome(() => canonicalJson(v)));
      }),
      { seed: 12, numRuns: 3000 },
    );
  });

  it('charges each node and each string', () => {
    const b = new StepBudget(1_000);
    canonical({ a: ['x'.repeat(160), 1, null] }, b);
    expect(1_000 - b.remaining).toBeGreaterThanOrEqual(5 + 10);
    expect(() => canonical(Array.from({ length: 100 }, () => 0), new StepBudget(50))).toThrow(BudgetExhausted);
  });
});

describe('codePoints', () => {
  it('counts what spreading the string counts, lone surrogates included (property)', () => {
    fc.assert(fc.property(utf16, (s) => {
      expect(codePoints(s)).toBe([...s].length);
    }), { seed: 3, numRuns: 5000 });
  });
});
