import { canonicalJson } from '@holdback/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonical, chargeChars, chargeSort, codePoints, MAX_CANONICAL_DEPTH, TooDeep } from './cost.js';
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

/**
 * D96's recursive walk as it was before D102, kept here as the reference for the charges: the iterative walk must
 * spend the same units in the same order, so a budget runs out at the same node.
 */
function recursive(v: unknown, budget: StepBudget): string {
  const str = (s: string) => {
    chargeChars(budget, s.length);
    if (/\p{Cs}/u.test(s)) throw new TypeError('lone surrogate');
    return JSON.stringify(s);
  };
  const scalar = (x: unknown): string | undefined => {
    if (x === null) return 'null';
    if (typeof x === 'boolean') return x ? 'true' : 'false';
    if (typeof x === 'string') return str(x);
    if (typeof x === 'number') {
      if (!Number.isFinite(x)) throw new TypeError('non-finite');
      return String(x);
    }
    return undefined;
  };
  const parts: string[] = [];
  const write = (x: unknown, depth: number): void => {
    budget.spend(1);
    if (depth > MAX_CANONICAL_DEPTH) throw new TypeError('too deep');
    const s = scalar(x);
    if (s !== undefined) parts.push(s);
    else if (Array.isArray(x)) {
      parts.push('[');
      x.forEach((y, i) => {
        if (i > 0) parts.push(',');
        write(y, depth + 1);
      });
      parts.push(']');
    } else if (typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype) {
      const entries = Object.entries(x as Record<string, unknown>);
      for (const [, y] of entries) if (y === undefined) throw new TypeError('undefined');
      chargeSort(budget, entries.length);
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      parts.push('{');
      entries.forEach(([k, y], i) => {
        if (i > 0) parts.push(',');
        parts.push(str(k), ':');
        write(y, depth + 1);
      });
      parts.push('}');
    } else throw new TypeError('unsupported');
  };
  if (typeof v !== 'object' || v === null) {
    budget.spend(1);
    const s = scalar(v);
    if (s === undefined) throw new TypeError('unsupported');
    return s;
  }
  write(v, 1);
  return parts.join('');
}

describe('canonical: charges (D102)', () => {
  const charged = (f: (b: StepBudget) => string, units: number) => {
    const b = new StepBudget(units);
    try {
      return { text: f(b), left: b.remaining };
    } catch (e) {
      return { threw: e instanceof BudgetExhausted ? 'budget' : e instanceof TypeError ? 'type' : 'other', left: b.remaining };
    }
  };
  it('spends what the recursive walk spent, and runs out at the same node (property)', () => {
    const value = fc.letrec<{ v: unknown }>((tie) => ({
      v: fc.oneof(
        { depthSize: 'small' },
        fc.constantFrom(null, true, false, 0, -0, 1e21, 0.1, Infinity, undefined),
        utf16,
        fc.array(tie('v'), { maxLength: 5 }),
        fc.dictionary(utf16, tie('v'), { maxKeys: 5 }),
      ),
    })).v;
    fc.assert(
      fc.property(value, fc.integer({ min: 0, max: 400 }), (v, units) => {
        expect(charged((b) => canonical(v, b), units)).toEqual(charged((b) => recursive(v, b), units));
      }),
      { seed: 102, numRuns: 5000 },
    );
  });
});

describe('canonical: depth', () => {
  const nest = (n: number): unknown => {
    let v: unknown = 0;
    for (let i = 1; i < n; i++) v = [v];
    return v;
  };
  it(`writes a value nested ${MAX_CANONICAL_DEPTH} deep and refuses one level more, whatever the stack`, () => {
    expect(canonical(nest(MAX_CANONICAL_DEPTH))).toBe(`${'['.repeat(MAX_CANONICAL_DEPTH - 1)}0${']'.repeat(MAX_CANONICAL_DEPTH - 1)}`);
    expect(() => canonical(nest(MAX_CANONICAL_DEPTH + 1))).toThrow(TooDeep);
    expect(() => canonical(nest(MAX_CANONICAL_DEPTH + 1))).toThrow(TypeError);
    expect(() => canonical(nest(MAX_CANONICAL_DEPTH * 50))).toThrow(TypeError);
  });
});

describe('codePoints', () => {
  it('counts what spreading the string counts, lone surrogates included (property)', () => {
    fc.assert(fc.property(utf16, (s) => {
      expect(codePoints(s)).toBe([...s].length);
    }), { seed: 3, numRuns: 5000 });
  });
});
