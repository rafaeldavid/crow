// T-480, row N137: the copy and the check, run against a made-up env-shaped file (written here, under a name that does
// not start with .env) and a stub in place of 1Password's `op`. They prove that no value reaches the output, an
// argument or a file, that values reach op on standard input only, and that an existing item is never changed.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const COPY = join(ROOT, 'scripts', 'secrets', 'copy.mjs');
const CHECK = join(ROOT, 'scripts', 'secrets', 'check.mjs');

/** Made-up values, built at run time so no secret-shaped string sits in the repository. */
const v = (tag: string) => `made-up-${tag}-${'z9'.repeat(16)}`;
const VALUES = { A_KEY: v('a'), B_KEY: v('b'), C_KEY: v('c'), STRAY_TOKEN: v('stray'), SHORT_KEY: 'tiny' };

const STUB = `#!${process.execPath}
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync(process.env.OP_STUB_STATE, 'utf8'));
const argv = process.argv.slice(2);
let stdin = '';
try { stdin = argv.includes('-') ? fs.readFileSync(0, 'utf8') : ''; } catch {}
fs.appendFileSync(process.env.OP_STUB_LOG, JSON.stringify({ argv, stdin }) + '\\n');
const save = () => fs.writeFileSync(process.env.OP_STUB_STATE, JSON.stringify(state));
const cmd = argv.slice(0, 3).join(' ');
if (argv[0] === 'whoami') { if (!state.signedIn) { process.stderr.write('[ERROR] account is not signed in\\n'); process.exit(1); } process.stdout.write('User Type: HUMAN\\n'); process.exit(0); }
if (cmd.startsWith('vault list')) { process.stdout.write(JSON.stringify(state.vaults)); process.exit(0); }
if (cmd.startsWith('item template get')) { process.stdout.write(JSON.stringify({ category: 'API_CREDENTIAL', fields: [{ id: state.fieldId || 'credential', type: 'CONCEALED' }] })); process.exit(0); }
if (cmd.startsWith('item list')) { process.stdout.write(JSON.stringify(state.items.map((t, i) => ({ id: 'i' + i, title: t })))); process.exit(0); }
if (cmd.startsWith('item create')) {
  const body = JSON.parse(stdin);
  if (body.title === state.failCreateFor) { process.stderr.write('[ERROR] could not save ' + body.fields[0].value + '\\n'); process.exit(1); }
  state.items.push(body.title); save();
  process.stdout.write(JSON.stringify(body)); process.exit(0);
}
process.stderr.write('stub: unexpected ' + argv.join(' ')); process.exit(9);
`;

let dir: string;
let bin: string;
let state: string;
let log: string;
let envFile: string;
let refsDir: string;

