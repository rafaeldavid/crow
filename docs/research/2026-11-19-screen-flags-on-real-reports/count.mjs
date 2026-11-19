// T-557 (row N40): runs the adjudicator's screen over the published security reports of the T-509/T-534 corpus,
// once as published and once as the security-review form's JSON, and counts the signals. Writes results.json beside
// this file: counts, signal kinds, code points and the short matched phrases, and no other report text.
//
//   node docs/research/2026-11-18-report-corpus/fetch.mjs <corpus folder>       (once, fetches the reports)
//   node docs/research/2026-11-19-screen-flags-on-real-reports/count.mjs <corpus folder> <out folder> [--reuse]
//
// Run from a checkout after `pnpm install && pnpm build`: the script imports the built @holdback/judgment and runs
// what the adjudicator runs on a delivery: decodePlaintext (strict UTF-8, normalizeText) and then the screen that
// the bound policy names, through the kept table (packages/judgment/src/pipeline.ts, runPipeline). It screens with
// every kept screen version; screen-1 is the default (apps/adjudicator/src/kept-policies.json).
//
// The converted form comes from the corpus's own converter: the script runs measure.mjs with --only for each set,
// which writes the converted reports into <out folder>/converted and leaves measure.mjs's results.json untouched.
//
// Reports are untrusted data. The script reads their bytes, screens them and runs nothing from them. The phrase
// attribution below is a copy of the screen's patterns (screen-1), used only to say which words matched; the script
// checks that the copy finds exactly the phrase ids the screen itself reported, and prints any difference.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const corpusDir = resolve(here, '../2026-11-18-report-corpus');
const [corpus, outDir] = process.argv.slice(2);
if (!corpus || !outDir) {
  console.error('usage: node count.mjs <corpus folder> <out folder>');
  process.exit(2);
}
const J = await import(pathToFileURL(join(root, 'packages/judgment/dist/index.js')).href);
const sources = JSON.parse(readFileSync(join(corpusDir, 'sources.json'), 'utf8'));
const setOf = (r) => r.set ?? sources.firms[r.firm].set;

// ---------- The converted form, by the corpus's own converter ----------

