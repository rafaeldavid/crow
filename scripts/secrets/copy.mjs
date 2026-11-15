#!/usr/bin/env node
// The copy (T-480, row N137): moves each key from the local env file into the 1Password item that the references
// files in config/secrets/ name. Rafa runs it himself, in his own terminal, once he has signed in to `op`.
// An agent never runs it: it reads the local file.
//
//   node scripts/secrets/copy.mjs --dry-run      what it would do; reads the file, calls no op, prints names only
//   node scripts/secrets/copy.mjs                creates the items that are missing; leaves existing ones alone
//
// Options: --from <file> (default: the .env at the repository root), --refs <file or folder>, repeatable
// (default: config/secrets). It prints names and one of "created", "exists, left alone", "missing in the file" or
// "in the file, not in the inventory". It never prints a value or any part of one, passes each value to op on
// standard input (a JSON item template, never an argument), writes no file, and never changes an existing item.
// It stops at the first failure and says what to do. Exit 0 when done, 1 when op failed, 2 when it refused.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { FIELD, loadRefs, redact, VAULT } from './refs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const say = (line) => console.log(line);
const refuse = (line) => { console.error(`copy: ${line}`); process.exit(2); };

const args = process.argv.slice(2);
let from = join(ROOT, '.env');
const refPaths = [];
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') dryRun = true;
  else if (args[i] === '--from' && args[i + 1]) from = args[++i];
  else if (args[i] === '--refs' && args[i + 1]) refPaths.push(args[++i]);
  else refuse(`unknown argument ${JSON.stringify(args[i]).slice(0, 40)}. Usage: node scripts/secrets/copy.mjs [--dry-run] [--from <file>] [--refs <file or folder>]...`);
}
if (refPaths.length === 0) refPaths.push(join(ROOT, 'config', 'secrets'));

const { entries, errors } = loadRefs(refPaths);
if (errors.length) refuse(`the references files are not valid:\n  ${errors.join('\n  ')}`);
if (!existsSync(from)) refuse(`no file at ${from}: nothing to copy`);

/** The local file, parsed as Node's --env-file parses it. Its values stay in this process. */
let local;
try {
  local = parseEnv(readFileSync(from, 'utf8'));
} catch {
  refuse(`could not parse ${from} as an env file`);
}
const values = Object.values(local).filter((v) => typeof v === 'string' && v !== '');

const known = new Set(entries.map((e) => e.name));
const extra = Object.keys(local).filter((n) => !known.has(n)).sort();
const toCopy = entries.filter((e) => e.ref && local[e.name]);
const status = new Map();
for (const e of entries) {
  if (e.plain) status.set(e.name, 'plain configuration in the references file, not copied');
  else if (!local[e.name]) status.set(e.name, 'missing in the file');
  else status.set(e.name, 'not reached: the copy stopped before it');
}

function report() {
  const width = Math.max(...entries.map((e) => e.name.length), ...extra.map((n) => n.length));
  for (const e of entries) say(`  ${e.name.padEnd(width)}  ${status.get(e.name)}`);
  for (const n of extra) say(`  ${n.padEnd(width)}  in the file, not in the inventory`);
}

if (dryRun) {
  for (const e of toCopy) status.set(e.name, `would be copied to ${e.ref.item}, unless that item exists`);
  say(`Dry run: ${from} against ${refPaths.map((p) => relative(ROOT, p) || p).join(', ')}. No op call made.`);
  report();
  process.exit(0);
}

