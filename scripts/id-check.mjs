// The ID check (T-405; the second link T-437). The chain it holds: a pull request names its task, and the task's
// file names its roadmap row or says none; Crow Control's build then ties the row to that work.
//   1. A pull request names the task it works on, a T-number with a task file in docs/tasks/, in its branch (t-405-…),
//      its title or a "Closes T-nnn" line, or it says "no ticket" in its title or body.
//   2. Each task it names has, in its file's header (above the first "## " heading), the line
//        - **Roadmap row:** N70
//      with one roadmap row's ID, several separated by commas ("N109, N119"), a note in brackets after an ID allowed
//      ("N70 (part 1)"), or "none" for work with no row ("none (a CI fix)").
//      The date rule: files filed from 2026-11-13 on must carry it. Task numbers are given in order and T-402 was the
//      first filed that day, so the check reads the number: T-402 and later (FIRST_WITH_ROW). Older files are exempt.
// This repository cannot see the private roadmap, so the check reads the line's shape only; Crow Control's build,
// which reads both repositories, reports an ID that no row answers to. It reads the checkout and the PR event,
// nothing else, and names no private ID: the private repository runs its own check against its own registry, and
// both say the first message in the same words (NO_TASK).
//   3. A task number has one task file (T-464). The check fails when two files in docs/tasks/ share a number, whatever
//      the pull request names, since a second file is how a collision lands; the T-427 pair already on main is excepted
//      by file name (KNOWN_DUPLICATES). Numbers are reserved in the private repository, which this check cannot read:
//      the message says how (RESERVE).
//   node scripts/id-check.mjs                       (in Actions: GITHUB_EVENT_PATH)
//   node scripts/id-check.mjs --title <t> --branch <b> --body <text>
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TASKS = join(root, 'docs', 'tasks');
const T_ID = /(?<![A-Za-z0-9])T-(\d{3})(?![0-9])/gi;
export const FIRST_WITH_ROW = 402;
export const NO_TASK = 'names no task: put its ID in the branch (t-405-…), the title or a "Closes" line, or write "no ticket" in the body';
export const ROW_LINE = /^- \*\*Roadmap rows?:\*\*[ \t]*(.*)$/im;
export const ROW_SHAPE = /^(?:T-\d{3}|[A-Z]{1,2}\d{1,3}[a-z]?)$/;
const HOW = 'with the row\'s ID from the roadmap, several separated by commas, or "none" for work with no row';

// the T-numbers with a task file on this checkout
export function taskIds(dir = TASKS) {
  return new Set(existsSync(dir) ? readdirSync(dir).map((f) => /^(T-\d{3})/.exec(f)?.[1]).filter(Boolean) : []);
}

// The line's value: { ok, none, ids }. "none" with anything after it, or row IDs separated by commas or "and", each
// of a row's shape (T-252, N70, AD4, N1a), with bracketed notes removed first.
export function rowLine(value) {
  const v = String(value ?? '').trim();
  if (/^none\b/i.test(v)) return { ok: true, none: true, ids: [] };
  let bare = v, prev;
  do { prev = bare; bare = bare.replace(/\([^()]*\)/g, ''); } while (bare !== prev);
  const items = bare.split(/,|\band\b/).map((x) => x.trim()).filter(Boolean);
  return items.length && items.every((x) => ROW_SHAPE.test(x)) ? { ok: true, none: false, ids: items } : { ok: false, none: false, ids: [] };
}

