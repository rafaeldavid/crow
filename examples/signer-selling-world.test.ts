// The seller adapter signing through Crow's signer (T-443), against the public demo's own world on SimChain served in
// this process: the adapter runs with CROW_SIGNER_URL and no HOLDBACK_KEY, so it holds no key; the signer holds the
// selling key in its own process. A buyer that is not Crow's quotes, funds, and gets the work; the release pays Crow's
// payout address. The adapter refuses to start with a key beside a signer, or with per-deal keys.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeKeys } from './buyer-signer.ts';
import { config as shipped, startSellerAdapter, type RunningAdapter } from './seller-adapter.ts';
import { startStubSellerApi, type StubSellerApi } from './seller-adapter-stub.ts';
import { cast, cleanup, mandateFor, sellingMandateFor, sellingRulesFor, startSigner, type Cast, type Running } from './signer-test-kit.ts';
import { serveTwoOrigins, type TwoOrigins } from './two-origins.ts';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { jcsHash, SIMCHAIN_DOMAIN, typedOf } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const SCOPE = { commit: 'a'.repeat(40), files: ['contracts/Vault.sol'], lines: 300 };
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'crow-selling-'));
  dirs.push(d);
  return d;
};

let demo: TwoOrigins, discovery: J, stub: StubSellerApi, c: Cast, s: Running;
const adapters: RunningAdapter[] = [];
const deals = async (party: string) => (((await (await fetch(`${demo.urls[0]}/v1/commitments?party=${party}`)).json()) as J).items?.length ?? 0) as number;
const balance = async (a: string) => BigInt(((await (await fetch(`${demo.urls[1]}/v1/balances/${a}`)).json()) as J).amount ?? '0');
const adapterConfig = (o: J = {}) => ({ ...shipped, port: 0, sellerApi: stub.api, journal: join(tmp(), 'journal.json'), pollMs: 50, log: () => {}, ...o });

beforeAll(async () => {
  const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '0', OPERATOR_FEE_MIN: '0' }, faucetPerClient: 100, telemetryLog: () => {} });
  demo = await serveTwoOrigins(world, { tickMs: 100 });
  discovery = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
  const token = discovery.demo.token.id;
  stub = await startStubSellerApi({ port: 0, token, quoteOverride: { price: { token, amount: '5000000' } } });
  // A probe: the same adapter with a throwaway key shows the product, the reviewers and the club its offers carry,
  // which Crow's administrator writes into the signer's rules once.
  const probe = await startSellerAdapter(adapterConfig({ payoutAddress: undefined }), { HOLDBACK_KEY: generatePrivateKey(), HOLDBACK_OPERATORS: demo.urls.join(',') });
  const buyer = await makeKeys(tmp(), { operators: demo.urls, log: () => {} });
  const q = await buyer.quote(`${probe.url}/quote`, SCOPE);
  const t = (await (await fetch(`${demo.urls[0]}/v1/commitments/${q.commitmentId}/terms`)).json()) as J;
  await probe.close();
  c = cast();
  const a = t.adjudication;
  const rules = sellingRulesFor(c, {
    reads: demo.urls, clubId: t.clubId, rulebookHash: t.rulebookHash,
    reviewers: { adjudicator: a.adjudicator, fallbackAdjudicator: a.fallbackAdjudicator, appealAdjudicator: a.appealAdjudicator, policyId: a.policyId, policyHash: a.policyHash, registryHash: a.registryHash, fee: a.fee.amount },
    products: [{ deliverable: t.deliverable, acceptance: t.acceptance }],
  });
  // The adapter's own windows, as the signer pins them: the shipped configuration's (the design's S4 values are for Crow's own product, T-444).
  const created = Date.parse(t.createdAt), sec = (k: string, from: number) => (Date.parse(t.timing[k]) - from) / 1000;
  rules.selling.windows = { offerExpiresInSec: sec('offerExpiresAt', created), fundWithinSec: sec('fundBy', created), deliverWithinSec: sec('deliverBy', created), judgeWithinSec: sec('judgeBy', Date.parse(t.timing.deliverBy)), fallbackWithinSec: sec('fallbackBy', Date.parse(t.timing.judgeBy)) };
  rules.selling.terms = { ...rules.selling.terms, appealDecideSec: t.timing.appealDecideSec, appealWindowSec: t.timing.appealWindowSec };
  rules.buying.reviewers = rules.selling.reviewers;
  s = await startSigner(c, rules, await mandateFor(c), { sellingMandate: await sellingMandateFor(c) });
  dirs.push(s.dir);
  void jcsHash;
}, 60_000);
afterAll(async () => {
  for (const a of adapters) await a.close();
  await s?.kill();
  await stub?.close();
  await demo?.close();
  cleanup(dirs);
});