function writeState(s: Record<string, unknown>) {
  writeFileSync(state, JSON.stringify({ signedIn: true, vaults: [{ id: 'v1', name: 'Crow' }, { id: 'v2', name: 'Private' }], items: [], ...s }));
}
function run(script: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir, OP_STUB_STATE: state, OP_STUB_LOG: log, ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const calls = (): Array<{ argv: string[]; stdin: string }> => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
function noValueIn(text: string) {
  for (const value of Object.values(VALUES)) expect(text).not.toContain(value);
  for (const value of Object.values(VALUES).filter((x) => x.length > 8)) expect(text).not.toContain(value.slice(0, 12));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'secrets-test-'));
  bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'op'), STUB);
  chmodSync(join(bin, 'op'), 0o755);
  state = join(dir, 'state.json');
  log = join(dir, 'op.log');
  envFile = join(dir, 'local-secrets.txt');
  writeFileSync(envFile, `# made up\nA_KEY=${VALUES.A_KEY}\nB_KEY="${VALUES.B_KEY}"\nexport C_KEY=${VALUES.C_KEY}\nSTRAY_TOKEN=${VALUES.STRAY_TOKEN}\nSHORT_KEY=${VALUES.SHORT_KEY}\nEMPTY_KEY=\n`);
  refsDir = join(dir, 'refs');
  mkdirSync(refsDir);
  writeFileSync(join(refsDir, 'one.refs'), '# job one\nA_KEY=op://crow/mac-a/credential\nB_KEY=op://crow/mac-b/credential\nA_BASE_URL=https://api.example.com\n');
  writeFileSync(join(refsDir, 'two.refs'), 'C_KEY=op://crow/mac-c/credential\nSHORT_KEY=op://crow/mac-short/credential\nMISSING_KEY=op://crow/mac-missing/credential\nEMPTY_KEY=op://crow/mac-empty/credential\n');
  writeState({});
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the copy', () => {
  it('in a dry run reads the file, calls no op and prints names only', () => {
    const r = run(COPY, ['--dry-run', '--from', envFile, '--refs', refsDir]);
    expect(r.code).toBe(0);
    expect(calls()).toEqual([]);
    expect(r.out).toMatch(/A_KEY\s+would be copied to mac-a/);
    expect(r.out).toMatch(/MISSING_KEY\s+missing in the file/);
    expect(r.out).toMatch(/EMPTY_KEY\s+missing in the file/);
    expect(r.out).toMatch(/STRAY_TOKEN\s+in the file, not in the inventory/);
    noValueIn(r.out);
  });

  it('creates the missing items through stdin, leaves existing ones alone and prints no value', () => {
    writeState({ items: ['mac-b'] });
    const r = run(COPY, ['--from', envFile, '--refs', refsDir]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/A_KEY\s+created \(mac-a\)/);
    expect(r.out).toMatch(/B_KEY\s+exists, left alone \(mac-b\)/);
    expect(r.out).toMatch(/C_KEY\s+created \(mac-c\)/);
    expect(r.out).toMatch(/MISSING_KEY\s+missing in the file/);
    expect(r.out).toMatch(/A_BASE_URL\s+plain configuration/);
    expect(r.out).toMatch(/STRAY_TOKEN\s+in the file, not in the inventory/);
    noValueIn(r.out);
    const creates = calls().filter((c) => c.argv[0] === 'item' && c.argv[1] === 'create');
    expect(creates.map((c) => JSON.parse(c.stdin).title)).toEqual(['mac-a', 'mac-c', 'mac-short']);
    expect(JSON.parse(creates[0].stdin).fields[0]).toMatchObject({ id: 'credential', type: 'CONCEALED', value: VALUES.A_KEY });
    for (const c of calls()) noValueIn(c.argv.join(' '));
    for (const c of creates) expect(c.argv).toEqual(['item', 'create', '--vault', 'v1', '--format', 'json', '-']);
    // Only the check line for the file whose items all exist; two.refs names an item nobody created.
    expect(r.out).toMatch(/op run --env-file=refs\/one\.refs -- node .*check\.mjs refs\/one\.refs/);
    expect(r.out).not.toMatch(/--env-file=refs\/two\.refs/);
  });

  it('a second run changes nothing', () => {
    run(COPY, ['--from', envFile, '--refs', refsDir]);
    const before = calls().length;
    const r = run(COPY, ['--from', envFile, '--refs', refsDir]);
    expect(r.code).toBe(0);
    expect(calls().slice(before).some((c) => c.argv[1] === 'create')).toBe(false);
    expect(r.out).toMatch(/A_KEY\s+exists, left alone/);
  });

  it('stops at the first failure, with the error line redacted', () => {
    writeState({ failCreateFor: 'mac-c' });
    const r = run(COPY, ['--from', envFile, '--refs', refsDir]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('op item create failed for C_KEY');
    expect(r.out).toContain('[redacted]');
    expect(r.out).toMatch(/SHORT_KEY\s+not reached/);
    noValueIn(r.out);
    expect(calls().filter((c) => c.argv[1] === 'create').map((c) => JSON.parse(c.stdin).title)).toEqual(['mac-a', 'mac-b', 'mac-c']);
  });

  it('stops before reading items when op is not signed in, or the vault or field is missing', () => {
    writeState({ signedIn: false });
    let r = run(COPY, ['--from', envFile, '--refs', refsDir]);
    expect([r.code, calls().length]).toEqual([1, 1]);
    expect(r.out).toContain('Integrate with 1Password CLI');
    writeState({ vaults: [{ id: 'v2', name: 'Private' }] });
    r = run(COPY, ['--from', envFile, '--refs', refsDir]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('op vault create Crow');
    writeState({ fieldId: 'password' });
    r = run(COPY, ['--from', envFile, '--refs', refsDir]);
    expect(r.code).toBe(1);
    expect(calls().some((c) => c.argv[1] === 'create')).toBe(false);
  });

  it('refuses invalid references files and a missing file, without op', () => {
    writeFileSync(join(refsDir, 'bad.refs'), `A_KEY=${VALUES.A_KEY}\n`);
    let r = run(COPY, ['--from', envFile, '--refs', refsDir]);
    expect(r.code).toBe(2);
    noValueIn(r.out);
    rmSync(join(refsDir, 'bad.refs'));
    r = run(COPY, ['--from', join(dir, 'nothing-here'), '--refs', refsDir]);
    expect(r.code).toBe(2);
    expect(calls()).toEqual([]);
  });

  it('works when op is missing, and says so', () => {
    rmSync(join(bin, 'op'));
    const r = run(COPY, ['--from', envFile, '--refs', refsDir]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('op is not installed');
  });
});

describe('the check', () => {
  const one = () => join(refsDir, 'one.refs');
  const two = () => join(refsDir, 'two.refs');
  // The values op run would put in the environment.
  const resolved = { A_KEY: VALUES.A_KEY, B_KEY: 'changed-in-the-vault-' + 'y8'.repeat(8), A_BASE_URL: 'https://api.example.com' };

  it('prints set and length class, same or differs, and stray names, never a value', () => {
    const r = run(CHECK, [one(), '--from', envFile, '--inventory', refsDir], resolved);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/A_KEY\s+plausible; same as the local file/);
    expect(r.out).toMatch(/B_KEY\s+plausible; differs from the local file/);
    expect(r.out).toMatch(/A_BASE_URL\s+plain, as the references file says/);
    expect(r.out).toMatch(/STRAY_TOKEN\s+in the local file, not in the inventory/);
    noValueIn(r.out);
    expect(calls()).toEqual([]);
  });

  it('fails on a name not set, empty or still a reference, and says short', () => {
    const r = run(CHECK, [two(), '--from', envFile, '--inventory', refsDir], { C_KEY: 'op://crow/mac-c/credential', SHORT_KEY: VALUES.SHORT_KEY, EMPTY_KEY: '' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/C_KEY\s+still a reference/);
    expect(r.out).toMatch(/SHORT_KEY\s+short; same as the local file/);
    expect(r.out).toMatch(/MISSING_KEY\s+not set/);
    expect(r.out).toMatch(/EMPTY_KEY\s+empty/);
    noValueIn(r.out);
  });

  it('runs without a local file once it is gone', () => {
    const r = run(CHECK, [one(), '--from', join(dir, 'gone'), '--inventory', refsDir], { ...resolved, B_KEY: VALUES.B_KEY });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('local file');
  });

  it('refuses without a references file', () => {
    expect(run(CHECK, []).code).toBe(2);
  });
});
