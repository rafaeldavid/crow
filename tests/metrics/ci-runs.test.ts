// N173: ci-runs.mjs on a made-up month of three pull requests and one push, so every number it prints can be checked
// by hand. The patterns it classifies with must stay the ones .github/workflows/ci.yml's changes job uses.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHAIN_SIDE, DOCS_ONLY, buildCiReport, jobKey, kindOf, toMarkdown } from '../../scripts/metrics/ci-runs.mjs';

const T0 = Date.parse('2026-11-10T10:00:00Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const job = (name: string, attempt: number, start: number, end: number, conclusion = 'success', steps: object[] = []) => ({
  name,
  run_attempt: attempt,
  conclusion,
  created_at: at(start - 5),
  started_at: at(start),
  completed_at: at(end),
  steps,
});
const skipped = (name: string, t: number) => ({ ...job(name, 1, t, t), conclusion: 'skipped' });
const ciRun = (id: number, created: number, pr: number | null, sha: string, extra: object = {}) => ({
  id,
  name: 'ci',
  event: pr === null ? 'push' : 'pull_request',
  status: 'completed',
  conclusion: 'success',
  run_attempt: 1,
  created_at: at(created),
  head_sha: sha,
  head_branch: pr === null ? 'main' : `b${pr}`,
  pull_requests: pr === null ? [] : [{ number: pr }],
  ...extra,
});

const prs = [
  { number: 1, createdAt: at(-60), mergedAt: at(900), headRefName: 'b1', files: ['docs/tasks/T-1-x.md'], mergeCommit: { oid: 'm1' } },
  { number: 2, createdAt: at(-60), mergedAt: at(4000), headRefName: 'b2', files: ['apps/operator/src/a.ts', 'docs/x.md'], mergeCommit: { oid: 'm2' } },
  { number: 3, createdAt: at(-60), mergedAt: null, headRefName: 'b3', files: ['contracts/src/R.sol'], mergeCommit: null },
];

// PR 1: docs only, one run, the heavy jobs skipped, check done 30 s after the run starts.
// PR 2: code on the chain side. Run 20 fails its static job; run 21 (a new commit at 200 s, before run 20 ends at 400 s)
// passes, so run 20 is superseded from 200 s. PR 3: contracts; run 30 fails test 1/4 on attempt 1 and passes on attempt 2.
// Push 40: main after PR 1.
const runs = [
  ciRun(10, 0, 1, 's1'),
  ciRun(20, 0, 2, 's2a', { conclusion: 'failure' }),
  ciRun(21, 200, 2, 's2b'),
  ciRun(30, 0, 3, 's3', { run_attempt: 2 }),
  ciRun(40, 1000, null, 'm1'),
  { ...ciRun(50, 0, 1, 's1'), name: 'CodeQL', event: 'pull_request' },
  { ...ciRun(60, 0, 1, 's1'), status: 'in_progress' },
];
const setup = [
  { name: 'Set up job', started_at: at(10), completed_at: at(12) },
  { name: 'Run pnpm install --frozen-lockfile', started_at: at(12), completed_at: at(40) },
  { name: 'Run pnpm test --shard=1/4', started_at: at(40), completed_at: at(300) },
];
const jobs: Record<string, object[]> = {
  10: [job('changes', 1, 5, 10), skipped('typecheck, lint, spec, snap', 10), job('check', 1, 20, 30), job('gitleaks', 1, 5, 15)],
  20: [job('changes', 1, 5, 10), job('typecheck, lint, spec, snap', 1, 10, 120, 'failure'), job('test (1/4)', 1, 10, 400), job('check', 1, 400, 405, 'failure')],
  21: [job('changes', 1, 205, 210), job('typecheck, lint, spec, snap', 1, 210, 330), job('test (1/4)', 1, 210, 500, 'success', setup), job('anvil tests, world (must not skip)', 1, 210, 700), job('check', 1, 700, 710)],
  30: [job('changes', 1, 5, 10), job('test (1/4)', 1, 10, 300, 'failure'), job('check', 1, 300, 305, 'failure'), job('changes', 2, 1005, 1010), job('test (1/4)', 2, 1010, 1300), job('check', 2, 1300, 1305)],
  40: [job('changes', 1, 1005, 1010), job('formal (TLC)', 1, 1010, 2000), job('check', 1, 2000, 2010)],
  50: [job('Analyze (actions)', 1, 10, 70)],
};

const rep = buildCiReport({ runs, jobs, prs, sinceMs: T0 - 86_400_000, untilMs: T0 + 86_400_000 });

