// T-472, the first criterion: the setup bundle is proved before anything is built on it. site/setup.mjs is one
// self-contained file (viem, tweetnacl, the seller adapter and the check library inside), it runs with nothing
// installed beside it, none of the bundled tools' own command lines runs when it starts, and the adapter starts from
// inside it with the key passed in its `env` argument only. Every run here is the committed file, copied alone into a
// fresh empty folder and run in its own Node process, against the demo world served in this process: no network.
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveTwoOrigins, type TwoOrigins } from './two-origins.ts';

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

type Run = { code: number | null; out: string; err: string };
/** Runs `node <file> <args>` with only PATH and HOME (the fresh folder) in its environment, plus `env`. */
function node(at: { dir: string; file: string }, args: string[], env: Record<string, string> = {}): Promise<Run> {
  const child = spawn(process.execPath, [at.file, ...args], { cwd: at.dir, env: { PATH: process.env['PATH'] ?? '', HOME: at.dir, ...env } });
  let out = '', err = '';
  child.stdout.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr.on('data', (d: Buffer) => (err += d.toString()));
  child.stdin.end();
  // A bundled tool that started a server would keep the process alive: stop it, and the test fails on the null code.
  const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
  return new Promise((resolve) => child.on('exit', (code) => (clearTimeout(timer), resolve({ code, out, err }))));
}
const jsonLines = (text: string): J[] => text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
/** The first words of the usage each bundled tool prints from its own command line. */
const OWN_USAGE = /^(seller-adapter|check-delivery|report-converter): |usage: node examples\//m;

describe('site/setup.mjs, the bundle (T-472)', () => {
  it('is the current bundle of site/setup-entry.mjs: one file that imports only Node built-ins', async () => {
    const { setupBundle } = await import(here('../site/build.mjs'));
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
    // What it carries: the adapter's Node shell and core, the check library, and the two libraries.
    for (const mark of ['async function startSellerAdapter(', 'async function createSellerAdapter(', 'function preflightDelivery(', 'function checkDelivery(', 'function privateKeyToAccount(', 'nacl.box']) expect(code, mark).toContain(mark);
  }, 60_000);

  it('runs with nothing installed beside it: `status` in a fresh empty folder', async () => {
    const at = alone();
    expect(readdirSync(at.dir)).toEqual(['setup.mjs']);
    const r = await node(at, ['status', '--folder', join(at.dir, 'party')]);
    expect(r.code, r.out + r.err).toBe(0);
    expect(r.err).toBe('');
    expect(jsonLines(r.out)).toEqual([{ step: 'status', folder: join(at.dir, 'party'), exists: false }]);
    expect(readdirSync(at.dir)).toEqual(['setup.mjs']); // `status` writes nothing
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
    // Each shape is one a bundled tool's command line would take: a configuration, terms and a file, a mapping and a report, --help.
    for (const args of [['status'], ['a.json'], ['a.json', 'b.json'], ['a.json', '--sim'], ['--help'], []]) {
      const r = await node(at, args);
      const said = r.out + r.err;
      expect(said, args.join(' ')).not.toMatch(OWN_USAGE);
      expect(r.code, `${args.join(' ')}: ${said}`).toBe(args[0] === 'status' || args[0] === '--help' ? 0 : 2);
      if (r.code === 2) expect(r.err).toMatch(/^setup\.mjs: /);
    }
  }, 60_000);

  it('the control: built without the transform, a bundled tool takes the command line and `status` never runs', async () => {
    const { setupBundle, pins } = await import(here('../site/build.mjs'));
    const r = await node(alone(await setupBundle(pins(), { keepOwnMains: true })), ['status']);
    expect(r.out + r.err).toMatch(OWN_USAGE);
    expect(r.code).not.toBe(0);
    expect(r.out).not.toMatch(/"step":"status"/);
  }, 60_000);
});

