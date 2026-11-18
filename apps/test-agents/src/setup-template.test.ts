// T-543: a seller sells its own work from a template with the setup command. As in setup.test.ts, the committed
// site/setup.mjs runs alone in a fresh folder, in its own Node process, against the public demo's own world on two
// origins and Crow's test buyer's real code, all in this process: CI needs no network.
//
// The work is not finished when the offer is made. `first-deal` stops once the deal is funded, with the deadline and
// the path for the work, and exits 0. The same command, run again, checks the file that is there, holds one that
// fails a check and names the check, and delivers one that passes.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveTwoOrigins, type TwoOrigins } from '../../../examples/two-origins.ts';
import { knownPins } from '../../../examples/verify.ts';
import { TestBuyer } from './buyer.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const committed = fileURLToPath(new URL('../../../site/setup.mjs', import.meta.url));
const pin = knownPins()[0]!; // SimChain

/** Each POST the command made to an operator, by path. */
const posts: string[] = [];
let demo: PublicWorld;
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
  demo = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000' }, faucetPerClient: 1000 });
  recorded = await serveTwoOrigins({
    fetch: (request, ctx) => {
      if (request.method === 'POST') posts.push(new URL(request.url).pathname);
      return demo.fetch(request, ctx);
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
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'crow-setup-template-')));
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
const stateOf = (folder: string): J => JSON.parse(readFileSync(join(folder, 'crow.json'), 'utf8'));
const journalOf = (folder: string): J => JSON.parse(readFileSync(join(folder, 'journal.json'), 'utf8'));
const deliveries = (id: string) => posts.filter((p) => p === `/v1/commitments/${id}/deliveries`).length;

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
/** The party's files beside the command: the template and the work, outside the folder the setup makes. */
function party(at: { dir: string }, template: J = TEMPLATE): { template: string; good: string; bad: string } {
  const files = { template: join(at.dir, 'template.json'), good: join(at.dir, 'protocols.csv'), bad: join(at.dir, 'protocols-without-url.csv') };
  writeFileSync(files.template, JSON.stringify(template));
  writeFileSync(files.good, GOOD);
  writeFileSync(files.bad, NO_URL);
  return files;
}

