// T-478: `cloudflare`, `cloudflare --key` and `leave`, run as a party runs them: the committed site/setup.mjs in its
// own Node process, on a template folder it made itself, with a stand-in `npx` first on PATH that plays Wrangler. The
// stand-in records every argument of every run and what each read on standard input, and answers `secret list` from
// a store it keeps in a file. Nothing reaches a Cloudflare account, and the network is not used.
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { addressOf, checkSeller, WRANGLER_VERSION } from './setup-cloudflare.ts';
import { formsOf } from './setup-seller.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const committed = fileURLToPath(new URL('../site/setup.mjs', import.meta.url));
const workerFile = fileURLToPath(new URL('../site/seller-worker.mjs', import.meta.url));
const ACCOUNT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

/** The stand-in Wrangler: a shell script named npx. `fail-bulk` in the directory makes the next bulk fail once. */
function standIn(dir: string): string {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const script = `#!/bin/sh
d='${dir}'
printf '%s\\n' "$*" >> "$d/args.log"
env > "$d/env.log"
pwd > "$d/cwd.log"
input=$(cat)
printf '%s\\n' "$input" >> "$d/stdin.log"
case "$*" in
  *"secret list"*) if [ -f "$d/store" ]; then cat "$d/store"; else echo '[]'; fi ;;
  *"secret bulk"*) if [ -f "$d/fail-bulk" ]; then rm "$d/fail-bulk"; echo 'bulk failed' >&2; exit 1; fi; echo '[{"name":"HOLDBACK_KEY","type":"secret_text"}]' > "$d/store" ;;
  *delete*) echo 'deleted' ;;
esac
`;
  writeFileSync(join(bin, 'npx'), script);
  chmodSync(join(bin, 'npx'), 0o755);
  return bin;
}

function run(args: string[], o: { bin: string; env?: Record<string, string> }): Promise<{ code: number; out: string; err: string; lines: J[] }> {
  return new Promise((done) => {
    const env: Record<string, string> = { PATH: `${o.bin}:${process.env.PATH}`, HOME: process.env.HOME ?? '/tmp', ...o.env };
    const child = spawn(process.execPath, [committed, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d: Buffer) => (out += d));
    child.stderr.on('data', (d: Buffer) => (err += d));
    child.on('close', (code) => done({ code: code ?? 1, out, err, lines: out.split('\n').filter(Boolean).map((l) => JSON.parse(l)) }));
  });
}

