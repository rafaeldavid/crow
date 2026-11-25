// ADR-0049 (D105): agg-5's verdict filter cuts a judge's free text over its cap instead of abstaining. The caps are the
// schema's, in code points: 300 for a criterion's evidence and for injectionEvidence, 600 for the rationale, or the
// policy's lower rationale cap. The cut keeps cap - 5 code points and ends with [cut]; the pipeline adds one reason per
// cut seat. Every other schema fault still abstains with its named rule, and the cut never touches a score, an id, a
// boolean or overall.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { NONCES } from './_helpers.js';
import { parseVerdict as parseVerdict4 } from './kept/verdict-0.js';
import { cutReason } from './pipeline.js';
import { CUT_MARK, cutToCap, MAX_OUTPUT_CHARS, parseVerdict, type ParsedVerdict } from './verdict.js';

const IDS = ['fit', 'coherent', 'distinct'];
const opts = { criterionIds: IDS, canary: NONCES.canary, rationaleMaxChars: 600 };
const base = () => ({
  criteria: IDS.map((id) => ({ id, score: 4, evidence: 'ok' })),
  overall: 'pass',
  injectionSuspected: false,
  injectionEvidence: 'none',
  rationale: 'A complete kit.',
});
type Out = ReturnType<typeof base>;
const text = (n: number) => 'Roles, sizes and tokens match the brief. '.repeat(Math.ceil(n / 41) + 1).slice(0, n);
const parse = (v: unknown, o: Partial<typeof opts> = {}) => parseVerdict(typeof v === 'string' ? v : JSON.stringify(v), { ...opts, ...o });
const ok = (r: ParsedVerdict) => {
  if (r.status !== 'ok') throw new Error(`abstained: ${r.reason} ${r.detail}`);
  return r;
};
const cps = (s: string) => [...s].length;

type Path = 'evidence' | 'injectionEvidence' | 'rationale';
const at = (path: Path, value: unknown): Out => {
  const v = base();
  if (path === 'evidence') v.criteria[1]!.evidence = value as string;
  else (v as Record<string, unknown>)[path] = value;
  return v;
};
const read = (v: Out, path: Path) => (path === 'evidence' ? v.criteria[1]!.evidence : v[path]);
const CAPS: Array<[Path, number]> = [
  ['evidence', 300],
  ['injectionEvidence', 300],
  ['rationale', 600],
];