describe('site/setup.mjs: seller --template, then first-deal with Crow\'s test buyer (T-543)', () => {
  it('work that is not finished: Held and exit 0 with the deadline and the path; a file that fails a check is held and the check named; the corrected file ends Released', async () => {
    const at = fresh();
    const files = party(at);
    const made = await node(at, ['seller', '--template', files.template, '--payout', 'this-key', '--folder', at.folder, ...operators()]);
    expect(made.code, made.out + made.err).toBe(0);
    const lines = jsonLines(made.out);
    expect(lines[0]).toMatchObject({ step: 'seller', ok: true, sells: 'template', work: { price: '5000000', format: 'text/csv', deliverWithinSec: 82_800, ready: null }, sent: 'nothing' });
    // No sample of the work: one advisory line, and nothing fails for it (D31, D32).
    expect(lines.filter((l) => l.advisory)).toEqual([expect.objectContaining({ step: 'check', check: 'work', ok: true, advisory: true, detail: expect.stringMatching(/^The checks have never run on real work/) })]);
    expect(lines.filter((l) => l.step === 'check').map((l) => [l.check, l.ok])).toEqual([['folder', true], ['configuration', true], ['template', true], ['work', true], ['secrets', true]]);
    expect(stateOf(at.folder)).toMatchObject({ sells: 'template', work: { price: '5000000', format: 'text/csv', deliverWithinSec: 82_800 } });

    // Run 1: the offer, the hold, and a stop with the deadline and the path for the work. Exit 0.
    const started = Date.now();
    const first = await node(at, ['first-deal', '--folder', at.folder, ...testWorld()]);
    expect(first.code, first.out + first.err).toBe(0);
    const held = jsonLines(first.out).at(-1);
    const id = held.commitmentId as string;
    expect(held).toMatchObject({ step: 'first-deal', ok: true, state: 'Held', workPath: join(at.folder, 'work', `${id}.csv`), detail: expect.stringMatching(/^The deal is funded and waits for the work\. Put the finished work at .*run the same command again/) });
    // The deadline is the template's: 82,800 s after the offer, which the test buyer, at 86,400 s, takes.
    const deal = journalOf(at.folder).deals[id];
    expect(held.deliverBy).toBe(deal.terms.timing.deliverBy);
    expect(Date.parse(deal.terms.timing.deliverBy) - Date.parse(deal.terms.createdAt)).toBe(82_800_000);
    expect(Date.parse(held.deliverBy)).toBeGreaterThan(started + 82_000_000);
    expect(deal.terms.price.amount).toBe('5000000');
    expect(deal.terms.buyer.toLowerCase()).toBe(buyer.address);
    expect(deal.scope).toEqual({});
    expect(deliveries(id)).toBe(0);
    const status = jsonLines((await node(at, ['status', '--folder', at.folder])).out)[0];
    expect(status).toMatchObject({ sells: 'template', workPath: held.workPath, firstDeal: { commitmentId: id }, openDeals: [{ commitmentId: id }] });

    // Run 2, still no work: the same line, the same deal, no second offer.
    const again = await node(at, ['first-deal', '--folder', at.folder, ...operators()]);
    expect(again.code, again.out + again.err).toBe(0);
    expect(jsonLines(again.out).at(-1)).toMatchObject({ ok: true, state: 'Held', commitmentId: id, workPath: held.workPath, deliverBy: held.deliverBy });
    expect(jsonLines(again.out).find((l) => l.step === 'offer')).toMatchObject({ commitmentId: id, resumed: true });
    expect(posts.filter((p) => p === '/v1/commitments').length).toBe(1);

    // Run 3: work that fails a check. It is not delivered, and the line names the check.
    mkdirSync(join(at.folder, 'work'), { recursive: true });
    writeFileSync(held.workPath, NO_URL);
    const refused = await node(at, ['first-deal', '--folder', at.folder, ...operators()]);
    expect(refused.code, refused.out + refused.err).toBe(1);
    const why = jsonLines(refused.out).at(-1);
    expect(why).toMatchObject({ step: 'first-deal', ok: false, state: 'Held', commitmentId: id, workPath: held.workPath, failed: [{ check: 'cols', required: true, outcome: 'fail' }] });
    expect(why.detail).toMatch(/was not delivered: checks: FAIL cols \(required\)/);
    expect(deliveries(id)).toBe(0);
    // Run again with the same file: the same answer, at once, and still no delivery.
    const same = await node(at, ['first-deal', '--folder', at.folder, ...operators()]);
    expect(same.code).toBe(1);
    expect(jsonLines(same.out).at(-1)).toMatchObject({ ok: false, failed: [{ check: 'cols' }] });
    expect(deliveries(id)).toBe(0);

    // Run 5: the corrected file is delivered, and the deal ends Released with a record.
    writeFileSync(held.workPath, GOOD);
    const done = await node(at, ['first-deal', '--folder', at.folder, ...operators()]);
    expect(done.code, done.out + done.err).toBe(0);
    const last = jsonLines(done.out).at(-1);
    expect(last).toMatchObject({ step: 'first-deal', ok: true, state: 'Released', commitmentId: id, buyer: buyer.address, price: { amount: '5000000' } });
    expect(deliveries(id)).toBe(1);
    expect(posts.filter((p) => p === '/v1/commitments').length).toBe(1);
    const record = JSON.parse(readFileSync(last.record as string, 'utf8'));
    expect(record.row).toMatchObject({ commitmentId: id, outcome: 'Released' });
    expect(record.checks.filter((k: J) => k.ok === false)).toEqual([]);

    // No printed line holds the key, and the folder's work is closed to other accounts.
    const key = readFileSync(join(at.folder, 'keys', 'signing.key'), 'utf8').trim().slice(2);
    for (const run of [made, first, again, refused, same, done]) expect((run.out + run.err).toLowerCase()).not.toContain(key);
    expect(statSync(at.folder).mode & 0o077).toBe(0);
  }, 240_000);

  it('finished work named with --file: the check runs the deal\'s checks on it, and one run ends Released', async () => {
    posts.length = 0;
    const at = fresh();
    const files = party(at, { ...TEMPLATE, deliverWithinSec: 3600 });
    const made = await node(at, ['seller', '--template', files.template, '--file', files.good, '--payout', 'this-key', '--folder', at.folder, ...operators()]);
    expect(made.code, made.out + made.err).toBe(0);
    const ready = join(at.folder, 'work', 'ready.csv');
    expect(readFileSync(ready, 'utf8')).toBe(GOOD);
    expect(statSync(ready).mode & 0o777).toBe(0o600);
    const checks = jsonLines(made.out).filter((l) => l.step === 'check');
    expect(checks.map((l) => [l.check, l.ok, l.advisory])).toEqual([['folder', true, undefined], ['configuration', true, undefined], ['template', true, undefined], ['work', true, undefined], ['required-field', true, undefined], ['secrets', true, undefined]]);
    expect(checks.find((l) => l.check === 'required-field').detail).toBe('the work with its last column, url, removed fails the checks');

    const run = await node(at, ['first-deal', '--folder', at.folder, ...testWorld()]);
    expect(run.code, run.out + run.err).toBe(0);
    const last = jsonLines(run.out).at(-1);
    expect(last).toMatchObject({ step: 'first-deal', ok: true, state: 'Released', buyer: buyer.address });
    expect(deliveries(last.commitmentId)).toBe(1);
    const deal = journalOf(at.folder).deals[last.commitmentId];
    expect(Date.parse(deal.terms.timing.deliverBy) - Date.parse(deal.terms.createdAt)).toBe(3_600_000); // the template's window
  }, 240_000);

  it('finished work that fails the template\'s own checks stops before any offer', async () => {
    posts.length = 0;
    const at = fresh();
    const files = party(at);
    const made = await node(at, ['seller', '--template', files.template, '--file', files.bad, '--payout', 'this-key', '--folder', at.folder, ...operators()]);
    expect(made.code, made.out + made.err).toBe(1);
    expect(jsonLines(made.out).find((l) => l.check === 'work')).toMatchObject({ ok: false, detail: expect.stringMatching(/the checks refuse .*ready\.csv.*FAIL {2}cols \(required\)/) });
    const run = await node(at, ['first-deal', '--folder', at.folder, ...testWorld()]);
    expect(run.code).toBe(1);
    expect(jsonLines(run.out).at(-1)).toMatchObject({ step: 'first-deal', ok: false, detail: expect.stringMatching(/The check fails \(work, required-field\).*Nothing was sent/) });
    expect(posts).toEqual([]);
    expect(existsSync(join(at.folder, 'first-deal.started'))).toBe(false);
    // The corrected file, named again, passes: the same command replaces the finished work.
    const fixed = await node(at, ['seller', '--template', files.template, '--file', files.good, '--folder', at.folder, ...operators()]);
    expect(fixed.code, fixed.out + fixed.err).toBe(0);
  }, 120_000);
});