/** A fresh template folder, and the party's own-API configuration with its template beside it. */
async function party(over: { config?: J } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'crow-cf-'));
  const bin = standIn(dir);
  const folder = join(dir, 'seller');
  writeFileSync(join(dir, 'template.input.json'), JSON.stringify({ deliverable: { kind: 'dataset', description: 'A list.', format: 'text/csv' }, price: '1000000', checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['name'] }] }));
  const made = await run(['seller', '--template', join(dir, 'template.input.json'), '--payout', 'this-key', '--folder', folder, '--name', 'reviews'], { bin });
  expect(made.code, made.out + made.err).toBe(0);
  const own = join(dir, 'own');
  mkdirSync(own);
  writeFileSync(join(own, 'template.json'), JSON.stringify({ deliverable: { kind: 'document', description: 'A review of {{commit}}.', format: 'application/json' }, checks: [{ id: 'r', type: 'json_schema', required: true, schema: { type: 'object', required: ['summary'] } }] }));
  const config = { port: 8791, journal: 'j.json', events: 'e.jsonl', template: 'template.json', scope: { commit: { type: 'string', pattern: '^[0-9a-f]{40}$' } }, sellerApi: { baseUrl: 'https://api.party-example.com/v1/', auth: { env: 'PARTY_API_KEY', header: 'X-Api-Key' }, quote: { method: 'POST', path: 'quotes', body: { commit: '{{scope.commit}}' }, read: { amount: '/amount', quoteId: '/id' } }, start: { method: 'POST', path: 'jobs', body: { quote: '{{quoteId}}' }, read: { jobId: '/id' } }, result: { method: 'GET', path: 'jobs/{{jobId}}', status: { by: 'field', pointer: '/state', running: ['running'], done: ['done'], failed: ['failed'] }, report: '/report' } }, ...over.config };
  writeFileSync(join(own, 'adapter.json'), JSON.stringify(config));
  return { dir, bin, folder, card: `${folder}-card`, config: join(own, 'adapter.json') };
}
const prepared = (p: Awaited<ReturnType<typeof party>>, extra: string[] = []) => ['cloudflare', '--folder', p.folder, '--config', p.config, '--account', ACCOUNT, '--at', 'reviews.party-example.workers.dev', '--quote-credential', '--quotes-per-day', '100', '--worker-file', workerFile, ...extra];
/** What the person's deploy writes to WRANGLER_OUTPUT_FILE_PATH: one `deploy` line with the Worker's name and targets. */
const deployed = (p: { folder: string }, targets = ['https://reviews.party-example.workers.dev'], name = 'reviews') => writeFileSync(join(p.folder, 'cloudflare', 'deploy-output.ndjson'), `${JSON.stringify({ type: 'wrangler-session', version: 1 })}\n${JSON.stringify({ type: 'deploy', version: 1, worker_name: name, targets })}\n`);
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const argsOf = (dir: string) => (existsSync(join(dir, 'args.log')) ? readFileSync(join(dir, 'args.log'), 'utf8').split('\n').filter(Boolean) : []);

/** Every file under `root` but those under keys/, with its text. */
function filesOutsideKeys(root: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (relative(root, p) === 'keys') continue;
      if (statSync(p).isDirectory()) walk(p);
      else out.push([p, readFileSync(p, 'latin1')]);
    }
  };
  walk(root);
  return out;
}

describe('T-478: cloudflare asks for the account and the address, and infers neither', () => {
  it('with no answers it names each question, exits 3 and writes nothing', async () => {
    const p = await party();
    const r = await run(['cloudflare', '--folder', p.folder], { bin: p.bin });
    expect(r.code).toBe(3);
    expect(r.lines[0].missing.map((m: J) => m.flag)).toEqual(['--config', '--account', '--at', '--quote-credential', '--quotes-per-day']);
    expect(r.lines[0].missing.find((m: J) => m.flag === '--account').question).toMatch(/Never pick one for the person/);
    expect(existsSync(join(p.folder, 'cloudflare'))).toBe(false);
    // With the account given and the address not, it still asks for the address.
    const half = await run(['cloudflare', '--folder', p.folder, '--config', p.config, '--account', ACCOUNT, '--open', '--quotes-per-day', '5'], { bin: p.bin });
    expect(half.code).toBe(3);
    expect(half.lines[0].missing.map((m: J) => m.flag)).toEqual(['--at']);
    expect(argsOf(p.dir)).toEqual([]); // Wrangler never ran
  }, 60_000);

  it('refuses to run while an account token or ID is in the environment', async () => {
    const p = await party();
    for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CF_API_TOKEN']) {
      const r = await run(prepared(p), { bin: p.bin, env: { [name]: 'x' } });
      expect(r.code, name).toBe(1);
      expect(r.lines[0].detail).toContain(`${name} is set in the environment`);
    }
    expect(existsSync(join(p.folder, 'cloudflare'))).toBe(false);
  }, 60_000);
});

