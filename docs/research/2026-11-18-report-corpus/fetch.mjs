// T-509: downloads each report in sources.json, pinned to its repository commit, into its own folder, and writes
// manifest.json: address, firm, date, set, bytes and SHA-256 of the file fetched. It reads and runs nothing from the
// files. For a PDF it also writes the text that `pdftotext -layout` gives, beside the file, for measure.mjs.
//
//   node docs/research/2026-11-18-report-corpus/fetch.mjs <corpus folder>
//
// The corpus folder holds copies of third-party reports: keep it out of git (reports/scratch/ is ignored).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
if (!out) {
  console.error('usage: node fetch.mjs <corpus folder>');
  process.exit(2);
}
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const manifest = [];
for (const r of sources.reports) {
  const firm = sources.firms[r.firm];
  const url = `https://raw.githubusercontent.com/${firm.repo}/${firm.commit}/${r.path.split('/').map(encodeURIComponent).join('/')}`;
  const dir = join(out, r.id);
  mkdirSync(dir, { recursive: true });
  const ext = r.path.endsWith('.pdf') ? 'pdf' : 'md';
  const file = join(dir, `report.${ext}`);
  if (!existsSync(file)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${r.id}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const bytes = readFileSync(file);
  if (ext === 'pdf') execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, join(dir, 'report.txt')]);
  manifest.push({
    id: r.id,
    firm: firm.name,
    set: r.set ?? firm.set, // T-534: a report may name its own set (layout-2 beside heldout-2)
    date: r.date,
    address: `https://github.com/${firm.repo}/blob/${firm.commit}/${r.path.split('/').map(encodeURIComponent).join('/')}`,
    licence: firm.licence,
    format: ext === 'pdf' ? 'PDF' : 'Markdown',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  console.log(`${r.id}: ${bytes.length} bytes`);
}
writeFileSync(join(here, 'manifest.json'), JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), reports: manifest }, null, 2) + '\n');
