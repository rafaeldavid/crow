// T-509 (row N180): converts each fetched security review report to the security-review form's JSON by fixed
// rules, fills the form's terms with what the report itself states, and runs today's checks with the adjudicator's
// own first stage (examples/check-delivery.ts, unchanged). Writes results.json beside this file: counts, check
// results and causes, and no report text. The converted reports and terms stay in <out folder>.
//
//   node docs/research/2026-11-18-report-corpus/fetch.mjs <corpus folder>
//   node docs/research/2026-11-18-report-corpus/measure.mjs <corpus folder> <out folder>
//
// Run from a checkout after `pnpm install && pnpm build`: the check runner imports the built @holdback/judgment.
// The converter reads report text as data. It runs nothing from a report and changes no word of what it carries:
// it only cuts text into sections and copies each section into a field.
//
// The rules were written from the design set (three firms). The held-out firms (heldout.json) only run through
// the same rules; a rule that fails on them is a finding, not a bug to fix here. A firm's own layout file
// (layouts/<firm>.json, T-534) is written from that firm's older reports only and applies to that firm alone. Each
// report's set comes from sources.json.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const [corpus, outDir] = process.argv.slice(2);
// --only <set>: run one set and print it, writing no results.json (T-534: to check a layout on its layout set before
// the held-out set is measured once).
const onlyAt = process.argv.indexOf('--only');
const only = onlyAt > 0 ? process.argv[onlyAt + 1] : undefined;
if (!corpus || !outDir) {
  console.error('usage: node measure.mjs <corpus folder> <out folder>');
  process.exit(2);
}
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const template = JSON.parse(readFileSync(join(root, 'examples/seller-adapter.template.json'), 'utf8'));

// The form's limits, read from the template so the script follows it if it changes.
const findingSchema = template.checks.find((c) => c.id === 'report').schema.properties.findings.items;
const LIMIT = Object.fromEntries(['title', 'rootCause', 'impact', 'recommendedFix'].map((k) => [k, findingSchema.properties[k].maxLength]));
// T-534: what the form requires of a finding, and whether it holds a proof check by default (version 2 does not).
const REQUIRED = new Set(findingSchema.required);
const PROOF_BY_DEFAULT = template.checks.some((c) => c.id === 'proof');
const templateSha256 = createHash('sha256').update(readFileSync(join(root, 'examples/seller-adapter.template.json'))).digest('hex');
const MEDIUM_UP = new Set(['Critical', 'High', 'Medium']);
// packages/judgment/src/hidden.ts, HIDDEN_GLOBAL: the classes the `hidden` check counts.
const HIDDEN = /[\u{E0000}-\u{E007F}؜‎‏‪-‮⁦-⁩︀-️\u{E0100}-\u{E01EF}᠋-᠍᠏­͏ᅟᅠ឴឵᠎​-‍⁠-⁤⁪-⁯ㅤ﻿ﾠ\u{1D173}-\u{1D17A}]/gu;
const JUDGE_READ = 100_000; // DEFAULT_MAX_DATA_CHARS, packages/judgment/src/prompt.ts

// ---------- Text ----------

/**
 * PDF text without page furniture: a line among the first or last three of a page that repeats, digits aside, on
 * half the pages or more (headers and footers), and lone page numbers.
 */
function pdfBody(text) {
  const pages = text.split('\f').map((p) => p.split('\n'));
  const key = (l) => l.replace(/[\s​]+/g, ' ').trim().replace(/\d+/g, '#');
  const edges = (p) => {
    const idx = p.map((l, i) => [l, i]).filter(([l]) => key(l));
    return new Set([...idx.slice(0, 3), ...idx.slice(-3)].map(([, i]) => i));
  };
  const seen = new Map();
  for (const p of pages) {
    const e = edges(p);
    for (const k of new Set([...e].map((i) => key(p[i])))) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const furniture = new Set([...seen].filter(([, n]) => pages.length >= 4 && n >= pages.length / 2).map(([k]) => k));
  const lines = [];
  for (const p of pages) {
    const e = edges(p);
    p.forEach((l, i) => {
      const k = key(l);
      if ((e.has(i) && furniture.has(k)) || /^#$/.test(k)) return;
      lines.push(l.replace(/\s+$/, ''));
    });
  }
  // A URL that pdftotext broke at the line width: the next line, starting in the first column, carries it on.
  const out = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && /https?:\/\/\S+$/.test(prev) && /^\S/.test(l) && !/^https?:/.test(l)) out[out.length - 1] = prev + l;
    else out.push(l);
  }
  return out;
}

