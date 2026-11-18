// The security-review form (examples/seller-adapter.template.json) is a product with a test (T-534): no change to it
// lands without the pass rate measured before and after. The corpus script measures it on public reports
// (docs/research/2026-11-18-report-corpus/measure.mjs, which needs the reports downloaded and pdftotext, so it is not
// run here). This file holds the rule where CI can see it:
//   1. results.json was written by a run on the template as it is now (same SHA-256), so a changed form has a new run;
//   2. the form's reference page records that run's numbers for the form's version, beside the version before it;
//   3. the form's checks do what its reference page says, on small reports, through the adjudicator's check library.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fill } from '../examples/seller-adapter-core.ts';
import { runChecks, UntrustedData, validateCheck, type JudgmentCheck } from '../packages/judgment/src/index.ts';

const at = (path: string) => new URL(`../${path}`, import.meta.url);
const templateBytes = readFileSync(at('examples/seller-adapter.template.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const template: any = JSON.parse(templateBytes.toString('utf8'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const results: any = JSON.parse(readFileSync(at('docs/research/2026-11-18-report-corpus/results.json'), 'utf8'));
const page = readFileSync(at('examples/security-review-form.md'), 'utf8');

const RERUN = 'rerun docs/research/2026-11-18-report-corpus/measure.mjs (examples/security-review-form.md, "Measure a change") and record the numbers';

describe('the security-review form is measured as it is', () => {
  it('has a name and a version, and points at its reference page', () => {
    expect(template.form).toMatchObject({ name: 'security-review', reference: 'examples/security-review-form.md' });
    expect(Number.isInteger(template.form.version)).toBe(true);
  });

  it('results.json comes from a run on this template', () => {
    const sha = createHash('sha256').update(templateBytes).digest('hex');
    expect(results.templateSha256, `the template changed since the last corpus run: ${RERUN}`).toBe(sha);
    expect(results.form).toEqual(template.form);
  });

  it("the reference page records this version's measured rates, and the version before it", () => {
    // A row of the Versions table: | <version> | `<template SHA-256>` | <date> | <design> | <design, stripped> |
    // <held-out> | <second held-out> | <what changed> |. A count is "<n> of <m>": the reports accepted on the form's
    // default terms, a review of several repositories not counted; or "not measured".
    const rows = page.split('\n').filter((l) => /^\| \d+ \| `[0-9a-f]{64}` \|/.test(l)).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
    const sha = createHash('sha256').update(templateBytes).digest('hex');
    const row = rows.find((r) => Number(r[0]) === template.form.version);
    expect(row, `examples/security-review-form.md has no row for version ${template.form.version}: ${RERUN}`).toBeDefined();
    expect(row![1], 'the row names the template it measured').toBe(`\`${sha}\``);
    // Each version keeps a byte copy (forms/v<n>.json): the template is its version's copy, and every row names its own.
    const copy = (v: string) => readFileSync(at(`docs/research/2026-11-18-report-corpus/forms/v${v}.json`));
    expect(createHash('sha256').update(copy(String(template.form.version))).digest('hex'), `the template differs from forms/v${template.form.version}.json: raise form.version and keep a copy`).toBe(sha);
    for (const r of rows) expect(r[1], `the row for version ${r[0]} names its own template`).toBe(`\`${createHash('sha256').update(copy(r[0]!)).digest('hex')}\``);
    const count = (s: { acceptedOneCommit: number; acceptedOneCommitStripped: number; reports: number }, stripped = false) => `${stripped ? s.acceptedOneCommitStripped : s.acceptedOneCommit} of ${s.reports}`;
    const sets = results.summary;
    expect(row!.slice(3, 7)).toEqual([count(sets.design), count(sets.design, true), count(sets.heldout), count(sets['heldout-2'])]);
    if (template.form.version > 1) expect(rows.some((r) => Number(r[0]) === template.form.version - 1), 'the row before this version (the "before")').toBe(true);
  });
});

describe("the form's checks do what its reference page says", () => {
  const scope = { commit: 'a'.repeat(40), files: ['src/Vault.sol', 'src/Oracle.sol'] };
  const checks: JudgmentCheck[] = fill(template.checks, scope);
  const failed = (report: unknown): string[] =>
    runChecks(checks, { data: UntrustedData.wrap(JSON.stringify(report)), mime: 'application/json' })
      .outcomes.filter((o) => o.required && !o.passed)
      .map((o) => o.checkId);
  const report = (...findings: unknown[]) => ({ commit: scope.commit, filesReviewed: scope.files, findings });
  const finding = (extra: Record<string, unknown> = {}) => ({ id: 'F-01', severity: 'High', title: 'A title', rootCause: 'Why.', ...extra });

  it('every check is one the library accepts, and no proof check is on by default', () => {
    for (const c of checks) expect(validateCheck(c)).toBeUndefined();
    expect(checks.map((c) => c.id)).toEqual(['report', 'scope', 'coverage', 'hidden']);
  });

  it('a finding needs an id, a severity, a title and a root cause; a location, a fix and proof are optional', () => {
    expect(failed(report(finding()))).toEqual([]);
    expect(failed(report(finding({ locations: [] })))).toEqual([]);
    expect(failed(report(finding({ rootCause: undefined })))).toEqual(['report']);
    expect(failed(report({ id: 'F-01', severity: 'High', rootCause: 'Why.' }))).toEqual(['report']);
    expect(failed(report(finding({ severity: 'Undetermined' })))).toEqual(['report']);
  });

  it('a text field holds 8,000 characters, not one more', () => {
    for (const k of ['rootCause', 'impact', 'recommendedFix']) {
      expect(failed(report(finding({ [k]: 'x'.repeat(8000) })))).toEqual([]);
      expect(failed(report(finding({ [k]: 'x'.repeat(8001) })))).toEqual(['report']);
    }
  });

  it('a finding set aside as known, duplicate or out-of-scope needs no root cause, and may cite any file', () => {
    for (const status of ['known', 'duplicate', 'out-of-scope']) {
      expect(failed(report({ id: 'F-01', severity: 'Low', title: 'Set aside', status }))).toEqual([]);
      expect(failed(report({ id: 'F-01', severity: 'Low', title: 'Set aside', status, locations: [{ file: 'lib/Other.sol' }] }))).toEqual([]);
    }
    expect(failed(report({ id: 'F-01', severity: 'Low', title: 'Open', status: 'open' }))).toEqual(['report']);
  });

  it('a finding with locations has one in scope; the others may cite related code', () => {
    expect(failed(report(finding({ locations: [{ file: 'src/Vault.sol' }, { file: 'lib/Math.sol' }] })))).toEqual([]);
    expect(failed(report(finding({ locations: [{ file: 'lib/Math.sol' }] })))).toEqual(['scope']);
    expect(failed(report(finding({ status: 'fixed', locations: [{ file: 'test/Vault.t.sol' }] })))).toEqual(['scope']);
  });

  it("the reference page's check keeps set-aside findings to Low and Info", () => {
    const block = /\*\*Keep set-aside findings to Low and Info\.\*\*[\s\S]*?```json\n([\s\S]*?)\n```/.exec(page);
    expect(block, 'examples/security-review-form.md shows the check').not.toBeNull();
    const extra = JSON.parse(block![1]!) as JudgmentCheck;
    expect(validateCheck(extra)).toBeUndefined();
    const withExtra = [...checks, extra];
    const run = (f: unknown) => runChecks(withExtra, { data: UntrustedData.wrap(JSON.stringify(report(f))), mime: 'application/json' }).outcomes.filter((o) => !o.passed).map((o) => o.checkId);
    expect(run({ id: 'F-01', severity: 'Critical', title: 'Set aside', status: 'known' })).toEqual(['set-aside-low']);
    expect(run({ id: 'F-01', severity: 'Low', title: 'Set aside', status: 'known' })).toEqual([]);
    expect(run(finding({ severity: 'Critical', status: 'fixed' }))).toEqual([]);
  });

  it('keeps one commit, the file list and no hidden characters', () => {
    expect(failed({ ...report(finding()), commit: 'b'.repeat(40) })).toEqual(['scope']);
    expect(failed({ ...report(finding()), filesReviewed: ['src/Vault.sol'] })).toEqual(['coverage']);
    expect(failed(report(finding({ rootCause: 'Why.​' })))).toEqual(['hidden']);
  });
});
