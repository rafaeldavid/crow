// T-472: the setup's first deal, as a stranger runs it: the committed site/setup.mjs, copied alone into a fresh empty
// folder and run in its own Node process, against the public demo's own world on two origins and Crow's test buyer's
// real code, all in this process, so CI needs no network. It lives beside the test buyer, as try-goals.test.ts does.
//
// Every request the command makes is recorded twice. The operators and the test buyer it is given write down each
// request with whether the first deal's marker file was there yet; the test buyer itself reaches the same world through
// other origins, so the record holds the command's requests only. And a recorder loaded before the bundle writes down
// every connection the process opens, and refuses one that leaves this machine.
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import type { Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dealKeyOf, holdingKeyOf } from '../../../examples/seller-adapter-core.ts';
import { serveTwoOrigins, type TwoOrigins } from '../../../examples/two-origins.ts';
import { knownPins } from '../../../examples/verify.ts';
import { TestBuyer } from './buyer.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const committed = fileURLToPath(new URL('../../../site/setup.mjs', import.meta.url));
const pin = knownPins()[0]!; // SimChain
const NOT_LIVE = 'test world: this is not the live service';

/** One request the command made: to an operator or to the test buyer, and whether the marker file was there yet. */
type Asked = { to: 'operator' | 'buyer'; method: string; path: string; beforeMarker: boolean };
const asked: Asked[] = [];
/** The marker file of the folder under test: a request that arrives while it is missing came before the first deal. */
let marker = '';
const record = (to: Asked['to'], method: string, url: string) => asked.push({ to, method, path: new URL(url).pathname, beforeMarker: !existsSync(marker) });

let world: PublicWorld;
let recorded: TwoOrigins; // the operators the command is given
let direct: TwoOrigins; // the same world, for the test buyer's own requests
let buyer: { url: string; address: string; close(): Promise<void> };

