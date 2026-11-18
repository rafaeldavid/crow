#!/usr/bin/env node
// ci-runs.json (N173, the CI review of 2026-11-18): what a change waits for and spends in GitHub Actions, by kind of
// change, from the runs, jobs and pull requests GitHub records. Nothing here is written by hand: rerun it and every
// number in docs/research/2026-11-18-ci-review.md comes back.
//
//   node scripts/metrics/ci-runs.mjs --cache reports/scratch/ci-cache.json --out reports/scratch/ci-runs.json --md reports/scratch/ci-runs.md
//   node scripts/metrics/ci-runs.mjs --offline --since 2026-11-18 ...   # from the cache only, runs created on or after a day
//
// Reading needs `gh` signed in with read access; it reads only (GET). A completed run's jobs are cached by run ID and
// attempt, so a second read fetches only new runs. The analysis (`buildCiReport`) is pure and tested on a fixture
// (tests/metrics/ci-runs.test.ts).
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { cli, envelope, gitCommit, isMain, iso, quantile, ROOT, writeJson } from './lib.mjs';

const run = promisify(execFile);
const DAY_MS = 86_400_000;
export const REPO = 'rafaeldavid/holdback';

// The changes job's own patterns, copied from .github/workflows/ci.yml; the test fails when they drift apart.
export const DOCS_ONLY = /^(docs\/.+|[^/]+\.md)$/;
export const CHAIN_SIDE =
  /^(contracts\/|scripts\/(sourcify-verify|deploy-rehearsal|record-copies)\.mjs$|packages\/|apps\/(operator|adjudicator|demo-cloud|test-agents)\/|examples\/|fixtures\/|spec\/|config\/|\.github\/|\.gitmodules$|\.nvmrc$|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|tsconfig[^/]*\.json$|vitest\.config\.ts$)/;

/** What the formal job reads: formal/check.sh reads only formal/ (and the workflow pins its Java). */
export const FORMAL_INPUTS = /^(formal\/|\.github\/workflows\/ci\.yml$)/;
/** What `forge test` reads: contracts/ and its submodules, and fixtures/beacon/ (contracts/foundry.toml fs_permissions). */
export const CONTRACTS_INPUTS = /^(contracts\/|fixtures\/beacon\/|\.gitmodules$|\.github\/workflows\/ci\.yml$)/;

/** The kinds of change, in the order the tables print them. */
export const KINDS = ['tasks', 'docs', 'site', 'code', 'code-chain', 'contracts', 'ci', 'unknown'];

/**
 * The kind of a change from its file list. Pure.
 * - tasks: only docs/tasks/ files (a Status or Handoff edit); docs: only what ci.yml's changes job calls docs;
 * - site: site/ plus docs; contracts: anything under contracts/; ci: anything under .github/;
 * - code-chain: a file ci.yml's chain pattern names (runs the contracts and anvil jobs); code: the rest.
 */
export function kindOf(files) {
  if (!Array.isArray(files) || files.length === 0) return 'unknown';
  if (files.every((f) => f.startsWith('docs/tasks/'))) return 'tasks';
  if (files.every((f) => DOCS_ONLY.test(f))) return 'docs';
  if (files.every((f) => f.startsWith('site/') || DOCS_ONLY.test(f))) return 'site';
  if (files.some((f) => f.startsWith('contracts/'))) return 'contracts';
  if (files.some((f) => f.startsWith('.github/'))) return 'ci';
  if (files.some((f) => CHAIN_SIDE.test(f))) return 'code-chain';
  return 'code';
}