const SECTION = {
  rootCause: ['description', 'summary', 'vulnerability detail', 'vulnerability details', 'root cause', 'details', 'finding description'],
  impact: ['impact', 'impacts', 'exploit scenario', 'attack flow example', 'example scenario', 'attack scenario', 'attack path'],
  recommendedFix: ['recommendation', 'recommendations', 'recommended mitigation', 'mitigation', 'recommended fix', 'fix'],
  locations: ['code snippet', 'affected files', 'affected code', 'context', 'target', 'source'],
  // A proof of concept in prose has no file path, so it cannot become `pocFiles` without inventing one: counted, dropped.
  dropped: ['proof of concept', 'poc', 'discussion', 'client commentary', 'fix implemented', 'tool used', 'severity', 'likelihood', 'status', 'fix review', 'fix status', 'resolution', 'client response'],
};
const LABEL = new Map(Object.entries(SECTION).flatMap(([field, names]) => names.map((n) => [n, field])));

// A firm's own layout (T-534): layouts/<firm>.json, data written from that firm's layout-set reports only, applied
// to that firm's reports alone. It adds section labels and a scope rule; it changes nothing for any other firm.
const LAYOUTS = Object.fromEntries(
  (existsSync(join(here, 'layouts')) ? readdirSync(join(here, 'layouts')) : [])
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(here, 'layouts', f), 'utf8')))
    .map((l) => [l.firm, l]),
);
let labels = LABEL; // the labels of the report being converted: LABEL, plus its firm's layout labels
const labelsFor = (layout) => new Map([...LABEL, ...Object.entries(layout?.sections ?? {}).flatMap(([field, names]) => names.map((n) => [n, field]))]);