describe('T-478: the prepared deploy', () => {
  it("names the person's account and address, and no Crow account, zone or route; the operators are the one Crow address", async () => {
    const p = await party();
    const r = await run(prepared(p), { bin: p.bin });
    expect(r.code, r.out + r.err).toBe(0);
    const line = r.lines.at(-1);
    expect(line).toMatchObject({ step: 'cloudflare', ok: true, address: 'https://reviews.party-example.workers.dev/', worker: 'reviews', account: ACCOUNT });
    expect(line.next.join('\n')).toContain(`WRANGLER_OUTPUT_FILE_PATH=deploy-output.ndjson npx wrangler@${WRANGLER_VERSION} deploy --config`);
    expect(line.next[0]).toContain(`npx --yes wrangler@${WRANGLER_VERSION} --version`); // the one install, the person's own step
    expect(line.next.join('\n')).toContain('secret put PARTY_API_KEY');
    expect(line.dropped.map((d: string) => d.split(':')[0])).toEqual(['port', 'journal', 'events']);
    const cfg = readJson(join(p.folder, 'cloudflare', 'wrangler.json'));
    expect(cfg).toMatchObject({ name: 'reviews', account_id: ACCOUNT, main: 'worker.mjs', workers_dev: true, preview_urls: false, vars: { SELLER_URL: 'https://reviews.party-example.workers.dev/' } });
    expect(cfg.routes).toBeUndefined();
    const { vars, ...rest } = cfg;
    const { OPERATOR_URLS, ...otherVars } = vars;
    expect(OPERATOR_URLS).toBe('https://api.crow.direct,https://api2.crow.direct');
    expect(JSON.stringify({ rest, otherVars })).not.toMatch(/crow\.direct|escrow\.stream/);
    // The bundle: no Node-only field, the folder's payout, the person's quote access; the Worker's own check takes it.
    const bundle = readJson(join(p.folder, 'cloudflare', 'seller-bundle.txt'));
    const state = readJson(join(p.folder, 'crow.json'));
    expect(bundle.owner).toBe(state.address);
    for (const k of ['port', 'journal', 'events']) expect(bundle.seller.config[k]).toBeUndefined();
    expect(bundle.seller.config).toMatchObject({ payoutAddress: state.payout.address, signingKey: 'per-deal', quoteAuth: { kind: 'bearer', env: 'QUOTE_CREDENTIALS' }, quoteRateLimit: { overall: { requests: 100, windowSec: 86_400 } } });
    expect(checkSeller(bundle.seller).sort()).toEqual(['PARTY_API_KEY', 'QUOTE_CREDENTIALS']); // the Worker's own check: apps/own-seller/src/setup.test.ts
    expect(readFileSync(join(p.folder, 'cloudflare', 'worker.mjs')).equals(readFileSync(workerFile))).toBe(true);
    // The card keeps its draft: the quote entry waits until the deploy shows the address.
    expect(readJson(join(p.card, 'agent.json')).status).toMatch(/^draft/);
    // Run again: the same bytes, nothing written.
    const again = await run(prepared(p), { bin: p.bin });
    expect(again.code).toBe(0);
    expect(again.lines.at(-1).written).toEqual([]);
    expect(argsOf(p.dir)).toEqual([]); // preparing runs no Wrangler
  }, 60_000);

  it("a host on the party's own zone is a custom-domain route with no workers.dev address", async () => {
    const p = await party();
    const args = prepared(p);
    args[args.indexOf('--at') + 1] = 'crow.party-example.com';
    const r = await run(args, { bin: p.bin });
    expect(r.code, r.out).toBe(0);
    const cfg = readJson(join(p.folder, 'cloudflare', 'wrangler.json'));
    expect(cfg.workers_dev).toBe(false);
    expect(cfg.routes).toEqual([{ pattern: 'crow.party-example.com', custom_domain: true }]);
    expect(cfg.name).toMatch(/^crow-seller-[0-9a-f]{12}$/);
  }, 60_000);

  it("refuses an address on Crow's zones, a Worker file with another SHA-256, an http API and a quote access the file sets", async () => {
    expect(() => addressOf('reviews.crow.direct', false)).toThrow(/Crow's zone/);
    expect(() => addressOf('crow.direct', false)).toThrow(/Crow's zone/);
    expect(() => addressOf('x.escrow.stream', false)).toThrow(/Crow's zone/);
    expect(() => addressOf('127.0.0.1:8787', false)).toThrow();
    const p = await party();
    const fake = join(p.dir, 'worker.mjs');
    writeFileSync(fake, 'export default {}');
    const args = prepared(p);
    args[args.indexOf('--worker-file') + 1] = fake;
    const r = await run(args, { bin: p.bin });
    expect(r.code).toBe(1);
    expect(r.lines.at(-1).detail).toMatch(/SHA-256 is [0-9a-f]{64}, not [0-9a-f]{64}/);
    for (const [config, why] of [[{ sellerApi: { quote: 'http://api.example.com/q', start: 'https://api.example.com/s', result: 'https://api.example.com/r/{jobId}' } }, /sellerApi.quote must be an https address/], [{ quoteAuth: { kind: 'bearer', env: 'X' } }, /sets quoteAuth/], [{ payoutAddress: `0x${'2'.repeat(40)}` }, /this folder's payout address/]] as const) {
      const q = await party({ config });
      const bad = await run(prepared(q), { bin: q.bin });
      expect(bad.code, JSON.stringify(config)).toBe(1);
      expect(bad.lines.at(-1).detail).toMatch(why);
      expect(existsSync(join(q.folder, 'cloudflare'))).toBe(false);
    }
  }, 120_000);

  it('--open says what an open quote address costs', async () => {
    const p = await party();
    const args = prepared(p).filter((a) => a !== '--quote-credential');
    const r = await run([...args, '--open'], { bin: p.bin });
    expect(r.code).toBe(0);
    expect(r.lines.at(-1).quotes).toMatch(/anyone who reaches .* may ask. Each quote asks your API for a price and spends one of the Worker's faucet grants/);
    expect(readJson(join(p.folder, 'cloudflare', 'seller-bundle.txt')).seller.config.quoteAuth).toBeUndefined();
  }, 60_000);
});

describe("T-478: the Worker's key reaches the secret store on standard input only", () => {
  it('sets one key, checks before it creates, and the key is in no printed line, argument or file outside keys/', async () => {
    const p = await party();
    expect((await run(prepared(p), { bin: p.bin })).code).toBe(0);
    deployed(p);
    writeFileSync(join(p.dir, 'fail-bulk'), ''); // the first bulk fails: a rerun continues
    const failed = await run(['cloudflare', '--key', '--folder', p.folder], { bin: p.bin });
    expect(failed.code).toBe(1);
    const first = await run(['cloudflare', '--key', '--folder', p.folder], { bin: p.bin });
    expect(first.code, first.out + first.err).toBe(0);
    expect(first.lines.at(-1)).toMatchObject({ step: 'cloudflare-key', ok: true, set: true });
    expect(first.lines.at(-1).next.join('\n')).toContain('secret put PARTY_API_KEY');
    const again = await run(['cloudflare', '--key', '--folder', p.folder], { bin: p.bin });
    expect(again.lines.at(-1)).toMatchObject({ ok: true, set: false });
    // The card's quote entry is written once the deploy showed the address.
    const card = readJson(join(p.card, 'agent.json'));
    expect(card.status).toBeUndefined();
    expect(card.offers).toContainEqual({ id: 'reviews', pricing: { kind: 'quoted', quote: 'https://reviews.party-example.workers.dev/quote', defaults: 'https://reviews.party-example.workers.dev/defaults' } });
    expect(card.configSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readJson(join(p.folder, 'crow.json')).cloudflare.workerAddress).toMatch(/^0x[0-9a-f]{40}$/);
    const args = argsOf(p.dir);
    expect(args.filter((a) => a.includes('secret bulk'))).toHaveLength(2); // the failed one and the one that set it
    expect(args.every((a) => a.startsWith(`wrangler@${WRANGLER_VERSION} `))).toBe(true); // no --yes: npx installs nothing
    expect(args.every((a) => a.includes(`--config ${join(realpathSync(p.folder), 'cloudflare', 'wrangler.json')}`))).toBe(true);
    // The key, as the stand-in read it on standard input.
    const inputs = readFileSync(join(p.dir, 'stdin.log'), 'utf8').split('\n').filter((l) => l.startsWith('{'));
    const key = JSON.parse(inputs.at(-1)!).HOLDBACK_KEY as string;
    expect(key).toMatch(/^0x[0-9a-f]{64}$/);
    const forms = [key, ...formsOf(key)];
    const printed = [failed, first, again].map((r) => r.out + r.err).join('\n');
    const places: Array<[string, string]> = [['printed lines', printed], ['arguments', args.join('\n')], ...filesOutsideKeys(p.folder), ...filesOutsideKeys(p.card)];
    for (const [where, text] of places) for (const f of forms) expect(text.includes(f), `${where} holds the key`).toBe(false);
  }, 90_000);

  it('refuses a Worker that holds secrets its bundle does not name: another program\'s Worker of the same name', async () => {
    const p = await party();
    expect((await run(prepared(p), { bin: p.bin })).code).toBe(0);
    deployed(p);
    writeFileSync(join(p.dir, 'store'), '[{"name":"STRIPE_KEY","type":"secret_text"}]');
    const r = await run(['cloudflare', '--key', '--folder', p.folder], { bin: p.bin });
    expect(r.code).toBe(1);
    expect(r.lines.at(-1).detail).toMatch(/secrets this folder's bundle does not name \(STRIPE_KEY\)/);
    expect(argsOf(p.dir).some((a) => a.includes('secret bulk'))).toBe(false);
  }, 60_000);

  it('runs Wrangler in the deploy folder, and not at all while a .env file is there for it to load', async () => {
    const p = await party();
    expect((await run(prepared(p), { bin: p.bin })).code).toBe(0);
    deployed(p);
    writeFileSync(join(p.folder, 'cloudflare', '.env'), 'X=1\n');
    const r = await run(['cloudflare', '--key', '--folder', p.folder], { bin: p.bin });
    expect(r.code).toBe(1);
    expect(r.lines.at(-1).detail).toMatch(/\.env is there, and Wrangler would load it/);
    expect(argsOf(p.dir)).toEqual([]);
  }, 60_000);

  it('refuses a folder name the Worker would refuse, before anything is written', async () => {
    const p = await party();
    const other = join(p.dir, 'shop');
    expect((await run(['seller', '--template', join(p.dir, 'template.input.json'), '--payout', 'this-key', '--folder', other, '--name', 'test-seller-own'], { bin: p.bin })).code).toBe(0);
    const args = prepared(p);
    args[args.indexOf('--folder') + 1] = other;
    const r = await run(args, { bin: p.bin });
    expect(r.code).toBe(1);
    expect(r.lines.at(-1).detail).toMatch(/not one the Worker takes/);
    expect(existsSync(join(other, 'cloudflare'))).toBe(false);
  }, 60_000);

  it('gives Wrangler only the variables it needs, a sanitized log in a folder of its own, and the deploy folder as its working directory', async () => {
    const p = await party();
    expect((await run(prepared(p), { bin: p.bin })).code).toBe(0);
    deployed(p);
    const r = await run(['cloudflare', '--key', '--folder', p.folder], { bin: p.bin, env: { PLANTED_TOKEN: 'planted-value-77' } });
    expect(r.code, r.out).toBe(0);
    const env = readFileSync(join(p.dir, 'env.log'), 'utf8');
    expect(env).not.toContain('planted-value-77');
    expect(env).toMatch(/^WRANGLER_LOG_SANITIZE=true$/m);
    expect(env).toMatch(/^npm_config_yes=false$/m);
    expect(env).not.toMatch(/^npm_config_registry=/m);
    const logPath = /^WRANGLER_LOG_PATH=(.*)$/m.exec(env)![1]!;
    expect(existsSync(logPath)).toBe(false); // removed when the run ended
    expect(readFileSync(join(p.dir, 'cwd.log'), 'utf8').trim()).toBe(join(realpathSync(p.folder), 'cloudflare'));
    for (const name of ['CLOUDFLARE_API_BASE_URL', 'WRANGLER_LOG_SANITIZE']) {
      const refused = await run(['cloudflare', '--key', '--folder', p.folder], { bin: p.bin, env: { [name]: 'x', npm_config_registry: 'https://registry.example' } });
      expect(refused.code, name).toBe(1);
    }
  }, 90_000);

  it('refuses a template or mapping named by a path, or one that is the folder key under another name', async () => {
    for (const template of ['../seller/keys/signing.key', 'sub/template.json']) {
      const p = await party({ config: { template } });
      const r = await run(prepared(p), { bin: p.bin });
      expect(r.code, template).toBe(1);
      expect(r.lines.at(-1).detail).toMatch(/with no folder in the name/);
    }
    const p = await party({ config: { template: 'linked.json' } });
    linkSync(join(p.folder, 'keys', 'signing.key'), join(p.dir, 'own', 'linked.json'));
    const r = await run(prepared(p), { bin: p.bin });
    expect(r.code).toBe(1);
    expect(r.lines.at(-1).detail).toMatch(/names the folder's signing key/);
    expect(existsSync(join(p.folder, 'cloudflare'))).toBe(false);
  }, 90_000);

  it('makes no key until the deploy shows the Worker at the address the person typed', async () => {
    const p = await party();
    expect((await run(prepared(p), { bin: p.bin })).code).toBe(0);
    const none = await run(['cloudflare', '--key', '--folder', p.folder], { bin: p.bin });
    expect(none.code).toBe(1);
    expect(none.lines.at(-1).detail).toMatch(/deploy-output\.ndjson, is not there/);
    deployed(p, ['https://reviews.someone-else.workers.dev']);
    const wrong = await run(['cloudflare', '--key', '--folder', p.folder], { bin: p.bin });
    expect(wrong.code).toBe(1);
    expect(wrong.lines.at(-1).detail).toMatch(/at reviews\.someone-else\.workers\.dev, not at reviews\.party-example\.workers\.dev/);
    expect(argsOf(p.dir)).toEqual([]); // no Wrangler run, no key
    expect(readJson(join(p.card, 'agent.json')).status).toMatch(/^draft/);
    writeFileSync(join(p.folder, 'cloudflare', '.npmrc'), 'registry=https://registry.example\n');
    deployed(p);
    const npmrc = await run(['cloudflare', '--key', '--folder', p.folder], { bin: p.bin });
    expect(npmrc.code).toBe(1);
    expect(npmrc.lines.at(-1).detail).toMatch(/\.npmrc is there, and npx would load it/);
  }, 90_000);

  it('refuses a Worker whose key this folder did not set', async () => {
    const p = await party();
    expect((await run(prepared(p), { bin: p.bin })).code).toBe(0);
    deployed(p);
    writeFileSync(join(p.dir, 'store'), '[{"name":"HOLDBACK_KEY","type":"secret_text"}]');
    const r = await run(['cloudflare', '--key', '--folder', p.folder], { bin: p.bin });
    expect(r.code).toBe(1);
    expect(r.lines.at(-1).detail).toMatch(/already has a HOLDBACK_KEY that this folder did not set/);
    expect(argsOf(p.dir).some((a) => a.includes('secret bulk'))).toBe(false);
  }, 60_000);
});

describe('T-478: leave', () => {
  it('a folder with no Worker removes nothing and says how to stop', async () => {
    const p = await party();
    const r = await run(['leave', '--folder', p.folder], { bin: p.bin });
    expect(r.code).toBe(0);
    expect(r.lines.at(-1)).toMatchObject({ step: 'leave', ok: true, removed: null });
    expect(argsOf(p.dir)).toEqual([]);
  }, 60_000);
});
