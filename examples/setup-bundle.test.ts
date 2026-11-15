// T-472: site/setup.mjs, the setup command, as a stranger runs it. Every run here is the committed file, copied alone
// into a fresh empty folder and run in its own Node process with only PATH and HOME in its environment. This file
// covers what needs no counterparty: the bundle itself, the published command, the folder `seller` makes, the check
// and each way it holds a bad setup back. The first deal with Crow's test buyer is in
// apps/test-agents/src/setup.test.ts, beside the test buyer's code. Nothing here reaches the network: a recorder
// loaded before the bundle writes down every connection the process opens and refuses one that leaves this machine.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { builtinModules } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { holdingKeyOf } from './seller-adapter.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const committed = here('../site/setup.mjs');

/**
 * A fresh empty folder with one file in it: setup.mjs, as a stranger's download leaves it. The folder's path has no
 * symbolic link in it (macOS's temporary folder is reached through one): a bundled tool tests whether it is the program
 * by comparing paths, and through a link that test is false whatever the bundle holds, which would prove nothing here.
 */
function alone(code?: string): { dir: string; file: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'crow-setup-')));
  const file = join(dir, 'setup.mjs');
  if (code === undefined) copyFileSync(committed, file);
  else writeFileSync(file, code);
  return { dir, file };
}

/** Loaded before the bundle: every TCP connection the process opens, one JSON line each; one that leaves this machine is refused. */
const RECORDER = `import net from 'node:net';
import { appendFileSync } from 'node:fs';
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const o = typeof first === 'object' && first !== null ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  const host = String(o.host ?? 'localhost');
  appendFileSync(process.env.SETUP_TEST_CONNECTIONS, JSON.stringify({ host, port: Number(o.port) }) + '\\n');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('the test lets no connection leave this machine: ' + host);
  return connect.apply(this, args);
};
`;

type Run = { code: number | null; out: string; err: string; connections: Array<{ host: string; port: number }> };
/** Runs `node <file> <args>` under the recorder, with only PATH and HOME (the fresh folder) in its environment, plus `env`. */
function node(at: { dir: string; file: string }, args: string[], env: Record<string, string> = {}): Promise<Run> {
  const tools = realpathSync(mkdtempSync(join(tmpdir(), 'crow-setup-recorder-')));
  writeFileSync(join(tools, 'recorder.mjs'), RECORDER);
  const log = join(tools, 'connections.jsonl');
  writeFileSync(log, '');
  const child = spawn(process.execPath, ['--import', join(tools, 'recorder.mjs'), at.file, ...args], { cwd: at.dir, env: { PATH: process.env['PATH'] ?? '', HOME: at.dir, SETUP_TEST_CONNECTIONS: log, ...env } });
  let out = '', err = '';
  child.stdout.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr.on('data', (d: Buffer) => (err += d.toString()));
  child.stdin.end();
  // A bundled tool that started a server would keep the process alive: stop it, and the test fails on the null code.
  const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
  return new Promise((resolve) => child.on('exit', (code) => (clearTimeout(timer), resolve({ code, out, err, connections: readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) }))));
}
const jsonLines = (text: string): J[] => text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
/** The first words of the usage each bundled tool prints from its own command line. */
const OWN_USAGE = /^(seller-adapter|check-delivery|report-converter|deal-record): |usage: node examples\//m;
/** Every form a key could take in a line or a file: hex in both cases, base64 in both alphabets. */
const formsOf = (key: string): string[] => {
  const hex = key.replace(/^0x/, ''), bytes = Buffer.from(hex, 'hex');
  return [hex, hex.toUpperCase(), bytes.toString('base64'), bytes.toString('base64url'), bytes.toString('base64').replace(/=+$/, '')];
};
const mode = (path: string) => statSync(path).mode & 0o777;

