// T-555: the published scan and fix review of Crow's contracts (docs/audit/outside-scan.md). The table on the page is
// what table.mjs renders, every finding has a triage row, and no identifier the redaction removes is left in a
// published file. Where Crow's private copy is on this machine (CROW_PRIVATE, or reports/crow-private in the main
// checkout), it also checks that no identifier of the originals and no term of the private names list remains. CI has
// no private copy, so those two checks are skipped there and run on the maintainer's machine.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module without types
import { EMAIL, UUID } from '../docs/audit/outside-scan/redact.mjs';
// @ts-expect-error plain ES module without types
import { PAGE, findings, renderTable, START, END } from '../docs/audit/outside-scan/table.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (p: string) => join(root, p);
const PUBLISHED = [
  'docs/audit/outside-scan.md',
  'docs/audit/outside-scan/first-scan.json',
  'docs/audit/outside-scan/fix-review.json',
  'docs/audit/outside-scan/triage.json',
  'docs/audit/known-issues.md',
  'site/trust.txt',
];
const text = (p: string) => readFileSync(at(p), 'utf8');
// Fields the redaction removes; none may appear as a JSON key in a published data file.
const REMOVED_KEYS = ['workspace_id', 'requester', 'account_id', 'display_name', 'avatar_url', 'access', 'lineage', 'comment_reads', 'context_file_ids', 'credits', 'job_id', 'parent_job_id'];

describe('the published outside scan (T-555)', () => {
  it('the page holds the table table.mjs renders', () => {
    const page = readFileSync(PAGE, 'utf8');
    const s = page.indexOf(START), e = page.indexOf(END);
    expect(s, 'the page lacks its table markers').toBeGreaterThanOrEqual(0);
    expect(page.slice(s, e + END.length), 'the table is stale: run node docs/audit/outside-scan/table.mjs --write').toBe(renderTable());
  });

  it('every finding has a triage row, and every row a finding', () => {
    const { review, triage } = findings();
    const ids = review.map((a: { id: string }) => a.id).sort();
    expect(ids.length).toBe(70);
    expect(Object.keys(triage).sort()).toEqual(ids);
    for (const [id, t] of Object.entries(triage) as [string, { status: string; outcome: string }][]) {
      expect(['open', 'fixed in part', 'fixed in the new version', 'fixed off chain', 'deploy check', 'accepted limit', 'not a defect'], `${id}: unknown status`).toContain(t.status);
      expect(['confirmed', 'known', 'not a defect'], `${id}: unknown outcome`).toContain(t.outcome);
    }
  });

  it.each(PUBLISHED)('%s holds no UUID and no email address', (p) => {
    const t = text(p);
    expect(t.match(UUID) ?? [], `${p}: a UUID is left`).toEqual([]);
    expect(t.match(EMAIL) ?? [], `${p}: an email address is left`).toEqual([]);
  });

  it.each(['docs/audit/outside-scan/first-scan.json', 'docs/audit/outside-scan/fix-review.json'])('%s holds none of the removed fields', (p) => {
    const t = text(p);
    for (const k of REMOVED_KEYS) expect(t.includes(`"${k}":`), `${p}: the field ${k} is left`).toBe(false);
    expect(/googleusercontent|avatar/i.test(t), `${p}: a picture URL is left`).toBe(false);
  });

  const main = resolve(root, root.includes('/.worktrees/') ? root.slice(0, root.indexOf('/.worktrees/')) : root);
  const privateCopy = [process.env.CROW_PRIVATE, join(main, 'reports/crow-private')].find((p) => p && existsSync(join(p, 'roadmap/deny.txt')));
  const scan = privateCopy && join(privateCopy, 'design-partners/partner-a/crow-scan');

  it.skipIf(!scan || !existsSync(join(scan, 'report/job.json')))('no identifier of the originals is left (private copy)', () => {
    const job = JSON.parse(readFileSync(join(scan!, 'report/job.json'), 'utf8')).job;
    const work = JSON.parse(readFileSync(join(scan!, 'fix-review/work.json'), 'utf8')).job;
    const secrets = [job.id, job.workspace_id, job.requester?.account_id, job.requester?.display_name, job.requester?.avatar_url, work.id, ...(work.workspace_id ? [work.workspace_id] : [])].filter(Boolean);
    expect(secrets.length).toBeGreaterThanOrEqual(5);
    for (const p of PUBLISHED) for (const s of secrets) expect(text(p).toLowerCase().includes(String(s).toLowerCase()), `${p} holds an identifier of the originals`).toBe(false);
  });

  it.skipIf(!privateCopy)('no term of the private names list is left (private copy)', () => {
    // The same folding as the private roadmap's deny check: case, accents, punctuation and spacing fold, and a term
    // of 6 or more letters and digits also matches with its spaces removed. The firm's own name is public on
    // Rafa's word of 2026-11-19 (T-555), so its two forms are allowed.
    const fold = (s: string) => ` ${s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
    const squash = (s: string) => fold(s).replace(/ /g, '');
    const allowed = new Set(['zero cool', 'zero cool labs'].map(fold));
    const terms = readFileSync(join(privateCopy!, 'roadmap/deny.txt'), 'utf8').split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean).filter((t) => !allowed.has(fold(t)));
    for (const p of PUBLISHED) {
      const ft = fold(text(p)), st = squash(text(p));
      const hits = terms.filter((t) => (fold(t).trim() && ft.includes(fold(t))) || (squash(t).length >= 6 && st.includes(squash(t))));
      expect(hits.length, `${p} holds ${hits.length} term(s) of the private names list`).toBe(0);
    }
  });
});
