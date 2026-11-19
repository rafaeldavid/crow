// T-570: the judgment line of the roadmap's demo stage. "No judge fault re-rolls a panel or yields a one-family
// decision." Each fault class below hits every seat of one model family (a whole family down, or every judge of one
// family abstaining), and the pipeline must then:
//   - call only the seated judges, each at most twice (one retry on a transport error), and no substitute seat;
//   - count the faulty seats as abstentions, never as votes (passCount, failCount and validCount leave them out);
//   - decide nothing on verdicts from one family: the case escalates, and D27's default rules take it from there.
// Two defects are recorded here as today's behaviour, with the fix that changes them (T-570's second PR):
//   - aggregation agg-3 signs a reject on one family's verdicts when the faulty family holds one seat of three and its
//     fault is not a filter abstention (ONE_FAMILY_REJECT_AT_AGG3);
//   - an answer whose text is not a string makes runPipeline throw, so the adjudicator retries and calls the panel again.
import { describe, expect, it } from 'vitest';
import { ADJUDICATOR, delivery, fakeUnwrap, GOOD_CSV, NONCES, POLICY, RUBRIC, seal, utf8 } from './_helpers.js';
import { intake } from './intake.js';
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

/** The faults after which agg-3 signs a one-family reject (the defect); the filter abstentions escalate already. */
const ONE_FAMILY_REJECT_AT_AGG3 = new Set(['times out', 'answers HTTP 503 twice', 'answers HTTP 400', 'throws (network error)', 'returns no text', 'returns a schema-valid abstain']);

async function run(provider: JudgeProvider, over: Partial<PipelineInput> = {}) {
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

      it.each(FAULTS)('%s: the other family failing unanimously escalates, and the faulty seats count as no vote', async (name, fault) => {
        const f = faulty(family, fault, 'fail');
        const draft = await run(f.provider);
        const faulted = SEATS.filter((s) => s.family === family).length;
        // Known defect at agg-3: with one gpt seat down, the two claude fails reach minValid and reject.
        const atAgg3 = faulted === 1 && ONE_FAMILY_REJECT_AT_AGG3.has(name) ? 'reject' : 'escalate';
        expect(draft.aggregate.decision).toBe(atAgg3);
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

describe('T-570: an answer whose text is not a string (red team H1)', () => {
  // Known defect: an OpenAI-compatible host can answer content null, an array or a number, which live.ts passes on as
  // an ok answer. parseVerdict then throws and runPipeline rejects, so the adjudicator records nothing and calls the
  // whole panel again on its next pass. The fix in T-570's second PR turns the seat into an error, no vote.
  it.each([['null', null], ['an array', [{ type: 'text', text: 'x' }]], ['a number', 7]] as const)('text %s: runPipeline throws today', async (_name, text) => {
    const provider: JudgeProvider = { complete: async (req) => (req.judgeId === 'gpt-a' ? ({ kind: 'ok', text } as unknown as JudgeResponse) : answer('pass')) };
    await expect(run(provider)).rejects.toThrow();
  });
});
