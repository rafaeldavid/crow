// Partner C's refund, 2026-11-25 (commitment 0x59f42180...): an honest kit, every check passed, every judge that
// answered passed it, and four of eight seats over the two panels abstained on "output rejected by a filter
// (schema)". The verdict schema caps each criterion's evidence at 300 characters and the rationale at 600, and the
// hard rule keeps that filter: output that fails the schema abstains. Template pair 1 states the caps only as
// `string<=300` and `string<=600` inside a type sketch, and a rubric whose criteria list many items (roles, sizes,
// contrast pairs, CSS tokens) draws evidence up to the cap: the live DeepSeek flash verdict wrote 288 of 300.
// On the appeal after an escalation one lost seat turns a unanimous pass into a reject (D27a).
//
// Template pair 2 keeps the filter, the caps and every other line of pair 1, and states the limits in words with
// targets well under them, so a judge that overshoots its target still fits the schema.
import { describe, expect, it } from 'vitest';
import { ADJUDICATOR, criterion, delivery, fakeUnwrap, NONCES, POLICY, seal, utf8 } from './_helpers.js';
import { intake } from './intake.js';
import { KEPT, NEWEST_VERSIONS } from './kept.js';
import { runPipeline, type JudgeProvider, type JudgeRequest, type PanelSeat } from './pipeline.js';
import { APPEAL_PROMPT_TEMPLATE, APPEAL_PROMPT_TEMPLATE_2, buildPrompt, PROMPT_TEMPLATE, PROMPT_TEMPLATE_2, TEMPLATE_PAIR, TEMPLATE_PAIR_2 } from './prompt.js';
import { UntrustedData } from './untrusted.js';
import { MAX_OUTPUT_CHARS, parseVerdict } from './verdict.js';
import type { JudgmentRubric } from './terms.js';

const IDS = ['fit', 'coherent', 'distinct', 'usable'];
const long = (n: number) => 'Roles, sizes, contrast pairs and CSS tokens are stated and match. '.repeat(10).slice(0, n);
const verdictOf = (evidence: string, over: Record<string, unknown> = {}) => ({
  criteria: IDS.map((id) => ({ id, score: 4, evidence })),
  overall: 'pass',
  injectionSuspected: false,
  rationale: 'A complete, consistent kit.',
  ...over,
});