// --reuse screens the conversion an earlier run left in <out folder>/converted (the conversion takes about 15 minutes).
const converted = join(outDir, 'converted');
for (const set of process.argv.includes('--reuse') ? [] : [...new Set(sources.reports.map(setOf))]) {
  const run = spawnSync(process.execPath, [join(corpusDir, 'measure.mjs'), corpus, converted, '--only', set], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (run.status !== 0) {
    console.error(`measure.mjs --only ${set} failed:\n${run.stderr}`);
    process.exit(1);
  }
}

// The genuine fix review of Crow's contracts (docs/audit/outside-scan), redacted and public, and its first scan.
const outsideScan = ['first-scan', 'fix-review'].map((id) => ({ id, set: 'outside-scan', file: join(root, 'docs/audit/outside-scan', `${id}.json`) }));

// ---------- Attribution: a copy of screen-1's phrase patterns (packages/judgment/src/screen.ts) ----------

const PHRASES = [
  { id: 'override', re: /\b(?:ignore|disregard|forget|override|bypass)\b[^\n]{0,40}?\b(?:instructions?|rubric|prompt|guidelines|criteria)\b|\b(?:ignore|disregard|forget)\b[^\n]{0,40}?\b(?:rules|above|previous|prior)\b/g },
  { id: 'override', re: /\b(?:override|bypass)\b[^\n]{0,40}?\b(?:rules|above|previous|prior)\b/g, weak: true },
  { id: 'role-reset', re: /\byou are now\b/g },
  { id: 'new-instructions', re: /\bnew instructions?\b/g },
  { id: 'prompt-probe', re: /\b(?:your|reveal|repeat|print|show|leak|disclose|output|dump)\b[^\n]{0,20}?\b(?:system|developer|hidden) prompt\b/g },
  { id: 'prompt-probe', re: /\b(?:system|developer|hidden) prompt\b/g, weak: true },
  { id: 'role-tag', re: /<\/?\s*(?:system|instructions?|assistant|user|data)\s*>/g },
  { id: 'verdict-steer', re: /\b(?:respond with|mark (?:this|it) as)\b[^\n]{0,30}?\bpass\b/g },
  { id: 'verdict-steer', re: /\b(?:output|return|answer|print)\b[^\n]{0,30}?\bpass\b/g, weak: true },
  { id: 'score-steer', re: /\b(?:score|rate|grade)\s+(?:this|it|every|all|each)\b[^\n]{0,30}?\b(?:4|four|max(?:imum)?|perfect|full)\b/g },
  { id: 'schema-field', re: /\binjection ?suspected\b/g },
  { id: 'persona', re: /\bas an? (?:ai|language model)\b/g },
  { id: 'addressing', re: /\b(?:note|message|instructions?|attention|memo|notice) (?:to|for) (?:the |all |any )?(?:[a-z]+ )?(?:panel|judges?|evaluators?|graders?|models?|assistants?|ai|llms?)\b/g },
  { id: 'addressing', re: /\b(?:note|message|instructions?|attention|memo|notice) (?:to|for) (?:the |all |any )?(?:[a-z]+ )?reviewers?\b/g, weak: true },
  { id: 'judge-note', re: /\b(?:judge|evaluator|grader|panel|model|assistant|ai|llm)s? (?:note|notice|instruction|message|directive)s?\b/g },
  { id: 'judge-note', re: /\breviewers? (?:note|notice|instruction|message|directive)s?\b/g, weak: true },
  { id: 'judge-steer', re: /\b(?:judges?|panel(?:ists?)?|evaluators?|graders?|adjudicators?)\b[^\n]{0,30}?\b(?:should|must|shall|will|need to|needs to|are to|is to|have to|has to|please)\b[^\n]{0,20}?\b(?:accept|approve|pass|score|rate|grade|mark|return|output|ignore|disregard)\b/g },
  { id: 'verdict-claim', re: /\b(?:correct|only|right) (?:overall )?verdict\b|\boverall verdict is\b|\b(?:top|full|maximum|perfect) (?:marks|scores?)\b|\bverdicts?\b[^\n]{0,40}?\b(?:pass(?:es|ed)?|accept(?:ed)?|approved?)\b/g },
  { id: 'verdict-claim', re: /\bpre ?approved\b|\bcriteria (?:are |were )?(?:all |fully )?(?:met|satisfied)\b/g, weak: true },
];
const TARGET =
  /\b(?:verdicts?|rubrics?|judges?|judging|panel(?:ists?)?|evaluators?|graders?|adjudicators?|assistants?|ai|llms?|injection ?suspected|overall (?:pass|fail|abstain))\b|"overall"|\b(?:every|each|all) (?:criterion|criteria)\b|\b(?:highest|top|max(?:imum)?|full|perfect) (?:scores?|marks|anchors?)\b|\b(?:accept|approve|pass|reject)\b (?:on |for )?(?:this|the) (?:report|delivery|deliverable|submission|work)\b/;
const TARGET_WINDOW = 80;
const CONFUSABLE_RE = /[Α-ωЀ-ԯıℓ]/g;

// The screen's views, without the confusable map's details: the corpus has no mixed-script words (the screen's own
// encoded_run count says so), so folding Cyrillic and Greek is left to the cross-check below.
function skeleton(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9<>/]+/g, (m) => (/\s\s/.test(m) ? '  ' : ' '));
}
function collapseSpaced(sk) {
  return sk.split('  ').map((segment) => {
    const out = [];
    let letters = [];
    const flush = () => { if (letters.length >= 3) out.push(letters.join('')); else out.push(...letters); letters = []; };
    for (const t of segment.split(' ')) { if (t.length === 1 && t >= 'a' && t <= 'z') letters.push(t); else { flush(); out.push(t); } }
    flush();
    return out.join(' ');
  }).join(' ');
}
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g' };
const rot13 = (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
function variants(text) {
  const sk = skeleton(text);
  const single = sk.replace(/  +/g, ' ');
  const leet = single.replace(/[a-z0-9]+/g, (t) => (/[a-z]/.test(t) && /[0-9]/.test(t) ? t.replace(/[0-9]/g, (d) => LEET[d] ?? d) : t));
  const reversed = skeleton([...text].reverse().join('')).replace(/  +/g, ' ');
  return [
    ['lowercase', text.toLowerCase()], ['folded', single], ['letters rejoined', collapseSpaced(sk)], ['leetspeak', leet], ['ROT13', rot13(single)], ['reversed', reversed],
  ];
}

/** Every match of every phrase pattern that the screen would count, with the view it matched in. */
function phraseMatches(text, phrases = PHRASES) {
  const hits = [];
  if (!text) return hits;
  for (const [view, v] of variants(text)) {
    for (const p of phrases) {
      for (const m of v.matchAll(p.re)) {
        if (p.weak) {
          const from = Math.max(0, m.index - TARGET_WINDOW);
          if (!TARGET.test(v.slice(from, m.index + m[0].length + TARGET_WINDOW))) continue;
        }
        hits.push({ id: p.id, weak: !!p.weak, view, phrase: m[0].replace(/\s+/g, ' ').trim().slice(0, 60) });
      }
    }
  }
  return hits;
}

/** The parsed string keys and values of a JSON document, in the screen's order (screen.ts, jsonStrings). */
function jsonStrings(text) {
  const head = text.trimStart()[0];
  if (head !== '{' && head !== '[') return undefined;
  let value;
  try { value = JSON.parse(text); } catch { return undefined; }
  const parts = [];
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]);
    else if (v !== null && typeof v === 'object') { const e = Object.entries(v); for (let i = e.length - 1; i >= 0; i--) stack.push(e[i][1], e[i][0]); }
  }
  return parts.join('\n');
}