// The problems of one task's files (two files may share a number): [] when each carries a well-formed line.
export function rowProblems(id, dir = TASKS) {
  if (Number(id.slice(2)) < FIRST_WITH_ROW || !existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.startsWith(`${id}-`) || f === `${id}.md`).flatMap((f) => {
    const head = readFileSync(join(dir, f), 'utf8').split(/^## /m)[0];
    const m = ROW_LINE.exec(head);
    const file = `docs/tasks/${f}`;
    const count = head.match(new RegExp(ROW_LINE.source, 'gim'))?.length ?? 0;
    if (count > 1) return [`${id}'s task file ${file} has ${count} "Roadmap row:" lines in its header: keep one, ${HOW}`];
    if (!m) return [`${id}'s task file ${file} names no roadmap row: add the line "- **Roadmap row:** N70" to its header, above "## Intent", ${HOW}`];
    if (!rowLine(m[1]).ok) return [`${id}'s task file ${file} has a "Roadmap row:" line that is not a list of row IDs or "none": write "- **Roadmap row:** N70", ${HOW}`];
    return [];
  });
}

// A number taken twice before the rule (T-464), kept by name until its owner renumbers one of them. Any other second
// file, a third T-427 file included, fails.
export const KNOWN_DUPLICATES = Object.freeze({ 'T-427': Object.freeze(['T-427-buyer-path-headroom.md', 'T-427-demo-refresh.md']) });
export const RESERVE = 'a task number has one task file: reserve a new number from a crow-private checkout with node roadmap/ids.mjs reserve "<short title>" --repo holdback, then rename the newer file to it';

// The numbers with more than one task file in dir: [string], one problem each, naming the files.
export function duplicateProblems(dir = TASKS) {
  if (!existsSync(dir)) return [];
  const by = new Map();
  for (const f of readdirSync(dir).filter((x) => /^T-\d{3}(?:[-.]|$)/.test(x)).sort()) {
    const id = f.slice(0, 5);
    by.set(id, [...(by.get(id) ?? []), f]);
  }
  const out = [];
  for (const [id, files] of by) {
    if (files.length < 2) continue;
    const known = KNOWN_DUPLICATES[id];
    if (known && files.length === known.length && files.every((f) => known.includes(f))) continue;
    out.push(`${id} has ${files.length} task files (${files.map((f) => `docs/tasks/${f}`).join(', ')}): ${RESERVE}`);
  }
  return out;
}

// { ok, ids, reason }
// The body without its closed HTML comments: the pull request template's guidance ("write no ticket …", "T-xxx") is
// not the author's answer, and GitHub keeps the comments in the body. An unclosed "<!--" (often code in backticks)
// stays, text and all.
export const uncommented = (text) => String(text ?? '').replace(/<!--[\s\S]*?-->/g, ' ');
export function checkPr({ title = '', branch = '', body: raw = '' } = {}, ids = taskIds(), dir = TASKS) {
  const body = uncommented(raw);
  const named = [...new Set([...`${branch} ${title} ${body}`.matchAll(T_ID)].map((m) => `T-${m[1]}`))].filter((id) => ids.has(id));
  if (named.length) {
    const problems = named.flatMap((id) => rowProblems(id, dir));
    return problems.length ? { ok: false, ids: named, reason: problems.join('; ') } : { ok: true, ids: named, reason: `names ${named.join(', ')}, and each task file names its roadmap row or says none` };
  }
  if (/\bno ticket\b/i.test(`${title} ${body}`)) return { ok: true, ids: [], reason: 'says "no ticket"' };
  return { ok: false, ids: [], reason: NO_TASK };
}

// The whole check, as the workflow runs it: one number one file, then the pull request's links.
export function runCheck(pr, dir = TASKS) {
  const dups = duplicateProblems(dir);
  const r = checkPr(pr, taskIds(dir), dir);
  if (!dups.length) return r;
  return { ok: false, ids: r.ids, reason: [...dups, ...(r.ok ? [] : [r.reason])].join('; ') };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  let pr = { title: opt('--title') ?? '', branch: opt('--branch') ?? '', body: opt('--body') ?? '' };
  if (!opt('--title') && process.env.GITHUB_EVENT_PATH) {
    const ev = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request ?? {};
    pr = { title: ev.title ?? '', branch: ev.head?.ref ?? '', body: ev.body ?? '' };
  }
  const r = runCheck(pr);
  console.log(`ID check: ${r.ok ? 'pass' : 'fail'}: ${r.reason}`);
  if (!r.ok) process.exit(1);
}
