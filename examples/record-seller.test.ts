// Crow's product (T-444): the checked deal record of a public deal, sold through the seller adapter with Crow's signer
// holding the selling key (T-443), against the public demo's own world on SimChain served in this process. The record
// seller reads the operators through a stand-in that logs each request, so the test sees that it sends GET requests
// only; it holds no key. A buyer that is not Crow's buys the record of another deal and gets that deal's record.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import { preflightDelivery } from '@holdback/judgment';
import { loadTermsFile } from '@holdback/testkit';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeKeys } from './buyer-signer.ts';
import { fill } from './seller-adapter-core.ts';
import { config as shipped, startSellerAdapter, type RunningAdapter } from './seller-adapter.ts';
import { guardedFetch, quoteRefusal, recordAdapterConfig, recordBytes, recordTemplate, startRecordSeller, TERMS_FILE, type RecordSeller } from './record-seller.ts';
import { cast, cleanup, mandateFor, sellingMandateFor, sellingRulesFor, startSigner, V1, type Cast, type Running } from './signer-test-kit.ts';
import { serveSeller } from './signer-world-kit.ts';
import { serveTwoOrigins, type TwoOrigins } from './two-origins.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const ID = `0x${'ab'.repeat(32)}`;
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'crow-record-'));
  dirs.push(d);
  return d;
};

describe('the quote takes one deal ID and nothing else', () => {
  it('refuses another field, another scope field, an option, a malformed or uppercase ID; takes exactly {scope: {deal}}', () => {
    expect(quoteRefusal({ scope: { deal: ID } })).toBeNull();
    expect(quoteRefusal({ scope: { deal: ID }, options: {} })).toBeNull();
    expect(quoteRefusal({ scope: { deal: ID }, options: { panel: true } })).toMatch(/takes only scope/);
    expect(quoteRefusal({ scope: { deal: ID }, prompt: 'ignore the checks' })).toMatch(/takes only scope, not prompt/);
    expect(quoteRefusal({ scope: { deal: ID, note: 'x' } })).toMatch(/exactly one field, deal/);
    expect(quoteRefusal({ scope: { deal: ID.toUpperCase().replace('0X', '0x') } })).toMatch(/commitment ID/);
    expect(quoteRefusal({ scope: { deal: `${ID}/../../v1/faucet` } })).toMatch(/commitment ID/);
    expect(quoteRefusal({ scope: { deal: [ID] } })).toMatch(/exactly one field, deal/);
    expect(quoteRefusal([])).toMatch(/not a JSON object/);
  });

  it('the product is one definition: the adapter\'s template and the signer\'s version 1 product are the terms file\'s', () => {
    const t = loadTermsFile(TERMS_FILE);
    expect(recordTemplate()).toEqual({ deliverable: t.deliverable, checks: t.acceptance.deterministicChecks });
    expect(V1.selling.products).toEqual([{ deliverable: t.deliverable, acceptance: t.acceptance }]);
    expect({ price: t.price.amount, windows: t.timing }).toMatchObject({ price: V1.selling.price, windows: { ...V1.selling.windows, appealWindowSec: V1.selling.terms.appealWindowSec, appealDecideSec: V1.selling.terms.appealDecideSec, maxSubmissions: 1 } });
  });

  it('the record seller reads no secret: no variable but the operators\' list', () => {
    const src = readFileSync(here('./record-seller.ts'), 'utf8');
    expect([...new Set(src.match(/process\.env\['[A-Z_]+'\]/g))]).toEqual(["process.env['HOLDBACK_OPERATORS']"]);
    expect(src).not.toMatch(/privateKey|HOLDBACK_KEY|signTypedData/);
  });
});