const cp = (c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
/** The code points NFKC changed, as normalizeText counts them (space variants aside), after hidden characters go. */
function nfkcChars(raw) {
  const tally = {};
  for (const c of raw.replace(J.HIDDEN_GLOBAL, '')) {
    if (c.charCodeAt(0) < 0x80) continue;
    const n = c.normalize('NFKC');
    if (n !== c && n !== ' ') tally[`${cp(c)} -> ${JSON.stringify(n)}`] = (tally[`${cp(c)} -> ${JSON.stringify(n)}`] ?? 0) + 1;
  }
  return tally;
}
function hiddenChars(raw) {
  const tally = {};
  for (const m of raw.matchAll(J.HIDDEN_GLOBAL)) tally[cp(m[0])] = (tally[cp(m[0])] ?? 0) + 1;
  return tally;
}

// ---------- One screening ----------

const versions = [...J.KEPT.screens.keys()];
function screenOne(bytes, mime) {
  const d = J.decodePlaintext(bytes, mime);
  if (!d.ok) return { refused: d.error.code };
  const raw = d.value.raw.reveal();
  const byVersion = {};
  for (const v of versions) {
    const s = J.KEPT.screens.get(v).screen({ data: d.value.data, hiddenTagText: d.value.hiddenTagText, removed: d.value.removed, mime });
    byVersion[v] = { flagged: s.flagged, signals: s.signals };
  }
  // Attribution, for screen-1: what each phrase signal matched, in the text and in JSON string values.
  const text = d.value.data.reveal();
  const strings = jsonStrings(text);
  const views = { text: phraseMatches(text) };
  if (strings !== undefined) views['JSON string values'] = phraseMatches(J.normalizeText(strings).text);
  const reported = {};
  for (const s of byVersion['screen-1'].signals) {
    const m = /^in (text|JSON string values): (.+)$/.exec(s.detail);
    if (s.kind === 'instruction_phrase' && m) reported[m[1]] = m[2].split(', ').sort();
  }
  const mismatch = [];
  for (const where of new Set([...Object.keys(views), ...Object.keys(reported)])) {
    const copy = [...new Set((views[where] ?? []).map((h) => h.id))].sort();
    if (JSON.stringify(copy) !== JSON.stringify(reported[where] ?? [])) mismatch.push({ where, screen: reported[where] ?? [], copy });
  }
  // What-if (not the product): the candidate NFKC rule counts only characters whose NFKC form holds a letter
  // (fullwidth and mathematical letters, letter ligatures), so ellipses, superscript digits and signs no longer flag.
  // The phrase patterns already read the NFKC text, so a phrase written in fullwidth letters still flags either way.
  const letterViews = { text: nfkcLetters(raw), ...(strings !== undefined ? { json: nfkcLetters(strings) } : {}) };
  const keep = (sig) => {
    if (sig.kind !== 'encoded_run' || !/changed by NFKC/.test(sig.detail)) return true;
    return (/in JSON string values/.test(sig.detail) ? letterViews.json : letterViews.text) > 0;
  };
  const whatIfNfkcLetters = byVersion['screen-1'].signals.filter(keep);
  return { removed: d.value.removed, byVersion, phrases: views, nfkc: nfkcChars(raw), hidden: hiddenChars(raw), whatIfNfkcLetters, mismatch };
}
function nfkcLetters(raw) {
  let n = 0;
  for (const c of raw.replace(J.HIDDEN_GLOBAL, '')) {
    if (c.charCodeAt(0) < 0x80) continue;
    const f = c.normalize('NFKC');
    if (f !== c && f !== ' ' && /\p{L}/u.test(f)) n++;
  }
  return n;
}

// ---------- All reports ----------

const items = [];
for (const r of sources.reports) {
  const dir = join(corpus, r.id);
  const md = existsSync(join(dir, 'report.md'));
  const published = readFileSync(join(dir, md ? 'report.md' : 'report.txt'));
  const conv = join(converted, r.id, 'report.json');
  items.push({ id: r.id, set: setOf(r), shape: 'published', mime: md ? 'text/markdown' : 'text/plain', bytes: published });
  if (existsSync(conv)) {
    const report = JSON.parse(readFileSync(conv, 'utf8'));
    const bytes = readFileSync(conv);
    items.push({ id: r.id, set: setOf(r), shape: 'converted', mime: 'application/json', bytes, findings: report.findings?.length ?? 0 });
    // The delivery form version 2 asks for: the converted report with zero-width and other hidden characters
    // stripped by the seller, since the form's `hidden` check allows none (examples/security-review-form.md).
    items.push({ id: r.id, set: setOf(r), shape: 'stripped', mime: 'application/json', bytes: Buffer.from(bytes.toString('utf8').replace(J.HIDDEN_GLOBAL, '')), findings: report.findings?.length ?? 0 });
  }
}
for (const o of outsideScan) items.push({ id: o.id, set: o.set, shape: 'published', mime: 'application/json', bytes: readFileSync(o.file) });

const rows = [];
for (const it of items) {
  const s = screenOne(it.bytes, it.mime);
  const sha256 = createHash('sha256').update(it.bytes).digest('hex');
  rows.push({ id: it.id, set: it.set, shape: it.shape, mime: it.mime, sha256, chars: it.bytes.length, ...(it.findings !== undefined ? { findings: it.findings } : {}), ...s });
  const one = s.byVersion?.['screen-1'];
  console.log(`${it.id.padEnd(13)} ${it.set.padEnd(12)} ${it.shape.padEnd(9)} ${one ? (one.flagged ? `flagged ${one.signals.map((x) => x.kind).join(',')}` : 'clean') : `refused ${s.refused}`}${s.mismatch?.length ? '  ATTRIBUTION MISMATCH' : ''}`);
}

// ---------- Summary ----------

/** A signal's family for counting: the kind, with the encoded_run kind split by its cause. */
function family(sig) {
  if (sig.kind !== 'encoded_run') return sig.kind;
  if (/changed by NFKC/.test(sig.detail)) return 'encoded_run (NFKC)';
  if (/mixed-script/.test(sig.detail)) return 'encoded_run (mixed script)';
  const m = /decodable (base64|joined base64|hex|percent-encoded|Morse) run/.exec(sig.detail);
  return m ? `encoded_run (${m[1]})` : 'encoded_run (other)';
}
const top = (tally, n = 3) => Object.entries(tally).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n).map(([k, c]) => ({ trigger: k, count: c }));