describe('site/setup.mjs, the bundle (T-472)', () => {
  it('is the current bundle of site/setup-entry.mjs: one file that imports only Node built-ins', async () => {
    const { setupBundle, pins } = await import(here('../site/build.mjs'));
    const code = readFileSync(committed, 'utf8');
    expect(code === (await setupBundle()), 'site/setup.mjs is stale: run node site/build.mjs').toBe(true);
    const imports = [...code.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]!);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((s) => !s.startsWith('node:'))).toEqual([]);
    // No import() left, and every require() names a Node built-in (tweetnacl asks for crypto, yaml for process and buffer).
    expect(code).not.toMatch(/\bimport\(/);
    const required = [...new Set([...code.matchAll(/__require\("([^"]+)"\)/g)].map((m) => m[1]!))];
    expect(required).toContain('crypto');
    expect(required.filter((name) => !builtinModules.includes(name))).toEqual([]);
    // What it carries: the adapter's Node shell and core, the check library, the deal record, and the two libraries at the lockfile's versions.
    for (const mark of ['async function startSellerAdapter(', 'async function createSellerAdapter(', 'function preflightDelivery(', 'function checkDelivery(', 'async function dealRecord(', 'function privateKeyToAccount(', 'nacl.box', `viem@${pins().viem} (`, `tweetnacl@${pins().tweetnacl} (`]) expect(code, mark).toContain(mark);
    // Before any module: the ambient settings are removed, and the one command the file runs is named, so deal-record.ts runs none.
    const firstImport = code.indexOf('\nimport ');
    for (const line of ["for (const name of Object.keys(process.env)) if (/^(HOLDBACK|CROW)_/.test(name)) delete process.env[name];", "Object.defineProperty(globalThis, 'crowEntry', { value: 'setup',"]) {
      expect(code.indexOf(line), line).toBeGreaterThan(0);
      expect(code.indexOf(line), line).toBeLessThan(firstImport);
    }
  }, 60_000);

  it('setup.txt carries the one command: the file as a .part, moved into place only when its SHA-256 is the current one, then the first step', async () => {
    const { setupCommand, setupSha256, publishedGuides } = await import(here('../site/build.mjs'));
    const sha = createHash('sha256').update(readFileSync(committed)).digest('hex');
    expect(setupSha256()).toBe(sha);
    const command = setupCommand();
    expect(command).toBe(`mkdir -p ~/.crow && cd ~/.crow && curl -fsSL https://crow.direct/setup.mjs -o setup.mjs.part && echo "${sha}  setup.mjs.part" | shasum -a 256 -c && mv setup.mjs.part setup.mjs && node setup.mjs seller --sample`);
    const source = readFileSync(here('../site/setup.txt'), 'utf8');
    expect(source.split('{{SETUP_COMMAND}}').length - 1).toBe(1);
    const published = publishedGuides({ op1: 'https://a.example', op2: 'https://b.example' }).get('setup.txt') as string;
    expect(published.split('\n')).toContain(command);
    expect(published).not.toMatch(/\{\{|^%% /m);
    expect(Buffer.byteLength(published)).toBeLessThanOrEqual(8000);
    expect(command).not.toMatch(/npm/);
  }, 30_000);

  it('runs with nothing installed beside it: `status` in a fresh empty folder, and through a symbolic link', async () => {
    const at = alone();
    expect(readdirSync(at.dir)).toEqual(['setup.mjs']);
    const r = await node(at, ['status', '--folder', join(at.dir, 'party')]);
    expect(r.code, r.out + r.err).toBe(0);
    expect(r.err).toBe('');
    expect(jsonLines(r.out)).toEqual([{ step: 'status', folder: join(at.dir, 'party'), exists: false }]);
    expect(readdirSync(at.dir)).toEqual(['setup.mjs']); // `status` writes nothing
    expect(r.connections).toEqual([]);
    // Reached through a symbolic link, where a test of "is this file the program" by path is false, it runs the same.
    const link = join(realpathSync(mkdtempSync(join(tmpdir(), 'crow-setup-link-'))), 'linked');
    symlinkSync(at.dir, link);
    const linked = await node({ dir: link, file: join(link, 'setup.mjs') }, ['status', '--folder', join(at.dir, 'party')]);
    expect(linked.code, linked.out + linked.err).toBe(0);
    expect(jsonLines(linked.out)).toEqual([{ step: 'status', folder: join(at.dir, 'party'), exists: false }]);
  }, 30_000);

  it("runs none of the bundled tools' own command lines, whatever the arguments look like", async () => {
    const at = alone();
    writeFileSync(join(at.dir, 'a.json'), '{}');
    writeFileSync(join(at.dir, 'b.json'), '{}');
    // Each shape is one a bundled tool's command line would take: a configuration, terms and a file, a mapping and a
    // report, a commitment ID with --as (deal-record.ts), --help.
    for (const args of [['status'], ['a.json'], ['a.json', 'b.json'], ['a.json', '--sim'], [`0x${'ab'.repeat(32)}`, '--as', 'seller'], ['--help'], []]) {
      const r = await node(at, args);
      const said = r.out + r.err;
      expect(said, args.join(' ')).not.toMatch(OWN_USAGE);
      expect(r.code, `${args.join(' ')}: ${said}`).toBe(args[0] === 'status' || args[0] === '--help' ? 0 : 2);
      if (r.code === 2) expect(r.err).toMatch(/^setup\.mjs: /);
      expect(r.connections).toEqual([]);
    }
  }, 60_000);

  it('the control: built without the transform, a bundled tool takes the command line and `status` never runs', async () => {
    const { setupBundle, pins } = await import(here('../site/build.mjs'));
    const r = await node(alone(await setupBundle(pins(), { keepOwnMains: true })), ['status']);
    expect(r.out + r.err).toMatch(OWN_USAGE);
    expect(r.code).not.toBe(0);
    expect(r.out).not.toMatch(/"step":"status"/);
  }, 60_000);

  it('--test-world needs --operators, and first-deal in a test world needs --buyer: a wrong call exits 2 and sends nothing', async () => {
    const at = alone();
    const bare = await node(at, ['first-deal', '--folder', join(at.dir, 'party'), '--test-world']);
    expect(bare.code).toBe(2);
    expect(bare.err).toMatch(/^setup\.mjs: \[test world: this is not the live service\] --test-world needs --operators/);
    expect(bare.connections).toEqual([]);
    const none = await node(at, ['first-deal', '--folder', join(at.dir, 'party')]);
    expect(none.code).toBe(1);
    expect(jsonLines(none.out)).toEqual([{ step: 'first-deal', ok: false, detail: expect.stringMatching(/run the seller command first\. Nothing was sent\./) }]);
    expect(none.connections).toEqual([]);
  }, 30_000);
});

describe('site/setup.mjs seller, check and status (T-472)', () => {
  // A server that stands where the operators and the test buyer would: nothing may ask it anything.
  let asked = 0;
  const bystander = createServer((_req, res) => {
    asked += 1;
    res.writeHead(500).end();
  });
  let operators = '';
  let buyer = '';
  beforeAll(async () => {
    await new Promise<void>((resolve) => bystander.listen(0, '127.0.0.1', resolve));
    const port = (bystander.address() as AddressInfo).port;
    operators = `http://127.0.0.1:${port},http://localhost:${port}`;
    buyer = `http://127.0.0.1:${port}/agents/test-buyer`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => bystander.close(() => resolve()));
  });
  /** No request reached the bystander, and no connection went anywhere but the command's own sample API on the loopback address. */
  const sentNothing = (r: Run) => {
    expect(asked).toBe(0);
    const port = (bystander.address() as AddressInfo).port;
    for (const c of r.connections) {
      expect(['127.0.0.1', 'localhost', '::1']).toContain(c.host);
      expect(c.port).not.toBe(port);
    }
  };
  const keyOf = (folder: string) => readFileSync(join(folder, 'keys', 'signing.key'), 'utf8').trim() as `0x${string}`;
  /** A folder `seller --sample --payout this-key` made, with the lines it printed. */
  async function made(extra: string[] = []): Promise<{ at: { dir: string; file: string }; folder: string; run: Run }> {
    const at = alone();
    const folder = join(at.dir, 'party');
    const run = await node(at, ['seller', '--sample', '--payout', 'this-key', '--folder', folder, ...extra]);
    expect(run.code, run.out + run.err).toBe(0);
    return { at, folder, run };
  }

  it('asks for the payout address and never gives it a default: one JSON object with each question, exit 3, nothing made', async () => {
    const at = alone();
    const folder = join(at.dir, 'party');
    const both = await node(at, ['seller', '--folder', folder]);
    expect(both.code).toBe(3);
    expect(jsonLines(both.out)).toEqual([{ step: 'seller', ok: false, exit: 3, missing: [{ flag: '--sample', question: expect.any(String) }, { flag: '--payout', question: expect.stringMatching(/^Where are you paid\? Give an address whose key is not on this machine .*or answer this-key/) }], next: expect.stringMatching(/Nothing was made or sent/) }]);
    const one = await node(at, ['seller', '--sample', '--folder', folder]);
    expect(one.code).toBe(3);
    expect(jsonLines(one.out)[0].missing.map((m: J) => m.flag)).toEqual(['--payout']);
    expect(existsSync(folder)).toBe(false);
    expect((await node(at, ['seller', '--sample', '--payout', '0x1234', '--folder', folder])).code).toBe(1);
    expect(existsSync(folder)).toBe(false);
    sentNothing(one);
  }, 30_000);

  it('makes the folder: a key in keys/ with modes 0700 and 0600, a .gitignore, the configuration, the template, a card apart, and a passing check', async () => {
    const { at, folder, run } = await made(['--operators', operators]);
    const lines = jsonLines(run.out);
    const key = keyOf(folder);
    const address = privateKeyToAccount(key).address.toLowerCase();
    expect(key).toMatch(/^0x[0-9a-f]{64}$/);
    expect(mode(join(folder, 'keys'))).toBe(0o700);
    expect(mode(join(folder, 'keys', 'signing.key'))).toBe(0o600);
    expect(readFileSync(join(folder, '.gitignore'), 'utf8').split('\n')).toContain('keys/');
    // With this-key the command says what that links, and where the key is.
    expect(lines[0]).toMatchObject({ step: 'seller', ok: true, folder, card: `${folder}-card`, address, payout: address, sent: 'nothing' });
    expect(lines[0].payoutNote).toBe(`Every deal names this folder's standing address ${address} as its payout address in its public terms, which links this folder's deals to one another. Its key is on this machine, in keys/signing.key.`);
    // The configuration: a fresh key for each deal, its own template, the payout address, and windows Crow's test buyer takes.
    const config = JSON.parse(readFileSync(join(folder, 'adapter.json'), 'utf8'));
    expect(config).toMatchObject({ signingKey: 'per-deal', template: 'template.json', payoutAddress: address, timing: { deliverWithinSec: 3600, judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 } });
    const rules = await import(here('../apps/test-agents/src/buyer-rules.ts'));
    expect(config.timing.deliverWithinSec).toBeLessThanOrEqual(rules.WINDOWS.maxDeliverWithinSec);
    for (const w of ['judgeWithinSec', 'fallbackWithinSec', 'appealDecideSec']) expect(config.timing[w]).toBeLessThanOrEqual(rules.WINDOWS.maxJudgingSec);
    expect(config.timing.fundWithinSec).toBeGreaterThan(rules.WINDOWS.minFundingLeftSec);
    const template = JSON.parse(readFileSync(join(folder, 'template.json'), 'utf8'));
    expect(template.checks.length).toBeGreaterThanOrEqual(rules.CHECKS_RULE.min);
    expect(template.checks.every((c: J) => rules.CHECK_TYPES.includes(c.type) && c.required === true)).toBe(true);
    // The card is in a folder of its own, which holds no key and no address.
    expect(readdirSync(`${folder}-card`)).toEqual(['agent.json']);
    expect(readFileSync(join(`${folder}-card`, 'agent.json'), 'utf8')).not.toMatch(/0x[0-9a-f]{40}/i);
    // It ends by running the check: one JSON line per check, all passing.
    expect(lines.slice(1).map((l) => [l.step, l.check, l.ok])).toEqual([['check', 'folder', true], ['check', 'configuration', true], ['check', 'template', true], ['check', 'sample', true], ['check', 'required-field', true], ['check', 'secrets', true]]);
    sentNothing(run);
    // `check` alone gives the same lines and exit 0; `status` names the role, the steps and the addresses, and no key.
    const checked = await node(at, ['check', '--folder', folder, '--operators', operators]);
    expect(checked.code, checked.out).toBe(0);
    expect(jsonLines(checked.out)).toEqual(lines.slice(1));
    sentNothing(checked);
    // The recorder is not blind: the check's calls to its own sample API on the loopback address are in its record.
    expect(checked.connections.length).toBeGreaterThan(0);
    const status = await node(at, ['status', '--folder', folder]);
    expect(jsonLines(status.out)).toEqual([{ step: 'status', folder, exists: true, role: 'seller', sells: 'sample', name: 'seller', steps: ['folder', 'key', 'payout', 'template', 'configuration', 'card'], address, payout: { address, thisKey: true }, card: `${folder}-card`, firstDeal: null, openDeals: [] }]);
    expect(status.connections).toEqual([]);
    // No line any of the three printed, and no file outside keys/, holds the key or the holding key it derives.
    const said = run.out + run.err + checked.out + checked.err + status.out + status.err;
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'keys' ? [] : files(join(dir, e.name))) : [join(dir, e.name)]));
    for (const secret of [...formsOf(key), ...formsOf(holdingKeyOf(key))]) {
      expect(said).not.toContain(secret);
      for (const f of [...files(folder), ...files(`${folder}-card`)]) expect(readFileSync(f, 'latin1'), f).not.toContain(secret);
    }
  }, 60_000);

  it('takes an address as the payout address, and says every deal names it', async () => {
    const at = alone();
    const folder = join(at.dir, 'party');
    const elsewhere = '0x00000000000000000000000000000000000c0ffe';
    const run = await node(at, ['seller', '--sample', '--payout', elsewhere, '--folder', folder]);
    expect(run.code, run.out).toBe(0);
    expect(jsonLines(run.out)[0]).toMatchObject({ payout: elsewhere, payoutNote: `Every deal names ${elsewhere} as its payout address in its public terms, which links this folder's deals to one another.` });
    expect(JSON.parse(readFileSync(join(folder, 'adapter.json'), 'utf8')).payoutAddress).toBe(elsewhere);
  }, 30_000);

  it('the default folder is ~/.crow/<name>', async () => {
    const at = alone();
    const run = await node(at, ['seller', '--sample', '--payout', 'this-key', '--name', 'acme']);
    expect(run.code, run.out).toBe(0);
    expect(jsonLines(run.out)[0]).toMatchObject({ folder: join(at.dir, '.crow', 'acme'), card: join(at.dir, '.crow', 'acme-card') });
    expect(mode(join(at.dir, '.crow', 'acme', 'keys', 'signing.key'))).toBe(0o600);
  }, 30_000);

  it('refuses a folder inside a git work tree, a synced folder or the card\'s folder, each until its flag says otherwise', async () => {
    const at = alone();
    mkdirSync(join(at.dir, 'repo', '.git'), { recursive: true });
    const cases: Array<[string, string[], string, RegExp]> = [
      [join(at.dir, 'repo', 'deep', 'party'), [], '--allow-git', /is inside the git work tree at .*repo: a commit there could carry the key/],
      [join(at.dir, 'Dropbox', 'party'), [], '--allow-synced', /is under Dropbox, a folder a sync service copies to other machines/],
      [join(at.dir, 'served', 'party'), ['--card', join(at.dir, 'served')], '--allow-served', /hold one another: a folder that is served would hold keys\//],
    ];
    for (const [folder, extra, flag, why] of cases) {
      const refused = await node(at, ['seller', '--sample', '--payout', 'this-key', '--folder', folder, ...extra]);
      expect(refused.code, refused.out).toBe(1);
      expect(jsonLines(refused.out)).toEqual([{ step: 'folder', ok: false, flag, detail: expect.stringMatching(why) }]);
      expect(existsSync(join(folder, 'keys'))).toBe(false);
      const allowed = await node(at, ['seller', '--sample', '--payout', 'this-key', '--folder', folder, ...extra, flag]);
      expect(allowed.code, allowed.out).toBe(0);
      expect(mode(join(folder, 'keys', 'signing.key'))).toBe(0o600);
    }
  }, 60_000);

  it('resumes: run again after a stop, it makes no second key and keeps the answers', async () => {
    const { at, folder } = await made();
    const key = keyOf(folder);
    // As if it stopped after the key: the state and the later files are gone.
    for (const f of ['crow.json', 'adapter.json', 'template.json']) rmSync(join(folder, f));
    rmSync(`${folder}-card`, { recursive: true });
    const again = await node(at, ['seller', '--sample', '--payout', 'this-key', '--folder', folder]);
    expect(again.code, again.out).toBe(0);
    expect(keyOf(folder)).toBe(key);
    expect(existsSync(join(folder, 'adapter.json')) && existsSync(join(`${folder}-card`, 'agent.json'))).toBe(true);
    // With the state there, the answers are kept: no flag, no question, the same key.
    const bare = await node(at, ['seller', '--folder', folder]);
    expect(bare.code, bare.out).toBe(0);
    expect(keyOf(folder)).toBe(key);
    // Another payout address is not taken silently.
    const other = await node(at, ['seller', '--payout', '0x00000000000000000000000000000000000c0ffe', '--folder', folder]);
    expect(other.code).toBe(1);
    expect(jsonLines(other.out)[0].detail).toMatch(/this folder already pays to 0x[0-9a-f]{40}/);
  }, 60_000);

  it('the check holds a bad setup back: each cause fails it by name, and first-deal then refuses and sends nothing', async () => {
    const { at, folder } = await made();
    const good = { adapter: readFileSync(join(folder, 'adapter.json'), 'utf8'), template: readFileSync(join(folder, 'template.json'), 'utf8') };
    const template = JSON.parse(good.template);
    const cases: Array<{ name: string; file: string; text: string; check: string; why: RegExp }> = [
      { name: 'a template the bundled commitment schema refuses', file: 'template.json', text: JSON.stringify({ ...template, deliverable: { ...template.deliverable, kind: 'no-such-kind' } }), check: 'template', why: /template\.json: .*deliverable/ },
      { name: 'a sample result the checks refuse', file: 'template.json', text: JSON.stringify({ ...template, checks: [...template.checks.filter((c: J) => c.id !== 'rows'), { id: 'rows', type: 'row_count_range', required: true, min: 40, max: 40 }] }), check: 'sample', why: /the checks refuse the sample result\. Result: reject\. The required check rows fails/ },
      { name: 'checks that still pass a result with a required field removed', file: 'template.json', text: JSON.stringify({ ...template, checks: template.checks.filter((c: J) => c.id === 'rows') }), check: 'required-field', why: /the checks still pass the sample result with its last column, square, removed: they do not check what the result holds/ },
      { name: "a configuration the adapter's own loader refuses", file: 'adapter.json', text: JSON.stringify({ ...JSON.parse(good.adapter), signingKey: 'sometimes' }), check: 'configuration', why: /signingKey must be "standing" or "per-deal"/ },
      { name: "a key's value in a file outside keys/", file: 'notes.txt', text: `my key is ${keyOf(folder)}\n`, check: 'secrets', why: /notes\.txt holds a key's value: a key belongs in keys\/ only/ },
      { name: "a key's value in base64 in a file outside keys/", file: 'notes.txt', text: Buffer.from(keyOf(folder).slice(2), 'hex').toString('base64'), check: 'secrets', why: /notes\.txt holds a key's value/ },
    ];
    for (const c of cases) {
      writeFileSync(join(folder, c.file), c.text);
      const checked = await node(at, ['check', '--folder', folder]);
      expect(checked.code, `${c.name}: ${checked.out}`).toBe(1);
      const failed = jsonLines(checked.out).filter((l) => !l.ok);
      expect(failed.map((l) => l.check), c.name).toContain(c.check);
      expect(failed.find((l) => l.check === c.check).detail, c.name).toMatch(c.why);
      // The detail names the file, never the key.
      for (const secret of formsOf(keyOf(folder))) expect(checked.out + checked.err).not.toContain(secret);
      const deal = await node(at, ['first-deal', '--folder', folder, '--test-world', '--operators', operators, '--buyer', buyer]);
      expect(deal.code, `${c.name}: ${deal.out}`).toBe(1);
      expect(jsonLines(deal.out).at(-1)).toMatchObject({ step: 'first-deal', ok: false, detail: expect.stringMatching(/^The check fails \(.*\): fix it, then run check\. Nothing was sent\.$/) });
      expect(existsSync(join(folder, 'first-deal.started')), c.name).toBe(false);
      sentNothing(deal);
      // Put back what the case changed.
      if (c.file === 'notes.txt') rmSync(join(folder, c.file));
      else writeFileSync(join(folder, c.file), c.file === 'adapter.json' ? good.adapter : good.template);
    }
    // keys/ readable by others fails the check too.
    chmodSync(join(folder, 'keys'), 0o755);
    const open = await node(at, ['check', '--folder', folder]);
    expect(jsonLines(open.out).find((l) => l.check === 'folder')).toMatchObject({ ok: false, detail: expect.stringMatching(/keys\/ has mode 755, not 700/) });
    chmodSync(join(folder, 'keys'), 0o700);
    expect((await node(at, ['check', '--folder', folder])).code).toBe(0);
  }, 120_000);

  it('ignores HOLDBACK_* and CROW_* variables: seller and check give the same lines with them set', async () => {
    const at = alone();
    const folder = join(at.dir, 'party');
    // Each would change or break a bundled tool that read it: other operators, a deployment that is not JSON, another chain, a signer.
    const ambient = { HOLDBACK_OPERATORS: operators, HOLDBACK_DEPLOYMENT: 'not json', HOLDBACK_CHAIN_ID: '5', HOLDBACK_VERIFYING_CONTRACT: `0x${'12'.repeat(20)}`, HOLDBACK_KEY: 'ambient', CROW_SIGNER_URL: buyer };
    const run = await node(at, ['seller', '--sample', '--payout', 'this-key', '--folder', folder], ambient);
    expect(run.code, run.out + run.err).toBe(0);
    expect(jsonLines(run.out).every((l) => l.ok === true)).toBe(true);
    expect(run.out + run.err).not.toContain('ambient');
    sentNothing(run);
  }, 30_000);
});
