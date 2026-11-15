// The rule for every privileged file (T-485; decision record T-484, section 6): before a script runs as the
// administrator or with a secret, it prints the commit it came from and the SHA-256 of each file it will run, then
// waits for a typed "yes". This module does that for the Node scripts under infra/. The shell scripts carry their
// own copy of the same steps.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

/** The repository root: infra/lib/ is two levels below it. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** `git archive` replaces this with the commit when infra/.gitattributes marks the file export-subst. */
const ARCHIVED = '$Format:%H$';

/** @param {string} path */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * The commit the files came from, and which of them differ from it. In a checkout: HEAD, and the files git reports
 * as changed. In a `git archive` bundle: the commit the archive was made from, and no file can be checked.
 * @param {string[]} files absolute paths
 * @param {{ root?: string, run?: typeof spawnSync }} [opts]
 */
export function commitOf(files, { root = ROOT, run = spawnSync } = {}) {
  const head = run('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (head.status === 0 && /^[0-9a-f]{40}$/.test(String(head.stdout).trim())) {
    const rel = files.map((f) => relative(root, f));
    const st = run('git', ['-C', root, 'status', '--porcelain', '--', ...rel], { encoding: 'utf8' });
    const changed = st.status === 0 ? String(st.stdout).split('\n').filter(Boolean).map((l) => l.slice(3)) : rel;
    return { commit: String(head.stdout).trim(), source: 'checkout', changed };
  }
  if (/^[0-9a-f]{40}$/.test(ARCHIVED)) return { commit: ARCHIVED, source: 'git archive', changed: [] };
  return { commit: undefined, source: 'unknown', changed: [] };
}

/**
 * Prints the commit and the hashes, then asks for "yes". Returns true to go on.
 * - `dryRun`: prints, asks nothing, returns true (a dry run sends nothing).
 * - `yes`: prints, asks nothing, returns true; for a session, which has no terminal. The lines still print.
 * - no terminal and no `yes`: refuses.
 * An unknown commit always refuses: a privileged file runs only from a commit Rafa can name.
 * @param {{ title: string, files: string[], dryRun?: boolean, yes?: boolean, root?: string, out?: (l: string) => void,
 *   isTTY?: boolean, ask?: (q: string) => Promise<string>, run?: typeof spawnSync }} o
 */
export async function attest(o) {
  const out = o.out ?? ((l) => console.error(l));
  const root = o.root ?? ROOT;
  const { commit, source, changed } = commitOf(o.files, { root, run: o.run });
  out(o.title);
  out(`  From commit: ${commit ?? 'unknown'} (${source})`);
  if (changed.length) out(`  CHANGED since that commit, so not the reviewed files: ${changed.join(', ')}`);
  out('  Files it runs, SHA-256:');
  for (const f of o.files) out(`    ${sha256File(f)}  ${relative(root, f)}`);
  if (!commit) { out('  Refused: the commit is unknown. Run it from a checkout or from a git archive of the reviewed commit.'); return false; }
  if (o.dryRun) return true;
  if (o.yes) { out('  Answered yes by --yes.'); return true; }
  const isTTY = o.isTTY ?? Boolean(process.stdin.isTTY);
  if (!isTTY) { out('  Refused: standard input is not a terminal. Read the lines above, then pass --yes.'); return false; }
  const ask = o.ask ?? (async (q) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try { return await rl.question(q); } finally { rl.close(); }
  });
  const answer = (await ask(changed.length ? 'These files differ from the commit. Type yes to run them anyway: ' : 'Type yes to run these files: ')).trim();
  if (answer !== 'yes') { out('  Stopped: the answer was not yes.'); return false; }
  return true;
}
