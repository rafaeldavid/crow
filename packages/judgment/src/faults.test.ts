// T-570: the judgment line of the roadmap's demo stage. "No judge fault re-rolls a panel or yields a one-family
// decision." Each fault class below hits every seat of one model family (a whole family down, or every judge of one
// family abstaining), and the pipeline must then:
//   - call only the seated judges, each at most twice (one retry on a transport error), and no substitute seat;
//   - count the faulty seats as abstentions, never as votes (passCount, failCount and validCount leave them out);
//   - decide nothing on verdicts from one family: the case escalates, and D27's default rules take it from there.
// These run under this build's newest aggregation, agg-4 (ADR-0043). Aggregation agg-3, kept for the deals bound to it,
// still signs a reject on one family's verdicts when the faulty family holds one seat of three and its fault is not a
// filter abstention (ONE_FAMILY_REJECT_AT_AGG3); the last describe block holds it there.
import { canonicalJson, type JudgeVerdict } from '@holdback/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ADJUDICATOR, delivery, fakeUnwrap, GOOD_CSV, NONCES, POLICY, RUBRIC, seal, utf8 } from './_helpers.js';
import { intake } from './intake.js';
import { KEPT, NEWEST_VERSIONS, type KeptTable } from './kept.js';
import { runPipeline, type JudgeProvider, type JudgeRequest, type JudgeResponse, type PanelSeat, type PipelineInput } from './pipeline.js';
import type { JudgmentAcceptance } from './terms.js';

// Two seats from one family and one from another: the smallest panel the policy allows (3 seats, 2 families) in
// which a family's fault leaves the other family's verdicts able to reach the minimum of valid verdicts.
const SEATS: PanelSeat[] = [
  { judgeId: 'claude-a', provider: 'anthropic', family: 'claude', model: 'claude-a-model-20260601' },
  { judgeId: 'claude-b', provider: 'anthropic', family: 'claude', model: 'claude-b-model-20260601' },
  { judgeId: 'gpt-a', provider: 'openai-compatible', family: 'gpt', model: 'gpt-a-model-20260601' },
];

const ACCEPTANCE: JudgmentAcceptance = {
  deterministicChecks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'name', 'email', 'signup_date', 'email_valid'] }],
  rubric: RUBRIC,
};

const verdictText = (overall: 'pass' | 'fail' | 'abstain', extra: Record<string, unknown> = {}) =>
  JSON.stringify({ criteria: RUBRIC.criteria.map((c) => ({ id: c.id, score: overall === 'pass' ? 4 : 0, evidence: 'from the rows shown' })), overall, injectionSuspected: false, rationale: 'r', ...extra });
const answer = (overall: 'pass' | 'fail' | 'abstain'): JudgeResponse => ({ kind: 'ok', text: verdictText(overall) });

/** The fault classes of T-570, as the provider returns them to the pipeline. */
const FAULTS: Array<[string, (calls: number) => JudgeResponse | Promise<JudgeResponse>]> = [
  // The adjudicator's withTimeout resolves a judge that does not answer in time to { kind: 'timeout' } (providers/timeout.ts).
  ['times out', () => ({ kind: 'timeout' })],
  // live.ts: 429 and 5xx are transport errors (retried once); any other non-2xx is not retried.
  ['answers HTTP 503 twice', () => ({ kind: 'error', transport: true, detail: 'HTTP 503' })],
  ['answers HTTP 400', () => ({ kind: 'error', transport: false, detail: 'HTTP 400' })],
  ['throws (network error)', () => Promise.reject(new Error('socket hang up'))],
  // live.ts: a 200 with no text (a reasoning model that spent its output cap) is a non-transport error.
  ['returns no text', () => ({ kind: 'error', transport: false, detail: 'no text in the response' })],
  ['returns output that fails judge-verdict.schema.json', () => ({ kind: 'ok', text: verdictText('pass', { overall: 'maybe' }) })],
  ['returns a verdict missing a criterion', () => ({ kind: 'ok', text: JSON.stringify({ criteria: [], overall: 'pass', injectionSuspected: false, rationale: 'r' }) })],
  ['refuses in prose', () => ({ kind: 'ok', text: "I can't help with evaluating this content." })],
  ['returns a schema-valid abstain', () => answer('abstain')],
];