/** A section label at the start of a line: `## Description`, `Description`, `Recommendation:`, `**Impact:** Low`. */
function labelOf(line, md) {
  let t = line.trim();
  if (md) {
    if (!/^#{2,4}\s/.test(t)) return undefined;
    t = t.replace(/^#{2,4}\s*/, '');
  }
  // Markdown: a heading whose first words are a label. PDF text: the label alone, or the label, a colon and text.
  const m = md ? /^\**([A-Za-z][A-Za-z ]{1,30}?)\**\s*(?::\s*\**\s*(.*)|$)/.exec(t) : /^([A-Za-z][A-Za-z ]{1,30}?)\s*(?::\s*(.*))?$/.exec(t);
  if (!m) return undefined;
  const name = m[1].toLowerCase().trim();
  const field = labels.get(name);
  if (!field) return undefined;
  return { field, name, rest: (m[2] ?? '').trim() };
}

// ---------- Findings ----------

const LETTER = { C: 'Critical', H: 'High', M: 'Medium', L: 'Low', I: 'Info', G: 'Info', N: 'Info', Q: 'Info' };
const WORD = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', informational: 'Info', info: 'Info', note: 'Info' };

/** Finding headers, by the three layouts of the design set. Returns [{start, id, title, severity, status}]. */
function findHeaders(lines, md) {
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if (md && (m = /^#{1,3}\s*\[([A-Z]{1,2})-(\d+)\]\s*(.+)$/.exec(l))) {
      heads.push({ start: i, bodyStart: i + 1, id: `${m[1]}-${m[2]}`, title: m[3].trim(), severity: LETTER[m[1][0]] });
    } else if (!md && (m = /^\s{0,6}Issue ([A-Z])-(\d+):\s*(.*)$/.exec(l))) {
      let title = m[3].trim(), j = i + 1;
      while (j < lines.length && lines[j].trim() && !labelOf(lines[j], false)) title += ' ' + lines[j++].trim();
      heads.push({ start: i, bodyStart: j, id: `${m[1]}-${m[2]}`, title, severity: LETTER[m[1]] });
    } else if (!md && (m = /^\s{0,8}(\d{1,3}(?:\.\d{1,3}){0,3})\.?\s+(\S.{2,})$/.exec(l))) {
      // A numbered heading with a `Severity:` label within the next 8 lines (a header table).
      const near = lines.slice(i + 1, i + 9);
      const sev = near.map((x) => /Severity:\s*([A-Za-z]+)/.exec(x)).find(Boolean);
      if (!sev) continue;
      const idLine = near.map((x) => /Finding ID:\s*(\S+)/.exec(x)).find(Boolean);
      let end = i + 1;
      while (end < i + 9 && end < lines.length && !/^\s*(Description|Summary)\s*:?\s*$/i.test(lines[end])) end++;
      const target = near.map((x) => /Target:\s*(.+)$/.exec(x)).find(Boolean);
      heads.push({ start: i, bodyStart: end, id: idLine ? idLine[1] : m[1], title: m[2].trim(), severity: WORD[sev[1].toLowerCase()], severityWord: sev[1], target: target ? target[1].trim() : undefined });
    }
  }
  return heads;
}

/** Where the findings end: an appendix heading, or for Markdown the next top-level heading that is no finding. */
function endOf(lines, from, md) {
  for (let i = from; i < lines.length; i++) {
    if (md && /^#\s/.test(lines[i]) && !/^#\s*\[/.test(lines[i])) return i;
    if (!md && /^\s{0,4}([A-Z]\.\s+[A-Z][a-z]|Appendix\b|Disclaimers?\s*$)/.test(lines[i])) return i;
  }
  return lines.length;
}

const STATUS = [[/\b(resolved|fixed)\b/i, 'fixed'], [/\backnowledged\b/i, 'acknowledged']];
const statusOf = (s) => STATUS.find(([re]) => re.test(s))?.[1];

function sectionsOf(body, md) {
  const out = []; // {field, name, text}
  let cur = { field: 'preamble', name: 'preamble', lines: [] };
  for (const l of body) {
    const lab = labelOf(l, md);
    if (lab) {
      out.push(cur);
      cur = { field: lab.field, name: lab.name, lines: lab.rest ? [lab.rest] : [] };
    } else cur.lines.push(l);
  }
  out.push(cur);
  return out.map((s) => ({ field: s.field, name: s.name, text: s.lines.join('\n').replace(/^\n+|\s+$/g, '') }));
}

// ---------- Locations, scope, commit ----------

const EXT = '(?:sol|rs|go|ts|tsx|js|py|move|cairo|vy|c|h|cc|cpp|toml|json|yaml|yml|sql|nr|circom)';
const PATH_RE = new RegExp(`(?:https://github\\.com/[^/\\s]+/[^/\\s]+/blob/[^/\\s]+/)?([A-Za-z0-9_@.\\-/]*[A-Za-z0-9_\\-]\\.${EXT})(?:(?:#L|:)(\\d+)(?:\\s*[-–]\\s*L?(\\d+))?)?\\b`, 'g');

function pathsIn(text) {
  const found = [];
  for (const m of text.matchAll(PATH_RE)) {
    const start = m[2] ? Number(m[2]) : undefined;
    const end = m[3] ? Number(m[3]) : start;
    found.push({ path: m[1].replace(/^\.?\//, ''), url: m[0].startsWith('https://'), ...(start ? { start, end } : {}) });
  }
  return found;
}

/** The scope entry a path names: equal, or one ends with the other at a '/' boundary, when exactly one entry does. */
function inScope(path, scope) {
  const hits = scope.filter((s) => s === path || path.endsWith('/' + s) || s.endsWith('/' + path));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return hits.find((s) => s === path) ?? hits.sort((a, b) => b.length - a.length)[0];
  return undefined;
}

function statedScope(lines, md, findingsStart, layout) {
  const files = [];
  if (md && layout?.scope) {
    // The firm's layout: a scope heading, then a table whose first cell in each row is a path (T-534).
    const heading = new RegExp(layout.scope.heading, 'i');
    const { headerCells = [], skipCells = [], trimTrailing = '' } = layout.scope.table ?? {};
    const i = lines.findIndex((l, k) => k < findingsStart && heading.test(l));
    if (i < 0) return undefined;
    for (let j = i + 1; j < findingsStart && !/^#/.test(lines[j]); j++) {
      const m = /^\|\s*([^|]*?)\s*\|/.exec(lines[j]);
      if (!m) continue;
      let cell = m[1].replace(/`/g, '').trim();
      if (!cell || /^:?-+:?$/.test(cell) || headerCells.includes(cell.toLowerCase()) || skipCells.includes(cell.toLowerCase())) continue;
      while (trimTrailing && cell.length && trimTrailing.includes(cell[cell.length - 1])) cell = cell.slice(0, -1);
      files.push(cell);
    }
  } else if (md) {
    const i = lines.findIndex((l) => /^#\s+Scope\s*$/i.test(l));
    if (i < 0) return undefined;
    for (let j = i + 1; j < lines.length && !/^#\s/.test(lines[j]); j++) {
      const m = /^\s*[-*]\s+`?([^`]+?)`?\s*$/.exec(lines[j]);
      if (m) files.push(m[1].trim());
    }
  } else {
    // Every `Files:` list before the findings (a report on several repositories has one per repository).
    for (let i = 0; i < findingsStart; i++) {
      if (!/^\s*Files\s*:?\s*$/i.test(lines[i])) continue;
      for (let j = i + 1; j < findingsStart; j++) {
        const t = lines[j].trim();
        if (!t) continue;
        const m = /^[•●\-*]\s*(\S+)\s*$/.exec(t);
        if (!m) break;
        files.push(m[1]);
      }
    }
  }
  return files.length ? [...new Set(files)] : undefined;
}

function commitsOf(lines, md, findingsStart) {
  const front = lines.slice(0, findingsStart);
  const values = [];
  for (const l of front) {
    if (md) {
      if (/review commit hash/i.test(l) && !/fix(es)? review/i.test(l)) values.push(...[...l.matchAll(/\[([0-9a-fA-F]{7,40})\]/g)].map((m) => m[1]));
    } else {
      const m = /^\s*(Audited Commit|Commit Hash|Commit|Version|Review Commit)\s*[:​]?\s+(\S+)\s*$/i.exec(l.replace(/​/g, ' '));
      if (m) values.push(m[2]);
    }
  }
  return [...new Set(values)];
}

// ---------- One report ----------

function convert(r) {
  const layout = LAYOUTS[r.firm];
  labels = layout ? labelsFor(layout) : LABEL;
  const dir = join(corpus, r.id);
  const md = existsSync(join(dir, 'report.md'));
  const raw = readFileSync(join(dir, md ? 'report.md' : 'report.txt'), 'utf8');
  const lines = md ? raw.split('\n') : pdfBody(raw);
  const text = lines.join('\n');
  // The text the rules read, for checking them by eye. It stays in the out folder with the converted report.
  mkdirSync(join(outDir, r.id), { recursive: true });
  writeFileSync(join(outDir, r.id, 'body.txt'), text);
  const notes = []; // why the report does not map, one cause per entry
  const lost = { findingsNotParsed: 0, sectionsDropped: {}, preambleChars: 0, locationsOutOfScope: 0, statusWordsUnmapped: 0 };

  const heads = findHeaders(lines, md);
  const findingsStart = heads.length ? heads[0].start : lines.length;
  const findingsEnd = heads.length ? endOf(lines, heads[heads.length - 1].bodyStart, md) : findingsStart;
  writeFileSync(join(outDir, r.id, 'headers.json'), JSON.stringify({ findingsEnd, heads: heads.map((h) => ({ line: h.start + 1, body: h.bodyStart + 1, id: h.id })) }));

  // A looser count of finding identifiers anywhere in the text (summary tables included), to see whether the header
  // rules missed any: `[H-01]` or `[H-1]`, `Issue H-1`, and `TOB-…-N`, at any position in a line.
  const idPatterns = [/\[([CHMLIGNQ]-\d{1,3})\]/g, /\bIssue ([CHMLI]-\d{1,3})\b/g, /\b(TOB-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d+)\b/g];
  const ids = new Set(idPatterns.flatMap((re) => [...text.matchAll(re)].map((m) => m[1])));
  if (ids.size > heads.length) lost.findingsNotParsed = ids.size - heads.length;

  const commits = commitsOf(lines, md, findingsStart);
  const stated = statedScope(lines, md, findingsStart, layout);
  let commit;
  if (commits.length === 0) notes.push('commit: the report names no commit');
  else if (commits.length > 1) notes.push('commit: the report reviews more than one commit or repository; the form holds one');
  else if (!/^[0-9a-f]{40}$/.test(commits[0])) notes.push('commit: the report names a tag or a short hash, not a 40-character commit');
  else commit = commits[0];

  const findings = [];
  const derived = new Set();
  heads.forEach((h, k) => {
    const bodyEnd = k + 1 < heads.length ? heads[k + 1].start : findingsEnd;
    const body = lines.slice(h.bodyStart, bodyEnd);
    let status = undefined;
    let title = h.title;
    const tStatus = /\s*\[([A-Z ]+)\]\s*$/.exec(title);
    if (tStatus) { status = statusOf(tStatus[1]); if (!status) lost.statusWordsUnmapped++; title = title.slice(0, tStatus.index).trim(); }
    const sections = sectionsOf(body, md);
    const parts = { rootCause: [], impact: [], recommendedFix: [] };
    for (const s of sections) {
      if (!s.text) continue;
      if (s.field === 'preamble') {
        const st = /^_([A-Za-z ]+)_\s*$/m.exec(s.text);
        let rest = s.text;
        if (st) { status = statusOf(st[1]); if (!status) lost.statusWordsUnmapped++; rest = s.text.replace(st[0], '').trim(); }
        if (rest) parts.rootCause.push(rest), (lost.preambleChars += rest.length);
      } else if (s.field === 'impact' && /^(low|medium|high|critical)\b.{0,80}$/i.test(s.text)) {
        lost.sectionsDropped['impact rating'] = (lost.sectionsDropped['impact rating'] ?? 0) + s.text.length;
      } else if (parts[s.field]) parts[s.field].push(s.text);
      else lost.sectionsDropped[s.name] = (lost.sectionsDropped[s.name] ?? 0) + s.text.length;
    }
    // Locations: the header's target, then every path the finding's text names.
    const cand = [...(h.target ? h.target.split(/,\s*/).map((p) => ({ path: p.trim() })) : []), ...pathsIn(body.join('\n'))];
    // A contract or module named as a whole word that is a scope file's name without its extension (`PSMVault` for
    // PSMVault.sol), when exactly one scope file has that name. The title counts too.
    if (stated) {
      const words = new Set(`${title}\n${body.join('\n')}`.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? []);
      const stems = new Map();
      for (const s of stated) { const stem = s.split('/').pop().replace(/\.[A-Za-z]+$/, ''); stems.set(stem, stems.has(stem) ? null : s); }
      for (const [stem, s] of stems) if (s && words.has(stem) && !cand.some((c) => inScope(c.path, stated) === s)) cand.push({ path: s });
    }
    const locs = new Map();
    for (const c of cand) {
      let file;
      if (stated) file = inScope(c.path, stated);
      else if (c.url || h.target?.includes(c.path) || c.path.includes('/')) file = c.path.replace(/^[^/]+\/(?=src\/|contracts\/|crates\/|pkg\/|packages\/)/, '');
      if (!file) { lost.locationsOutOfScope++; continue; }
      const loc = { file, ...(c.start ? { lines: { start: Math.min(c.start, c.end), end: Math.max(c.start, c.end) } } : {}) };
      locs.set(JSON.stringify(loc), loc);
      if (!stated) derived.add(file);
    }
    // A file named once with lines and once without: keep the ones with lines.
    const list = [...locs.values()].filter((l, _, all) => l.lines || !all.some((o) => o.file === l.file && o.lines));
    const f = {
      id: `F-${String(k + 1).padStart(2, '0')}`,
      severity: h.severity,
      ...(status ? { status } : {}),
      title: `[${h.id}] ${title}`,
      locations: list,
      rootCause: parts.rootCause.join('\n\n'),
      ...(parts.impact.length ? { impact: parts.impact.join('\n\n') } : {}),
      recommendedFix: parts.recommendedFix.join('\n\n'),
    };
    if (!f.severity) delete f.severity;
    if (!f.rootCause) delete f.rootCause;
    if (!f.recommendedFix) delete f.recommendedFix;
    findings.push({ f, severityWord: h.severityWord });
  });

  const filesReviewed = stated ?? [...derived];
  const report = {
    commit: commit ?? (commits[0] ?? ''),
    ...(/^\d{4}-\d{2}-\d{2}$/.test(r.date) ? { reportDate: r.date } : {}),
    filesReviewed,
    findings: findings.map((x) => x.f),
  };

  // Does every finding map with nothing lost? One cause per kind, counted per finding.
  const perFinding = {};
  const add = (k) => (perFinding[k] = (perFinding[k] ?? 0) + 1);
  for (const { f, severityWord } of findings) {
    if (!f.severity) add(`severity: "${severityWord}" has no place on the form's scale`);
    // A field the form does not require is no cause (T-534: version 2 requires neither a location nor a fix).
    if (!f.locations.length && REQUIRED.has('locations')) add('location: the finding names no file in scope');
    if (!f.rootCause) add('root cause: no description text found');
    if (!f.recommendedFix && REQUIRED.has('recommendedFix')) add('recommended fix: no separate recommendation section (a model would have to cut it out of the prose)');
  }
  if (lost.findingsNotParsed) notes.push(`findings: ${lost.findingsNotParsed} finding identifiers in the text match no finding header the rules know`);
  if (!heads.length && ids.size === 0 && !/no (security )?(issues|findings|vulnerabilities)/i.test(text)) notes.push('findings: the rules find no finding and the report does not say it has none');
  if (!filesReviewed.length) notes.push('scope: the report lists no files and its findings name none');
  for (const [k, n] of Object.entries(perFinding)) notes.push(`${k} (${n} of ${findings.length} findings)`);

  // What the form's own limits and checks would say, computed here per finding (the runner names only the first).
  const over = {};
  for (const { f } of findings) for (const k of Object.keys(LIMIT)) if (typeof f[k] === 'string' && f[k].length > LIMIT[k]) over[k] = (over[k] ?? 0) + 1;
  const proofNeeded = findings.filter(({ f }) => MEDIUM_UP.has(f.severity)).length;
  const hiddenChars = [...JSON.stringify(report).matchAll(HIDDEN)].map((m) => m[0]);
  const hidden = hiddenChars.length;
  const hiddenByCodePoint = hiddenChars.reduce((m, c) => { const k = 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  const maxLength = {};
  for (const { f } of findings) for (const k of Object.keys(LIMIT)) if (typeof f[k] === 'string') maxLength[k] = Math.max(maxLength[k] ?? 0, f[k].length);

  // Every reason this report cannot be delivered as published, one key per kind: what stands between it and an accept.
  const blockers = new Set();
  for (const n of notes) blockers.add(n.split(':')[0] + (n.startsWith('commit') ? (n.includes('more than one') ? ' (several)' : n.includes('tag') ? ' (not 40 characters)' : ' (none)') : ''));
  if (Object.keys(over).length) blockers.add('text over a field limit');
  if (proofNeeded && PROOF_BY_DEFAULT) blockers.add('proof files');
  if (hidden) blockers.add('hidden characters');

  // Characters: the source, the part inside findings, and what the JSON fields carry.
  const carried = findings.reduce((n, { f }) => n + f.title.length + (f.rootCause?.length ?? 0) + (f.impact?.length ?? 0) + (f.recommendedFix?.length ?? 0), 0);
  const inFindings = lines.slice(findingsStart, findingsEnd).join('\n').length;

  return {
    report,
    stated: Boolean(stated),
    stats: {
      format: md ? 'Markdown' : 'PDF',
      sourceChars: text.length,
      findingsChars: inFindings,
      carriedChars: carried,
      outsideFindingsChars: text.length - inFindings,
      findings: findings.length,
      bySeverity: findings.reduce((m, { f }) => ((m[f.severity ?? 'unmapped'] = (m[f.severity ?? 'unmapped'] ?? 0) + 1), m), {}),
      locations: findings.reduce((n, { f }) => n + f.locations.length, 0),
      scope: stated ? `stated, ${filesReviewed.length} files` : `derived from the findings, ${filesReviewed.length} files`,
      commits: commits.length,
      fieldsOverLimit: over,
      longestField: maxLength,
      mediumOrHigher: proofNeeded,
      hiddenCharacters: hidden,
      hiddenByCodePoint,
      blockers: [...blockers].sort(),
      jsonChars: JSON.stringify(report, null, 2).length,
      lost,
    },
    notes,
  };
}

/**
 * The form with today's check-level limits lifted, for the what-if run only: no proof check, no length limit on a
 * finding's texts, a location list that may be empty, and a recommended fix that may be left out. The report gets
 * its zero-width characters removed. Nothing here changes the template file.
 */
function relaxed(checks) {
  const c = structuredClone(checks);
  const f = c.find((x) => x.id === 'report').schema.properties.findings.items;
  for (const k of Object.keys(LIMIT)) delete f.properties[k].maxLength;
  f.required = f.required.filter((k) => k !== 'locations' && k !== 'recommendedFix');
  delete f.properties.locations.minItems;
  // Version 1's scope rule (every finding has a location, each in scope); version 2's already allows none.
  const scopeItems = c.find((x) => x.id === 'scope').schema.properties.findings.items;
  if (scopeItems.properties?.locations) delete scopeItems.properties.locations.minItems;
  if (scopeItems.required) scopeItems.required = [];
  return c.filter((x) => x.id !== 'proof');
}

function termsFor(report, proof, relax = false) {
  const scope = { commit: /^[0-9a-f]{40}$/.test(report.commit) ? report.commit : '0'.repeat(40), files: report.filesReviewed.length ? report.filesReviewed : ['(none)'] };
  const fill = (node) => {
    if (typeof node === 'string') {
      const whole = /^\{\{(\w+)(\.length)?\}\}$/.exec(node);
      if (whole) return structuredClone(whole[2] ? scope[whole[1]].length : scope[whole[1]]);
      return node.replace(/\{\{(\w+)(\.length)?\}\}/g, (_, n, len) => (len ? String(scope[n].length) : Array.isArray(scope[n]) ? scope[n].join(', ') : String(scope[n])));
    }
    if (Array.isArray(node)) return node.map(fill);
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fill(v)]));
    return node;
  };
  const filled = fill(template.checks);
  const checks = relax ? relaxed(filled) : filled.filter((c) => proof || c.id !== 'proof');
  return { deliverable: fill(template.deliverable), acceptance: { deterministicChecks: checks, rubric: { criteria: [], passThreshold: 0 } } };
}

function runChecks(dir, name, report, proof, relax = false, strip = relax) {
  const termsPath = join(dir, `terms-${name}.json`);
  writeFileSync(termsPath, JSON.stringify(termsFor(report, proof, relax), null, 2));
  let file = join(dir, 'report.json');
  if (strip) {
    // The seller's step before it delivers (T-534, decision 2): zero-width characters out, every other one kept.
    file = join(dir, `report-${name}.json`);
    writeFileSync(file, JSON.stringify(report, null, 2).replace(/[​-‍⁠﻿]/g, ''));
  }
  const res = spawnSync(process.execPath, [join(root, 'examples/check-delivery.ts'), termsPath, file, '--json'], { cwd: root, encoding: 'utf8' });
  if (res.status === 2 && !res.stdout) throw new Error(`check-delivery could not run: ${res.stderr.split('\n')[0]}`);
  const out = JSON.parse(res.stdout);
  return {
    result: out.result,
    exitCode: res.status,
    checks: Object.fromEntries(out.deterministic.map((o) => [o.checkId, o.passed ? 'pass' : `FAIL${o.detail ? `: ${o.detail}` : ''}`])),
  };
}

// ---------- All reports ----------

// Each report's set: its own `set` in sources.json, else its firm's (design, heldout, and T-534's heldout-2 and layout-2).
const setOf = (r) => r.set ?? sources.firms[r.firm].set;
const rows = [];
for (const r of sources.reports.filter((x) => !only || setOf(x) === only)) {
  const c = convert(r);
  const dir = join(outDir, r.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify(c.report, null, 2));
  const withProof = runChecks(dir, 'default', c.report, true);
  const noProof = runChecks(dir, 'no-proof', c.report, false);
  const relaxedRun = runChecks(dir, 'relaxed', c.report, false, true);
  const stripped = runChecks(dir, 'stripped', c.report, true, false, true);
  rows.push({ id: r.id, set: setOf(r), maps: c.notes.length === 0, notes: c.notes, ...c.stats, defaultTerms: withProof, noProofTerm: noProof, strippedDefaultTerms: stripped, relaxedWhatIf: relaxedRun });
  console.log(`${r.id.padEnd(11)} ${setOf(r).padEnd(9)} findings ${String(c.stats.findings).padStart(3)}  maps ${c.notes.length === 0 ? 'yes' : 'no '}  default ${withProof.result.padEnd(6)}  no-proof ${noProof.result.padEnd(6)}  stripped ${stripped.result}`);
}

const summary = {};
for (const set of [...new Set(rows.map((x) => x.set)), 'all']) {
  const rs = rows.filter((x) => set === 'all' || x.set === set);
  const mapped = rs.filter((x) => x.maps);
  const causes = {};
  for (const x of rs) for (const n of x.notes) { const k = n.replace(/ \(\d+ of \d+ findings\)$/, ''); causes[k] = (causes[k] ?? 0) + 1; }
  const checkFails = (terms, among) => {
    const m = {};
    for (const x of among) for (const [id, v] of Object.entries(x[terms].checks)) if (v !== 'pass') m[id] = (m[id] ?? 0) + 1;
    return m;
  };
  // What-if, one change at a time: the reports left with no blocker once that one kind of blocker is gone.
  const kinds = [...new Set(rs.flatMap((x) => x.blockers))].sort();
  const reportsWithBlocker = Object.fromEntries(kinds.map((k) => [k, rs.filter((x) => x.blockers.includes(k)).length]));
  const passIfRemoved = Object.fromEntries(kinds.map((k) => [k, rs.filter((x) => x.blockers.every((b) => b === k)).length]));
  summary[set] = {
    reports: rs.length,
    reportsWithNoBlocker: rs.filter((x) => x.blockers.length === 0).length,
    reportsWithBlocker,
    passIfOnlyThisBlockerRemoved: passIfRemoved,
    relaxedWhatIfAccepted: rs.filter((x) => x.relaxedWhatIf.result === 'accept').length,
    relaxedWhatIfAcceptedAmongMappable: rs.filter((x) => x.relaxedWhatIf.result === 'accept' && x.notes.every((n) => /^(location|recommended fix)/.test(n))).length,
    findings: rs.reduce((n, x) => n + x.findings, 0),
    mapWithNoFindingLost: mapped.length,
    ofThoseAcceptedDefaultTerms: mapped.filter((x) => x.defaultTerms.result === 'accept').length,
    ofThoseAcceptedNoProofTerm: mapped.filter((x) => x.noProofTerm.result === 'accept').length,
    allAcceptedDefaultTerms: rs.filter((x) => x.defaultTerms.result === 'accept').length,
    allAcceptedNoProofTerm: rs.filter((x) => x.noProofTerm.result === 'accept').length,
    allAcceptedDefaultTermsStripped: rs.filter((x) => x.strippedDefaultTerms.result === 'accept').length,
    // The form's headline (T-534): a review of several repositories is several deals, so a report that passes only
    // because the converter kept its first commit and dropped the others is not counted.
    acceptedOneCommit: rs.filter((x) => x.defaultTerms.result === 'accept' && x.commits <= 1).length,
    acceptedOneCommitStripped: rs.filter((x) => x.strippedDefaultTerms.result === 'accept' && x.commits <= 1).length,
    reportsNotMappingByCause: causes,
    failingChecksAmongMappedDefault: checkFails('defaultTerms', mapped),
    failingChecksAmongMappedNoProof: checkFails('noProofTerm', mapped),
    failingChecksAllDefault: checkFails('defaultTerms', rs),
    findingsOverAFieldLimit: rs.reduce((m, x) => { for (const [k, n] of Object.entries(x.fieldsOverLimit)) m[k] = (m[k] ?? 0) + n; return m; }, {}),
    findingsMediumOrHigher: rs.reduce((n, x) => n + x.mediumOrHigher, 0),
    reportsWithHiddenCharacters: rs.filter((x) => x.hiddenCharacters > 0).length,
    reportsOverJudgeRead: rs.filter((x) => x.jsonChars > JUDGE_READ).length,
    sourceChars: rs.reduce((n, x) => n + x.sourceChars, 0),
    carriedChars: rs.reduce((n, x) => n + x.carriedChars, 0),
    outsideFindingsChars: rs.reduce((n, x) => n + x.outsideFindingsChars, 0),
    droppedSectionChars: rs.reduce((m, x) => { for (const [k, n] of Object.entries(x.lost.sectionsDropped)) m[k] = (m[k] ?? 0) + n; return m; }, {}),
    locationsOutOfScope: rs.reduce((n, x) => n + x.lost.locationsOutOfScope, 0),
  };
}
// The form measured, by version and hash: tests/security-review-form.test.ts fails when the template changes and
// this file was not rewritten by a new run (T-534).
if (!only) writeFileSync(join(here, 'results.json'), JSON.stringify({ template: 'examples/seller-adapter.template.json', form: template.form ?? { name: 'security-review', version: 1 }, templateSha256, summary, reports: rows }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
