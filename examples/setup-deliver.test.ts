// T-568: `deliver`, one pass over a seller folder's funded deals. As in apps/test-agents/src/setup-template.test.ts, the
// committed site/setup.mjs runs alone in a fresh folder, in its own Node process, against the public demo's own world
// on two origins and Crow's test buyer's real code, all in this process: CI needs no network.
//
// Two funded deals: one the folder's first deal (its journal holds it), one the folder's key offered elsewhere, which
// only the operators' list shows. One pass delivers the deal with work and names the other's deadline; a second pass
// delivers nothing again; a file that fails a check is held with the check named; the corrected file is delivered.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, startSellerAdapter } from './seller-adapter.ts';
import { withDeadline } from './setup-deliver.ts';
import { startWorkApi, workAddresses, WORK_CREDENTIAL_ENV } from './setup-work-api.ts';
import { serveTwoOrigins, type TwoOrigins } from './two-origins.ts';
import { knownPins } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const committed = fileURLToPath(new URL('../site/setup.mjs', import.meta.url));
// Crow's test buyer's real code, from apps/test-agents: imported by its path, as setup-bundle.test.ts imports its rules.
const testBuyerFile = fileURLToPath(new URL('../apps/test-agents/src/buyer.ts', import.meta.url));
const pin = knownPins()[0]!; // SimChain

/** Each POST the command made to an operator, by path. */
const posts: string[] = [];
/** A test's change to what the command's operators answer: undefined answers as the world does. */
let fault: ((request: Request, next: () => Response | Promise<Response>) => Response | Promise<Response> | undefined) | undefined;
/** Operator 1 of the command's two: the same world under the host 127.0.0.1 (two-origins.ts). */
const isFirst = (request: Request) => new URL(request.url).hostname === '127.0.0.1';
let demo: PublicWorld;
let recorded: TwoOrigins; // the operators the command is given
let direct: TwoOrigins; // the same world, for the test buyer's and the other machine's requests
let buyer: { url: string; address: string; encryptionPublicKey: string; intake: string; close(): Promise<void> };