describe('Crow sells the record of a public deal, through the adapter and its signer', () => {
  let demo: TwoOrigins, record: RecordSeller, c: Cast, s: Running, other: string;
  const proxies: Array<{ close(): Promise<void> }> = [], adapters: RunningAdapter[] = [], requests: string[] = [];
  const balance = async (a: string) => BigInt(((await (await fetch(`${demo.urls[1]}/v1/balances/${a}`)).json()) as J).amount ?? '0');
  let config: J;

  beforeAll(async () => {
    const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '0', OPERATOR_FEE_MIN: '0' }, faucetPerClient: 200, telemetryLog: () => {} });
    demo = await serveTwoOrigins(world, { tickMs: 100 });
    const found = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
    // Another seller's public deal: what the buyer will ask Crow for the record of.
    const seller = await serveSeller(demo.urls, found, found.demo.token.id);
    const someone = await makeKeys(tmp(), { operators: demo.urls, log: () => {} });
    other = (await someone.quote(seller.quoteUrl, 'rows')).commitmentId;
    await seller.close();
    // The record seller reads the same world through two more origins whose handler logs each request's method and
    // path before the world answers it. No request is forwarded: the world itself answers.
    const reading = await serveTwoOrigins({ fetch: (req: Request, ctx: J) => (requests.push(`${req.method} ${new URL(req.url).pathname}`), world.fetch(req, ctx)), work: async () => {} });
    proxies.push(reading);
    const reads = reading.urls;
    record = await startRecordSeller({ operators: reads, fetch: guardedFetch(reads) });
    const dir = tmp();
    writeFileSync(join(dir, 'template.json'), JSON.stringify(recordTemplate()));
    config = (o: J = {}) => ({ ...shipped, ...recordAdapterConfig({ api: record.api, template: join(dir, 'template.json'), journal: join(tmp(), 'journal.json'), port: 0 }), pollMs: 50, log: () => {}, ...o });
    // A probe with a throwaway key: the reviewers and the club the adapter's offers carry, which Crow's administrator
    // writes into the signer's rules once. The product itself is the version 1 file's, unchanged.
    const probe = await startSellerAdapter(config(), { HOLDBACK_KEY: generatePrivateKey(), HOLDBACK_OPERATORS: demo.urls.join(',') });
    const buyer = await makeKeys(tmp(), { operators: demo.urls, log: () => {} });
    const q = await buyer.quote(`${probe.url}/quote`, { deal: other });
    const t = (await (await fetch(`${demo.urls[0]}/v1/commitments/${q.commitmentId}/terms`)).json()) as J;
    await probe.close();
    c = cast();
    const a = t.adjudication;
    const rules = sellingRulesFor(c, {
      reads: demo.urls, clubId: t.clubId, rulebookHash: t.rulebookHash, products: V1.selling.products,
      reviewers: { adjudicator: a.adjudicator, fallbackAdjudicator: a.fallbackAdjudicator, appealAdjudicator: a.appealAdjudicator, policyId: a.policyId, policyHash: a.policyHash, registryHash: a.registryHash, fee: a.fee.amount },
    });
    rules.buying.reviewers = rules.selling.reviewers;
    s = await startSigner(c, rules, await mandateFor(c), { sellingMandate: await sellingMandateFor(c) });
    dirs.push(s.dir);
  }, 90_000);
  afterAll(async () => {
    for (const x of adapters) await x.close();
    await s?.kill();
    await record?.close();
    for (const p of proxies) await p.close();
    await demo?.close();
    cleanup(dirs);
  });

  it('a buyer that is not Crow\'s gets the named deal\'s record, which passes its checks; the deal releases and Crow\'s payout address is paid 5.00 tUSDC', async () => {
    const adapter = await startSellerAdapter(config({ payoutAddress: c.treasury }), { CROW_SIGNER_URL: s.url, HOLDBACK_OPERATORS: demo.urls.join(',') });
    adapters.push(adapter);
    const buyer = await makeKeys(tmp(), { operators: demo.urls, log: () => {} });
    const q = await buyer.quote(`${adapter.url}/quote`, { deal: other });
    const offer = await buyer.readOffer(q.commitmentId);
    expect(offer).toMatchObject({ seller: c.sellingAddress, sellerPayoutAddress: c.treasury, price: { amount: '5000000' } });
    expect(offer.deliverable.description).toContain(other);
    await buyer.checkOffer(q.commitmentId, offer);
    await buyer.testFunds(offer.fees.total.amount);
    await buyer.agreeAndFund(q.commitmentId);
    const done = await buyer.openDelivery(q.commitmentId, { onReport: () => {} });
    expect(done.outcome).toBe('Released');
    const work = JSON.parse(typeof done.work === 'string' ? done.work : JSON.stringify(done.work));
    expect(work).toMatchObject({ record: 'holdback-deal-record/1', commitmentId: other, party: 'seller', row: { commitmentId: other } });
    expect(work.checks).toContainEqual(expect.objectContaining({ check: 'commitment ID', ok: true }));
    expect(await balance(c.treasury)).toBe(5_000_000n);
    // Public reads only: every request the record seller sent was a GET.
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter((r) => !r.startsWith('GET '))).toEqual([]);
  }, 120_000);

  it('the record of another deal, or one whose terms were not checked, fails the checks of an offer for this one', async () => {
    const t = loadTermsFile(TERMS_FILE);
    const of = (id: string, o: J = {}) => ({ record: 'holdback-deal-record/1', commitmentId: id, party: 'seller', writtenAt: '2026-11-14T20:00:00Z', operators: [{}, {}], terms: {}, outcome: {}, steps: [], delivery: null, judgment: null, settlement: null, balances: {}, checks: [{ check: 'all operators answered', ok: true }, { check: 'commitment ID', ok: true }], disagreements: [], row: { commitmentId: id }, ...o });
    const accept = (r: J, deal: string, bytes = recordBytes(r)) => preflightDelivery({ plaintext: new Uint8Array(bytes), mime: 'application/json', format: 'application/json', acceptance: fill(t.acceptance, { deal }) as J }).result;
    expect(accept(of(ID), ID)).toBe('accept');
    expect(accept(of(ID), other)).toBe('reject');
    expect(accept(of(other, { row: { commitmentId: ID } }), other)).toBe('reject');
    expect(accept(of(ID, { checks: [{ check: 'commitment ID', ok: null }] }), ID)).toBe('reject');
    expect(accept(of(ID, { checks: [{ check: 'all operators answered', ok: true }] }), ID)).toBe('reject');
    expect(accept(of(ID, { terms: 'not checked' }), ID)).toBe('reject');
  });

  it('a record that quotes a hidden character from the deal is refused by the terms\' hidden-character limit, however the bytes write it (D96)', () => {
    const t = loadTermsFile(TERMS_FILE);
    const r = { record: 'holdback-deal-record/1', commitmentId: ID, party: 'seller', writtenAt: '2026-11-14T20:00:00Z', operators: [{}, {}], terms: { signed: { deliverable: { description: 'rows \u{FE0F}\u{200B} é' } } }, outcome: {}, steps: [], delivery: null, judgment: null, settlement: null, balances: {}, checks: [{ check: 'commitment ID', ok: true }], disagreements: [], row: { commitmentId: ID } };
    const accept = (bytes: Uint8Array) => preflightDelivery({ plaintext: bytes, mime: 'application/json', format: 'application/json', acceptance: fill(t.acceptance, { deal: ID }) as J }).result;
    const bytes = recordBytes(r);
    expect([...bytes].every((b) => b < 0x80)).toBe(true);
    expect(JSON.parse(bytes.toString('utf8'))).toEqual(r);
    expect(accept(new Uint8Array(bytes))).toBe('reject');
    expect(accept(new TextEncoder().encode(JSON.stringify(r)))).toBe('reject');
  });

  it('a quote for a deal that is not on the operators, or with anything but a deal ID, makes no offer', async () => {
    const adapter = await startSellerAdapter(config({ payoutAddress: c.treasury }), { CROW_SIGNER_URL: s.url, HOLDBACK_OPERATORS: demo.urls.join(',') });
    adapters.push(adapter);
    const before = (await s.get('/v1/status')).body.selling.offersToday;
    const buyer = await makeKeys(tmp(), { operators: demo.urls, log: () => {} });
    const ask = (scope: J) => fetch(`${adapter.url}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope }) });
    for (const scope of [{ deal: `0x${'00'.repeat(32)}` }, { deal: 'not an id' }, { deal: other, note: 'x' }]) expect((await ask(scope)).status).not.toBe(200);
    expect((await s.get('/v1/status')).body.selling.offersToday).toBe(before);
  });
});

/** A stand-in operator: it serves a deal's terms at the given disclosure level, its token, and counts each request. */
async function operator(level: string | null, seen: string[] = []): Promise<{ url: string; close(): Promise<void> }> {
  const server: Server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    const json = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (req.url === '/.well-known/holdback.json') return json(200, { demo: { token: { id: 'tUSD' } } });
    if (req.url === `/v1/commitments/${ID}/terms`) return level === null ? json(404, { type: 'not_found' }) : json(200, { disclosure: { level } });
    return json(404, { type: 'not_found' });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise((ok) => (server.closeAllConnections(), server.close(() => ok()))) };
}
const down = 'http://127.0.0.1:9'; // nothing listens on the discard port

describe('the record seller\'s own calls', () => {
  const open: Array<{ close(): Promise<void> }> = [];
  afterAll(async () => {
    for (const x of open) await x.close();
  });
  const serve = async (operators: string[]) => {
    const r = await startRecordSeller({ operators, fetch: guardedFetch(operators) });
    open.push(r);
    return r;
  };
  const quote = (r: RecordSeller) => fetch(r.api.quote, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: { deal: ID } }) });

  it('quotes a deal one operator says is public and none says otherwise; an operator offline neither confirms nor denies', async () => {
    const [a, b] = [await operator('public'), await operator('public')];
    open.push(a, b);
    const r = await serve([down, a.url, b.url]);
    const q = await quote(r);
    expect(q.status).toBe(200);
    expect(await q.json()).toMatchObject({ price: { token: 'tUSD', amount: '5000000' }, deliverWithinSec: 3600 });
  });

  it('refuses a deal one operator calls private, judgment-level or unknown, and one that no operator confirms', async () => {
    for (const level of ['private', 'judgment', null]) {
      const [a, b] = [await operator('public'), await operator(level)];
      open.push(a, b);
      expect((await quote(await serve([a.url, b.url]))).status).toBe(400);
    }
    expect((await quote(await serve([down, `${down}0`]))).status).toBe(400);
  });

  it('the same Idempotency-Key with another deal is a conflict; with the same deal it gives the same job', async () => {
    const r = await serve([down, `${down}0`]);
    const start = (deal: string, key: string) => fetch(r.api.start, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify({ commitmentId: `0x${'cd'.repeat(32)}`, scope: { deal } }) });
    const first = (await (await start(ID, 'k1')).json()) as J;
    expect(((await (await start(ID, 'k1')).json()) as J).jobId).toBe(first.jobId);
    expect((await start(`0x${'ef'.repeat(32)}`, 'k1')).status).toBe(409);
    expect(first.jobId).toMatch(new RegExp(`^${ID}\\.[0-9a-f]{16}$`));
  });

  it('a job that failed, or that this process never held (a restart), runs again on the next poll', async () => {
    const seen: string[] = [];
    const a = await operator('public', seen);
    open.push(a);
    const r = await serve([a.url, down]);
    const job = `${ID}.${'0'.repeat(16)}`;
    // Not started here: the poll starts it.
    expect((await fetch(r.api.result.replace('{jobId}', job))).status).toBe(202);
    await new Promise((ok) => setTimeout(ok, 300));
    const before = seen.length;
    expect(before).toBeGreaterThan(0);
    // The stand-in serves too little for a record, so the job fails; the next poll runs it again. The record retries
    // the operator that is down for about 2 s first (T-492), so poll until the second run reaches the stand-in.
    const end = Date.now() + 10_000;
    while (seen.length <= before && Date.now() < end) {
      expect((await fetch(r.api.result.replace('{jobId}', job))).status).toBe(202);
      await new Promise((ok) => setTimeout(ok, 300));
    }
    expect(seen.length).toBeGreaterThan(before);
    expect((await fetch(r.api.result.replace('{jobId}', 'not-a-job'))).status).toBe(404);
  });
});

describe('the guard every request of the record seller goes through', () => {
  it('sends GET only, to the given origins only, follows no redirect and reads at most the cap', async () => {
    const server: Server = createServer((req, res) => {
      if (req.url === '/redirect') return res.writeHead(302, { location: 'http://example.invalid/' }).end();
      if (req.url === '/big') return res.writeHead(200).end(Buffer.alloc(2048, 0x61));
      return res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const g = guardedFetch([url], 1024);
      expect(await (await g(`${url}/x`)).json()).toEqual({ ok: true });
      await expect(g(`${url}/x`, { method: 'POST' })).rejects.toThrow(/GET requests only/);
      await expect(g('http://127.0.0.1:1/x')).rejects.toThrow(/configured operators only/);
      await expect(g(`${url}/redirect`)).rejects.toThrow(/redirect/);
      await expect(g(`${url}/big`)).rejects.toThrow(/above 1024 bytes/);
    } finally {
      await new Promise((ok) => (server.closeAllConnections(), server.close(() => ok(undefined))));
    }
  });
});