const ms = (t) => (typeof t === 'string' ? Date.parse(t) : Number.NaN);
const secs = (a, b) => {
  const d = ms(b) - ms(a);
  return Number.isFinite(d) && d >= 0 ? Math.round(d / 1000) : null;
};
/** Seconds a job held a runner (start to finish); 0 for a skipped job. */
export const jobSeconds = (j) => (j.conclusion === 'skipped' ? 0 : (secs(j.started_at, j.completed_at) ?? 0));
/** GitHub rounds each job up to a whole minute when it bills. */
const billedMinutes = (s) => (s > 0 ? Math.ceil(s / 60) : 0);
const stats = (values) => {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return { n: s.length, median: quantile(s, 50), p90: quantile(s, 90), max: s.length ? s[s.length - 1] : null, sum };
};
const round1 = (x) => Math.round(x * 10) / 10;
/** A matrix leg's name with its shard number, and the anvil leg's long name cut to its suite. */
export const jobKey = (name) => name.replace(/^anvil tests, (\w+) \(must not skip\)$/, 'anvil $1');
/** A run's workflow: its file's name, CodeQL's default setup, or the run's own name. */
export function workflowOf(r) {
  const p = r.path ?? '';
  if (p.includes('github-code-scanning/codeql') || /^(PR #\d+|Push on main)$/.test(r.name ?? '')) return 'CodeQL';
  if (p.includes('dependabot')) return 'Dependabot';
  const m = /^\.github\/workflows\/([^/]+)\.ya?ml/.exec(p);
  return m ? m[1] : r.name;
}
const SETUP_STEP = /^(Set up job|Run actions\/checkout|Run pnpm\/action-setup|Run actions\/setup-node|Run actions\/setup-java|Run foundry-rs\/foundry-toolchain|Run actions\/cache|submodules|Run pnpm install|Run pnpm build|forge build|Post |Complete job)/;

/**
 * Builds ci-runs.json's body. Pure.
 * @param {{ runs: object[], jobs: Record<string, object[]>, prs: object[], sinceMs: number, untilMs: number }} input
 *   runs: GitHub workflow runs (any workflow); jobs: run ID → that run's jobs over every attempt (filter=all);
 *   prs: `gh pr list --json number,createdAt,mergedAt,state,headRefName,files,mergeCommit,headRefOid`.
 */
export function buildCiReport({ runs, jobs, prs, sinceMs, untilMs }) {
  const prBy = new Map(prs.map((p) => [p.number, p]));
  const prByMerge = new Map(prs.filter((p) => p.mergeCommit?.oid).map((p) => [p.mergeCommit.oid, p]));
  const prByBranch = new Map(prs.map((p) => [p.headRefName, p]));
  const filesOf = (p) => (p?.files ?? []).map((f) => (typeof f === 'string' ? f : f.path));

  const inWindow = runs.filter((r) => ms(r.created_at) >= sinceMs && ms(r.created_at) < untilMs && r.status === 'completed');
  const rows = inWindow.map((r) => {
    // CodeQL's default setup names its runs "PR #n" and "Push on main", with the event "dynamic"
    const codeqlPr = /^PR #(\d+)$/.exec(r.name ?? '');
    const onPr = r.event === 'pull_request' || !!codeqlPr;
    const prNumber = r.pull_requests?.[0]?.number ?? (codeqlPr ? Number(codeqlPr[1]) : undefined);
    const pr = onPr ? (prBy.get(prNumber) ?? prByBranch.get(r.head_branch)) : prByMerge.get(r.head_sha);
    const all = jobs[String(r.id)] ?? [];
    const first = all.filter((j) => (j.run_attempt ?? 1) === 1);
    const check = first.find((j) => j.name === 'check');
    const end = check?.completed_at ?? (first.length ? first.map((j) => j.completed_at).filter(Boolean).sort().at(-1) : null);
    const work = first.filter((j) => j.name !== 'check' && j.conclusion !== 'skipped');
    const last = work.slice().sort((a, b) => ms(b.completed_at) - ms(a.completed_at))[0];
    const failed = first.filter((j) => j.conclusion === 'failure' && j.name !== 'check').map((j) => jobKey(j.name));
    return {
      id: r.id,
      workflow: workflowOf(r),
      event: onPr ? 'pull_request' : r.event === 'dynamic' ? 'push' : r.event,
      pr: pr?.number ?? null,
      sha: r.head_sha,
      kind: kindOf(filesOf(pr)),
      createdMs: ms(r.created_at),
      endMs: ms(end),
      wallS: secs(r.created_at, end),
      attempts: r.run_attempt ?? 1,
      firstConclusion: check ? check.conclusion : first.some((j) => j.conclusion === 'failure') ? 'failure' : first.some((j) => j.conclusion === 'cancelled') ? 'cancelled' : 'success',
      finalConclusion: r.conclusion,
      failed,
      criticalJob: last ? jobKey(last.name) : null,
      jobS: all.map(jobSeconds).reduce((a, b) => a + b, 0),
      firstJobS: first.map(jobSeconds).reduce((a, b) => a + b, 0),
      billedMin: all.map((j) => billedMinutes(jobSeconds(j))).reduce((a, b) => a + b, 0),
      jobsRan: all.filter((j) => j.conclusion !== 'skipped').length,
      files: pr ? filesOf(pr) : null,
      first,
    };
  });

  // Per workflow: runs, runner minutes and billed minutes over every attempt.
  const workflows = {};
  for (const r of rows) {
    const w = (workflows[r.workflow] ??= { runs: 0, byEvent: {}, runnerMinutes: 0, billedMinutes: 0, jobs: 0, wall: [] });
    w.runs += 1;
    w.byEvent[r.event] = (w.byEvent[r.event] ?? 0) + 1;
    w.runnerMinutes += r.jobS / 60;
    w.billedMinutes += r.billedMin;
    w.jobs += r.jobsRan;
    if (r.wallS !== null) w.wall.push(r.wallS);
  }
  for (const w of Object.values(workflows)) {
    const s = stats(w.wall);
    w.wallMedianS = s.median;
    w.wallP90S = s.p90;
    w.runnerMinutes = round1(w.runnerMinutes);
    delete w.wall;
  }

  // The ci workflow by kind: pull requests apart from pushes to main.
  const ci = rows.filter((r) => r.workflow === 'ci');
  const byKind = (list) => {
    const out = {};
    for (const k of KINDS) {
      const of = list.filter((r) => r.kind === k);
      if (!of.length) continue;
      const wall = stats(of.map((r) => r.wallS));
      const runner = stats(of.map((r) => r.firstJobS / 60));
      const crit = {};
      for (const r of of) if (r.criticalJob) crit[r.criticalJob] = (crit[r.criticalJob] ?? 0) + 1;
      out[k] = {
        runs: of.length,
        wallMedianS: wall.median,
        wallP90S: wall.p90,
        runnerMinutesPerRunMedian: runner.median === null ? null : round1(runner.median),
        runnerMinutesTotal: round1(of.reduce((a, r) => a + r.jobS / 60, 0)),
        billedMinutesTotal: of.reduce((a, r) => a + r.billedMin, 0),
        firstAttemptFailed: of.filter((r) => r.firstConclusion === 'failure').length,
        reruns: of.filter((r) => r.attempts > 1).length,
        criticalPath: Object.fromEntries(Object.entries(crit).sort((a, b) => b[1] - a[1])),
      };
    }
    return out;
  };
  const prRuns = ci.filter((r) => r.event === 'pull_request');
  const pushRuns = ci.filter((r) => r.event === 'push');

  // Each job's minutes on pull-request runs where it ran, first attempts only.
  const perJob = (list) => {
    const acc = {};
    for (const r of list)
      for (const j of r.first) {
        if (j.conclusion === 'skipped') continue;
        const k = jobKey(j.name);
        const a = (acc[k] ??= { runs: 0, s: [], setupS: [], queueS: [] });
        a.runs += 1;
        a.s.push(jobSeconds(j));
        a.queueS.push(secs(j.created_at, j.started_at));
        a.setupS.push((j.steps ?? []).filter((s) => SETUP_STEP.test(s.name)).reduce((t, s) => t + (secs(s.started_at, s.completed_at) ?? 0), 0));
      }
    return Object.fromEntries(
      Object.entries(acc)
        .map(([k, a]) => {
          const s = stats(a.s);
          const setup = stats(a.setupS);
          const queue = stats(a.queueS);
          return [k, { runs: a.runs, medianS: s.median, p90S: s.p90, setupMedianS: setup.median, queueMedianS: queue.median, queueP90S: queue.p90, runnerMinutes: round1(s.sum / 60) }];
        })
        .sort((a, b) => b[1].runnerMinutes - a[1].runnerMinutes),
    );
  };

  // Reruns: a run with a second attempt. "Green on rerun" means the same commit passed on a later attempt.
  const reruns = ci
    .filter((r) => r.attempts > 1)
    .map((r) => ({ run: r.id, pr: r.pr, event: r.event, attempts: r.attempts, firstFailed: r.failed, final: r.finalConclusion, greenOnRerun: r.firstConclusion === 'failure' && r.finalConclusion === 'success' }));

  // First-attempt failures on pull requests: fixed by a new commit (real) or by a rerun of the same commit.
  const failures = { runs: 0, byJob: {}, fixedByNewCommit: 0, greenOnRerun: 0, other: 0 };
  for (const r of prRuns.filter((x) => x.firstConclusion === 'failure')) {
    failures.runs += 1;
    for (const j of r.failed) failures.byJob[j] = (failures.byJob[j] ?? 0) + 1;
    const later = prRuns.find((x) => x.pr === r.pr && x.createdMs > r.createdMs && x.sha !== r.sha);
    if (r.attempts > 1 && r.finalConclusion === 'success') failures.greenOnRerun += 1;
    else if (later) failures.fixedByNewCommit += 1;
    else failures.other += 1;
  }
  failures.byJob = Object.fromEntries(Object.entries(failures.byJob).sort((a, b) => b[1] - a[1]));

  // Superseded: a pull-request run that a newer push to the same pull request overtook before it finished. A
  // concurrency group with cancel-in-progress would have stopped it; its runner minutes after the newer push are waste.
  let supersededRuns = 0;
  let supersededMinutes = 0;
  for (const r of prRuns) {
    const newer = prRuns.find((x) => x.pr === r.pr && x.createdMs > r.createdMs && x.createdMs < r.endMs && x.sha !== r.sha);
    if (!newer) continue;
    supersededRuns += 1;
    for (const j of r.first) {
      if (j.conclusion === 'skipped') continue;
      const from = Math.max(ms(j.started_at), newer.createdMs);
      const to = ms(j.completed_at);
      if (to > from) supersededMinutes += (to - from) / 60_000;
    }
  }

  // Pull requests opened in the window: how many a day, how many touch only docs or task files, what CI they used.
  const opened = prs.filter((p) => ms(p.createdAt) >= sinceMs && ms(p.createdAt) < untilMs);
  const days = Math.max(0.1, Math.round(((untilMs - sinceMs) / DAY_MS) * 10) / 10);
  const minutesOf = (p) => rows.filter((r) => r.pr === p.number && r.event === 'pull_request').reduce((a, r) => a + r.jobS / 60, 0);
  const waitOf = (p) => ci.filter((r) => r.pr === p.number && r.event === 'pull_request').reduce((a, r) => a + (r.wallS ?? 0), 0);
  const prKinds = {};
  for (const p of opened) {
    const k = kindOf(filesOf(p));
    const a = (prKinds[k] ??= { prs: 0, merged: 0, ciRuns: 0, runnerMinutes: 0, ciWaitMinutes: 0, toMerge: [] });
    a.prs += 1;
    if (p.mergedAt) {
      a.merged += 1;
      a.toMerge.push(secs(p.createdAt, p.mergedAt));
    }
    a.ciRuns += ci.filter((r) => r.pr === p.number && r.event === 'pull_request').length;
    a.runnerMinutes += minutesOf(p);
    a.ciWaitMinutes += waitOf(p) / 60;
  }
  for (const a of Object.values(prKinds)) {
    const s = stats(a.toMerge);
    a.openToMergeMedianS = s.median;
    a.openToMergeP90S = s.p90;
    a.runnerMinutes = round1(a.runnerMinutes);
    a.ciWaitMinutes = round1(a.ciWaitMinutes);
    delete a.toMerge;
  }
  const docsLike = ['tasks', 'docs'].map((k) => prKinds[k]?.prs ?? 0).reduce((a, b) => a + b, 0);

  // What-ifs for the proposals: skip a job on the runs whose change touches none of its inputs. A run with no known
  // file list counts as touching them. The new wall time is the last remaining job's end plus check's own time; it
  // leaves out the shorter queues fewer jobs would bring, so it understates the saving.
  const whatIfSkip = (jobRe, inputs, skips = (r) => r.files && !r.files.some((f) => inputs.test(f))) => {
    const out = {};
    for (const [label, list] of [['pullRequest', prRuns], ['push', pushRuns]]) {
      const hit = list.filter((r) => skips(r) && r.first.some((j) => jobRe.test(j.name) && j.conclusion !== 'skipped'));
      const before = [];
      const after = [];
      let saved = 0;
      for (const r of hit) {
        const kept = r.first.filter((j) => j.name !== 'check' && j.conclusion !== 'skipped' && !jobRe.test(j.name));
        for (const j of r.first) if (jobRe.test(j.name)) saved += jobSeconds(j);
        const check = r.first.find((j) => j.name === 'check');
        const lastEnd = Math.max(r.createdMs, ...kept.map((j) => ms(j.completed_at)));
        before.push(r.wallS);
        after.push(Math.round((lastEnd - r.createdMs) / 1000) + (check ? jobSeconds(check) : 0));
      }
      const b = stats(before);
      const a = stats(after);
      out[label] = { runsOf: list.length, runsSkipping: hit.length, runnerMinutesSaved: round1(saved / 60), wallMedianS: { before: b.median, after: a.median }, wallP90S: { before: b.p90, after: a.p90 } };
    }
    return out;
  };
  // Seconds of one named step in the jobs matching a name, first attempts.
  const stepStats = (list, jobRe, stepRe) => {
    const s = [];
    for (const r of list) for (const j of r.first) if (jobRe.test(j.name) && j.conclusion !== 'skipped') for (const st of j.steps ?? []) if (stepRe.test(st.name)) s.push(secs(st.started_at, st.completed_at));
    const x = stats(s);
    return { steps: x.n, medianS: x.median, p90S: x.p90, minutes: round1(x.sum / 60) };
  };
  // Push runs by the kind of the pull request they merged.
  const pushByKind = {};
  for (const r of pushRuns) {
    const a = (pushByKind[r.kind] ??= { runs: 0, runnerMinutes: 0, wall: [] });
    a.runs += 1;
    a.runnerMinutes += r.jobS / 60;
    a.wall.push(r.wallS);
  }
  for (const a of Object.values(pushByKind)) {
    a.runnerMinutes = round1(a.runnerMinutes);
    a.wallMedianS = stats(a.wall).median;
    delete a.wall;
  }

  const totalRunner = rows.reduce((a, r) => a + r.jobS / 60, 0);
  return {
    window: { since: iso(sinceMs), until: iso(untilMs), days },
    totals: {
      runs: rows.length,
      runnerMinutes: round1(totalRunner),
      runnerMinutesPerDay: round1(totalRunner / days),
      billedMinutes: rows.reduce((a, r) => a + r.billedMin, 0),
    },
    workflows,
    ci: {
      pullRequest: byKind(prRuns),
      push: { runs: pushRuns.length, ...stats(pushRuns.map((r) => r.wallS)), runnerMinutesTotal: round1(pushRuns.reduce((a, r) => a + r.jobS / 60, 0)), firstAttemptFailed: pushRuns.filter((r) => r.firstConclusion === 'failure').length },
      jobsOnPullRequests: perJob(prRuns),
      jobsOnPush: perJob(pushRuns),
      reruns: { runs: reruns.length, greenOnRerun: reruns.filter((r) => r.greenOnRerun).length, list: reruns },
      failures,
      superseded: { runs: supersededRuns, runnerMinutes: round1(supersededMinutes) },
      pushByKind,
      steps: {
        forgeBuildPr: stepStats(prRuns, /^anvil tests/, /^forge build$/),
        forgeBuildPush: stepStats(pushRuns, /^anvil tests/, /^forge build$/),
        installPr: stepStats(prRuns, /./, /^Run pnpm install/),
        buildPr: stepStats(prRuns, /./, /^Run pnpm build$/),
        submodulesPr: stepStats(prRuns, /./, /^submodules$/),
      },
      whatIf: {
        formalOnItsInputs: whatIfSkip(/^formal \(TLC\)$/, FORMAL_INPUTS),
        contractsOnItsInputs: whatIfSkip(/^contracts \(forge test\)$/, CONTRACTS_INPUTS),
        // a merged docs or task-file pull request skips the model check, forge test and anvil; static and tests stay
        docsOnlySkipsChainAndFormal: whatIfSkip(/^(formal \(TLC\)|contracts \(forge test\)|anvil tests, )/, null, (r) => r.kind === 'docs' || r.kind === 'tasks'),
      },
    },
    pullRequests: {
      opened: opened.length,
      perDay: round1(opened.length / days),
      docsOrTasksOnly: docsLike,
      docsOrTasksShareBps: opened.length ? Math.round((docsLike * 10_000) / opened.length) : null,
      byKind: prKinds,
    },
  };
}

const fmtS = (s) => (s === null || s === undefined ? '-' : s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`);

/** The report's tables as Markdown. Pure. */
export function toMarkdown(rep) {
  const out = [];
  out.push(`Window: ${rep.window.since} to ${rep.window.until} (${rep.window.days} days). ${rep.totals.runs} completed runs, ${rep.totals.runnerMinutes} runner minutes (${rep.totals.runnerMinutesPerDay} a day), ${rep.totals.billedMinutes} billed-style minutes (each job rounded up to a minute).`, '');
  out.push('| Workflow | Runs | Events | Runner minutes | Median wall | p90 wall |', '| --- | --- | --- | --- | --- | --- |');
  for (const [name, w] of Object.entries(rep.workflows).sort((a, b) => b[1].runnerMinutes - a[1].runnerMinutes))
    out.push(`| ${name} | ${w.runs} | ${Object.entries(w.byEvent).map(([e, n]) => `${e} ${n}`).join(', ')} | ${w.runnerMinutes} | ${fmtS(w.wallMedianS)} | ${fmtS(w.wallP90S)} |`);
  out.push('', '`ci` on pull requests, by kind of change (wall: run created to `check` done, first attempt):', '');
  out.push('| Kind | Runs | Median wall | p90 wall | Runner min per run (median) | Runner min total | First attempt failed | Reruns | Last job before `check` |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [k, v] of Object.entries(rep.ci.pullRequest))
    out.push(`| ${k} | ${v.runs} | ${fmtS(v.wallMedianS)} | ${fmtS(v.wallP90S)} | ${v.runnerMinutesPerRunMedian} | ${v.runnerMinutesTotal} | ${v.firstAttemptFailed} | ${v.reruns} | ${Object.entries(v.criticalPath).slice(0, 3).map(([j, n]) => `${j} ${n}`).join(', ')} |`);
  const p = rep.ci.push;
  out.push('', `\`ci\` on push to main: ${p.runs} runs, median wall ${fmtS(p.median)}, p90 ${fmtS(p.p90)}, ${p.runnerMinutesTotal} runner minutes, ${p.firstAttemptFailed} failed on the first attempt.`, '');
  out.push('Jobs on pull-request runs where they ran (first attempts):', '');
  out.push('| Job | Runs | Median | p90 | Setup median | Queue median | Queue p90 | Runner minutes |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [k, j] of Object.entries(rep.ci.jobsOnPullRequests)) out.push(`| ${k} | ${j.runs} | ${fmtS(j.medianS)} | ${fmtS(j.p90S)} | ${fmtS(j.setupMedianS)} | ${fmtS(j.queueMedianS)} | ${fmtS(j.queueP90S)} | ${j.runnerMinutes} |`);
  out.push('', 'Jobs on push to main (first attempts):', '');
  out.push('| Job | Runs | Median | p90 | Setup median | Runner minutes |', '| --- | --- | --- | --- | --- | --- |');
  for (const [k, j] of Object.entries(rep.ci.jobsOnPush)) out.push(`| ${k} | ${j.runs} | ${fmtS(j.medianS)} | ${fmtS(j.p90S)} | ${fmtS(j.setupMedianS)} | ${j.runnerMinutes} |`);
  const f = rep.ci.failures;
  out.push('', `Pull-request runs that failed on the first attempt: ${f.runs}. Fixed by a new commit: ${f.fixedByNewCommit}. Green on a rerun of the same commit: ${f.greenOnRerun}. Neither: ${f.other}. Failed jobs: ${Object.entries(f.byJob).map(([j, n]) => `${j} ${n}`).join(', ') || 'none'}.`);
  out.push(`Runs with a second attempt: ${rep.ci.reruns.runs} (green on rerun: ${rep.ci.reruns.greenOnRerun}).`);
  out.push(`Superseded pull-request runs (a newer push to the same PR began before they finished): ${rep.ci.superseded.runs}, ${rep.ci.superseded.runnerMinutes} runner minutes after the newer push.`, '');
  out.push('`ci` on push to main, by the kind of the pull request it merged:', '', '| Kind | Runs | Median wall | Runner minutes |', '| --- | --- | --- | --- |');
  for (const k of KINDS) {
    const v = rep.ci.pushByKind[k];
    if (v) out.push(`| ${k} | ${v.runs} | ${fmtS(v.wallMedianS)} | ${v.runnerMinutes} |`);
  }
  out.push('', 'Setup steps (first attempts):', '', '| Step | Where | Steps | Median | p90 | Minutes |', '| --- | --- | --- | --- | --- | --- |');
  const st = rep.ci.steps;
  for (const [name, where, v] of [['forge build', 'anvil legs, pull requests', st.forgeBuildPr], ['forge build', 'anvil legs, push to main', st.forgeBuildPush], ['pnpm install', 'every job, pull requests', st.installPr], ['pnpm build', 'every job, pull requests', st.buildPr], ['submodules', 'every job, pull requests', st.submodulesPr]])
    out.push(`| ${name} | ${where} | ${v.steps} | ${fmtS(v.medianS)} | ${fmtS(v.p90S)} | ${v.minutes} |`);
  out.push('', 'What if a job ran only when its inputs changed (runs whose change touches none of them):', '', '| Job | Where | Runs | Skipping | Runner minutes saved | Median wall before → after | p90 wall before → after |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const [name, w] of [['formal (TLC)', rep.ci.whatIf.formalOnItsInputs], ['contracts (forge test)', rep.ci.whatIf.contractsOnItsInputs], ['formal, contracts, anvil on docs or task files only', rep.ci.whatIf.docsOnlySkipsChainAndFormal]])
    for (const [where, v] of Object.entries(w)) out.push(`| ${name} | ${where} | ${v.runsOf} | ${v.runsSkipping} | ${v.runnerMinutesSaved} | ${fmtS(v.wallMedianS.before)} → ${fmtS(v.wallMedianS.after)} | ${fmtS(v.wallP90S.before)} → ${fmtS(v.wallP90S.after)} |`);
  out.push('');
  const pr = rep.pullRequests;
  out.push(`Pull requests opened: ${pr.opened} (${pr.perDay} a day). Docs or task files only: ${pr.docsOrTasksOnly} (${pr.docsOrTasksShareBps === null ? '-' : `${(pr.docsOrTasksShareBps / 100).toFixed(1)}%`}).`, '');
  out.push('| Kind | PRs | Merged | `ci` runs | Runner minutes (all workflows) | `ci` wait, minutes (sum of walls) | Open to merge, median | p90 |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const k of KINDS) {
    const v = pr.byKind[k];
    if (v) out.push(`| ${k} | ${v.prs} | ${v.merged} | ${v.ciRuns} | ${v.runnerMinutes} | ${v.ciWaitMinutes} | ${fmtS(v.openToMergeMedianS)} | ${fmtS(v.openToMergeP90S)} |`);
  }
  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading GitHub (read only).

async function gh(args) {
  const { stdout } = await run('gh', args, { maxBuffer: 256 << 20 });
  return JSON.parse(stdout);
}

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

/** Every run created on each day from `sinceMs` to now (one listing per day keeps each under GitHub's 1,000 cap). */
async function readRuns(sinceMs, untilMs) {
  const days = [];
  for (let t = Math.floor(sinceMs / DAY_MS) * DAY_MS; t < untilMs; t += DAY_MS) days.push(iso(t).slice(0, 10));
  const pages = await pool(days, 4, (d) => gh(['api', '-X', 'GET', `repos/${REPO}/actions/runs?created=${d}&per_page=100`, '--paginate', '--slurp']));
  const keep = (r) => ({ id: r.id, name: r.name, path: r.path, event: r.event, status: r.status, conclusion: r.conclusion, run_attempt: r.run_attempt, created_at: r.created_at, run_started_at: r.run_started_at, updated_at: r.updated_at, head_sha: r.head_sha, head_branch: r.head_branch, pull_requests: (r.pull_requests ?? []).map((p) => ({ number: p.number })) });
  return pages.flat().flatMap((p) => p.workflow_runs ?? []).map(keep);
}

const keepJob = (j) => ({ name: j.name, run_attempt: j.run_attempt, conclusion: j.conclusion, created_at: j.created_at, started_at: j.started_at, completed_at: j.completed_at, steps: (j.steps ?? []).map((s) => ({ name: s.name, conclusion: s.conclusion, started_at: s.started_at, completed_at: s.completed_at })) });

async function main() {
  const o = cli({ cache: { type: 'string', default: 'reports/scratch/ci-cache.json' }, out: { type: 'string' }, md: { type: 'string' }, since: { type: 'string' }, until: { type: 'string' }, days: { type: 'string', default: '30' }, offline: { type: 'boolean', default: false } });
  const nowMs = Date.now();
  const untilMs = o.until ? Date.parse(o.until) : nowMs;
  const sinceMs = o.since ? Date.parse(o.since) : untilMs - Number(o.days) * DAY_MS;
  const cachePath = o.cache.startsWith('/') ? o.cache : `${ROOT}/${o.cache}`;
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : { runs: {}, jobs: {}, prs: [] };
  if (!o.offline) {
    for (const r of await readRuns(sinceMs, untilMs)) cache.runs[r.id] = r;
    const need = Object.values(cache.runs).filter((r) => r.status === 'completed' && cache.jobs[r.id]?.attempt !== r.run_attempt);
    process.stderr.write(`reading jobs for ${need.length} runs\n`);
    await pool(need, 8, async (r) => {
      const pages = await gh(['api', '-X', 'GET', `repos/${REPO}/actions/runs/${r.id}/jobs?filter=all&per_page=100`, '--paginate', '--slurp']);
      cache.jobs[r.id] = { attempt: r.run_attempt, jobs: pages.flatMap((p) => p.jobs ?? []).map(keepJob) };
    });
    writeJson(cachePath, cache);
    try {
      const prs = await gh(['pr', 'list', '--repo', REPO, '--state', 'all', '--limit', '5000', '--json', 'number,createdAt,mergedAt,state,headRefName,files,mergeCommit,headRefOid']);
      cache.prs = prs.map((p) => ({ ...p, files: (p.files ?? []).map((f) => f.path) }));
      writeJson(cachePath, cache);
    } catch (e) {
      process.stderr.write(`the pull-request list failed (${String(e.message).split('\n')[0]}); using the cached list of ${cache.prs.length}\n`);
    }
  }
  const jobs = Object.fromEntries(Object.entries(cache.jobs).map(([id, v]) => [id, v.jobs]));
  const body = buildCiReport({ runs: Object.values(cache.runs), jobs, prs: cache.prs, sinceMs, untilMs });
  const doc = { ...envelope('ci-runs', { script: 'scripts/metrics/ci-runs.mjs', commit: gitCommit(ROOT), generatedAt: nowMs, sources: [`GitHub Actions runs and jobs of ${REPO}`, `gh pr list --repo ${REPO}`], gaps: [] }), ...body };
  if (o.out) writeJson(o.out, doc);
  const md = toMarkdown(body);
  if (o.md) writeFileSync(o.md, md);
  process.stdout.write(md);
}

if (isMain(import.meta.url)) await main();