describe('site/setup.mjs, the adapter inside it (T-472)', () => {
  let served: TwoOrigins;
  beforeAll(async () => {
    const world = await PublicWorld.open({ storage: new MemoryStorage(), env: {}, faucetPerClient: 100, telemetryLog: () => {} });
    served = await serveTwoOrigins(world, { tickMs: 100 });
  });
  afterAll(async () => {
    await served.close();
  });

  it('starts the adapter with the folder\'s key in its env argument only, reads its own /defaults, and stops', async () => {
    const at = alone();
    const folder = join(at.dir, 'party');
    mkdirSync(join(folder, 'keys'), { recursive: true });
    const key = generatePrivateKey();
    writeFileSync(join(folder, 'keys', 'signing.key'), `${key}\n`, { mode: 0o600 });
    const checks = [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['sku', 'qty'] }];
    writeFileSync(join(folder, 'template.json'), JSON.stringify({ deliverable: { kind: 'dataset', description: 'The sample stock list, {{item}}.', format: 'text/csv' }, checks }));
    writeFileSync(join(folder, 'adapter.json'), JSON.stringify({
      port: 0,
      // Nothing listens there: the adapter calls the seller's API only for a quote, and this run asks for none.
      sellerApi: { quote: 'http://127.0.0.1:9/quote', start: 'http://127.0.0.1:9/jobs', result: 'http://127.0.0.1:9/jobs/{jobId}/result' },
      template: 'template.json',
      scope: { item: { type: 'string', pattern: '^[a-z-]{1,40}$' } },
      signingKey: 'per-deal',
      timing: { deliverWithinSec: 3600 },
      pollMs: 200,
    }));
    // Ambient settings that would break the run if anything read them: operators that do not answer, and another key.
    const r = await node(at, ['first-deal', '--folder', folder, '--test-world', '--operators', served.urls.join(',')], { HOLDBACK_OPERATORS: 'http://127.0.0.1:9', HOLDBACK_KEY: 'ambient', CROW_SIGNER_URL: 'http://127.0.0.1:9' });
    const said = r.out + r.err;
    const lines = jsonLines(said);
    const adapter = lines.find((l) => l.step === 'adapter' && l.ok === true);
    expect(adapter, said).toBeDefined();
    expect(adapter.quote).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/quote$/);
    expect(adapter.defaults).toEqual({ status: 200, checks: ['cols'], deliverWithinSec: 3600 });
    // The folder's key is the one the adapter got: its log names that key's address, and no line holds the key.
    expect(said).toContain(privateKeyToAccount(key).address.toLowerCase());
    for (const secret of [key.slice(2), Buffer.from(key.slice(2), 'hex').toString('base64'), Buffer.from(key.slice(2), 'hex').toString('base64url')]) expect(said).not.toContain(secret);
    // A test world: every line says it is not the live service.
    for (const l of lines) expect(l.notLive, JSON.stringify(l)).toBe('test world: this is not the live service');
    // This file's first-deal ends after the adapter's start for now, and says so: exit 1, the process gone, nothing listening.
    expect(jsonLines(r.out).at(-1)).toMatchObject({ step: 'first-deal', ok: false });
    expect(jsonLines(r.err).length, 'the adapter logs its start on standard error').toBeGreaterThan(0);
    expect(r.code, said).toBe(1);
    await expect(fetch(adapter.quote.replace('/quote', '/defaults'))).rejects.toThrow();
  }, 60_000);

  it('check runs the adapter\'s own loader and the check library from inside the bundle: one JSON line each, exit 0 only when both pass', async () => {
    const at = alone();
    const folder = join(at.dir, 'party');
    mkdirSync(join(folder, 'sample'), { recursive: true });
    const api = { quote: 'http://127.0.0.1:9/quote', start: 'http://127.0.0.1:9/jobs', result: 'http://127.0.0.1:9/jobs/{jobId}/result' };
    writeFileSync(join(folder, 'adapter.json'), JSON.stringify({ sellerApi: api, signingKey: 'per-deal' }));
    const terms = (columns: string[]) => JSON.stringify({ deliverable: { format: 'text/csv' }, acceptance: { deterministicChecks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns }], rubric: { criteria: [] } } });
    writeFileSync(join(folder, 'sample', 'terms.json'), terms(['sku', 'qty']));
    writeFileSync(join(folder, 'sample', 'result'), 'sku,qty\nA1,3\n');
    const good = await node(at, ['check', '--folder', folder]);
    expect(good.code, good.out + good.err).toBe(0);
    expect(jsonLines(good.out)).toEqual([
      { step: 'check', check: 'configuration', ok: true, detail: expect.any(String) },
      { step: 'check', check: 'sample', ok: true, detail: expect.stringMatching(/^Result: accept\./) },
    ]);
    // A configuration the loader refuses and a sample the checks refuse: each line names its cause, and the exit is 1.
    writeFileSync(join(folder, 'adapter.json'), JSON.stringify({ sellerApi: api, signingKey: 'sometimes' }));
    writeFileSync(join(folder, 'sample', 'terms.json'), terms(['sku', 'price']));
    const bad = await node(at, ['check', '--folder', folder]);
    expect(bad.code, bad.out + bad.err).toBe(1);
    expect(jsonLines(bad.out)).toEqual([
      { step: 'check', check: 'configuration', ok: false, detail: expect.stringMatching(/signingKey must be "standing" or "per-deal"/) },
      { step: 'check', check: 'sample', ok: false, detail: expect.stringMatching(/^Result: reject\. The required check cols fails/) },
    ]);
  }, 30_000);

  it('first-deal sends nothing without --test-world yet, and --test-world needs --operators', async () => {
    const at = alone();
    const live = await node(at, ['first-deal', '--folder', join(at.dir, 'party')]);
    expect(live.code).toBe(1);
    expect(jsonLines(live.out)).toEqual([{ step: 'first-deal', ok: false, detail: expect.stringMatching(/nothing was sent/) }]);
    const bare = await node(at, ['first-deal', '--folder', join(at.dir, 'party'), '--test-world']);
    expect(bare.code).toBe(2);
    expect(bare.err).toMatch(/^setup\.mjs: \[test world: this is not the live service\] --test-world needs --operators/);
  }, 30_000);
});