describe('ci-runs', () => {
  it('uses the patterns of the changes job in ci.yml', () => {
    const yml = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
    expect(yml).toContain(`grep -Ev '${DOCS_ONLY.source.replaceAll('\\/', '/')}'`);
    expect(yml).toContain(`grep -E '${CHAIN_SIDE.source.replaceAll('\\/', '/')}'`);
  });

  it('names the kind of a change from its files', () => {
    expect(kindOf(['docs/tasks/T-1.md'])).toBe('tasks');
    expect(kindOf(['docs/tasks/T-1.md', 'README.md'])).toBe('docs');
    expect(kindOf(['site/index.html', 'docs/a.md'])).toBe('site');
    expect(kindOf(['scripts/metrics/x.mjs'])).toBe('code');
    expect(kindOf(['examples/a.ts', 'site/a'])).toBe('code-chain');
    expect(kindOf(['.github/workflows/ci.yml', 'scripts/a.mjs'])).toBe('ci');
    expect(kindOf(['contracts/src/R.sol', '.github/x'])).toBe('contracts');
    expect(kindOf([])).toBe('unknown');
    expect(jobKey('anvil tests, world (must not skip)')).toBe('anvil world');
  });

  it('counts completed runs per workflow and their runner minutes over every attempt', () => {
    expect(rep.totals.runs).toBe(6);
    expect(rep.workflows.ci.runs).toBe(5);
    expect(rep.workflows.ci.byEvent).toEqual({ pull_request: 4, push: 1 });
    expect(rep.workflows.CodeQL).toMatchObject({ runs: 1, runnerMinutes: 1, billedMinutes: 1 });
    // Run 30: attempt 1 is 5 + 290 + 5 s, attempt 2 the same: 600 s, 10 minutes; billed 1 + 5 + 1 twice = 14.
    expect(buildCiReport({ runs: [runs[3]], jobs, prs, sinceMs: 0, untilMs: T0 * 2 }).totals).toMatchObject({ runnerMinutes: 10, billedMinutes: 14 });
  });

  it('measures the wall time from the run to check done, by kind', () => {
    expect(rep.ci.pullRequest.tasks).toMatchObject({ runs: 1, wallMedianS: 30, firstAttemptFailed: 0, criticalPath: { gitleaks: 1 } });
    // Run 20 ends at 405 s, run 21 at 710 s after its own start at 200 s: 405 and 510 s.
    expect(rep.ci.pullRequest['code-chain']).toMatchObject({ runs: 2, wallMedianS: 405, wallP90S: 510, firstAttemptFailed: 1, criticalPath: { 'test (1/4)': 1, 'anvil world': 1 } });
    expect(rep.ci.pullRequest.contracts).toMatchObject({ runs: 1, wallMedianS: 305, reruns: 1 });
    expect(rep.ci.push).toMatchObject({ runs: 1, median: 1010, runnerMinutesTotal: 16.8 });
  });

  it('separates a failure fixed by a new commit from one that passed on a rerun', () => {
    expect(rep.ci.failures).toMatchObject({ runs: 2, fixedByNewCommit: 1, greenOnRerun: 1, other: 0, byJob: { 'typecheck, lint, spec, snap': 1, 'test (1/4)': 1 } });
    expect(rep.ci.reruns).toMatchObject({ runs: 1, greenOnRerun: 1 });
  });

  it('counts the minutes a newer push made useless', () => {
    // Run 20 after 200 s: the test leg from 200 to 400 s; static ended at 120 s; check started at 400 s and ran 5 s.
    expect(rep.ci.superseded).toEqual({ runs: 1, runnerMinutes: 3.4 });
  });

  it('splits a job into its setup steps and the rest', () => {
    expect(rep.ci.jobsOnPullRequests['test (1/4)']).toMatchObject({ runs: 3, medianS: 290, queueMedianS: 5 });
    expect(rep.ci.jobsOnPullRequests['test (1/4)'].setupMedianS).toBe(0);
    const one = buildCiReport({ runs: [runs[2]], jobs, prs, sinceMs: 0, untilMs: T0 * 2 });
    expect(one.ci.jobsOnPullRequests['test (1/4)'].setupMedianS).toBe(30);
  });

  it('counts pull requests a day, the docs-only share and what CI they used', () => {
    expect(rep.pullRequests).toMatchObject({ opened: 3, perDay: 1.5, docsOrTasksOnly: 1, docsOrTasksShareBps: 3333 });
    expect(rep.pullRequests.byKind.tasks).toMatchObject({ prs: 1, merged: 1, ciRuns: 1, openToMergeMedianS: 960 });
    // PR 1: ci run 10 (5 + 10 + 10 s) and CodeQL run 50 (60 s): 85 s.
    expect(rep.pullRequests.byKind.tasks.runnerMinutes).toBe(1.4);
    expect(rep.pullRequests.byKind['code-chain']).toMatchObject({ ciRuns: 2, ciWaitMinutes: 15.3 });
  });

  it('says what skipping a job on runs that touch none of its inputs would save', () => {
    // Push 40 merged PR 1 (a task file): formal ran 990 s; without it the run ends at changes' end (10 s) plus check's 10 s.
    expect(rep.ci.whatIf.formalOnItsInputs.push).toEqual({ runsOf: 1, runsSkipping: 1, runnerMinutesSaved: 16.5, wallMedianS: { before: 1010, after: 20 }, wallP90S: { before: 1010, after: 20 } });
    // No pull-request run here has a formal job, so none skips one.
    expect(rep.ci.whatIf.formalOnItsInputs.pullRequest).toMatchObject({ runsOf: 4, runsSkipping: 0, runnerMinutesSaved: 0 });
    // The same push merged only a task file, so the docs-only rule skips its formal job too.
    expect(rep.ci.whatIf.docsOnlySkipsChainAndFormal.push).toMatchObject({ runsSkipping: 1, runnerMinutesSaved: 16.5, wallMedianS: { before: 1010, after: 20 } });
    expect(rep.ci.pushByKind).toEqual({ tasks: { runs: 1, runnerMinutes: 16.8, wallMedianS: 1010 } });
    expect(rep.ci.steps.installPr).toEqual({ steps: 1, medianS: 28, p90S: 28, minutes: 0.5 });
  });

  it('prints the tables', () => {
    const md = toMarkdown(rep);
    expect(md).toContain('| tasks | 1 | 30 s |');
    expect(md).toContain('Superseded pull-request runs');
    expect(md).toContain('Docs or task files only: 1 (33.3%)');
  });
});