function summarise(rs, version) {
  const screened = rs.filter((x) => x.byVersion);
  const flagged = screened.filter((x) => x.byVersion[version].flagged);
  const perFamily = {};
  const triggers = {};
  for (const x of flagged) {
    const fams = new Set(x.byVersion[version].signals.map(family));
    for (const f of fams) perFamily[f] = (perFamily[f] ?? 0) + 1;
    if (version !== 'screen-1') continue;
    const add = (f, k, n = 1) => { triggers[f] ??= {}; triggers[f][k] = (triggers[f][k] ?? 0) + n; };
    if (fams.has('instruction_phrase')) for (const hits of Object.values(x.phrases)) for (const h of new Map(hits.map((h) => [`${h.id}: "${h.phrase}"`, h])).keys()) add('instruction_phrase', h);
    if (fams.has('encoded_run (NFKC)')) for (const [k, n] of Object.entries(x.nfkc)) add('encoded_run (NFKC)', k, n);
    if (fams.has('zero_width')) for (const [k, n] of Object.entries(x.hidden)) add('zero_width', k, n);
    for (const sig of x.byVersion[version].signals) {
      const f = family(sig);
      if (!['instruction_phrase', 'encoded_run (NFKC)', 'zero_width'].includes(f)) add(f, sig.detail.replace(/\d+/g, 'N'));
    }
  }
  return {
    screened: screened.length,
    flagged: flagged.length,
    ...(version === 'screen-1' ? { flaggedUnderNfkcLettersWhatIf: screened.filter((x) => x.whatIfNfkcLetters.length > 0).length } : {}),
    reportsPerSignal: perFamily,
    ...(version === 'screen-1' ? { topTriggers: Object.fromEntries(Object.entries(triggers).map(([f, t]) => [f, top(t)])) } : {}),
  };
}