/** The faults after which agg-3 signs a one-family reject (the defect agg-4 fixes); the filter abstentions escalate already. */
const ONE_FAMILY_REJECT_AT_AGG3 = new Set(['times out', 'answers HTTP 503 twice', 'answers HTTP 400', 'throws (network error)', 'returns no text', 'returns a schema-valid abstain']);

async function run(provider: JudgeProvider, over: Partial<PipelineInput> = {}, text = GOOD_CSV) {
  const pt = utf8(text);
  const ct = seal(pt);
  const intaken = await intake({ delivery: delivery(pt, ct), ciphertext: ct, recipient: ADJUDICATOR, unwrapKey: fakeUnwrap });
  if (!intaken.ok) throw new Error(intaken.error.detail);
  const r = await runPipeline({
    intake: intaken.value,
    acceptance: ACCEPTANCE,
    deliverable: { description: 'Clean customers.csv.' },
    policy: POLICY,
    seats: SEATS,
    provider,
    nonces: (_s, i) => ({ boundary: NONCES.boundary.replace(/.$/, String(i)), canary: NONCES.canary.replace(/.$/, String(i)) }),
    ...over,
  });
  if (!r.ok) throw new Error(r.error.detail);
  return r.value;
}

/** Every seat of `family` hits the fault; the other seats answer `others`. Records every request. */
function faulty(family: string, fault: (calls: number) => JudgeResponse | Promise<JudgeResponse>, others: 'pass' | 'fail') {
  const calls: JudgeRequest[] = [];
  const provider: JudgeProvider = {
    async complete(req) {
      calls.push(req);
      const seat = SEATS.find((s) => s.judgeId === req.judgeId)!;
      return seat.family === family ? fault(calls.filter((c) => c.judgeId === req.judgeId).length) : answer(others);
    },
  };
  return { provider, calls };
}

describe('T-570: a fault in one whole family never yields a one-family decision', () => {
  for (const family of ['gpt', 'claude']) {
    describe(`every ${family} seat`, () => {
      it.each(FAULTS)('%s: the other family passing unanimously escalates, and the faulty seats count as no vote', async (_name, fault) => {
        const f = faulty(family, fault, 'pass');
        const draft = await run(f.provider);
        const faulted = SEATS.filter((s) => s.family === family).length;
        expect(draft.aggregate.decision).toBe('escalate');
        expect(draft.aggregate.passCount).toBe(SEATS.length - faulted);
        expect(draft.aggregate.failCount).toBe(0);
        expect(draft.aggregate.validCount).toBe(SEATS.length - faulted);
        expect(draft.panel.members.filter((m) => m.family === family).every((m) => m.status !== 'ok')).toBe(true);
      });

      it.each(FAULTS)('%s: the other family failing unanimously escalates, and the faulty seats count as no vote', async (_name, fault) => {
        const f = faulty(family, fault, 'fail');
        const draft = await run(f.provider);
        const faulted = SEATS.filter((s) => s.family === family).length;
        expect(draft.aggregate.decision).toBe('escalate');
        expect(draft.aggregate.passCount).toBe(0);
        expect(draft.aggregate.failCount).toBe(SEATS.length - faulted);
        expect(draft.aggregate.validCount).toBe(SEATS.length - faulted);
      });

      it.each(FAULTS)('%s: only the seated judges are called, at most twice each, and no seat is replaced', async (_name, fault) => {
        const f = faulty(family, fault, 'pass');
        const draft = await run(f.provider);
        const seated = SEATS.map((s) => s.judgeId);
        expect(new Set(f.calls.map((c) => c.judgeId))).toEqual(new Set(seated));
        for (const id of seated) expect(f.calls.filter((c) => c.judgeId === id).length).toBeLessThanOrEqual(2);
        // A retry repeats the same request: same model, same prompt, same sampling parameters.
        for (const id of seated) {
          const mine = f.calls.filter((c) => c.judgeId === id);
          for (const c of mine) expect(c).toEqual(mine[0]);
        }
        expect(draft.panel.members.map((m) => m.judgeId)).toEqual(seated);
      });
    });
  }
});