describe('the filter stays: output that fails the verdict schema abstains (hard rule), and names its rule', () => {
  const opts = { criterionIds: IDS, canary: NONCES.canary, rationaleMaxChars: 600 };
  const third = (evidence: string) => verdictOf('ok', { criteria: IDS.map((id, i) => ({ id, score: 4, evidence: i === 2 ? evidence : 'ok' })) });
  it('evidence of 300 characters passes', () => expect(parseVerdict(JSON.stringify(third(long(300))), opts).status).toBe('ok'));
  it('evidence of 301 characters abstains, naming the field, the length and the limit', () => {
    expect(parseVerdict(JSON.stringify(third(long(301))), opts)).toEqual({ status: 'abstain', reason: 'schema', detail: 'criteria[2].evidence: 301 > 300' });
  });
  it('a rationale of 600 characters passes', () => expect(parseVerdict(JSON.stringify(verdictOf('ok', { rationale: long(600) })), opts).status).toBe('ok'));
  it.each([
    ['a rationale of 601 characters', verdictOf('ok', { rationale: long(601) }), opts, 'rationale: 601 > 600'],
    ['a rationale over the policy cap', verdictOf('ok', { rationale: long(450) }), { ...opts, rationaleMaxChars: 400 }, 'rationale: 450 > 400 (the policy cap, in UTF-16 units)'],
    ['evidence far over its cap', verdictOf(long(301), { criteria: IDS.map((id) => ({ id, score: 4, evidence: 'y'.repeat(2000) })) }), opts, 'criteria[0].evidence: more than 600 > 300'],
    ['many extra keys', { ...verdictOf('ok'), ...Object.fromEntries(Array.from({ length: 42 }, (_, i) => [`k${i}`, i])) }, opts, 'top level: more than 9 unexpected keys'],
    ['injectionEvidence of 301 characters', verdictOf('ok', { injectionEvidence: long(301) }), opts, 'injectionEvidence: 301 > 300'],
    ['a score of 5', verdictOf('ok', { criteria: IDS.map((id) => ({ id, score: 5, evidence: 'ok' })) }), opts, 'criteria[0].score: outside 0 to 4'],
    ['a score of 3.5', verdictOf('ok', { criteria: IDS.map((id) => ({ id, score: 3.5, evidence: 'ok' })) }), opts, 'criteria[0].score: not an integer'],
    ['a score as a string', verdictOf('ok', { criteria: IDS.map((id) => ({ id, score: '4', evidence: 'ok' })) }), opts, 'criteria[0].score: string, not an integer'],
    ['injectionEvidence null', verdictOf('ok', { injectionEvidence: null }), opts, 'injectionEvidence: null, not a string'],
    ['an extra top-level key', verdictOf('ok', { approved: true }), opts, 'top level: 1 unexpected key'],
    ['an extra criterion key', verdictOf('ok', { criteria: IDS.map((id) => ({ id, score: 4, evidence: 'ok', weight: 30 })) }), opts, 'criteria[0]: 1 unexpected key'],
    ['a missing rationale', { criteria: IDS.map((id) => ({ id, score: 4, evidence: 'ok' })), overall: 'pass', injectionSuspected: false }, opts, 'rationale: missing'],
    ['an overall of "accept"', verdictOf('ok', { overall: 'accept' }), opts, 'overall: not pass, fail or abstain'],
    ['an array', [verdictOf('ok')], opts, 'the output is a JSON array, not an object'],
  ])('%s abstains with "%s"', (_n, v, o, detail) => {
    expect(parseVerdict(JSON.stringify(v), o)).toEqual({ status: 'abstain', reason: 'schema', detail });
  });

  it('the detail carries no text, key or value from the output', () => {
    const secret = 'SECRET-DELIVERY-QUOTE';
    const SAFE = /^[A-Za-z0-9 .,:\[\]()<>-]*$/;
    for (const v of [
      third(`${secret} ${long(320)}`),
      verdictOf('ok', { [secret]: secret }),
      verdictOf('ok', { overall: secret }),
      verdictOf('ok', { criteria: IDS.map(() => ({ id: secret, score: 4, evidence: secret })) }),
      verdictOf('ok', { criteria: IDS.map((id) => ({ id, score: 4, evidence: 'ok', [secret]: 1 })) }),
    ]) {
      const r = parseVerdict(JSON.stringify(v), opts);
      expect(r.status).toBe('abstain');
      if (r.status === 'abstain') {
        expect(r.detail.toUpperCase()).not.toContain('SECRET');
        expect(r.detail).toMatch(SAFE);
      }
    }
  });

  it('a fenced reply is not JSON, and says it starts with a code fence', () => {
    expect(parseVerdict(`\`\`\`json\n${JSON.stringify(verdictOf('ok'))}\n\`\`\``, opts)).toEqual({ status: 'abstain', reason: 'not_json', detail: 'output is not a single JSON value (it starts with a code fence)' });
  });
});

