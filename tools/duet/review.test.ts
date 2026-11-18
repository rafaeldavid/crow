// The demo security review (T-500): the report the replay and the live deals deliver passes the five checks the
// adjudicator runs, and each failing report fails the one check it is meant to fail.
import { preflightDelivery, validateCheck, type JudgmentAcceptance } from '../../packages/judgment/dist/index.js';
import { afterAll, describe, expect, it } from 'vitest';
import { startReviewJobApi } from './review-job-api.ts';
import { REVIEW_CHECK_IDS, REVIEW_PRICE_UNITS, REVIEW_SCOPE, reviewReport, reviewTerms, type ReportKind } from './review.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { deliverable, checks } = reviewTerms();
const acceptance = { deterministicChecks: checks, rubric: { criteria: [], passThreshold: 0 } } as unknown as JudgmentAcceptance;
const run = (kind: ReportKind) => preflightDelivery({ plaintext: reviewReport(kind), mime: 'application/json', format: 'application/json', acceptance } as J);
const failed = (kind: ReportKind) => run(kind).deterministic.filter((o) => !o.passed).map((o) => o.checkId);

describe('the demo security review', () => {
  it('has the five checks of the audit-report template, each valid and required', () => {
    expect(checks.map((c) => c.id)).toEqual([...REVIEW_CHECK_IDS]);
    for (const c of checks) {
      expect(validateCheck(c)).toBeUndefined();
      expect(c.required).toBe(true);
    }
    expect(deliverable.format).toBe('application/json');
    expect(deliverable.description).toContain(REVIEW_SCOPE.commit);
    expect(deliverable.description).toContain('Repository: https://github.com/theredguild/damn-vulnerable-defi.');
    for (const f of REVIEW_SCOPE.files) expect(deliverable.description).toContain(f);
    expect(deliverable.description).not.toMatch(/\{\{/);
  });

  it('passes every check with the demo report, so the adjudicator accepts it', () => {
    const r = run('ok');
    expect(r.refused).toBeUndefined();
    expect(r.deterministic.map((o) => [o.checkId, o.passed])).toEqual(REVIEW_CHECK_IDS.map((id) => [id, true]));
    expect(r.result).toBe('accept');
  });

  it('fails only the proof check when the Critical finding has no proof of concept', () => {
    expect(failed('no-proof')).toEqual(['proof']);
    expect(run('no-proof').result).toBe('reject');
  });

  it('fails only the coverage check when a file in scope is left out', () => {
    expect(failed('missing-file')).toEqual(['coverage']);
  });

  it('passes with no findings at all: the checks test shape and scope, not quality', () => {
    const empty = JSON.parse(new TextDecoder().decode(reviewReport('ok')));
    empty.findings = [];
    const r = preflightDelivery({ plaintext: new TextEncoder().encode(JSON.stringify(empty)), mime: 'application/json', format: 'application/json', acceptance } as J);
    expect(r.result).toBe('accept');
  });

  it('labels every finding a demo finding, inside the two files at the agreed commit', () => {
    const r = JSON.parse(new TextDecoder().decode(reviewReport('ok')));
    expect(r.commit).toBe(REVIEW_SCOPE.commit);
    expect(r.summary).toMatch(/^Demo findings, written for Crow's demo page/);
    expect(r.summary).toContain('written to be broken for practice');
    for (const f of r.findings) {
      expect(f.title).toMatch(/^Demo finding: /);
      for (const l of f.locations) expect(REVIEW_SCOPE.files).toContain(l.file);
    }
  });
});

describe('the replay job API', () => {
  const started = startReviewJobApi({ token: 'tUSD', pollsUntilComplete: 0 });
  afterAll(async () => (await started).close());
  const post = async (path: string, body: J, key?: string) => {
    const api = await started;
    return fetch(`${api.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) });
  };

  it('quotes the demo scope at the demo price and serves the demo report', async () => {
    const q = (await (await post('/quote', { scope: REVIEW_SCOPE })).json()) as J;
    expect(q.price).toEqual({ token: 'tUSD', amount: REVIEW_PRICE_UNITS });
    const { jobId } = (await (await post('/jobs', { commitmentId: '0x01', quoteId: q.quoteId, scope: REVIEW_SCOPE }, 'k1')).json()) as J;
    const api = await started;
    const res = await fetch(`${api.url}/jobs/${jobId}/result`);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(reviewReport('ok'));
  });

  it('refuses any other scope', async () => {
    expect((await post('/quote', { scope: { ...REVIEW_SCOPE, commit: '7c1e4b9a2d3f5068a1b2c3d4e5f60718293a4b5c' } })).status).toBe(422);
  });
});