describe('the seller adapter through the signer', () => {
  it('holds no key: every offer and delivery is the selling key\'s; a buyer funds and is delivered; the release pays Crow\'s payout address', async () => {
    const lines: string[] = [];
    const adapter = await startSellerAdapter(adapterConfig({ payoutAddress: c.treasury, log: (l: string) => lines.push(l) }), { CROW_SIGNER_URL: s.url, HOLDBACK_OPERATORS: demo.urls.join(',') });
    adapters.push(adapter);
    const buyer = await makeKeys(tmp(), { operators: demo.urls, log: () => {} });
    const q = await buyer.quote(`${adapter.url}/quote`, SCOPE);
    const offer = await buyer.readOffer(q.commitmentId);
    expect(offer).toMatchObject({ seller: c.sellingAddress, sellerPayoutAddress: c.treasury });
    await buyer.checkOffer(q.commitmentId, offer);
    await buyer.testFunds(offer.fees.total.amount);
    await buyer.agreeAndFund(q.commitmentId);
    const done = await buyer.openDelivery(q.commitmentId, { onReport: () => {} });
    expect(done.outcome).toBe('Released');
    expect(await balance(c.treasury)).toBe(5_000_000n);
    const status = (await s.get('/v1/status')).body;
    expect(status.selling).toMatchObject({ delivered: 1, offersToday: 1 });
  }, 90_000);

  it('a quote the signer refuses makes no offer: the adapter answers 502 and signs nothing itself', async () => {
    const adapter = await startSellerAdapter(adapterConfig({ payoutAddress: `0x${'77'.repeat(20)}` }), { CROW_SIGNER_URL: s.url, HOLDBACK_OPERATORS: demo.urls.join(',') });
    adapters.push(adapter);
    const before = await deals(c.sellingAddress);
    const buyer = await makeKeys(tmp(), { operators: demo.urls, log: () => {} });
    const res = await fetch(`${adapter.url}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: SCOPE }) });
    expect(res.status).toBe(502);
    expect(await deals(c.sellingAddress)).toBe(before);
  });

  it('a signature that is not the selling key\'s, from a signer that lies, is never sent: no offer is made', async () => {
    const liar = privateKeyToAccount(generatePrivateKey());
    const fake = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const x of req) chunks.push(x as Buffer);
      const send = (b: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(b));
      if (req.url === '/v1/status') return send({ sellingAddress: c.sellingAddress });
      const body = JSON.parse(Buffer.concat(chunks).toString()) as J;
      send({ signature: await liar.signTypedData(typedOf('CommitmentTerms', body.terms, SIMCHAIN_DOMAIN)) });
    });
    await new Promise<void>((ok) => fake.listen(0, '127.0.0.1', ok));
    try {
      const adapter = await startSellerAdapter(adapterConfig({ payoutAddress: c.treasury }), { CROW_SIGNER_URL: `http://127.0.0.1:${(fake.address() as AddressInfo).port}`, HOLDBACK_OPERATORS: demo.urls.join(',') });
      adapters.push(adapter);
      const before = await deals(c.sellingAddress);
      const buyer = await makeKeys(tmp(), { operators: demo.urls, log: () => {} });
      const res = await fetch(`${adapter.url}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: SCOPE }) });
      expect(res.status).toBe(502);
      expect(await deals(c.sellingAddress)).toBe(before);
    } finally {
      fake.closeAllConnections();
      await new Promise<void>((ok) => fake.close(() => ok()));
    }
  });

  it('a delivery whose send fails after the signer signed it is sent again, the same body, and the deal releases', async () => {
    // A stand-in in front of the first operator answers the first delivery send 503; everything else passes through.
    let failed = 0;
    const proxy = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const x of req) chunks.push(x as Buffer);
      if (req.method === 'POST' && /^\/v1\/commitments\/0x[0-9a-f]{64}\/deliver/.test(req.url ?? '') && failed === 0) return void (failed++, res.writeHead(503, { 'content-type': 'application/json' }).end('{"type":"unavailable"}'));
      const r = await fetch(`${demo.urls[0]}${req.url}`, { method: req.method!, headers: { 'content-type': String(req.headers['content-type'] ?? 'application/json'), ...(req.headers['idempotency-key'] ? { 'idempotency-key': String(req.headers['idempotency-key']) } : {}) }, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json' }).end(Buffer.from(await r.arrayBuffer()));
    });
    await new Promise<void>((ok) => proxy.listen(0, '127.0.0.1', ok));
    try {
      const operators = [`http://127.0.0.1:${(proxy.address() as AddressInfo).port}`, demo.urls[1]!];
      const adapter = await startSellerAdapter(adapterConfig({ payoutAddress: c.treasury }), { CROW_SIGNER_URL: s.url, HOLDBACK_OPERATORS: operators.join(',') });
      adapters.push(adapter);
      const buyer = await makeKeys(tmp(), { operators: demo.urls, log: () => {} });
      const q = await buyer.quote(`${adapter.url}/quote`, SCOPE);
      const offer = await buyer.readOffer(q.commitmentId);
      await buyer.checkOffer(q.commitmentId, offer);
      await buyer.testFunds(offer.fees.total.amount);
      await buyer.agreeAndFund(q.commitmentId);
      const done = await buyer.openDelivery(q.commitmentId, { onReport: () => {} });
      expect(done.outcome).toBe('Released');
      expect(failed).toBe(1);
    } finally {
      proxy.closeAllConnections();
      await new Promise<void>((ok) => proxy.close(() => ok()));
    }
  }, 90_000);

  it('refuses to start with HOLDBACK_KEY beside a signer, or with per-deal keys', async () => {
    await expect(startSellerAdapter(adapterConfig(), { CROW_SIGNER_URL: s.url, HOLDBACK_KEY: generatePrivateKey(), HOLDBACK_OPERATORS: demo.urls.join(',') })).rejects.toThrow(/with a signer the adapter holds no key: unset HOLDBACK_KEY/);
    await expect(startSellerAdapter(adapterConfig({ signingKey: 'per-deal' }), { CROW_SIGNER_URL: s.url, HOLDBACK_OPERATORS: demo.urls.join(',') })).rejects.toThrow(/signingKey "per-deal"/);
  });
});
