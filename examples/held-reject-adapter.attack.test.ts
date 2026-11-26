// T-625 red team: attacks on GET /deals/<id>/delivery, the route the seller adapter uses to hand the deal's buyer its
// signed delivery while the primary's reject is held (ADR-0051 amendment). Each test states the outcome the defense
// should give. A test that fails here is a finding, not a broken fixture.
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import type { Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { deliveryFrom, heldView } from './held-reject.ts';
import { config as shipped, startSellerAdapter, type RunningAdapter, type SellerAdapterConfig } from './seller-adapter.ts';
import { startStubSellerApi, type StubSellerApi } from './seller-adapter-stub.ts';
import { openOwnEnvelope } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const SAMPLE = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/data/audit-report/report.json', import.meta.url)), 'utf8'));
const SMALL = { commit: SAMPLE.commit as string, files: SAMPLE.filesReviewed as string[], lines: 3000 };

/**
 * A pass-through proxy in front of one operator. When `lie` is set it answers the deal's state read with
 * `Delivered` and its judgment read with a primary reject, as a stale or dishonest operator would. It counts reads.
 */
async function proxy(target: string) {
  const o = { lie: undefined as undefined | { id: string; state: J; record: J }, reads: [] as string[], failPostOnce: undefined as undefined | RegExp, failed: [] as string[] };
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const path = req.url ?? '/';
    if (req.method === 'GET') o.reads.push(path);
    if (o.failPostOnce && req.method === 'POST' && o.failPostOnce.test(path)) {
      o.failPostOnce = undefined;
      o.failed.push(path);
      return void res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'unavailable', detail: 'red team: this POST never reached the operator' }));
    }
    if (o.lie && req.method === 'GET' && path === `/v1/commitments/${o.lie.id}`) return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o.lie.state));
    if (o.lie && req.method === 'GET' && path === `/v1/commitments/${o.lie.id}/judgment`) return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o.lie.record));
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && k !== 'host' && k !== 'content-length') headers[k] = v;
    const r = await fetch(`${target}${path}`, { method: req.method ?? "GET", headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    const body = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json' }).end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { ...o, o, url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

let world: SimWorld;
let stub: StubSellerApi | undefined;
const adapters: RunningAdapter[] = [];
const closers: Array<() => Promise<void>> = [];
const dirs: string[] = [];
const acct = (label: string) => world.info.accounts.find((a) => a.label === label)!;
const agent = (label: string) => new Agent(world.info.operators, acct(label).privateKey as Hex, Buffer.from(acct(label).encryptionSecretKey, 'base64url'));
/** A fresh funded account from the sim service, for tests past the two labelled buyers. */
const fresh = async () => {
  const a = (await (await fetch(`${world.url}/accounts`, { method: 'POST' })).json()) as J;
  return new Agent(world.info.operators, a.privateKey as Hex, Buffer.from(a.encryptionSecretKey, 'base64url'));
};
beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {} });
});
afterAll(async () => {
  await world.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
afterEach(async () => {
  for (const a of adapters.splice(0)) await a.close();
  for (const c of closers.splice(0)) await c();
  await stub?.close();
  stub = undefined;
});

/** A held rubric deal, as in held-reject-adapter.test.ts, with the adapter's first operator behind a proxy. */
async function heldDeal(buyerLabel: string, over: Partial<SellerAdapterConfig> = {}) {
  const p = await proxy(world.info.operators[0]!);
  closers.push(p.close);
  stub = await startStubSellerApi({ port: 0, pollsUntilComplete: 0, report: 'fail-me' });
  const [primary, fallback, appeal] = world.info.adjudicators.map((a) => a.address);
  const dir = mkdtempSync(join(tmpdir(), 't625-attack-'));
  dirs.push(dir);
  const running = await startSellerAdapter(
    { ...shipped, port: 0, sellerApi: stub.api, clubId: world.info.clubId, adjudicators: { primary: primary!, fallback: fallback!, appeal: appeal! }, journal: join(dir, 'journal.json'), pollMs: 50, log: () => {}, ...over },
    { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: [p.url, world.info.operators[1]!].join(',') },
  );
  adapters.push(running);
  const buyer = world.info.accounts.some((a) => a.label === buyerLabel) ? agent(buyerLabel) : await fresh();
  const res = await fetch(`${running.url}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: SMALL, options: { panel: true } }) });
  const quote = (await res.json()) as J;
  expect(res.status, JSON.stringify(quote)).toBe(200);
  const id = quote.commitmentId as Hex;
  await buyer.waitFor(id, ['AcceptedByAdjudicator']);
  const terms = await buyer.call('GET', `/v1/commitments/${id}/terms`);
  delete terms.id;
  delete terms.signatures;
  await buyer.agreeAndFund(terms, 6_000_000_000n);
  let view = await heldView(buyer, id);
  for (const end = Date.now() + 30_000; !view.held && Date.now() < end; view = await heldView(buyer, id)) await new Promise((r) => setTimeout(r, 100));
  return { running, buyer, id, view, terms, p };
}

describe('attack.share-delivery: who gets the seller\'s signed delivery (T-625)', () => {
  // Expected outcome: once the held reject is signed and the deal is Refunded, the adapter shares nothing, even when its
  // first operator still answers Delivered and the primary's reject (a stale node, or a node that lies). The adapter's
  // other gates (events before a delivery, settlement time) read every operator through Agent.trusted for that reason.
  it('attack.share-delivery-one-stale-operator: a refunded deal is not shared on one operator\'s stale answer', async () => {
    const { running, buyer, id, view, terms, p } = await heldDeal('buyer-1');
    expect(view).toMatchObject({ escrowState: 'Delivered', held: true });
    // What the first operator said during the hold: kept, as a stale node keeps it.
    const staleState = await buyer.call('GET', `/v1/commitments/${id}`);
    const staleRecord = await buyer.call('GET', `/v1/commitments/${id}/judgment`);
    expect(staleRecord).toMatchObject({ role: 'primary', aggregate: { decision: 'reject' } });
    // The hold ends: the primary signs its reject and the buyer is refunded.
    world.advance(87_000);
    expect((await buyer.waitFor(id, ['Refunded'], 60_000)).escrowState).toBe('Refunded');
    // Honest operators: the adapter shares nothing now.
    await expect(deliveryFrom(buyer, running.url, id)).rejects.toThrow(/404/);
    // One operator answers its stale view.
    p.o.lie = { id, state: staleState, record: staleRecord };
    let shared: J = null;
    try {
      shared = await deliveryFrom(buyer, running.url, id);
    } catch {
      shared = null;
    }
    if (shared) {
      // The finding, measured: the refunded buyer opens its own envelope and holds the work as well as its money.
      const opened = await openOwnEnvelope(await buyer.envelopeMaterial(terms, shared));
      expect(opened.deliveryHash).toBeTruthy();
    }
    expect(shared, 'the adapter handed a refunded deal\'s delivery to the buyer on one stale operator\'s answer').toBeNull();
  }, 120_000);

  // Expected outcome: a request the buyer signed once is not a bearer credential for anyone who sees the URL (proxy
  // logs, a browser history, a shared terminal). Measured here: anyone replaying the URL within 300 s gets the body.
  it('attack.share-delivery-replayed-url: a third party replaying the buyer\'s signed URL gets 404', async () => {
    const { running, buyer, id } = await heldDeal('buyer-2');
    const at = Math.floor(Date.now() / 1000);
    const nonce = 'aa'.repeat(16);
    const signature = await buyer.account.signMessage({ message: `crow.delivery:${id}:${at}:${nonce}` });
    const url = `${running.url}/deals/${id}/delivery?at=${at}&nonce=${nonce}&signature=${signature}`;
    expect((await fetch(url)).status).toBe(200); // the buyer
    const replay = await fetch(url, { headers: { 'x-forwarded-for': '203.0.113.9' } }); // anyone else with the URL
    expect(replay.status, 'a replayed URL is answered with the signed delivery').toBe(404);
  }, 90_000);

  // Expected outcome: one signed request costs the seller's operators a bounded number of reads, and a loop of requests
  // does not spend the read budget the adapter's own deal loop needs (1,200 reads a minute per client, per operator).
  it('attack.share-delivery-read-amplification: a burst of 50 signed requests costs at most 10 decisions, the rest 429', async () => {
    const { running, buyer, id, p } = await heldDeal('buyer-3');
    const at = Math.floor(Date.now() / 1000);
    // Fixed (M2): 50 requests, each signed with its own nonce, share one decision and its reads.
    const urls = await Promise.all(Array.from({ length: 50 }, async (_, i) => {
      const nonce = i.toString(16).padStart(16, '0');
      const signature = await buyer.account.signMessage({ message: `crow.delivery:${id}:${at}:${nonce}` });
      return `${running.url}/deals/${id}/delivery?at=${at}&nonce=${nonce}&signature=${signature}`;
    }));
    const before = p.o.reads.filter((r) => r.startsWith(`/v1/commitments/${id}`)).length;
    const statuses = await Promise.all(urls.map((u) => fetch(u).then((r) => r.status)));
    const after = p.o.reads.filter((r) => r.startsWith(`/v1/commitments/${id}`)).length;
    // Fixed (M2): each deal takes at most 10 decisions a minute (two reads each at this operator); the rest answer 429.
    expect(statuses.every((s) => s === 200 || s === 429), statuses.join(',')).toBe(true);
    expect(statuses).toContain(200);
    expect(after - before, `${after - before} operator reads for 50 delivery requests`).toBeLessThanOrEqual(20);
  }, 90_000);

  // Expected outcome (fail closed, PASS if it holds): a key other than the terms' buyer never gets the body, with any
  // casing of the deal's ID and any signature encoding the route accepts.
  it('attack.share-delivery-stranger: another key, an upper-case ID or a future time gets 404', async () => {
    const { running, buyer, id } = await heldDeal('buyer-4');
    const stranger = new Agent(world.info.operators, generatePrivateKey(), new Uint8Array(32));
    const at = Math.floor(Date.now() / 1000);
    const n = (i: number) => i.toString(16).padStart(16, '0');
    const url = (deal: string, t: number, nonce: string, sig: string) => `${running.url}/deals/${deal}/delivery?at=${t}&nonce=${nonce}&signature=${sig}`;
    const theirs = await stranger.account.signMessage({ message: `crow.delivery:${id}:${at}:${n(1)}` });
    expect((await fetch(url(id, at, n(1), theirs))).status).toBe(404);
    const upper = `0x${id.slice(2).toUpperCase()}`;
    const mine = await buyer.account.signMessage({ message: `crow.delivery:${id}:${at}:${n(2)}` });
    expect((await fetch(url(upper, at, n(2), mine))).status).toBe(200); // the ID is normalised
    const signedUpper = await buyer.account.signMessage({ message: `crow.delivery:${upper}:${at}:${n(3)}` });
    expect((await fetch(url(upper, at, n(3), signedUpper))).status).toBe(404);
    const future = at + 3_600;
    const late = await buyer.account.signMessage({ message: `crow.delivery:${id}:${future}:${n(4)}` });
    expect((await fetch(url(id, future, n(4), late))).status).toBe(404);
    // No nonce: refused, whatever the signature.
    const bare = await buyer.account.signMessage({ message: `crow.delivery:${id}:${at}` });
    expect((await fetch(`${running.url}/deals/${id}/delivery?at=${at}&signature=${bare}`)).status).toBe(404);
  }, 90_000);

  // Fixed (L2): the route recovers the signature before it reads the journal, so a deal it holds and one it does not
  // cost the same work for a stranger. A wall-clock threshold would be flaky on a loaded machine, so this checks what an
  // outsider reads: the same 404 answer for a held deal and an unknown one.
  it('attack.share-delivery-no-oracle: a stranger gets the same 404 for a held deal and an unknown deal', async () => {
    const { running, id } = await heldDeal('buyer-5');
    const stranger = new Agent(world.info.operators, generatePrivateKey(), new Uint8Array(32));
    const unknown = `0x${'ab'.repeat(32)}`;
    const answer = async (deal: string, i: number) => {
      const at = Math.floor(Date.now() / 1000);
      const nonce = i.toString(16).padStart(16, '0');
      const signature = await stranger.account.signMessage({ message: `crow.delivery:${deal}:${at}:${nonce}` });
      const r = await fetch(`${running.url}/deals/${deal}/delivery?at=${at}&nonce=${nonce}&signature=${signature}`);
      return [r.status, await r.text()];
    };
    expect(await answer(id, 1)).toEqual(await answer(unknown, 2));
  }, 90_000);

  // Expected outcome: the journal and the seller's alert name the bytes the settlement layer holds. A delivery whose
  // send failed is kept signed and sent again; if the seller's API answers other bytes on the next pass (a fixed or
  // regenerated report), the adapter must not record those bytes as delivered.
  it('attack.share-delivery-resend-records-other-bytes: after a failed send, the journal names the delivered bytes', async () => {
    const p = await proxy(world.info.operators[0]!);
    closers.push(p.close);
    stub = await startStubSellerApi({ port: 0, pollsUntilComplete: 0, report: 'fail-me' });
    const [primary, fallback, appeal] = world.info.adjudicators.map((a) => a.address);
    const dir = mkdtempSync(join(tmpdir(), 't625-attack-'));
    dirs.push(dir);
    const lines: string[] = [];
    // The first delivery POST fails before it reaches the operator; the seller's API then answers the other report.
    p.o.failPostOnce = /^\/v1\/commitments\/0x[0-9a-f]{64}\/deliver/;
    const s = stub;
    const running = await startSellerAdapter(
      { ...shipped, port: 0, sellerApi: stub.api, clubId: world.info.clubId, adjudicators: { primary: primary!, fallback: fallback!, appeal: appeal! }, journal: join(dir, 'journal.json'), pollMs: 50, log: (l: string) => { lines.push(l); if (/deliver/.test(l) && p.o.failed.length) s.setReport('ok'); } },
      { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: [p.url, world.info.operators[1]!].join(',') },
    );
    adapters.push(running);
    const buyer = await fresh();
    const res = await fetch(`${running.url}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: SMALL, options: { panel: true } }) });
    const quote = (await res.json()) as J;
    expect(res.status, JSON.stringify(quote)).toBe(200);
    const id = quote.commitmentId as Hex;
    await buyer.waitFor(id, ['AcceptedByAdjudicator']);
    const terms = await buyer.call('GET', `/v1/commitments/${id}/terms`);
    delete terms.id;
    delete terms.signatures;
    await buyer.agreeAndFund(terms, 6_000_000_000n);
    await buyer.waitFor(id, ['Delivered', 'Released', 'Refunded'], 30_000);
    for (const end = Date.now() + 10_000; Date.now() < end && running.deals().find((d) => d.id === id)?.stage !== 'delivered'; ) await new Promise((r) => setTimeout(r, 50));
    expect(p.o.failed.length, 'the first delivery POST was failed').toBe(1);
    const posted = (await buyer.call('GET', `/v1/commitments/${id}/events?limit=200`)).items.find((e: J) => e.type === 'delivery.submitted').payload;
    const deal = running.deals().find((d) => d.id === id) as J;
    const note = String(deal.note);
    const said = lines.filter((l) => l.includes(id) && /preflight|deliver/.test(l)).join(' | ');
    expect(note, `delivered ${posted.plaintextSha256}; the journal says "${note}"; the log says ${said.slice(0, 400)}`).toContain(String(posted.plaintextSha256).replace(/^sha256:/, ''));
  }, 90_000);
});
