#!/usr/bin/env node
// The copy (T-480, row N137): moves each key from the local env file into the 1Password item that the references
// files in config/secrets/ name. Rafa runs it himself, in his own terminal, once he has signed in to `op`.
// An agent never runs it: it reads the local file.
//
//   node scripts/secrets/copy.mjs --dry-run      what it would do; reads the file, calls no op, prints names only
//   node scripts/secrets/copy.mjs                shows the account and vault, asks for "yes", then creates the items
//                                                that are missing and leaves existing ones alone
//
// Options: --from <file> (default: the .env at the repository root), --refs <file or folder>, repeatable
// (default: config/secrets), --yes (answers the question when standard input is not a terminal). It prints names and
// one of "created", "exists, left alone", "missing in the file" or "in the file, not in the inventory", and only names
// shaped like a variable name. It never prints a value, a part of one, or op's own error text after a value went in.
// It passes each value to op on standard input (a JSON item template, never an argument), writes no file, and never
// changes an existing item. It stops at the first failure and says what to do. Exit 0 when done, 1 when op failed or
// the answer was not "yes", 2 when it refused.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { FIELD, isName, loadRefs, redact, VAULT } from './refs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const say = (line) => console.log(line);
const refuse = (line) => { console.error(`copy: ${line}`); process.exit(2); };

const args = process.argv.slice(2);
let from = join(ROOT, '.env');
const refPaths = [];
let dryRun = false;
let yes = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') dryRun = true;
  else if (args[i] === '--yes') yes = true;
  else if (args[i] === '--from' && args[i + 1]) from = args[++i];
  else if (args[i] === '--refs' && args[i + 1]) refPaths.push(args[++i]);
  else refuse(`unknown argument ${isName(args[i]) || args[i].startsWith('--') ? args[i].slice(0, 40) : '(not shown)'}. Usage: node scripts/secrets/copy.mjs [--dry-run] [--yes] [--from <file>] [--refs <file or folder>]...`);
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
// A wrapped value can parse as a "name"; only names shaped like a variable are printed, the rest are counted.
const extra = Object.keys(local).filter((n) => !known.has(n) && isName(n)).sort();
const odd = Object.keys(local).filter((n) => !isName(n)).length;
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
  if (odd) say(`  ${odd} line${odd === 1 ? '' : 's'} of the file parse to no variable name (not shown): check the file for a value split over lines.`);
}

if (dryRun) {
  for (const e of toCopy) status.set(e.name, `would be copied to ${e.ref.item}, unless that item exists`);
  say(`Dry run: ${from} against ${refPaths.map((p) => relative(ROOT, p) || p).join(', ')}. No op call made.`);
  report();
  process.exit(0);
}

for (const v of ['OP_SERVICE_ACCOUNT_TOKEN', 'OP_CONNECT_TOKEN', 'OP_CONNECT_HOST'])
  if (process.env[v]) refuse(`${v} is set, so op would act as a service account or a Connect server: unset it in this terminal and run again.`);

/** The op this run calls, by absolute path, so a later PATH entry or a planted file cannot swap it mid-run. */
const OP = (process.env.PATH ?? '').split(delimiter).filter(isAbsolute).map((d) => join(d, 'op')).find((p) => { try { accessSync(p, constants.X_OK); return true; } catch { return false; } });

/** One op call. Its output stays in memory: only an exit code and, before any value went in, a first error line. */
function op(argv, input) {
  if (!OP) return { code: -1, out: '', err: 'op is not installed or not on PATH' };
  const r = spawnSync(OP, argv, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  if (r.error) return { code: -1, out: '', err: 'op could not start' };
  return { code: r.status ?? -1, out: r.stdout ?? '', err: (r.stderr ?? '').split('\n').find((l) => l.trim() !== '') ?? '' };
}
const shown = (err) => redact(err, values).slice(0, 200);
function stop(what, r, hint) {
  console.error(`copy: stopped: ${what} (op exit ${r.code}${r.err ? `: ${shown(r.err)}` : ''}).`);
  console.error(`copy: ${hint}`);
  report();
  process.exit(1);
}

let r = op(['whoami', '--format', 'json']);
let who;
try { who = JSON.parse(r.out); } catch { who = undefined; }
if (r.code !== 0 || !who) stop('op is not signed in', r, 'turn on Settings > Developer > "Integrate with 1Password CLI" in the 1Password app, then run op signin and this command again.');
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
const toCreate = toCopy.filter((e) => !titles.includes(e.ref.item));

say(`op:      ${OP}`);
say(`Account: ${String(who.url ?? '(no URL)').slice(0, 80)} (${String(who.email ?? '(no email)').slice(0, 80)})`);
say(`Vault:   ${String(vaults[0].name).slice(0, 40)} (${vaultId.slice(0, 40)})`);
say(`Items to create: ${toCreate.map((e) => e.ref.item).join(', ') || 'none'}`);
if (toCreate.length && !yes) {
  if (!process.stdin.isTTY) refuse('standard input is not a terminal: pass --yes once you have read the account and vault above.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Type yes to create these items in that account and vault: ')).trim();
  rl.close();
  if (answer !== 'yes') { say('copy: nothing created.'); process.exit(1); }
}

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
  if (r.code !== 0) {
    // op's error text could quote the value in some escaped form, so none of it is shown.
    status.set(e.name, `failed: op item create exited ${r.code}`);
    stop(`op item create failed for ${e.name}`, { code: r.code, err: '' }, `the items created before this one stay and are left alone on the next run. To see op's own message, create ${item} by hand in the 1Password app, or run this command again.`);
  }
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