/** The test buyer's fetch(request, client) over HTTP at /agents/test-buyer, worked as its Durable Object's alarm works it. */
async function serveBuyer(): Promise<typeof buyer> {
  const held: { agent?: TestBuyer } = {};
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks);
    const url = `http://${req.headers.host}${req.url}`;
    record('buyer', req.method ?? 'GET', url);
    const r = await held.agent!.fetch(new Request(url, { method: req.method ?? 'GET', headers: req.headers as Record<string, string>, ...(body ? { body } : {}) }), req.socket.remoteAddress ?? 'unknown');
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/agents/test-buyer`;
  const agent = (held.agent = new TestBuyer({ storage: new MemoryStorage(), operators: [...direct.urls], seed: generatePrivateKey(), pin, base: url, log: () => {} }));
  let running = true;
  const loop = (async () => {
    while (running) {
      await agent.work().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  const card = (await (await fetch(`${url}/agent.json`)).json()) as J;
  asked.length = 0; // the read above is this test's own
  return {
    url,
    address: String(card.buyer).toLowerCase(),
    close: async () => {
      running = false;
      await loop;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}

beforeAll(async () => {
  world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000' }, faucetPerClient: 1000 });
  recorded = await serveTwoOrigins({ fetch: (request, ctx) => (record('operator', request.method, request.url), world.fetch(request, ctx)), work: () => world.work() }, { tickMs: 50 });
  direct = await serveTwoOrigins(world);
  buyer = await serveBuyer();
});
afterAll(async () => {
  await buyer.close();
  await direct.close();
  await recorded.close();
});

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

type Run = { code: number | null; out: string; err: string; hosts: string[] };
/** A fresh empty folder with setup.mjs alone in it, on a path with no symbolic link, and the party's folder inside it. */
function fresh(): { dir: string; file: string; folder: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'crow-setup-deal-')));
  copyFileSync(committed, join(dir, 'setup.mjs'));
  return { dir, file: join(dir, 'setup.mjs'), folder: join(dir, 'party') };
}
/** Starts `node setup.mjs <args>` under the recorder, with only PATH and HOME in its environment, plus `env`. */
function start(at: { dir: string; file: string }, args: string[], env: Record<string, string> = {}, onLine: (line: string) => void = () => {}): { child: ChildProcess; done: Promise<Run> } {
  const tools = realpathSync(mkdtempSync(join(tmpdir(), 'crow-setup-recorder-')));
  writeFileSync(join(tools, 'recorder.mjs'), RECORDER);
  const log = join(tools, 'connections.jsonl');
  writeFileSync(log, '');
  const child = spawn(process.execPath, ['--import', join(tools, 'recorder.mjs'), at.file, ...args], { cwd: at.dir, env: { PATH: process.env['PATH'] ?? '', HOME: at.dir, SETUP_TEST_CONNECTIONS: log, ...env } });
  let out = '', err = '';
  child.stdout!.on('data', (d: Buffer) => {
    out += d.toString();
    for (const l of d.toString().split('\n')) if (l) onLine(l);
  });
  child.stderr!.on('data', (d: Buffer) => (err += d.toString()));
  child.stdin!.end();
  return { child, done: new Promise((resolve) => child.on('exit', (code) => resolve({ code, out, err, hosts: [...new Set(readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => (JSON.parse(l) as { host: string }).host))] }))) };
}
const node = (at: { dir: string; file: string }, args: string[], env: Record<string, string> = {}) => start(at, args, env).done;
const jsonLines = (text: string): J[] => text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const world2 = () => ['--test-world', '--operators', recorded.urls.join(','), '--buyer', buyer.url];
/** Every form a key could take in a line or a file: hex in both cases, base64 in both alphabets. */
const formsOf = (key: string): string[] => {
  const hex = key.replace(/^0x/, ''), bytes = Buffer.from(hex, 'hex');
  return [hex, hex.toUpperCase(), bytes.toString('base64'), bytes.toString('base64url'), bytes.toString('base64').replace(/=+$/, '')];
};
/** Every file under `dir` but those under a folder named keys. */
const filesOutsideKeys = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'keys' ? [] : filesOutsideKeys(join(dir, e.name))) : [join(dir, e.name)]));
const ADDRESS = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;
/** Ambient settings that would change or break a bundled tool that read them. */
const AMBIENT = { HOLDBACK_OPERATORS: 'http://127.0.0.1:9,http://localhost:9', HOLDBACK_DEPLOYMENT: 'not json', HOLDBACK_CHAIN_ID: '5', HOLDBACK_VERIFYING_CONTRACT: `0x${'12'.repeat(20)}`, HOLDBACK_KEY: 'ambient', CROW_SIGNER_URL: 'http://127.0.0.1:9' };

describe('site/setup.mjs: seller --sample, then first-deal with Crow\'s test buyer (T-472)', () => {
  it('ends Released with the test buyer as the buyer, writes a deal record whose checks pass, sends nothing before the marker, and leaks no key', async () => {
    const at = fresh();
    marker = join(at.folder, 'first-deal.started');
    asked.length = 0;

    // seller and check: no request to an operator or the test buyer, and no connection but to the command's own sample API.
    const made = await node(at, ['seller', '--sample', '--payout', 'this-key', '--folder', at.folder, '--test-world', '--operators', recorded.urls.join(',')], AMBIENT);
    expect(made.code, made.out + made.err).toBe(0);
    const checked = await node(at, ['check', '--folder', at.folder, '--test-world', '--operators', recorded.urls.join(',')], AMBIENT);
    expect(checked.code, checked.out + checked.err).toBe(0);
    expect(asked).toEqual([]);
    expect(existsSync(marker)).toBe(false);
    const key = readFileSync(join(at.folder, 'keys', 'signing.key'), 'utf8').trim() as Hex;
    const address = jsonLines(made.out)[0].address as string;

    // first-deal, with ambient settings that would break it if anything read them.
    const deal = await node(at, ['first-deal', '--folder', at.folder, ...world2()], AMBIENT);
    const lines = jsonLines(deal.out);
    const said = deal.out + deal.err;
    expect(deal.code, said).toBe(0);
    const last = lines.at(-1);
    expect(last).toMatchObject({ step: 'first-deal', ok: true, state: 'Released', buyer: buyer.address, paidTo: address });
    for (const l of [...lines, ...jsonLines(deal.err)]) expect(l.notLive, JSON.stringify(l)).toBe(NOT_LIVE);

    // The preview comes first and states the link the payout address makes; then the marker, on standard error and as a file.
    const steps = lines.map((l) => l.step);
    expect(steps.slice(0, 3)).toEqual(['check', 'preview', 'discovery']);
    const preview = lines.find((l) => l.step === 'preview');
    expect(preview.payout).toBe(`The payout address is this folder's standing address ${address}. Every deal names it in its public terms, which links this folder's deals to one another, and its key is on this machine.`);
    expect(preview.sends.map((s: J) => s.to)).toEqual([recorded.urls, recorded.urls[0], recorded.urls, buyer.url, recorded.urls]);
    expect(jsonLines(deal.err).filter((l) => l.step === 'marker')).toEqual([{ step: 'marker', file: marker, detail: expect.stringMatching(/^The first deal starts/), notLive: NOT_LIVE }]);
    expect(existsSync(marker)).toBe(true);

    // The requests: none before the marker. After it, discovery first; one offer, one post to the buyer, one delivery.
    expect(asked.filter((a) => a.beforeMarker)).toEqual([]);
    expect(asked.filter((a) => a.beforeMarker && (a.method !== 'GET' || ADDRESS.test(a.path)))).toEqual([]);
    expect(asked[0]).toEqual({ to: 'operator', method: 'GET', path: '/.well-known/holdback.json', beforeMarker: false });
    const posts = asked.filter((a) => a.method === 'POST').map((a) => `${a.to} ${a.path}`);
    expect(posts.filter((p) => p === 'operator /v1/commitments').length).toBe(1);
    expect(posts.filter((p) => /^operator \/v1\/commitments\/0x[0-9a-f]{64}\/deliveries$/.test(p)).length).toBe(1);
    expect(posts.filter((p) => p.startsWith('buyer ')).length).toBe(1);
    expect(posts.filter((p) => p === 'operator /v1/faucet').length).toBe(1); // one grant: the deal's fresh key
    for (const run of [made, checked, deal]) expect(run.hosts.filter((h) => !['127.0.0.1', 'localhost', '::1'].includes(h))).toEqual([]);

    // The deal record: this deal, the test buyer, Released, every check passed, the operators agreeing.
    const file = last.record as string;
    expect(file).toBe(join(at.folder, 'deals', `${last.commitmentId}.json`));
    const dealRecord = JSON.parse(readFileSync(file, 'utf8'));
    expect(dealRecord.row).toMatchObject({ commitmentId: last.commitmentId, buyer: buyer.address, outcome: 'Released', sellerPayoutAddress: address, paidTo: address });
    expect(dealRecord.row.seller).not.toBe(address); // a fresh key signed the deal
    expect(dealRecord.checks.length).toBeGreaterThan(0);
    expect(dealRecord.checks.filter((c: J) => c.ok === false)).toEqual([]);
    expect(dealRecord.disagreements).toEqual([]);
    expect(lines.find((l) => l.step === 'record')).toMatchObject({ ok: true, file, operatorsAgree: true });

    // status: the first deal Released, no open deal, no key. Run again, first-deal sends nothing.
    const status = await node(at, ['status', '--folder', at.folder]);
    expect(jsonLines(status.out)[0]).toMatchObject({ firstDeal: { state: 'Released', commitmentId: last.commitmentId, record: file, buyer: buyer.url }, openDeals: [] });
    const before = asked.length;
    const again = await node(at, ['first-deal', '--folder', at.folder, ...world2()]);
    expect(again.code, again.out).toBe(0);
    expect(jsonLines(again.out)).toEqual([{ step: 'first-deal', ok: true, state: 'Released', commitmentId: last.commitmentId, record: file, detail: expect.stringMatching(/Nothing was sent now/), notLive: NOT_LIVE }]);
    expect(asked.length).toBe(before);

    // The leak test: no printed line and no file outside keys/ holds the standing key, the deal's key or the faucet
    // holding key, in hex or in base64. The seller's side has no encryption secret of its own (seller-adapter-core.ts
    // passes zeros); the delivery's content key lives in the adapter's memory only, and this test cannot name it.
    const nonce = dealRecord.terms.signed.nonce as Hex;
    expect(nonce).toMatch(/^0x[0-9a-f]{64}$/);
    const secrets = [key, holdingKeyOf(key), dealKeyOf(key, nonce)].flatMap(formsOf);
    const printed = [made, checked, deal, status, again].map((r) => r.out + r.err).join('\n');
    const files = [...filesOutsideKeys(at.folder), ...filesOutsideKeys(`${at.folder}-card`), ...filesOutsideKeys(at.dir).filter((f) => !f.startsWith(at.folder))];
    expect(files.length).toBeGreaterThan(8);
    for (const secret of secrets) {
      expect(printed.includes(secret), 'a printed line holds a key').toBe(false);
      for (const f of files) expect(readFileSync(f, 'latin1').includes(secret), `${f} holds a key`).toBe(false);
    }
    expect(printed).not.toContain('ambient');
  }, 180_000);

  it('resumes: killed after the offer reached the test buyer, the same command finishes with no second offer and one delivery', async () => {
    const at = fresh();
    marker = join(at.folder, 'first-deal.started');
    expect((await node(at, ['seller', '--sample', '--payout', 'this-key', '--folder', at.folder])).code).toBe(0);
    asked.length = 0;
    const key = readFileSync(join(at.folder, 'keys', 'signing.key'), 'utf8');
    const first = start(at, ['first-deal', '--folder', at.folder, ...world2()], {}, (line) => {
      if (line.includes('"step":"post"')) first.child.kill('SIGKILL');
    });
    const killed = await first.done;
    expect(killed.code, killed.out).toBe(null);
    const offered = jsonLines(killed.out).find((l) => l.step === 'offer').commitmentId as string;
    const resumed = await node(at, ['first-deal', '--folder', at.folder, ...world2()]);
    const lines = jsonLines(resumed.out);
    expect(resumed.code, resumed.out + resumed.err).toBe(0);
    expect(lines.find((l) => l.step === 'offer')).toMatchObject({ commitmentId: offered, resumed: true });
    expect(lines.at(-1)).toMatchObject({ step: 'first-deal', ok: true, state: 'Released', commitmentId: offered });
    const posts = asked.filter((a) => a.method === 'POST').map((a) => `${a.to} ${a.path}`);
    expect(posts.filter((p) => p === 'operator /v1/commitments').length).toBe(1);
    expect(posts.filter((p) => p === 'operator /v1/faucet').length).toBe(1);
    expect(posts.filter((p) => p === `operator /v1/commitments/${offered}/deliveries`).length).toBe(1);
    expect(readFileSync(join(at.folder, 'keys', 'signing.key'), 'utf8')).toBe(key); // no second key
  }, 180_000);

  it('a first deal that ended without a release is not offered again until --again says so', async () => {
    const at = fresh();
    marker = join(at.folder, 'first-deal.started');
    expect((await node(at, ['seller', '--sample', '--payout', 'this-key', '--folder', at.folder])).code).toBe(0);
    // As a run that ended Refunded left the state.
    const stateFile = join(at.folder, 'crow.json');
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    writeFileSync(stateFile, JSON.stringify({ ...state, firstDeal: { startedAt: '2026-11-15T00:00:00.000Z', buyer: buyer.url, commitmentId: `0x${'ab'.repeat(32)}`, state: 'Refunded' } }));
    asked.length = 0;
    const held = await node(at, ['first-deal', '--folder', at.folder, ...world2()]);
    expect(held.code, held.out).toBe(1);
    expect(jsonLines(held.out)).toEqual([{ step: 'first-deal', ok: false, state: 'Refunded', commitmentId: `0x${'ab'.repeat(32)}`, detail: expect.stringMatching(/Run first-deal --again to offer a new one\. Nothing was sent now\./), notLive: NOT_LIVE }]);
    expect(asked).toEqual([]);
    const again = await node(at, ['first-deal', '--again', '--folder', at.folder, ...world2()]);
    expect(again.code, again.out + again.err).toBe(0);
    expect(jsonLines(again.out).at(-1)).toMatchObject({ step: 'first-deal', ok: true, state: 'Released' });
    expect(jsonLines(again.out).at(-1).commitmentId).not.toBe(`0x${'ab'.repeat(32)}`);
  }, 120_000);

  it('without --test-world it signs only under Crow\'s deployment on Sepolia: operators that serve another chain are refused, and nothing is offered', async () => {
    const at = fresh();
    marker = join(at.folder, 'first-deal.started');
    expect((await node(at, ['seller', '--sample', '--payout', 'this-key', '--folder', at.folder])).code).toBe(0);
    asked.length = 0;
    // A deployment pin in the environment for this very world would let a tool that read it accept the world.
    const refused = await node(at, ['first-deal', '--folder', at.folder, '--operators', recorded.urls.join(','), '--buyer', buyer.url], { ...AMBIENT, HOLDBACK_CHAIN_ID: String(pin.domain.chainId), HOLDBACK_VERIFYING_CONTRACT: pin.domain.verifyingContract });
    expect(refused.code, refused.out + refused.err).toBe(1);
    const lines = jsonLines(refused.out);
    expect(lines.at(-1)).toMatchObject({ step: 'first-deal', ok: false, detail: expect.stringMatching(/not Crow's deployment on Sepolia \(chain 11155111\)\. Nothing was signed or offered/) });
    for (const l of lines) expect(l.notLive).toBeUndefined();
    // Only the reads of discovery, after the marker; no post, nothing to the test buyer, no connection off this machine.
    expect(asked.every((a) => a.to === 'operator' && a.method === 'GET' && a.path === '/.well-known/holdback.json' && !a.beforeMarker)).toBe(true);
    expect(asked.length).toBeGreaterThan(0);
    expect(refused.hosts.filter((h) => !['127.0.0.1', 'localhost', '::1'].includes(h))).toEqual([]);
  }, 60_000);
});
