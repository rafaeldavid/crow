// T-606: site/serve.mjs, the seller adapter in one pinned file, as a seller runs it. Every run here is the committed
// file, copied alone into a fresh folder and run in its own Node process, with only PATH, HOME and the variables the
// test names in its environment. A recorder loaded before the bundle refuses a connection that leaves this machine.
//
// The deal runs a configuration of the kind a program generates for one request, with a small program of its own
// beside the adapter that does the work. It uses the base-URL form of `sellerApi` with a token in a header of its own,
// a bearer `quoteAuth`, both tokens in CROW_* variables (which setup.mjs would remove), a template and a scope of its
// own, and no club or adjudicators, so discovery names them. Every name and value here is made up for the test.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { builtinModules } from 'node:module';
import { createServer as createTcpServer, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startLocalWorld, type LocalWorld } from './audit-deal.ts';
import { makeKeys } from './buyer-signer.ts';
import { fill } from './seller-adapter-core.ts';
import { knownPins } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const committed = here('../site/serve.mjs');

/** Loaded before the bundle: each connection (one leaving this machine is refused), and at exit the environment's names. */
const RECORDER = `import net from 'node:net';
import { appendFileSync } from 'node:fs';
const note = (o) => appendFileSync(process.env.SERVE_TEST_RECORD, JSON.stringify(o) + '\\n');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const o = typeof first === 'object' && first !== null ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  const host = String(o.host ?? 'localhost');
  note({ host });
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('the test lets no connection leave this machine: ' + host);
  return connect.apply(this, args);
};
process.on('exit', () => note({ env: Object.keys(process.env).sort() }));
// With SERVE_TEST_PAUSE_MS set, the process stops that long right after it writes its ready line, as a busy machine's
// scheduler may: a signal sent on that line then always arrives before the next line of the command runs.
if (process.env.SERVE_TEST_PAUSE_MS) {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    const sent = write(chunk, ...rest);
    if (String(chunk).includes('serves POST')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.SERVE_TEST_PAUSE_MS));
    return sent;
  };
}
`;

const children: ChildProcessWithoutNullStreams[] = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill('SIGKILL');
});

const fresh = (prefix: string) => realpathSync(mkdtempSync(join(tmpdir(), prefix)));

/** serve.mjs alone in a fresh `crow-serve` folder, as the guide's install line leaves it, run with `args` and `env`; `beside` adds files to that folder. */
function serve(args: string[], env: Record<string, string> = {}, beside: Record<string, string> = {}) {
  const home = fresh('crow-serve-home-');
  const dir = join(home, 'crow-serve');
  mkdirSync(dir);
  copyFileSync(committed, join(dir, 'serve.mjs'));
  for (const [name, text] of Object.entries(beside)) writeFileSync(join(dir, name), text);
  writeFileSync(join(home, 'recorder.mjs'), RECORDER);
  const record = join(home, 'record.jsonl');
  writeFileSync(record, '');
  const child = spawn(process.execPath, ['--import', join(home, 'recorder.mjs'), join(dir, 'serve.mjs'), ...args], { cwd: dir, env: { PATH: process.env['PATH'] ?? '', HOME: home, SERVE_TEST_RECORD: record, ...env } });
  children.push(child);
  let out = '', err = '';
  child.stdout.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr.on('data', (d: Buffer) => (err += d.toString()));
  child.stdin.end();
  // The exit status, or the name of the signal that killed the process, so a failure says which.
  const exited = new Promise<number | NodeJS.Signals>((resolve) => child.on('close', (code, signal) => resolve(code ?? signal!)));
  const recorded = (): J[] => readFileSync(record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { dir, child, exited, out: () => out, err: () => err, hosts: () => recorded().filter((r) => r.host !== undefined).map((r) => r.host as string), envAtExit: () => recorded().find((r) => r.env !== undefined)?.env as string[] | undefined };
}

async function until(what: string, ok: () => boolean, said: () => string, timeoutMs = 30_000): Promise<void> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) if (ok()) return;
  throw new Error(`timed out waiting for ${what}:\n${said()}`);
}