/** The test buyer's fetch(request, client) over HTTP at /agents/test-buyer, worked as its Durable Object's alarm works it. */
async function serveBuyer(): Promise<typeof buyer> {
  const { TestBuyer } = (await import(testBuyerFile)) as { TestBuyer: new (o: J) => { fetch(r: Request, client: string): Promise<Response>; work(): Promise<unknown> } };
  const held: { agent?: InstanceType<typeof TestBuyer> } = {};
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks);
    const url = `http://${req.headers.host}${req.url}`;
    const r = await held.agent!.fetch(new Request(url, { method: req.method ?? 'GET', headers: req.headers as Record<string, string>, ...(body ? { body } : {}) }), req.socket.remoteAddress ?? 'unknown');
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/agents/test-buyer`;
  // The live buyer's limits, raised: these tests post more deals in a minute than it takes from one client.
  const { BUYER_LIMITS } = (await import(testBuyerFile.replace(/buyer\.ts$/, 'buyer-rules.ts'))) as { BUYER_LIMITS: Record<string, number> };
  const limits = Object.fromEntries(Object.keys(BUYER_LIMITS).map((k) => [k, 1000]));
  const agent = (held.agent = new TestBuyer({ storage: new MemoryStorage(), operators: [...direct.urls], seed: generatePrivateKey(), pin, base: url, log: () => {}, limits }));
  let running = true;
  const loop = (async () => {
    while (running) {
      await agent.work().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  const card = (await (await fetch(`${url}/agent.json`)).json()) as J;
  return {
    url,
    address: String(card.buyer).toLowerCase(),
    encryptionPublicKey: card.buyerEncryptionPublicKey,
    intake: card.intake.api,
    close: async () => {
      running = false;
      await loop;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}

beforeAll(async () => {
  demo = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000' }, faucetPerClient: 1000 });
  recorded = await serveTwoOrigins({
    fetch: (request, ctx) => {
      if (request.method === 'POST') posts.push(new URL(request.url).pathname);
      const next = () => demo.fetch(request, ctx);
      return Promise.resolve(fault?.(request, next) ?? next());
    },
    work: () => demo.work(),
  }, { tickMs: 50 });
  direct = await serveTwoOrigins(demo);
  buyer = await serveBuyer();
});
afterAll(async () => {
  await buyer.close();
  await direct.close();
  await recorded.close();
});

type Run = { code: number | null; out: string; err: string };
/** A fresh empty folder with setup.mjs alone in it, on a path with no symbolic link, and the party's folder inside it. */
function fresh(): { dir: string; file: string; folder: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'crow-setup-deliver-')));
  copyFileSync(committed, join(dir, 'setup.mjs'));
  return { dir, file: join(dir, 'setup.mjs'), folder: join(dir, 'party') };
}
/** Runs `node setup.mjs <args>` with only PATH and HOME in its environment. */
function node(at: { dir: string; file: string }, args: string[]): Promise<Run> {
  const child = spawn(process.execPath, [at.file, ...args], { cwd: at.dir, env: { PATH: process.env['PATH'] ?? '', HOME: at.dir } });
  let out = '', err = '';
  child.stdout.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr.on('data', (d: Buffer) => (err += d.toString()));
  child.stdin.end();
  return new Promise((resolve) => child.on('exit', (code) => resolve({ code, out, err })));
}
const jsonLines = (text: string): J[] => text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const operators = () => ['--test-world', '--operators', recorded.urls.join(',')];
const testWorld = () => [...operators(), '--buyer', buyer.url];
const journalOf = (folder: string): J => (existsSync(join(folder, 'journal.json')) ? JSON.parse(readFileSync(join(folder, 'journal.json'), 'utf8')) : { deals: {} });
const deliveries = (id: string) => posts.filter((p) => p === `/v1/commitments/${id}/deliveries`).length;
const lineOf = (lines: J[], id: string) => lines.filter((l) => l.commitmentId === id);

/** What the party sells: a CSV of two named columns, 2 to 500 rows, for 5.00 of the test token. */
const TEMPLATE = {
  deliverable: { kind: 'dataset', description: 'A list of agent payment protocols, one row each: its name and its home page.', format: 'text/csv' },
  price: '5000000',
  checks: [
    { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['name', 'url'] },
    { id: 'rows', type: 'row_count_range', required: true, min: 2, max: 500 },
  ],
};
const GOOD = 'name,url\nx402,https://x402.org\nAP2,https://ap2-protocol.org\n';
const NO_URL = 'name\nx402\nAP2\n'; // fails cols

async function stateOn(id: string): Promise<string> {
  return String(((await (await fetch(`${direct.urls[0]}/v1/commitments/${id}`)).json()) as J).escrowState);
}
async function until(id: string, want: string[], ms = 60_000): Promise<string> {
  for (const end = Date.now() + ms; ; await new Promise((r) => setTimeout(r, 100))) {
    const s = await stateOn(id);
    if (want.includes(s)) return s;
    if (Date.now() > end) throw new Error(`${id} is ${s}, not ${want.join(' or ')}, after ${ms} ms`);
  }
}

/** A folder made by `seller --template`, with its standing key read back for the test's "other machine". */
async function sellerFolder(): Promise<{ at: ReturnType<typeof fresh>; key: `0x${string}` }> {
  const at = fresh();
  writeFileSync(join(at.dir, 'template.json'), JSON.stringify(TEMPLATE));
  const made = await node(at, ['seller', '--template', join(at.dir, 'template.json'), '--payout', 'this-key', '--folder', at.folder, ...operators()]);
  expect(made.code, made.out + made.err).toBe(0);
  return { at, key: readFileSync(join(at.folder, 'keys', 'signing.key'), 'utf8').trim() as `0x${string}` };
}

/**
 * One deal the folder's own key offers from another machine: the folder's adapter.json and template.json copied to a
 * folder of its own, run with the standing key and a journal of its own, and stopped once the offer is made. The
 * command's folder never sees it: only the operators' list does. `o.change` edits the copied configuration first;
 * `o.template` and `o.price` replace the folder's.
 */
async function offerElsewhere(folder: string, key: `0x${string}`, o: { change?: (config: J) => void; template?: J; price?: string } = {}): Promise<string> {
  const { change = () => {}, template, price = TEMPLATE.price } = o;
  const other = realpathSync(mkdtempSync(join(tmpdir(), 'crow-other-machine-')));
  const config = JSON.parse(readFileSync(join(folder, 'adapter.json'), 'utf8')) as J;
  const credential = 'other-machine-credential-0123456789';
  const api = await startWorkApi({ token: pin.token.id, price, folder: other, format: 'text/csv', credential });
  const port = Number(new URL(api.url).port);
  Object.assign(config, { signingKey: 'standing', sellerApi: workAddresses(port), journal: join(other, 'journal.json') });
  change(config);
  writeFileSync(join(other, 'adapter.json'), JSON.stringify(config));
  if (template) writeFileSync(join(other, 'template.json'), JSON.stringify(template));
  else copyFileSync(join(folder, 'template.json'), join(other, 'template.json'));
  const adapter = await startSellerAdapter({ ...loadConfig(join(other, 'adapter.json')), log: () => {} }, { HOLDBACK_KEY: key, HOLDBACK_OPERATORS: direct.urls.join(','), [WORK_CREDENTIAL_ENV]: credential });
  try {
    const answer = await fetch(`${adapter.url}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: {} }) });
    const quote = (await answer.json()) as J;
    expect(answer.status, JSON.stringify(quote)).toBe(200);
    return quote.commitmentId as string;
  } finally {
    await adapter.close(); // the other machine goes offline before the deal is funded
    await api.close();
  }
}
async function postToBuyer(id: string): Promise<void> {
  const posted = await fetch(buyer.intake, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commitmentId: id }) });
  expect([200, 202], await posted.text()).toContain(posted.status);
}

