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
import { quoteRefusal, recordAdapterConfig, recordTemplate, startRecordSeller, TERMS_FILE, type RecordSeller } from './record-seller.ts';
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

/** A stand-in in front of one operator that forwards every request and logs its method and path. */
async function logged(upstream: string, log: string[]): Promise<{ url: string; close(): Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    log.push(`${req.method} ${req.url}`);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const r = await fetch(`${upstream}${req.url}`, { method: req.method!, headers: { 'content-type': String(req.headers['content-type'] ?? 'application/json') }, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json' }).end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise((ok) => (server.closeAllConnections(), server.close(() => ok()))) };
}

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
    // The record seller, reading the operators through two logging stand-ins.
    for (const u of demo.urls) proxies.push(await logged(u, requests));
    record = await startRecordSeller({ operators: (proxies as J[]).map((p) => p.url) });
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
    expect(work).toMatchObject({ record: 'holdback-deal-record/1', commitmentId: other, party: 'buyer' });
    expect(await balance(c.treasury)).toBe(5_000_000n);
    // Public reads only: every request the record seller sent was a GET.
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter((r) => !r.startsWith('GET '))).toEqual([]);
  }, 120_000);

  it('the record of another deal fails the checks of an offer for this one', async () => {
    const t = loadTermsFile(TERMS_FILE);
    const record = JSON.stringify({ record: 'holdback-deal-record/1', commitmentId: ID, party: 'buyer', writtenAt: '2026-11-14T20:00:00Z', operators: [{}, {}], terms: {}, outcome: {}, steps: [], delivery: {}, judgment: {}, settlement: {}, balances: {}, checks: [{ check: 'x', ok: true }], disagreements: [], row: { commitmentId: ID } });
    const accept = (deal: string) => preflightDelivery({ plaintext: new TextEncoder().encode(record), mime: 'application/json', format: 'application/json', acceptance: fill(t.acceptance, { deal }) as J }).result;
    expect(accept(ID)).toBe('accept');
    expect(accept(other)).toBe('reject');
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