describe('site/setup.mjs seller --template and check --work: what they take and refuse (T-543)', () => {
  it('check --work runs the checks on a sample of the work and on a copy with a field removed; a sample that fails them fails the check', async () => {
    const at = fresh();
    const files = party(at);
    expect((await node(at, ['seller', '--template', files.template, '--payout', 'this-key', '--folder', at.folder])).code).toBe(0);
    const good = await node(at, ['check', '--work', files.good, '--folder', at.folder]);
    expect(good.code, good.out).toBe(0);
    expect(jsonLines(good.out).filter((l) => ['work', 'required-field'].includes(l.check))).toEqual([
      { step: 'check', check: 'work', ok: true, detail: expect.stringMatching(/^60 bytes in .*protocols\.csv\. Result: accept\./) },
      { step: 'check', check: 'required-field', ok: true, detail: 'the work with its last column, url, removed fails the checks' },
    ]);
    const bad = await node(at, ['check', '--work', files.bad, '--folder', at.folder]);
    expect(bad.code).toBe(1);
    expect(jsonLines(bad.out).find((l) => l.check === 'work')).toMatchObject({ ok: false, detail: expect.stringMatching(/FAIL {2}cols \(required\)/) });
    // A check on the template alone still passes: a failed sample is not the folder's state.
    expect((await node(at, ['check', '--folder', at.folder])).code).toBe(0);
  }, 60_000);

  it('checks that do not look at a field are the party\'s to decide: an advisory line, and exit 0', async () => {
    const at = fresh();
    const files = party(at, { ...TEMPLATE, checks: [{ id: 'rows', type: 'row_count_range', required: true, min: 1, max: 500 }] });
    expect((await node(at, ['seller', '--template', files.template, '--payout', 'this-key', '--folder', at.folder])).code).toBe(0);
    const run = await node(at, ['check', '--work', files.good, '--folder', at.folder]);
    expect(run.code, run.out).toBe(0);
    expect(jsonLines(run.out).find((l) => l.check === 'required-field')).toMatchObject({ ok: true, advisory: true, detail: expect.stringMatching(/^The work with its last column, url, removed still passes the checks/) });
  }, 60_000);

  it('refuses, before it makes anything: a format no delivery has, finished work over 1 MiB, an environment file, both kinds at once, --file with no template', async () => {
    const at = fresh();
    const files = party(at);
    const big = join(at.dir, 'big.csv');
    writeFileSync(big, Buffer.alloc(1_048_577, 'a'));
    const pdf = join(at.dir, 'pdf.json');
    writeFileSync(pdf, JSON.stringify({ ...TEMPLATE, deliverable: { ...TEMPLATE.deliverable, format: 'application/pdf' } }));
    const env = join(at.dir, '.env');
    writeFileSync(env, 'SECRET=never-printed');
    const base = ['--payout', 'this-key', '--folder', at.folder];
    const cases: Array<[string[], RegExp]> = [
      [['seller', '--template', pdf, ...base], /application\/pdf is none a delivery can have: a delivery is CSV, JSON, plain text or Markdown .* at most 1,048,576 bytes \(1 MiB\)/],
      [['seller', '--template', files.template, '--file', big, ...base], /is 1,048,577 bytes: a delivery is CSV, JSON, plain text or Markdown .* at most 1,048,576 bytes \(1 MiB\)/],
      [['seller', '--template', files.template, '--file', env, ...base], /--file names \.env, an environment file/],
      [['seller', '--template', env, ...base], /--template names \.env, an environment file/],
      [['seller', '--sample', '--template', files.template, ...base], /give --sample or --template, not both/],
      [['seller', '--sample', '--file', files.good, ...base], /--file names finished work for a folder that sells from a template/],
      [['seller', '--template', files.template, '--file', join(at.dir, 'missing.csv'), ...base], /missing\.csv is not there/],
    ];
    for (const [args, why] of cases) {
      const run = await node(at, args);
      expect(run.code, run.out + run.err).toBe(1);
      expect(jsonLines(run.out).at(-1)).toMatchObject({ step: 'seller', ok: false, detail: expect.stringMatching(why) });
      expect(run.out + run.err).not.toContain('never-printed');
      expect(existsSync(at.folder), args.join(' ')).toBe(false);
    }
  }, 60_000);

  it('a folder sells one kind for good, and keeps its template while a deal is open', async () => {
    const at = fresh();
    const files = party(at);
    expect((await node(at, ['seller', '--sample', '--payout', 'this-key', '--folder', at.folder])).code).toBe(0);
    const switched = await node(at, ['seller', '--template', files.template, '--folder', at.folder]);
    expect(switched.code).toBe(1);
    expect(jsonLines(switched.out).at(-1)).toMatchObject({ step: 'folder', ok: false, detail: expect.stringMatching(/sells Crow's sample, and a folder sells one kind for good/) });
    expect(stateOf(at.folder).sells).toBe('sample');

    const own = fresh();
    const ownFiles = party(own);
    expect((await node(own, ['seller', '--template', ownFiles.template, '--payout', 'this-key', '--folder', own.folder])).code).toBe(0);
    // Before a deal, the same command with another template replaces the price, the window and the checks.
    writeFileSync(ownFiles.template, JSON.stringify({ ...TEMPLATE, price: '7000000', deliverWithinSec: 7200 }));
    expect((await node(own, ['seller', '--template', ownFiles.template, '--folder', own.folder])).code).toBe(0);
    expect(stateOf(own.folder).work).toEqual({ price: '7000000', format: 'text/csv', deliverWithinSec: 7200 });
    expect(JSON.parse(readFileSync(join(own.folder, 'adapter.json'), 'utf8')).timing.deliverWithinSec).toBe(7200);
    // With a deal open, it keeps the template the deal was offered from.
    const state = stateOf(own.folder);
    writeFileSync(join(own.folder, 'crow.json'), JSON.stringify({ ...state, firstDeal: { startedAt: new Date().toISOString(), commitmentId: `0x${'ab'.repeat(32)}` } }));
    const open = await node(own, ['seller', '--template', ownFiles.template, '--folder', own.folder]);
    expect(open.code).toBe(1);
    expect(jsonLines(open.out).at(-1)).toMatchObject({ step: 'folder', ok: false, detail: expect.stringMatching(/open deal 0x(ab){32} was offered from the template it has/) });
  }, 60_000);
});