describe('T-570: no seat\'s output aborts the panel (red team H1)', () => {
  // An OpenAI-compatible host can answer content null, an array or a number, which live.ts passes on as an ok answer.
  // Before this fix parseVerdict threw, runPipeline rejected, and the adjudicator called the whole panel again on its
  // next pass. Each malformed shape is now an error for that seat: no vote, and the panel still returns.
  // Each malformed shape with the status its seat gets: an error (the provider gave no usable answer) or a filter
  // abstention (a string the verdict filter refuses).
  const SHAPES: Array<[string, unknown, 'error' | 'abstain']> = [
    ['text null', { kind: 'ok', text: null }, 'error'],
    ['text an array', { kind: 'ok', text: [{ type: 'text', text: 'x' }] }, 'error'],
    ['text a number', { kind: 'ok', text: 7 }, 'error'],
    ['text an object', { kind: 'ok', text: { overall: 'pass' } }, 'error'],
    ['no response object', undefined, 'error'],
    ['an unknown kind', { kind: 'maybe' }, 'error'],
    ['a string that is not a verdict, with a fractional latency', { kind: 'ok', text: 'not json', latencyMs: 1.5 }, 'abstain'],
  ];
  it.each(SHAPES)('%s: the seat is %s, never a vote, and every judge is called once', async (_name, shape, status) => {
    const calls: string[] = [];
    const provider: JudgeProvider = { complete: async (req) => (calls.push(req.judgeId), req.judgeId === 'gpt-a' ? (shape as JudgeResponse) : answer('pass')) };
    const draft = await run(provider);
    const gpt = draft.panel.members.find((m) => m.judgeId === 'gpt-a')!;
    expect(gpt.status).toBe(status);
    expect(gpt.verdict).toBeUndefined();
    expect(gpt.latencyMs === undefined || Number.isSafeInteger(gpt.latencyMs)).toBe(true);
    expect(draft.aggregate.passCount).toBe(2);
    expect(draft.aggregate.decision).toBe('escalate');
    expect(calls.sort()).toEqual(['claude-a', 'claude-b', 'gpt-a']);
    // The draft canonicalizes: the adjudicator can hash the record it signs.
    expect(() => canonicalJson(draft)).not.toThrow();
  });

  it('a valid pass with a fractional latency still counts as a vote, without the latency', async () => {
    const provider: JudgeProvider = { complete: async () => ({ ...answer('pass'), latencyMs: 1.5 }) as JudgeResponse };
    const draft = await run(provider);
    expect(draft.panel.members.every((m) => m.status === 'ok' && m.latencyMs === undefined)).toBe(true);
    expect(draft.aggregate.passCount).toBe(3);
  });

  // A lone UTF-16 surrogate, from the judge or from cutting redacted evidence at 300 units, used to pass the verdict
  // filter and then make the record hash throw. The pipeline now returns a well-formed draft: the character becomes
  // U+FFFD and the verdict stays a vote.
  it.each([
    ['a lone surrogate the judge wrote in its rationale', () => verdictText('pass', { rationale: 'r \ud800' })],
    ['URL redaction that cuts an emoji in half', () => JSON.stringify({ criteria: RUBRIC.criteria.map((c) => ({ id: c.id, score: 4, evidence: `www.ab ${'a'.repeat(284)}\u{1F600}` })), overall: 'pass', injectionSuspected: false, rationale: 'r' })],
  ])('%s: the verdict stays a vote, and the draft canonicalizes (agg-4)', async (_name, text) => {
    const provider: JudgeProvider = { complete: async (req) => (req.judgeId === 'gpt-a' ? { kind: 'ok', text: text() } : answer('pass')) };
    // agg-4's filter cuts redacted evidence at 300 UTF-16 units; agg-5 cuts on a code point (the next test).
    const draft = await run(provider, { versions: { ...NEWEST_VERSIONS, aggregationVersion: 'agg-4' } });
    const gpt = draft.panel.members.find((m) => m.judgeId === 'gpt-a')!;
    expect(gpt.status).toBe('ok');
    expect(JSON.stringify(gpt.verdict)).toContain('\uFFFD');
    expect(draft.aggregate.passCount).toBe(3);
    expect(() => canonicalJson(draft)).not.toThrow();
  });

  // agg-5 counts code points: the same evidence is 300 code points after redaction and stays whole; ten more letters
  // put it over, and the cut keeps 295 code points and the mark.
  it.each([
    [284, false],
    [294, true],
  ])('agg-5: URL redaction with %i letters and an emoji never leaves half an emoji (cut: %s)', async (letters, cut) => {
    const text = JSON.stringify({ criteria: RUBRIC.criteria.map((c) => ({ id: c.id, score: 4, evidence: `www.ab ${'a'.repeat(letters)}\u{1F600}` })), overall: 'pass', injectionSuspected: false, rationale: 'r' });
    const provider: JudgeProvider = { complete: async (req) => (req.judgeId === 'gpt-a' ? { kind: 'ok', text } : answer('pass')) };
    const draft = await run(provider);
    const gpt = draft.panel.members.find((m) => m.judgeId === 'gpt-a')!;
    expect(gpt.status).toBe('ok');
    expect(JSON.stringify(gpt.verdict)).not.toMatch(/\uFFFD|\p{Cs}/u);
    for (const c of (gpt.verdict as JudgeVerdict).criteria) {
      expect([...c.evidence]).toHaveLength(300);
      expect(c.evidence.endsWith(cut ? '[cut]' : '\u{1F600}')).toBe(true);
    }
    expect(draft.aggregate.reasons.some((r) => r === `judge gpt-a free text cut to its cap (evidence of ${RUBRIC.criteria.length} criteria)`)).toBe(cut);
    expect(draft.aggregate.passCount).toBe(3);
    expect(() => canonicalJson(draft)).not.toThrow();
  });

  it('a delivered CSV header that leaves half an emoji in the check detail: the required check rejects, and the draft canonicalizes', async () => {
    // "columns are [" is 13 units, so 283 more put the emoji's high surrogate at the last unit the detail keeps.
    const csv = [`${'a'.repeat(283)}\u{1F600},name,email,signup_date,email_valid`, ...GOOD_CSV.split('\n').slice(1)].join('\n');
    const calls: string[] = [];
    const draft = await run({ complete: async (req) => (calls.push(req.judgeId), answer('pass')) }, {}, csv);
    expect(draft.aggregate.decision).toBe('reject');
    expect(calls).toEqual([]);
    // The check cuts on a code point now, so the detail ends before the emoji.
    expect(draft.deterministic[0]!.detail).not.toMatch(/\p{Cs}/u);
    expect(() => canonicalJson(draft)).not.toThrow();
  });

  it('a delivered JSON key written as a lone surrogate escape, copied into a check detail: the draft canonicalizes', async () => {
    const text = '{"ok":1,"\\ud83d":2}';
    const pt = utf8(text);
    const ct = seal(pt);
    const intaken = await intake({ delivery: delivery(pt, ct, { plaintextMime: 'application/json' }), ciphertext: ct, recipient: ADJUDICATOR, unwrapKey: fakeUnwrap });
    if (!intaken.ok) throw new Error(intaken.error.detail);
    const r = await runPipeline({
      intake: intaken.value,
      acceptance: { deterministicChecks: [{ id: 'shape', type: 'json_schema', required: true, schema: { type: 'object', properties: { ok: { type: 'integer' } }, additionalProperties: false } }], rubric: RUBRIC },
      deliverable: { description: 'A JSON object.' },
      policy: POLICY,
      seats: SEATS,
      provider: { complete: async () => answer('pass') },
      nonces: (_s, i) => ({ boundary: NONCES.boundary.replace(/.$/, String(i)), canary: NONCES.canary.replace(/.$/, String(i)) }),
    });
    if (!r.ok) throw new Error(r.error.detail);
    expect(r.value.aggregate.decision).toBe('reject');
    expect(() => canonicalJson(r.value)).not.toThrow();
  });

  it('a seat whose criteria order is refused stops the turn before any judge is called', async () => {
    const calls: string[] = [];
    const provider: JudgeProvider = { complete: async (req) => (calls.push(req.judgeId), answer('pass')) };
    const pt = utf8(GOOD_CSV);
    const ct = seal(pt);
    const intaken = await intake({ delivery: delivery(pt, ct), ciphertext: ct, recipient: ADJUDICATOR, unwrapKey: fakeUnwrap });
    if (!intaken.ok) throw new Error(intaken.error.detail);
    const r = await runPipeline({
      intake: intaken.value,
      acceptance: ACCEPTANCE,
      deliverable: { description: 'Clean customers.csv.' },
      policy: POLICY,
      seats: SEATS,
      provider,
      nonces: (_s, i) => ({ boundary: NONCES.boundary.replace(/.$/, String(i)), canary: NONCES.canary.replace(/.$/, String(i)) }),
      criteriaFor: (_s, i) => (i === 2 ? RUBRIC.criteria.slice(1) : RUBRIC.criteria),
    });
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('a verdict filter that throws on one seat makes that seat an error, and the panel still returns', async () => {
    const agg = KEPT.aggregations.get(NEWEST_VERSIONS.aggregationVersion)!;
    const kept: KeptTable = { ...KEPT, aggregations: new Map([[NEWEST_VERSIONS.aggregationVersion, { ...agg, parseVerdict: (raw, o) => (raw.includes('THROW') ? (() => { throw new RangeError('boom'); })() : agg.parseVerdict(raw, o)) }]]) };
    const provider: JudgeProvider = { complete: async (req) => (req.judgeId === 'gpt-a' ? { kind: 'ok', text: 'THROW' } : answer('fail')) };
    const draft = await run(provider, { kept });
    expect(draft.panel.members.find((m) => m.judgeId === 'gpt-a')!.status).toBe('error');
    expect(draft.aggregate.validCount).toBe(2);
  });
});

describe('T-570: for any delivered text, runPipeline never throws and its draft always hashes (property)', () => {
  // Deliverables are untrusted. Lone surrogates cannot arrive as raw bytes (the delivery is UTF-8), but they come back
  // from JSON escapes, and a cut at a fixed length can split a pair that arrived whole. Each run feeds runPipeline a CSV
  // or a JSON document built from arbitrary code units, with an emoji placed around the 297-unit cut of a check detail,
  // and asserts the result is a value or a refusal, never a throw, and that canonical JSON (RFC 8785) accepts it.
  // fast-check prints the seed and the path of any failure, so a failure can be replayed exactly.
  const SEED = 5702;
  const judges: JudgeProvider = { complete: async (req) => (req.judgeId === 'gpt-a' ? answer('fail') : answer('pass')) };
  const unit = fc.oneof(fc.string({ unit: 'binary', maxLength: 40 }), fc.constantFrom('\u{1F600}', '\ud83d', '\ude00', '\u0000', '\u001b', '​', '‮', ',', '"', '\n'));
  const text = fc.array(unit, { maxLength: 30 }).map((xs) => xs.join(''));
  // An emoji whose first half lands at, just before or just after the last unit a 300-unit detail keeps.
  const aroundCut = fc.record({ pad: fc.integer({ min: 270, max: 300 }), tail: text }).map(({ pad, tail }) => `${'a'.repeat(pad)}\u{1F600}${tail}`);
  const long = fc.integer({ min: 1000, max: 20000 }).map((n) => '\u{1F600}x'.repeat(n));

  async function judge(mime: 'text/csv' | 'application/json', body: string, acceptance: JudgmentAcceptance) {
    const pt = utf8(body);
    const ct = seal(pt);
    const intaken = await intake({ delivery: delivery(pt, ct, { plaintextMime: mime }), ciphertext: ct, recipient: ADJUDICATOR, unwrapKey: fakeUnwrap });
    if (!intaken.ok) return null;
    return runPipeline({
      intake: intaken.value,
      acceptance,
      deliverable: { description: 'Untrusted work.' },
      policy: POLICY,
      seats: SEATS,
      provider: judges,
      nonces: (_s, i) => ({ boundary: NONCES.boundary.replace(/.$/, String(i)), canary: NONCES.canary.replace(/.$/, String(i)) }),
    });
  }

  it('CSV: an arbitrary header and cells, with required and optional checks', async () => {
    const csvChecks: JudgmentAcceptance = {
      deterministicChecks: [
        { id: 'cols', type: 'csv_columns_exact', required: false, columns: ['customer_id', 'name', 'email', 'signup_date', 'email_valid'] },
        { id: 'emails', type: 'regex_match_rate_min', required: false, column: 'email', pattern: '^[^@\\s]+@[^@\\s]+$', minBps: 9700 },
      ],
      rubric: RUBRIC,
    };
    const required: JudgmentAcceptance = { ...csvChecks, deterministicChecks: csvChecks.deterministicChecks.map((c) => ({ ...c, required: true })) };
    await fc.assert(
      fc.asyncProperty(fc.oneof(aroundCut, text, long), fc.array(text, { maxLength: 5 }), fc.boolean(), async (header, rows, req) => {
        const r = await judge('text/csv', [header, ...rows].join('\n'), req ? required : csvChecks);
        if (r?.ok) expect(() => canonicalJson(r.value)).not.toThrow();
      }),
      { seed: SEED, numRuns: 150 },
    );
  });

  it('JSON: arbitrary keys and values, lone surrogates included, against a closed schema', async () => {
    const closed: JudgmentAcceptance = {
      deterministicChecks: [{ id: 'shape', type: 'json_schema', required: false, schema: { type: 'object', properties: { ok: { type: 'integer' } }, additionalProperties: false } }],
      rubric: RUBRIC,
    };
    const required: JudgmentAcceptance = { ...closed, deterministicChecks: closed.deterministicChecks.map((c) => ({ ...c, required: true })) };
    await fc.assert(
      fc.asyncProperty(fc.array(fc.tuple(fc.oneof(aroundCut, text), fc.oneof(text, fc.integer())), { maxLength: 6 }), fc.boolean(), async (entries, req) => {
        // JSON.stringify writes a lone surrogate as an escape, which JSON.parse turns back into the lone surrogate.
        const r = await judge('application/json', JSON.stringify(Object.fromEntries([['ok', 1], ...entries])), req ? required : closed);
        if (r?.ok) expect(() => canonicalJson(r.value)).not.toThrow();
      }),
      { seed: SEED, numRuns: 150 },
    );
  });
});

describe('T-570: a deal bound to agg-3 keeps the rule it bound (ADR-0036)', () => {
  const bound = (aggregationVersion: string) => ({ ...NEWEST_VERSIONS, aggregationVersion });
  it.each(FAULTS.filter(([name]) => ONE_FAMILY_REJECT_AT_AGG3.has(name)))('%s on the one gpt seat: agg-3 signs the one-family reject, agg-4 escalates', async (_name, fault) => {
    const under3 = await run(faulty('gpt', fault, 'fail').provider, { versions: bound('agg-3') });
    const under4 = await run(faulty('gpt', fault, 'fail').provider, { versions: bound('agg-4') });
    expect(under3.aggregate.decision).toBe('reject');
    expect(under4.aggregate.decision).toBe('escalate');
    expect(under4.aggregate.reasons).toEqual(['2 valid verdicts from 1 model family; a decision needs verdicts from 2']);
  });
});