describe('site/setup.mjs deliver: one pass over the funded deals (T-568)', () => {
  it('two funded deals: the one with work is delivered and the other named with its deadline; a second pass delivers nothing again; a failing file is held; the corrected one is delivered', async () => {
    const { at, key } = await sellerFolder();
    const standing = privateKeyToAccount(key).address.toLowerCase();

    // Deal A: the folder's first deal, Held with no work.
    const first = await node(at, ['first-deal', '--folder', at.folder, ...testWorld()]);
    expect(first.code, first.out + first.err).toBe(0);
    const held = jsonLines(first.out).at(-1)!;
    expect(held).toMatchObject({ step: 'first-deal', ok: true, state: 'Held' });
    const a = held.commitmentId as string;

    // Deal B: the folder's standing key, offered from another machine; the folder's journal does not hold it.
    const b = await offerElsewhere(at.folder, key);
    await postToBuyer(b);
    await until(b, ['Held']);
    expect(Object.keys(journalOf(at.folder).deals)).not.toContain(b);

    // Nothing is due to the schedule's first pass but the work: B's file is there, A's is not.
    mkdirSync(join(at.folder, 'work'), { recursive: true });
    writeFileSync(join(at.folder, 'work', `${b}.csv`), GOOD);
    const one = await node(at, ['deliver', '--folder', at.folder, ...operators()]);
    expect(one.code, one.out + one.err).toBe(4);
    const lines = jsonLines(one.out);
    expect(lineOf(lines, b)).toEqual([expect.objectContaining({ step: 'deliver', ok: true, state: 'Delivered', found: true, seller: standing })]);
    expect(lineOf(lines, a)).toEqual([expect.objectContaining({ step: 'deliver', ok: true, state: 'Held', due: true, deliverBy: expect.any(String), workPath: join(at.folder, 'work', `${a}.csv`) })]);
    expect(lines.at(-1)).toMatchObject({ step: 'deliver', ok: true, delivered: [b], due: [a] });
    expect(deliveries(b)).toBe(1);
    expect(deliveries(a)).toBe(0);
    expect(journalOf(at.folder).deals[b]).toMatchObject({ stage: 'delivered' });

    // The second pass delivers nothing a second time, and changes no deal.
    const journalBefore = journalOf(at.folder);
    const two = await node(at, ['deliver', '--folder', at.folder, ...operators()]);
    expect(two.code, two.out + two.err).toBe(4);
    expect(jsonLines(two.out).at(-1)).toMatchObject({ delivered: [], due: [a] });
    expect(lineOf(jsonLines(two.out), b)).toEqual([]);
    expect(deliveries(b)).toBe(1);
    expect(journalOf(at.folder).deals[b]).toEqual(journalBefore.deals[b]);

    // A file that fails a check is held, and the failing check is named.
    writeFileSync(join(at.folder, 'work', `${a}.csv`), NO_URL);
    const three = await node(at, ['deliver', '--folder', at.folder, ...operators()]);
    expect(three.code, three.out + three.err).toBe(4);
    const refused = lineOf(jsonLines(three.out), a)[0]!;
    expect(refused).toMatchObject({ step: 'deliver', ok: false, state: 'Held', due: true, failed: expect.arrayContaining([expect.objectContaining({ check: 'cols', required: true })]) });
    expect(refused.failed.map((f: J) => f.check)).not.toContain('rows');
    expect(deliveries(a)).toBe(0);

    // The corrected file is delivered by the next pass, and then nothing is due.
    writeFileSync(join(at.folder, 'work', `${a}.csv`), GOOD);
    const four = await node(at, ['deliver', '--folder', at.folder, ...operators()]);
    expect(four.code, four.out + four.err).toBe(0);
    expect(lineOf(jsonLines(four.out), a)).toEqual([expect.objectContaining({ ok: true, state: 'Delivered' })]);
    expect(jsonLines(four.out).at(-1)).toMatchObject({ ok: true, delivered: [a], due: [] });
    expect(deliveries(a)).toBe(1);
    await until(a, ['Released']);
    await until(b, ['Released']);

    const five = await node(at, ['deliver', '--folder', at.folder, ...operators()]);
    expect(five.code, five.out + five.err).toBe(0);
    expect(jsonLines(five.out)).toEqual([expect.objectContaining({ step: 'deliver', ok: true, delivered: [], due: [] })]);
    expect(deliveries(a) + deliveries(b)).toBe(2);
  }, 240_000);

  // attack.deliver-standing-key-other-terms (red team, F1): the folder's own adapter signs each deal with a fresh key,
  // so a deal under its standing address was signed elsewhere, by a second machine or a leaked key. The folder's
  // finished work goes to every deal it delivers: only a deal that is exactly its own offer may get it.
  it("declines a funded deal of the folder's key that pays another address, sells other work or costs another price, and names why", async () => {
    const { at, key } = await sellerFolder();
    const elsewhere = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
    const paysOther = await offerElsewhere(at.folder, key, { change: (config) => (config.payoutAddress = elsewhere) });
    const otherWork = await offerElsewhere(at.folder, key, { template: { deliverable: { ...TEMPLATE.deliverable, description: 'Another list.' }, checks: TEMPLATE.checks } });
    const cheap = await offerElsewhere(at.folder, key, { price: '1' });
    const ids = [paysOther, otherWork, cheap];
    for (const id of ids) await postToBuyer(id);
    for (const id of ids) await until(id, ['Held']);
    mkdirSync(join(at.folder, 'work'), { recursive: true });
    for (const id of ids) writeFileSync(join(at.folder, 'work', `${id}.csv`), GOOD);
    writeFileSync(join(at.folder, 'work', 'ready.csv'), GOOD); // the folder's finished work, which its own deals deliver
    const run = await node(at, ['deliver', '--folder', at.folder, ...operators()]);
    expect(run.code, run.out + run.err).toBe(0); // the folder owes these deals nothing: nothing is due
    const lines = jsonLines(run.out);
    expect(lineOf(lines, paysOther)).toEqual([expect.objectContaining({ step: 'deliver', ok: false, found: true, declined: true, deliverBy: expect.any(String), detail: expect.stringContaining(`Not this folder's offer: it pays ${elsewhere}`) })]);
    expect(lineOf(lines, otherWork)).toEqual([expect.objectContaining({ ok: false, declined: true, detail: expect.stringContaining("its deliverable or its checks are not this folder's template") })]);
    expect(lineOf(lines, cheap)).toEqual([expect.objectContaining({ ok: false, declined: true, detail: expect.stringContaining('its price is 1 base units') })]);
    expect(lines.at(-1)).toMatchObject({ ok: true, delivered: [], due: [], declined: expect.arrayContaining(ids) });
    expect(ids.map(deliveries)).toEqual([0, 0, 0]);
    expect(Object.keys(journalOf(at.folder).deals)).toEqual([]);
  }, 120_000);

  it('declines a listed deal whose served signature is not the key\'s, or whose windows are not the folder\'s', async () => {
    const { at, key } = await sellerFolder();
    const forged = await offerElsewhere(at.folder, key);
    const slow = await offerElsewhere(at.folder, key, { change: (config) => (config.timing = { ...config.timing, judgeWithinSec: config.timing.judgeWithinSec + 1 }) });
    for (const id of [forged, slow]) await postToBuyer(id);
    for (const id of [forged, slow]) await until(id, ['Held']);
    mkdirSync(join(at.folder, 'work'), { recursive: true });
    writeFileSync(join(at.folder, 'work', 'ready.csv'), GOOD);
    // Both operators serve the forged deal's terms with another key's signature.
    const other = privateKeyToAccount(generatePrivateKey());
    const fake = await other.signMessage({ message: 'not the terms' });
    fault = (request, next) => {
      if (new URL(request.url).pathname !== `/v1/commitments/${forged}/terms`) return undefined;
      return Promise.resolve(next()).then(async (r) => Response.json({ ...((await r.json()) as J), signatures: { seller: fake } }));
    };
    try {
      const run = await node(at, ['deliver', '--folder', at.folder, ...operators()]);
      expect(run.code, run.out + run.err).toBe(0);
      expect(lineOf(jsonLines(run.out), forged)).toEqual([expect.objectContaining({ declined: true, detail: expect.stringContaining('the seller signature the operators serve is not') })]);
      expect(lineOf(jsonLines(run.out), slow)).toEqual([expect.objectContaining({ declined: true, detail: expect.stringContaining('its timing differs from the offer this folder makes') })]);
      expect(deliveries(forged) + deliveries(slow)).toBe(0);
    } finally {
      fault = undefined;
    }
  }, 120_000);

  // neutrality.deliver-one-operator-lists-bogus (red team, F2): one operator's failed read stops no delivery.
  it("one operator that lists a deal nobody serves, or fails its list, stops no delivery of the journal's deal: exit 1, each named", async () => {
    for (const broken of ['bogus', 'list-500'] as const) {
      const { at } = await sellerFolder();
      const first = await node(at, ['first-deal', '--folder', at.folder, ...testWorld()]);
      expect(first.code, first.out + first.err).toBe(0);
      const a = jsonLines(first.out).at(-1)!.commitmentId as string;
      mkdirSync(join(at.folder, 'work'), { recursive: true });
      writeFileSync(join(at.folder, 'work', `${a}.csv`), GOOD);
      const bogus = `0x${'ab'.repeat(32)}`;
      fault = (request, next) => {
        const u = new URL(request.url);
        if (!isFirst(request) || u.pathname !== '/v1/commitments' || u.searchParams.get('role') !== 'seller') return undefined;
        if (broken === 'list-500') return Response.json({ type: 'internal', detail: 'the operator failed' }, { status: 500 });
        return Promise.resolve(next()).then(async (r) => {
          const body = (await r.json()) as J;
          return Response.json({ ...body, items: [{ commitmentId: bogus, escrowState: 'Held' }, ...body.items] });
        });
      };
      try {
        const run = await node(at, ['deliver', '--folder', at.folder, ...operators()]);
        expect(run.code, `${broken}: ${run.out}${run.err}`).toBe(1);
        const lines = jsonLines(run.out);
        expect(lineOf(lines, a), broken).toEqual([expect.objectContaining({ ok: true, state: 'Delivered' })]);
        if (broken === 'bogus') expect(lineOf(lines, bogus)).toEqual([expect.objectContaining({ ok: false, found: true, detail: expect.stringContaining('could not be read from every operator') })]);
        else expect(lines).toContainEqual(expect.objectContaining({ ok: false, operator: recorded.urls[0], detail: expect.stringContaining("list of funded deals could not be read") }));
        expect(lines.at(-1)).toMatchObject({ ok: false, delivered: [a] });
        expect(deliveries(a)).toBe(1);
      } finally {
        fault = undefined;
      }
    }
  }, 180_000);

  it('a pass that outlives its time limit ends with its own answer, and one that ends in time with the work\'s', async () => {
    expect(await withDeadline(new Promise<number>(() => {}), 20, () => 1)).toBe(1);
    expect(await withDeadline(Promise.resolve(4), 1000, () => 1)).toBe(4);
  });

  it('a folder with no deal: one line, exit 0, and no POST to an operator', async () => {
    const { at } = await sellerFolder();
    const before = posts.length;
    const run = await node(at, ['deliver', '--folder', at.folder, ...operators()]);
    expect(run.code, run.out + run.err).toBe(0);
    expect(jsonLines(run.out)).toEqual([expect.objectContaining({ step: 'deliver', ok: true, delivered: [], due: [] })]);
    expect(posts.length).toBe(before);
  }, 60_000);

  it('refuses a folder that is not a template seller, and a folder another run holds, sending nothing', async () => {
    const at = fresh();
    const none = await node(at, ['deliver', '--folder', at.folder, ...operators()]);
    expect(none.code).toBe(1);
    expect(jsonLines(none.out)[0]).toMatchObject({ step: 'deliver', ok: false, detail: expect.stringContaining('run the seller command first') });

    const { at: busy } = await sellerFolder();
    writeFileSync(join(busy.folder, 'crow.lock'), `${process.pid}\n`); // this test's own process: a live run
    const before = posts.length;
    const run = await node(busy, ['deliver', '--folder', busy.folder, ...operators()]);
    expect(run.code).toBe(1);
    expect(jsonLines(run.out)[0]).toMatchObject({ step: 'deliver', ok: false, detail: expect.stringContaining('another run of this command') });
    expect(posts.length).toBe(before);
  }, 60_000);

  it("--schedule prints this machine's scheduler entry, every 5 minutes, with each path quoted, and sends nothing", async () => {
    const at = fresh();
    const odd = join(at.dir, "it's a folder");
    writeFileSync(join(at.dir, 'template.json'), JSON.stringify(TEMPLATE));
    const made = await node(at, ['seller', '--template', join(at.dir, 'template.json'), '--payout', 'this-key', '--folder', odd, ...operators()]);
    expect(made.code, made.out + made.err).toBe(0);
    const before = posts.length;
    const run = await node(at, ['deliver', '--schedule', '--folder', odd, ...operators()]);
    expect(run.code, run.out + run.err).toBe(0);
    const [line] = jsonLines(run.out);
    expect(line).toMatchObject({ step: 'schedule', ok: true, everyMinutes: 5, sent: 'nothing', installed: 'nothing' });
    const command: string = line.command;
    // One shell command: node by its full path without the settings the setup refuses, this file, deliver, the folder
    // and the operators, each quoted.
    expect(command.startsWith(`/usr/bin/env -u NODE_OPTIONS -u NODE_EXTRA_CA_CERTS -u NODE_USE_ENV_PROXY '${process.execPath}' '${at.file}' deliver --folder '`)).toBe(true);
    expect(command).toContain(`'${odd.replace(/'/g, `'\\''`)}'`);
    expect(command).toContain(`--test-world --operators '${recorded.urls.join(',')}'`);
    expect(command).toContain(`> '${join(odd, 'deliver.log').replace(/'/g, `'\\''`)}' 2>&1`);
    if (process.platform === 'darwin') {
      expect(line).toMatchObject({ scheduler: 'launchd', file: expect.stringMatching(/\/Library\/LaunchAgents\/direct\.crow\.deliver\.[a-z0-9-]+\.plist$/), load: expect.stringMatching(/^launchctl bootstrap gui\/\d+ '/) });
      expect(line.plist).toContain('<integer>300</integer>');
      expect(line.plist).toContain('<string>/bin/sh</string>');
    } else {
      expect(line).toMatchObject({ scheduler: 'cron', entry: `*/5 * * * * ${command}` });
    }
    expect(posts.length).toBe(before);
  }, 60_000);

  // attack.deliver-schedule-newline-injection (red team, F3): a line break would start a second crontab entry.
  it('--schedule refuses a line break in --operators or in the folder path, and prints no entry', async () => {
    const at = fresh();
    const injected = await node(at, ['deliver', '--schedule', '--folder', at.folder, '--operators', 'https://a.example/x\n*/1 * * * * touch /tmp/crow-pwned #,https://b.example']);
    expect(injected.code).toBe(2);
    expect(injected.out).toBe('');
    expect(injected.err).toContain('--operators holds a line break');

    const broken = join(at.dir, 'two\nlines');
    writeFileSync(join(at.dir, 'template.json'), JSON.stringify(TEMPLATE));
    const made = await node(at, ['seller', '--template', join(at.dir, 'template.json'), '--payout', 'this-key', '--folder', broken, ...operators()]);
    expect(made.code, made.out + made.err).toBe(0);
    const run = await node(at, ['deliver', '--schedule', '--folder', broken, ...operators()]);
    expect(run.code).toBe(1);
    expect(jsonLines(run.out)).toEqual([expect.objectContaining({ step: 'schedule', ok: false, detail: expect.stringContaining('line break') })]);
  }, 60_000);
});