const groups = {
  'corpus 24, published': rows.filter((x) => ['design', 'heldout-2'].includes(x.set) && x.shape === 'published'),
  'corpus 24, converted': rows.filter((x) => ['design', 'heldout-2'].includes(x.set) && x.shape === 'converted'),
  'corpus 24, converted, hidden characters stripped': rows.filter((x) => ['design', 'heldout-2'].includes(x.set) && x.shape === 'stripped'),
  'held-out summaries (cyfrin), published': rows.filter((x) => x.set === 'heldout' && x.shape === 'published'),
  'layout set (shieldify older), published': rows.filter((x) => x.set === 'layout-2' && x.shape === 'published'),
  'layout set (shieldify older), converted': rows.filter((x) => x.set === 'layout-2' && x.shape === 'converted'),
  'layout set (shieldify older), converted, hidden characters stripped': rows.filter((x) => x.set === 'layout-2' && x.shape === 'stripped'),
  'outside scan (Crow contracts), published': rows.filter((x) => x.set === 'outside-scan'),
};
const summary = {};
for (const [g, rs] of Object.entries(groups)) summary[g] = Object.fromEntries(versions.map((v) => [v, summarise(rs, v)]));
const mismatches = rows.filter((x) => x.mismatch?.length).map((x) => ({ id: x.id, shape: x.shape, mismatch: x.mismatch }));

// The per-report record: counts and short matched phrases only.
const record = rows.map(({ id, set, shape, mime, sha256, chars, findings, refused, removed, byVersion, phrases, nfkc, hidden, whatIfNfkcLetters }) => ({
  id, set, shape, mime, sha256, chars, ...(findings !== undefined ? { findings } : {}), ...(refused ? { refused } : {}), removed,
  flagged: byVersion && Object.fromEntries(versions.map((v) => [v, byVersion[v].flagged])),
  signals: byVersion && byVersion['screen-1'].signals.map((s) => ({ kind: s.kind, family: family(s), detail: s.detail })),
  phrases: phrases && Object.fromEntries(Object.entries(phrases).map(([w, hs]) => [w, [...new Set(hs.map((h) => `${h.id}${h.weak ? ' (weak)' : ''} [${h.view}]: "${h.phrase}"`))]])),
  nfkc, hidden,
  ...(whatIfNfkcLetters ? { flaggedUnderNfkcLettersWhatIf: whatIfNfkcLetters.length > 0 } : {}),
}));
mkdirSync(outDir, { recursive: true });
writeFileSync(join(here, 'results.json'), JSON.stringify({ screens: versions, summary, attributionMismatches: mismatches, reports: record }, null, 2) + '\n');
console.log(JSON.stringify({ summary, attributionMismatches: mismatches.length }, null, 2));