describe('template pair 2 states the verdict limits in words, under the schema caps', () => {
  const rule5 = (t: string) => t.split('\n').find((l) => l.startsWith('5. '))!;
  const rule = (t: string, n: number) => t.split('\n').find((l) => l.startsWith(`${n}. `));

  it('names each limit and the target under it, says nothing of what happens over a limit; the rationale limit comes from the policy', () => {
    const r = rule5(PROMPT_TEMPLATE_2);
    expect(r).toContain('Each "evidence" and the "injectionEvidence" may be at most 300 characters; aim for 200.');
    expect(r).toContain('The "rationale" may be at most {{rationale_max}} characters; aim for {{rationale_target}}.');
    expect(r).not.toMatch(/discard|no verdict|abstain[^"]|cut/i);
    expect(r).toMatch(/no code fence/);
    expect(rule5(PROMPT_TEMPLATE)).not.toMatch(/\{\{rationale/);
  });

  it.each([
    [600, 'aim for 400.', 'at most 600 characters'],
    [300, 'aim for 200.', 'at most 300 characters; aim for 200.'],
    [undefined, 'aim for 400.', 'at most 600 characters'],
  ])('fills a policy cap of %s into the rendered rule', (cap, target, limit) => {
    const p = buildPrompt({ spec: { description: 'x' }, criteria: [criterion('fit', 1)], data: UntrustedData.wrap('a'), nonces: NONCES, templates: TEMPLATE_PAIR_2, ...(cap === undefined ? {} : { rationaleMaxChars: cap }) });
    if (!p.ok) throw new Error(p.error);
    const r = rule5(p.value.system);
    expect(r).toContain(target);
    expect(r).toContain(limit);
    expect(r).not.toContain('{{');
  });

  it('changes rule 5 only: every other line of pair 1 stays, first-instance and appeal', () => {
    const others = (t: string) => t.split('\n').filter((l) => !l.startsWith('5. '));
    expect(others(PROMPT_TEMPLATE_2)).toEqual(others(PROMPT_TEMPLATE));
    expect(others(APPEAL_PROMPT_TEMPLATE_2)).toEqual(others(APPEAL_PROMPT_TEMPLATE));
    expect(rule5(APPEAL_PROMPT_TEMPLATE_2)).toBe(rule5(PROMPT_TEMPLATE_2));
    for (const n of [1, 2, 3, 4, 6, 7, 8]) expect(rule(PROMPT_TEMPLATE_2, n)).toBe(rule(PROMPT_TEMPLATE, n));
  });

  it('keeps pair 1 frozen under its hashes, and gives pair 2 its own', () => {
    expect([TEMPLATE_PAIR.firstHash, TEMPLATE_PAIR.appealHash]).toEqual([
      '0xabb5ec9b33cf9a936e140bf8530c217f6629fdf1e08a46fbdf6bd7363ce84dd2',
      '0xa0bb1a5d8fa8ac53294a41556df71c098f73220d24efd9522e922f9004248659',
    ]);
    expect(TEMPLATE_PAIR_2.firstHash).not.toBe(TEMPLATE_PAIR.firstHash);
    expect(TEMPLATE_PAIR_2.appealHash).not.toBe(TEMPLATE_PAIR.appealHash);
    expect(TEMPLATE_PAIR_2.appealHash).not.toBe(TEMPLATE_PAIR_2.firstHash);
  });

  it('is a pair this build keeps, beside pair 1', () => {
    expect(KEPT.templatePairs).toContain(TEMPLATE_PAIR);
    expect(KEPT.templatePairs).toContain(TEMPLATE_PAIR_2);
  });

  it('a verdict written to the targets fits the schema with room to spare', () => {
    expect(JSON.stringify(verdictOf(long(199), { rationale: long(399) })).length).toBeLessThan(MAX_OUTPUT_CHARS);
    expect(parseVerdict(JSON.stringify(verdictOf(long(199), { rationale: long(399) })), { criterionIds: IDS, canary: NONCES.canary, rationaleMaxChars: 600 }).status).toBe('ok');
  });
});

// The live deal's shape: a JSON kit, four criteria weighted 30/30/20/20, passThreshold 300, the appeal after the
// primary escalated, five seats over two families, every judge passing, three writing evidence past 300 characters.
describe("partner C's appeal, replayed on the pipeline", () => {
  const RUBRIC: JudgmentRubric = { criteria: [criterion('fit', 30), criterion('coherent', 30), criterion('distinct', 20), criterion('usable', 20)], passThreshold: 300 };
  const SEATS: PanelSeat[] = [
    { judgeId: 'claude-sonnet-5', provider: 'anthropic', family: 'claude', model: 'claude-sonnet-5@2026-06-29' },
    { judgeId: 'claude-sonnet-5-5', provider: 'anthropic', family: 'claude', model: 'claude-sonnet-5-5@2026-09-28' },
    { judgeId: 'deepseek-flash', provider: 'openai-compatible', family: 'deepseek', model: 'deepseek-flash@2026-11-01' },
    { judgeId: 'deepseek-v4-pro', provider: 'openai-compatible', family: 'deepseek', model: 'deepseek-v4-pro@2026-11-01' },
    { judgeId: 'claude-opus-5-5', provider: 'anthropic', family: 'claude', model: 'claude-opus-5-5@2026-09-21' },
  ];
  const KIT = JSON.stringify({ kit: { logo: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>', colours: [{ role: 'ink', hex: '#1d1d1f' }] } });

  const appeal = (evidenceFor: (judgeId: string) => string, versions = NEWEST_VERSIONS, template: 'appeal' | 'first-instance' = 'appeal') =>
    appealWith((req) => evidenceFor(req.judgeId), versions, template);
  const appealTold = (evidenceFor: (system: string) => string, versions = NEWEST_VERSIONS) => appealWith((req) => evidenceFor(req.system), versions, 'appeal');
  async function appealWith(evidenceFor: (req: JudgeRequest) => string, versions: typeof NEWEST_VERSIONS, template: 'appeal' | 'first-instance') {
    const calls: JudgeRequest[] = [];
    const provider: JudgeProvider = { complete: async (req) => (calls.push(req), { kind: 'ok', text: JSON.stringify(verdictOf(evidenceFor(req))) }) };
    const pt = utf8(KIT);
    const ct = seal(pt);
    const r = await intake({ delivery: delivery(pt, ct, { plaintextMime: 'application/json' }), ciphertext: ct, recipient: ADJUDICATOR, unwrapKey: fakeUnwrap });
    if (!r.ok) throw new Error(r.error.detail);
    const out = await runPipeline({
      intake: r.value,
      acceptance: { deterministicChecks: [], rubric: RUBRIC },
      deliverable: { description: 'A brand kit as one JSON document.' },
      policy: POLICY,
      seats: SEATS,
      provider,
      template,
      versions,
      nonces: (_s, i) => ({ boundary: NONCES.boundary.replace(/.$/, String(i)), canary: NONCES.canary.replace(/.$/, String(i)) }),
    });
    if (!out.ok) throw new Error(out.error.detail);
    return { d: out.value, calls };
  }
  const overClaude = (id: string) => (id.startsWith('claude') ? long(340) : long(288));

  it.each(['agg-3', 'agg-4'])('%s rejects it, as the live appeal did, and the record now names each seat\'s rule', async (aggregationVersion) => {
    const { d } = await appeal(overClaude, { ...NEWEST_VERSIONS, aggregationVersion });
    expect(d.aggregate.decision).toBe('reject');
    expect(d.aggregate.reasons).toContain('3 judge outputs rejected by a filter');
    expect(d.panel.members.map((m) => m.status)).toEqual(['abstain', 'abstain', 'ok', 'ok', 'abstain']);
    for (const id of ['claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-5-5']) {
      expect(d.aggregate.reasons).toContain(`judge ${id} output rejected by a filter (schema: criteria[0].evidence: 340 > 300)`);
    }
    for (const reason of d.aggregate.reasons) expect(reason.length).toBeLessThanOrEqual(200);
  });

  it('on the first-instance template the record names the seat and its rule once, and escalates as before', async () => {
    const { d } = await appeal((id) => (id === 'deepseek-flash' ? long(312) : long(200)), NEWEST_VERSIONS, 'first-instance');
    expect(d.aggregate.decision).toBe('escalate');
    expect(d.aggregate.reasons.filter((r) => r.startsWith('judge deepseek-flash'))).toEqual(['judge deepseek-flash output rejected by a filter (schema: criteria[0].evidence: 312 > 300)']);
  });

  it('the same panel with every evidence inside the cap accepts it: the cap alone decided the live refund', async () => {
    const { d } = await appeal(() => long(288));
    expect(d.aggregate.decision).toBe('accept');
    expect(d.aggregate.passCount).toBe(5);
  });

  // A model of the hypothesis, not a measurement: judges that write to the target they are told, and past the cap when
  // told only `string<=300`. Live judges decide whether pair 2 helps; this shows the words reach every seat.
  it('under template pair 2 every judge reads the limits in words, and the record names pair 2', async () => {
    const versions = { ...NEWEST_VERSIONS, promptTemplateHash: TEMPLATE_PAIR_2.firstHash, appealPromptTemplateHash: TEMPLATE_PAIR_2.appealHash };
    const told = (system: string) => (system.includes('aim for 200') ? long(180) : long(340));
    const two = await appealTold(told, versions);
    const one = await appealTold(told, NEWEST_VERSIONS);
    expect([one.d.aggregate.decision, two.d.aggregate.decision]).toEqual(['reject', 'accept']);
    expect(two.calls).toHaveLength(5);
    for (const c of two.calls) expect(c.system).toContain('aim for 200');
    expect(new Set(two.d.panel.members.map((m) => m.promptTemplateHash))).toEqual(new Set([TEMPLATE_PAIR_2.appealHash]));
  });
});