// ---- The seller's own program: its generated seller.json and template.json, and its three calls ----
const JOB_ENV = 'CROW_JOB_TOKEN';
const JOB_HEADER = 'X-Job-Token';
const ASK_ENV = 'CROW_ASK_TOKEN';
const SCOPE_RULES = {
  request: { type: 'string', pattern: '^\\{[\\s\\S]{10,2000}\\}\\s*$' },
  requestId: { type: 'string', pattern: '^[0-9a-f]{24}$' },
  requestDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
};
const ofAnswer = (id: string, name: string, value: string) => ({ id, type: 'json_schema', required: true, schema: { type: 'object', required: ['answers'], properties: { answers: { type: 'object', required: [name], properties: { [name]: { const: value } } } } } });
const TEMPLATE = {
  deliverable: { kind: 'dataset', description: 'The result of request {{requestId}}, SHA-256 {{requestDigest}}.', format: 'application/json' },
  checks: [
    { id: 'echoes-request', type: 'json_schema', required: true, schema: { type: 'object', required: ['request'], properties: { request: { const: '{{request}}' } } } },
    ofAnswer('answers-id', 'id', '{{requestId}}'),
    ofAnswer('answers-digest', 'digest', '{{requestDigest}}'),
    { id: 'plain-text', type: 'hidden_characters_max', required: true, max: { total: 0 } },
  ],
};
/** What the program writes as seller.json, with the port it listens on. */
const sellerJson = (apiPort: number) => {
  const base = `http://127.0.0.1:${apiPort}/`;
  return {
    port: 0,
    template: 'template.json',
    scope: SCOPE_RULES,
    sellerApi: { baseUrl: base, auth: { env: JOB_ENV, header: JOB_HEADER }, quote: `${base}quote`, start: `${base}jobs`, result: `${base}jobs/{jobId}/result` },
    quoteAuth: { kind: 'bearer', env: ASK_ENV },
    signingKey: 'standing',
    timing: { offerExpiresInSec: 900, fundWithinSec: 1800, deliverWithinSec: 7200, judgeWithinSec: 300, fallbackWithinSec: 300, appealWindowSec: 0, appealDecideSec: 300 },
    journal: 'seller-adapter.journal.json',
    pollMs: 100,
    redelivery: { refetchEverySec: 60 },
  };
};
/** The folder the program writes: seller.json and template.json beside each other. */
function work(config: J): string {
  const dir = fresh('crow-serve-work-');
  writeFileSync(join(dir, 'template.json'), JSON.stringify(TEMPLATE, null, 2));
  writeFileSync(join(dir, 'seller.json'), JSON.stringify(config, null, 2));
  return join(dir, 'seller.json');
}