/** One op call. Its output stays in memory: only an exit code and a redacted first error line ever leave. */
function op(argv, input) {
  const r = spawnSync('op', argv, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  if (r.error) return { code: -1, out: '', err: r.error.code === 'ENOENT' ? 'op is not installed or not on PATH' : 'op could not start' };
  return { code: r.status ?? -1, out: r.stdout ?? '', err: (r.stderr ?? '').split('\n').find((l) => l.trim() !== '') ?? '' };
}
const shown = (err) => redact(err, values).slice(0, 200);
function stop(what, r, hint) {
  console.error(`copy: stopped: ${what} (op exit ${r.code}${r.err ? `: ${shown(r.err)}` : ''}).`);
  console.error(`copy: ${hint}`);
  report();
  process.exit(1);
}

let r = op(['whoami']);
if (r.code !== 0) stop('op is not signed in', r, 'turn on Settings > Developer > "Integrate with 1Password CLI" in the 1Password app, then run op signin and this command again.');
// References match names without regard to case (1Password's secret reference syntax), so the vault may be "Crow".
r = op(['vault', 'list', '--format', 'json']);
let vaults;
try { vaults = JSON.parse(r.out).filter((v) => String(v.name).toLowerCase() === VAULT); } catch { vaults = undefined; }
if (r.code !== 0 || !Array.isArray(vaults)) stop('could not list the vaults', r, 'check op signin, then run this command again.');
if (vaults.length === 0) stop(`no vault named ${VAULT}`, { code: 0, err: '' }, 'create it with: op vault create Crow');
if (vaults.length > 1) stop(`${vaults.length} vaults are named ${VAULT} in some case`, { code: 0, err: '' }, 'rename all but one in the 1Password app.');
const vaultId = String(vaults[0].id);
r = op(['item', 'template', 'get', 'API Credential', '--format', 'json']);
let template;
try { template = JSON.parse(r.out); } catch { template = undefined; }
if (r.code !== 0 || !template?.fields?.some((f) => f.id === FIELD)) stop(`the API Credential template has no "${FIELD}" field`, r, 'tell the coordinator; this op version names the field differently, and nothing was created.');
r = op(['item', 'list', '--vault', vaultId, '--format', 'json']);
let titles;
try { titles = JSON.parse(r.out).map((i) => String(i.title).toLowerCase()); } catch { titles = undefined; }
if (r.code !== 0 || !Array.isArray(titles)) stop(`could not list the items in ${VAULT}`, r, 'check op signin, then run this command again.');
const twice = titles.filter((t, i) => titles.indexOf(t) !== i);

for (const e of toCopy) {
  const { item } = e.ref;
  if (twice.includes(item)) stop(`two items in ${VAULT} are titled ${item}`, { code: 0, err: '' }, 'remove one in the 1Password app, then run this command again.');
  if (titles.includes(item)) { status.set(e.name, `exists, left alone (${item})`); continue; }
  const body = {
    title: item,
    category: 'API_CREDENTIAL',
    tags: ['crow', 'n137'],
    fields: [{ id: FIELD, label: FIELD, type: 'CONCEALED', value: local[e.name] }],
    notesPlain: `Crow: ${e.name}, referenced by ${relative(ROOT, e.file) || e.file}. Copied from the local env file by scripts/secrets/copy.mjs on ${new Date().toISOString().slice(0, 10)}.`,
  };
  r = op(['item', 'create', '--vault', vaultId, '--format', 'json', '-'], JSON.stringify(body));
  if (r.code !== 0) stop(`op item create failed for ${e.name}`, r, 'the items created before this one stay and are left alone on the next run; fix the cause and run this command again.');
  status.set(e.name, `created (${item})`);
  titles.push(item);
}

say(`Copied from ${from} into the ${VAULT} vault:`);
report();
const ready = [...new Set(entries.map((e) => e.file))].filter((f) => entries.filter((e) => e.file === f && e.ref).every((e) => titles.includes(e.ref.item)));
if (ready.length) {
  const here = realpathSync(process.cwd());
  const files = ready.map((f) => relative(here, realpathSync(f)) || f);
  say('Next, the check, for the references files whose items all exist:');
  say(`  op run ${files.map((f) => `--env-file=${f}`).join(' ')} -- node ${relative(here, realpathSync(join(ROOT, 'scripts', 'secrets', 'check.mjs')))} ${files.join(' ')}${refPaths.map((p) => ` --inventory ${relative(here, realpathSync(p)) || p}`).join('')}`);
}