describe('agg-5: free text over its cap is cut to the cap, and the verdict counts', () => {
  it.each(CAPS)('%s at its cap of %i is unchanged, and no cut is recorded', (path, cap) => {
    const r = ok(parse(at(path, text(cap))));
    expect(read(r.verdict as Out, path)).toBe(text(cap));
    expect(r.cut).toBeUndefined();
  });

  it.each(CAPS)('%s one over its cap of %i is cut to the cap, ends with the mark, and the cut is recorded', (path, cap) => {
    const r = ok(parse(at(path, text(cap + 1))));
    const kept = read(r.verdict as Out, path)!;
    expect(kept).toBe(`${text(cap - 5)}${CUT_MARK}`);
    expect(cps(kept)).toBe(cap);
    expect(r.cut).toEqual({ rationale: path === 'rationale', injectionEvidence: path === 'injectionEvidence', evidence: path === 'evidence' ? 1 : 0 });
  });

  it.each(CAPS)('%s of 65,000 code points is cut to %i, inside the output limit', (path, cap) => {
    const raw = JSON.stringify(at(path, 'y'.repeat(65_000)));
    expect(raw.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    const r = ok(parse(raw));
    expect(cps(read(r.verdict as Out, path)!)).toBe(cap);
  });

  it('agg-4 abstains on the same 301 characters, naming the rule: agg-3 and agg-4 keep their filter', () => {
    expect(parseVerdict4(JSON.stringify(at('evidence', text(301))), opts)).toEqual({ status: 'abstain', reason: 'schema', detail: 'criteria[1].evidence: 301 > 300' });
  });

  it('counts code points, as the schema does: 300 emoji fit, and a cut never splits a surrogate pair', () => {
    const emoji = '\u{1F600}';
    expect(ok(parse(at('evidence', emoji.repeat(300)))).cut).toBeUndefined();
    const r = ok(parse(at('evidence', `${'a'.repeat(294)}${emoji.repeat(10)}`)));
    const kept = r.verdict.criteria[1]!.evidence;
    expect(kept).toBe(`${'a'.repeat(294)}${emoji}${CUT_MARK}`);
    expect(kept).not.toMatch(/\p{Cs}/u);
    // A lone surrogate counts once, as Ajv's ucs2length counts it.
    expect(cutToCap(`${'a'.repeat(299)}\ud800`, 300)).toBeUndefined();
    expect(cutToCap(`${'a'.repeat(300)}\ud800`, 300)).toBe(`${'a'.repeat(295)}${CUT_MARK}`);
  });

  it('the rationale takes the lower of the schema cap and the policy cap, in code points', () => {
    const r = ok(parse(at('rationale', '\u{1F600}'.repeat(150)), { rationaleMaxChars: 120 }));
    expect(r.verdict.rationale).toBe(`${'\u{1F600}'.repeat(115)}${CUT_MARK}`);
    // agg-4 counted the policy cap in UTF-16 units: 150 emoji are 300 units, over a cap of 200 there.
    expect(ok(parse(at('rationale', '\u{1F600}'.repeat(150)), { rationaleMaxChars: 200 })).cut).toBeUndefined();
    expect(parseVerdict4(JSON.stringify(at('rationale', '\u{1F600}'.repeat(150))), { ...opts, rationaleMaxChars: 200 }).status).toBe('abstain');
    // A policy cap above the schema's still cuts at 600.
    expect(cps(ok(parse(at('rationale', text(900)), { rationaleMaxChars: 2000 })).verdict.rationale)).toBe(600);
  });

  it('a cap too small for the mark keeps its first code points without one', () => {
    expect(cutToCap('abcdefgh', 3)).toBe('abc');
    expect(cutToCap('abcdefgh', 0)).toBe('');
    expect(ok(parse(at('rationale', 'abcdefgh'), { rationaleMaxChars: 3 })).verdict.rationale).toBe('abc');
  });

  it('cuts every field that is over, and counts each criterion once', () => {
    const v = base();
    v.criteria = IDS.map((id) => ({ id, score: 3, evidence: text(400) }));
    v.injectionEvidence = text(310);
    v.rationale = text(700);
    const r = ok(parse(v));
    expect(r.cut).toEqual({ rationale: true, injectionEvidence: true, evidence: 3 });
    expect(cutReason('claude-opus-5-5', r.cut!)).toBe('judge claude-opus-5-5 free text cut to its cap (rationale; injectionEvidence; evidence of 3 criteria)');
    expect(cutReason('j', { rationale: false, injectionEvidence: false, evidence: 1 })).toBe('judge j free text cut to its cap (evidence of 1 criterion)');
  });

  it('a judge that writes the mark itself, with nothing over a cap, records no cut', () => {
    const r = ok(parse(at('rationale', `It stops here ${CUT_MARK}`)));
    expect(r.verdict.rationale).toBe(`It stops here ${CUT_MARK}`);
    expect(r.cut).toBeUndefined();
  });

  it('a bidirectional control before the cut stays as it would in an uncut field: the cut adds the mark and nothing else', () => {
    const rlo = '‮';
    const head = `${'a'.repeat(10)}${rlo}${'b'.repeat(400)}`;
    const cut = ok(parse(at('evidence', head))).verdict.criteria[1]!.evidence;
    const uncut = ok(parse(at('evidence', head.slice(0, 295)))).verdict.criteria[1]!.evidence;
    expect(cut).toBe(`${uncut}${CUT_MARK}`);
  });
});

describe('agg-5: every other fault still abstains, with the rule PR 824 names', () => {
  it.each([
    ['a wrong key beside an overlong evidence', { ...at('evidence', text(400)), approved: true }, 'top level: 1 unexpected key'],
    ['an extra criterion key', { ...base(), criteria: IDS.map((id) => ({ id, score: 4, evidence: text(350), weight: 1 })) }, 'criteria[0]: 1 unexpected key'],
    ['a score of 5 beside an overlong rationale', { ...at('rationale', text(900)), criteria: IDS.map((id) => ({ id, score: 5, evidence: 'ok' })) }, 'criteria[0].score: outside 0 to 4'],
    ['a score of -1', { ...base(), criteria: IDS.map((id) => ({ id, score: -1, evidence: 'ok' })) }, 'criteria[0].score: outside 0 to 4'],
    ['a score of 3.5', { ...base(), criteria: IDS.map((id) => ({ id, score: 3.5, evidence: 'ok' })) }, 'criteria[0].score: not an integer'],
    ['an overall of "accept"', { ...at('evidence', text(301)), overall: 'accept' }, 'overall: not pass, fail or abstain'],
    ['injectionSuspected as a string', { ...base(), injectionSuspected: 'no' }, 'injectionSuspected: string, not a boolean'],
    ['13 criteria (the array is never trimmed)', { ...base(), criteria: Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, score: 4, evidence: text(301) })) }, 'criteria: 13 items > 12'],
    ['a missing rationale', (() => { const { rationale: _r, ...v } = base(); return v; })(), 'rationale: missing'], // eslint-disable-line @typescript-eslint/no-unused-vars
  ])('%s abstains with "%s"', (_n, v, detail) => {
    expect(parse(v)).toEqual({ status: 'abstain', reason: 'schema', detail });
  });

  it.each(CAPS.map(([p]) => p))('a number, an object, an array or null at %s abstains: only a string is cut', (path) => {
    for (const value of [12345, { text: text(400) }, [text(400)], null]) {
      const r = parse(at(path, value));
      expect(r.status).toBe('abstain');
      if (r.status === 'abstain') expect(r.detail).toMatch(/not a string$/);
    }
  });

  it('a criterion id outside the rubric abstains, cut or not', () => {
    const v = at('evidence', text(400));
    v.criteria[0]!.id = 'other';
    expect(parse(v)).toEqual({ status: 'abstain', reason: 'criteria_mismatch', detail: 'criterion ids differ from the rubric' });
  });

  it('not JSON, a fence and an output over the limit abstain as before', () => {
    expect(parse(`\`\`\`json\n${JSON.stringify(at('rationale', text(900)))}\n\`\`\``).status).toBe('abstain');
    expect(parse('x'.repeat(MAX_OUTPUT_CHARS + 1))).toEqual({ status: 'abstain', reason: 'too_long', detail: `output is ${MAX_OUTPUT_CHARS + 1} characters` });
  });
});

