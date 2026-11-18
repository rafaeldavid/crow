#!/usr/bin/env node
// The check (T-480, row N137): run under `op run`, it says for each name in the references files it is given whether
// the variable is set and its length class (empty, short or plausible), never the value. Rafa runs it himself:
//
//   op run --env-file=config/secrets/judges.refs -- node scripts/secrets/check.mjs config/secrets/judges.refs
//
// Several files: repeat --env-file for op and list the same files here. While the local env file still exists it also
// says, per name, whether 1Password's value is the same as the file's, and lists by name the variables in the file
// that no references file names. Options: --from <file> (default: the .env at the repository root, when present),
// --inventory <file or folder>, repeatable (default: config/secrets), the files that count as the inventory.
// Exit 0 when every name is set and not empty, 1 when one is not, 2 on a usage error.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { isName, lengthClass, loadRefs } from './refs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const usage = 'usage: op run --env-file=<refs> -- node scripts/secrets/check.mjs <refs file>... [--from <file>] [--inventory <file or folder>]...';
const refuse = (line) => { console.error(`check: ${line}\n${usage}`); process.exit(2); };

const args = process.argv.slice(2);
const files = [];
const inventory = [];
let from = join(ROOT, '.env');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--from' && args[i + 1]) from = args[++i];
  else if (args[i] === '--inventory' && args[i + 1]) inventory.push(args[++i]);
  else if (args[i].startsWith('--')) refuse(`unknown option ${JSON.stringify(args[i]).slice(0, 40)}`);
  else files.push(args[i]);
}
if (files.length === 0) refuse('name the references files that op run loaded');
if (inventory.length === 0) inventory.push(join(ROOT, 'config', 'secrets'));

const given = loadRefs(files);
const all = loadRefs([...inventory, ...files]);
if (given.errors.length || all.errors.length) refuse(`the references files are not valid:\n  ${[...new Set([...given.errors, ...all.errors])].join('\n  ')}`);

let local;
if (existsSync(from)) {
  try { local = parseEnv(readFileSync(from, 'utf8')); } catch { refuse(`could not parse ${from} as an env file`); }
}

const lines = [];
let ok = true;
for (const e of given.entries) {
  const v = process.env[e.name];
  let state = lengthClass(v);
  if (state === 'not set' || state === 'empty' || state === 'still a reference') ok = false;
  if (e.plain) {
    if (v !== e.plain) ok = false;
    state = v === e.plain ? 'plain, as the references file says' : `plain, ${state === 'not set' ? 'not set' : 'differs from the references file'}`;
  }
  if (local && v !== undefined) state += local[e.name] === undefined ? '; not in the local file' : local[e.name] === v ? '; same as the local file' : '; differs from the local file';
  lines.push([e.name, state]);
}
const known = new Set(all.entries.map((e) => e.name));
const extra = local ? Object.keys(local).filter((n) => !known.has(n) && isName(n)).sort() : [];
const odd = local ? Object.keys(local).filter((n) => !isName(n)).length : 0;
for (const n of extra) lines.push([n, 'in the local file, not in the inventory']);

const width = Math.max(...lines.map(([n]) => n.length));
console.log(`Check under op run of ${files.join(', ')}${local ? `, compared with ${from}` : ''}:`);
for (const [n, s] of lines) console.log(`  ${n.padEnd(width)}  ${s}`);
if (odd) console.log(`  ${odd} line${odd === 1 ? '' : 's'} of the local file parse to no variable name (not shown).`);
console.log(ok ? 'check: every name is set.' : 'check: a name is not set: see the lines above.');
process.exit(ok ? 0 : 1);