interface SellerProgram {
  port: number;
  /** Each call the stub took, and each it refused with why. */
  calls: string[];
  refused: string[];
  starts: J[];
  close(): Promise<void>;
}
/** The program's three calls. It takes only its own host, no web page's call, its token, and JSON on a POST. */
async function sellerProgram(token: string, result: () => string): Promise<SellerProgram> {
  const calls: string[] = [], refused: string[] = [], starts: J[] = [];
  let polls = 0;
  const body = async (req: IncomingMessage): Promise<J> => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
  const server: Server = createServer((req, res) => {
    const send = (status: number, value: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(typeof value === 'string' ? value : JSON.stringify(value));
    const port = (server.address() as AddressInfo).port;
    const wrong =
      req.headers.host !== `127.0.0.1:${port}` ? 'host' : req.headers.origin !== undefined ? 'origin' : req.headers[JOB_HEADER.toLowerCase()] !== token ? 'token' : req.method === 'POST' && req.headers['content-type']?.split(';')[0] !== 'application/json' ? 'content-type' : null;
    if (wrong) {
      refused.push(`${req.method} ${req.url}: ${wrong}`);
      return void send(401, { error: wrong });
    }
    calls.push(`${req.method} ${req.url}`);
    void (async () => {
      if (req.method === 'POST' && req.url === '/quote') return send(200, { quoteId: 'q-1', price: { token: 'tUSD', amount: '20000000' }, deliverWithinSec: 7200 });
      if (req.method === 'POST' && req.url === '/jobs') {
        const b = await body(req);
        starts.push(b);
        return send(200, { jobId: b.commitmentId });
      }
      if (req.method === 'GET' && /^\/jobs\/0x[0-9a-f]{64}\/result$/.test(req.url ?? '')) return ++polls < 2 ? send(202, { status: 'running' }) : send(200, result());
      return send(404, { error: 'no such call' });
    })().catch((e: Error) => send(500, { error: e.message }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, calls, refused, starts, close: () => new Promise((resolve) => (server.closeAllConnections(), server.close(() => resolve()))) };
}

describe('site/serve.mjs, the bundle (T-606)', () => {
  it('is the current bundle of site/serve-entry.mjs: one file that imports only Node built-ins and removes one variable', async () => {
    const { serveBundle, pins } = await import(here('../site/build.mjs'));
    const code = readFileSync(committed, 'utf8');
    expect(code === (await serveBundle()), 'site/serve.mjs is stale: run node site/build.mjs').toBe(true);
    const imports = [...code.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]!);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((s) => !s.startsWith('node:'))).toEqual([]);
    expect(code).not.toMatch(/\bimport\(/);
    expect([...code.matchAll(/__require\("([^"]+)"\)/g)].map((m) => m[1]!).filter((name) => !builtinModules.includes(name))).toEqual([]);
    for (const mark of ['async function startSellerAdapter(', 'async function createSellerAdapter(', 'function preflightDelivery(', 'function loadConfig(', `viem@${pins().viem} (`, `tweetnacl@${pins().tweetnacl} (`]) expect(code, mark).toContain(mark);
    // A configuration may name CROW_* variables for its tokens, which setup.mjs removes. This file removes one variable only.
    expect(code.match(/delete (process\.)?env\b[^;\n]*/g)).toEqual(['delete process.env.NODE_TLS_REJECT_UNAUTHORIZED']);
    for (const line of ['delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;', "Object.defineProperty(globalThis, 'crowEntry', { value: 'serve',"]) { // the second: no bundled tool that asks runs as the program
      expect(code.indexOf(line), line).toBeGreaterThan(0);
      expect(code.indexOf(line), line).toBeLessThan(code.indexOf('\nimport '));
    }
  }, 60_000);

  it('ref/serve.txt carries the two install lines, each naming serve.mjs only when its SHA-256 is the current one', async () => {
    const { serveInstall, serveInstallWindows, serveSha256, publishedGuides } = await import(here('../site/build.mjs'));
    const sha = createHash('sha256').update(readFileSync(committed)).digest('hex');
    expect(serveSha256()).toBe(sha);
    expect(serveInstall()).toBe(`mkdir -p crow-serve && cd crow-serve && curl -fsSL https://crow.direct/serve.mjs -o serve.mjs.part && echo "${sha}  serve.mjs.part" | shasum -a 256 -c && mv serve.mjs.part serve.mjs`);
    expect(serveInstallWindows()).toBe(`mkdir crow-serve -Force | Out-Null; cd crow-serve -ErrorAction Stop; curl.exe -fsSL https://crow.direct/serve.mjs -o serve.mjs.part; if ((Get-FileHash serve.mjs.part).Hash -eq '${sha}') { Move-Item -Force -ErrorAction Stop serve.mjs.part serve.mjs; 'serve.mjs: OK' } else { Write-Error 'serve.mjs: the download failed or its hash differs, so no file was installed' }`);
    const source = readFileSync(here('../site/ref/serve.txt'), 'utf8');
    for (const placeholder of ['{{SERVE_INSTALL}}', '{{SERVE_INSTALL_WINDOWS}}']) expect(source.split(placeholder).length - 1, placeholder).toBe(1);
    const published = publishedGuides({ op1: 'https://a.example', op2: 'https://b.example' });
    for (const line of [serveInstall(), serveInstallWindows()]) expect((published.get('ref/serve.txt') as string).split('\n')).toContain(line);
    expect(published.get('reference.txt')).toContain('=== ref/serve.txt ===');
  });

  it('answers --help with 0 and a wrong call with 2, with the usage', async () => {
    for (const [args, code] of [[['--help'], 0], [['-h'], 0], [[], 2], [['a.json', 'b.json'], 2], [['--sim'], 2], [['a.json', '--sim'], 2], [['a.json', '--help'], 2]] as const) {
      const run = serve([...args]);
      expect(await run.exited, args.join(' ')).toBe(code);
      expect(code === 0 ? run.out() : run.err(), args.join(' ')).toContain('usage: node serve.mjs <seller.json>');
      expect(run.hosts()).toEqual([]);
    }
  }, 60_000);
});

describe('site/serve.mjs refuses a start (T-606)', () => {
  const jobToken = randomBytes(32).toString('base64url'), askToken = randomBytes(32).toString('base64url');
  /** A start that would pass every check but the one a case breaks. The operators' address answers nothing. */
  const env = (over: Record<string, string> = {}) => ({ HOLDBACK_KEY: generatePrivateKey(), HOLDBACK_OPERATORS: 'http://127.0.0.1:9,http://localhost:9', [JOB_ENV]: jobToken, [ASK_ENV]: askToken, ...over });
  const refusal = async (config: J, variables: Record<string, string>) => {
    const run = serve([work(config)], variables);
    expect(await run.exited, run.out() + run.err()).toBe(2);
    const lines = run.err().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    for (const secret of [variables['HOLDBACK_KEY'], jobToken, askToken]) if (secret) expect(run.out() + run.err()).not.toContain(secret.replace(/^0x/, ''));
    return { line: lines[0]!, hosts: run.hosts() };
  };
  const deployment = (chainId: unknown) => JSON.stringify({ chainId, rules: `0x${'1'.repeat(40)}`, escrow: `0x${'2'.repeat(40)}`, erc3009Collector: `0x${'3'.repeat(40)}`, token: { address: `0x${'4'.repeat(40)}`, symbol: 'T', decimals: 6, name: 'T', version: '1' } });

  it('under any pinned chain but Sepolia or a local one, before any request', async () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{ HOLDBACK_DEPLOYMENT: deployment(1) }, 'chain 1 is not Sepolia'],
      [{ HOLDBACK_DEPLOYMENT: deployment(8453) }, 'chain 8453 is not Sepolia'],
      [{ HOLDBACK_DEPLOYMENT: deployment('31337') }, 'chain 31337 is not Sepolia'], // a text is no chain ID
      [{ HOLDBACK_CHAIN_ID: '1' }, 'chain 1 is not Sepolia'],
      [{ HOLDBACK_DEPLOYMENT: 'not json' }, 'JSON'],
    ];
    for (const [over, says] of cases) {
      const { line, hosts } = await refusal(sellerJson(1), env(over));
      expect(line).toMatch(/^serve: /);
      expect(line).toContain(says);
      expect(hosts).toEqual([]);
    }
  }, 60_000);

  it('and exits at once, even while one operator holds a connection open and says nothing', async () => {
    const silent = createTcpServer(() => {}); // takes each connection and never answers
    const held: Socket[] = [];
    silent.on('connection', (socket) => held.push(socket));
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    try {
      const started = Date.now();
      const run = serve([work(sellerJson(1))], env({ HOLDBACK_OPERATORS: `http://127.0.0.1:9,http://localhost:${(silent.address() as AddressInfo).port}` }));
      const code = await Promise.race([run.exited, new Promise<'alive'>((resolve) => setTimeout(() => resolve('alive'), 15_000))]);
      expect(code, `after ${Date.now() - started} ms:\n${run.err()}`).toBe(2);
      expect(run.err()).toMatch(/^serve: /);
    } finally {
      for (const socket of held) socket.destroy();
      silent.close();
    }
  }, 60_000);

  it('stopped by a signal while a start still waits, exits 0 and says it served nothing', async () => {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      const silent = createTcpServer(() => {});
      const held: Socket[] = [];
      const asked = new Promise<void>((resolve) => silent.on('connection', (socket) => (held.push(socket), resolve())));
      await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
      try {
        const port = (silent.address() as AddressInfo).port;
        const run = serve([work(sellerJson(1))], env({ HOLDBACK_OPERATORS: `http://127.0.0.1:${port},http://localhost:${port}` }));
        await asked; // the start is under way: it has asked an operator, which never answers
        run.child.kill(signal);
        expect(await run.exited, run.out() + run.err()).toBe(0);
        expect(run.out()).toContain(`${signal}: the adapter stops before it serves; the journal keeps every open deal.`);
        expect(run.out()).not.toContain('serves POST');
      } finally {
        for (const socket of held) socket.destroy();
        silent.close();
      }
    }
  }, 60_000);

  it('without a template of its own, since the file carries none', async () => {
    const config: J = sellerJson(1);
    delete config.template;
    delete config.scope;
    const { line, hosts } = await refusal(config, env());
    expect(line).toContain('template is required');
    expect(hosts).toEqual([]);
  }, 60_000);

  it("with the adapter's own checks: a token unset, two credentials alike, a credential named HOLDBACK_KEY, a removed setting", async () => {
    const without = (name: string) => Object.fromEntries(Object.entries(env()).filter(([k]) => k !== name));
    expect((await refusal(sellerJson(1), without(JOB_ENV))).line).toContain(`set ${JOB_ENV}`);
    expect((await refusal(sellerJson(1), without(ASK_ENV))).line).toContain(`set ${ASK_ENV}`);
    expect((await refusal(sellerJson(1), env({ [ASK_ENV]: jobToken }))).line).toContain('hold the same value');
    expect((await refusal({ ...sellerJson(1), quoteAuth: { kind: 'bearer', env: 'HOLDBACK_KEY' } }, env())).line).toContain('names HOLDBACK_KEY');
    expect((await refusal({ ...sellerJson(1), host: '0.0.0.0' }, env())).line).toContain('host was removed');
    expect((await refusal(sellerJson(1), without('HOLDBACK_KEY'))).line).toContain('set HOLDBACK_KEY');
  }, 60_000);
});

describe('site/serve.mjs sells one request on a local world (T-606)', () => {
  let world: LocalWorld;
  beforeAll(async () => {
    world = await startLocalWorld();
  });
  afterAll(() => world.close());

  it('runs a generated seller.json: quote, hold, start, checked delivery, Released', async () => {
    const jobToken = randomBytes(32).toString('base64url'), askToken = randomBytes(32).toString('base64url');
    const sellerKey = generatePrivateKey();
    const request = `{\n  "id": "${randomBytes(12).toString('hex')}",\n  "sizes": [1, 2, 3]\n}\n`;
    const scope = { request, requestId: JSON.parse(request).id as string, requestDigest: createHash('sha256').update(request).digest('hex') };
    const result = JSON.stringify({ request, answers: { id: scope.requestId, digest: scope.requestDigest } });
    const program = await sellerProgram(jobToken, () => result);
    try {
      const config = work(sellerJson(program.port));
      const run = serve([config], { HOLDBACK_KEY: sellerKey, HOLDBACK_OPERATORS: world.operators.join(','), [JOB_ENV]: jobToken, [ASK_ENV]: askToken, NODE_TLS_REJECT_UNAUTHORIZED: '0' });
      const said = () => `${run.out()}${run.err()}`;
      await until('the adapter to serve', () => /serves POST http:\/\/127\.0\.0\.1:\d+\/quote/.test(run.out()), said);
      const url = /serves POST (http:\/\/127\.0\.0\.1:\d+)\/quote/.exec(run.out())![1]!;

      // D101: the buyer quotes by hand here, not with quote, so it names the seller it expects.
      const buyer = await makeKeys(join(fresh('crow-serve-buyer-'), 'keys'), { operators: world.operators, seller: privateKeyToAccount(sellerKey).address, log: () => {}, clock: world.now });
      const ask = (authorization?: string) =>
        fetch(`${url}/quote`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'request-1', ...(authorization ? { authorization } : {}) }, body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope }) });
      expect((await ask()).status).toBe(401); // quoteAuth: no token, no offer
      const answer = await ask(`Bearer ${askToken}`);
      const quoted = (await answer.json()) as J;
      expect(answer.status, JSON.stringify(quoted) + said()).toBe(200);
      const id = quoted.commitmentId as string;

      // The buyer's own expectation: the template filled with its scope, and the offer it read.
      const offer = await buyer.readOffer(id);
      expect(offer.seller).toBe(privateKeyToAccount(sellerKey).address.toLowerCase());
      const expected = fill({ deliverable: TEMPLATE.deliverable, checks: TEMPLATE.checks }, scope);
      const found = (await (await fetch(`${world.operators[0]}/.well-known/holdback.json`)).json()) as J;
      const role = (r: string) => String(found.demo.adjudicators.find((a: J) => a.role === r).address).toLowerCase();
      const approved: J = {
        commitmentId: id, seller: offer.seller, price: { token: knownPins()[0]!.token.id, amount: offer.price.amount }, fees: offer.fees,
        deliverable: expected.deliverable, checks: expected.checks, deadlines: offer.deadlines, adjudicators: { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') }, differences: offer.differences ?? null,
        settlement: offer.settlement, disclosure: offer.disclosure, clubId: offer.clubId, rulebookHash: offer.rulebookHash, policyId: offer.policyId, policyHash: offer.policyHash,
        registryHash: offer.registryHash, maxSubmissions: offer.maxSubmissions, sellerPayoutAddress: offer.sellerPayoutAddress,
      };
      await buyer.testFunds(offer.fees.total.amount);
      await buyer.checkOffer(id, approved, { timeoutMs: 60_000 });
      expect(program.starts, 'no hold yet, so no work').toEqual([]);
      await buyer.agreeAndFund(id);
      const delivery = await buyer.openDelivery(id, { timeoutMs: 60_000, pollMs: 100 });
      expect(delivery.outcome, said()).toBe('Released');
      expect(Buffer.from(delivery.work!).toString('utf8')).toBe(result);

      // The program took every call, with its token, and one start for this deal with the buyer's request.
      expect(program.refused).toEqual([]);
      expect(program.starts).toEqual([{ commitmentId: id, quoteId: 'q-1', scope }]);
      expect(program.calls).toContain(`GET /jobs/${id}/result`);
      // The journal is in the folder the command runs in, not beside the configuration.
      expect(existsSync(join(run.dir, 'seller-adapter.journal.json'))).toBe(true);
      expect(existsSync(join(config, '..', 'seller-adapter.journal.json'))).toBe(false);

      run.child.kill('SIGTERM');
      expect(await run.exited).toBe(0);
      expect(run.out()).toContain('SIGTERM: the adapter stops after the step in progress');
      // Both tokens stayed in its environment; the one variable it removes is gone. No line shows the key or a token.
      expect(run.envAtExit()).toEqual(expect.arrayContaining([JOB_ENV, ASK_ENV, 'HOLDBACK_KEY']));
      expect(run.envAtExit()).not.toContain('NODE_TLS_REJECT_UNAUTHORIZED');
      for (const secret of [sellerKey.slice(2), jobToken, askToken]) expect(said()).not.toContain(secret);
      expect(run.hosts()).toContain('127.0.0.1'); // the recorder records, so an empty list elsewhere means no connection
      expect(run.hosts().filter((h) => !['127.0.0.1', 'localhost', '::1'].includes(h))).toEqual([]);
    } finally {
      await program.close();
    }
  }, 180_000);

  it("treats a template named as the repository's shipped one as the seller's own, with no salt added", async () => {
    const env = { HOLDBACK_KEY: generatePrivateKey(), HOLDBACK_OPERATORS: world.operators.join(','), [JOB_ENV]: randomBytes(32).toString('base64url'), [ASK_ENV]: randomBytes(32).toString('base64url') };
    // A text deliverable: the adapter refuses a salt on it at start, so a start that serves has the salt off.
    const name = 'seller-adapter.template.json';
    const template = JSON.stringify({ ...TEMPLATE, deliverable: { ...TEMPLATE.deliverable, format: 'text/markdown' }, checks: [TEMPLATE.checks.at(-1)] });
    const run = serve(['seller.json'], env, { 'seller.json': JSON.stringify({ ...sellerJson(1), template: name }), [name]: template });
    const said = () => `${run.out()}${run.err()}`;
    await until('the adapter to serve or stop', () => /serves POST|serve: /.test(said()), said);
    expect(said()).toContain('serves POST');
    run.child.kill('SIGTERM');
    expect(await run.exited).toBe(0);
  }, 60_000);

  it('stops gracefully on a signal sent as soon as it says it serves', async () => {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      const env = { HOLDBACK_KEY: generatePrivateKey(), HOLDBACK_OPERATORS: world.operators.join(','), [JOB_ENV]: randomBytes(32).toString('base64url'), [ASK_ENV]: randomBytes(32).toString('base64url'), SERVE_TEST_PAUSE_MS: '500' };
      const run = serve([work(sellerJson(1))], env);
      let sent = false;
      run.child.stdout.on('data', () => {
        if (sent || !run.out().includes('serves POST')) return;
        sent = true;
        run.child.kill(signal);
      });
      expect(await run.exited, run.out() + run.err()).toBe(0);
      expect(sent).toBe(true);
      expect(run.out()).toContain(`${signal}: the adapter stops after the step in progress`);
    }
  }, 60_000);
});