describe('agg-5: the canary and URL scans', () => {
  const c = NONCES.canary;
  it.each(CAPS)('the canary only past the cut of %s still abstains, plain and in base64', (path, cap) => {
    expect(parse(at(path, `${text(cap + 20)} ${c}`))).toMatchObject({ status: 'abstain', reason: 'canary_echo' });
    expect(parse(at(path, `${text(cap + 20)} ${Buffer.from(`leak ${c}`).toString('base64')}`))).toMatchObject({ status: 'abstain', reason: 'canary_echo' });
  });

  it('a URL only past the cut is discarded with the tail: the verdict counts and the record holds no URL', () => {
    for (const [path, cap] of CAPS) {
      const r = ok(parse(at(path, `${text(cap + 10)} https://evil.example/x?d=secret`)));
      expect(JSON.stringify(r.verdict)).not.toMatch(/evil|https?:/);
    }
  });

  it('a URL across the cut: in the rationale or injectionEvidence it abstains, in evidence it is replaced', () => {
    // The cut keeps "https://evil.ex": the scheme stays, so the URL step sees it.
    const across = (cap: number) => `${text(cap - 21)} https://evil.example/abcdef`;
    expect(parse(at('rationale', across(600)))).toMatchObject({ status: 'abstain', reason: 'url' });
    expect(parse(at('injectionEvidence', across(300)))).toMatchObject({ status: 'abstain', reason: 'url' });
    const r = ok(parse(at('evidence', across(300))));
    expect(r.verdict.criteria[1]!.evidence).not.toMatch(/https?:|evil/);
    expect(r.redactedUrls).toBe(1);
    expect(cps(r.verdict.criteria[1]!.evidence)).toBeLessThanOrEqual(300);
  });

  it('a cut that severs the scheme leaves no working link: the verdict counts', () => {
    // The cut keeps "https:" and drops "//evil.example/abcdef".
    const r = ok(parse(at('rationale', `${text(588)} https://evil.example/abcdef`)));
    expect(r.verdict.rationale.endsWith(` https:${CUT_MARK}`)).toBe(true);
    expect(r.verdict.rationale).not.toMatch(/\/\/|evil/);
  });

  it('a redaction that lengthens evidence past its cap is cut again, and counted once', () => {
    const r = ok(parse(at('evidence', `${'a'.repeat(290)} x.io/a`)));
    expect(r.verdict.criteria[1]!.evidence).toBe(`${'a'.repeat(290)} [lin${CUT_MARK}`);
    expect(r.cut).toEqual({ rationale: false, injectionEvidence: false, evidence: 1 });
  });
});

describe('agg-5: the cut never touches a score, an id, a boolean or overall (property)', () => {
  const free = fc.string({ unit: 'binary', maxLength: 700 });
  const out = fc.record({
    criteria: fc.uniqueArray(fc.record({ id: fc.constantFrom(...IDS), score: fc.integer({ min: 0, max: 4 }), evidence: free }), { selector: (c) => c.id, minLength: IDS.length, maxLength: IDS.length }),
    overall: fc.constantFrom('pass', 'fail', 'abstain'),
    injectionSuspected: fc.boolean(),
    injectionEvidence: free,
    rationale: free,
  });
  it('for any output, the filter keeps the structured fields as written, and each free text is the whole text or its cut', () => {
    fc.assert(
      fc.property(out, fc.integer({ min: 1, max: 600 }), (v, cap) => {
        const r = parse(v, { rationaleMaxChars: cap });
        if (r.status === 'abstain') return ['url', 'canary_echo'].includes(r.reason);
        const pick = (x: typeof v) => ({ ids: x.criteria.map((k) => k.id), scores: x.criteria.map((k) => k.score), overall: x.overall, injectionSuspected: x.injectionSuspected });
        expect(pick(r.verdict as typeof v)).toEqual(pick(v));
        const same = (a: string, b: string, max: number) => a === b || a === cutToCap(b, max);
        expect(same(r.verdict.rationale, v.rationale, Math.min(600, cap))).toBe(true);
        expect(same(r.verdict.injectionEvidence!, v.injectionEvidence, 300)).toBe(true);
        r.verdict.criteria.forEach((k, i) => {
          if (r.redactedUrls === 0) expect(same(k.evidence, v.criteria[i]!.evidence, 300)).toBe(true);
          expect(cps(k.evidence)).toBeLessThanOrEqual(300);
        });
        return true;
      }),
      { numRuns: 300, seed: 105 },
    );
  });
});
