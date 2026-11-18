// T-503: the seller signs a full refund. POST /deals/<id>/refund, behind the ready credential, makes the seller sign a
// MutualSettlement that pays the whole price back to the buyer's payment address, names no delivery and releases no
// key, for a deal every operator reads Held. The buyer signs the same message over the public API and either party
// submits it. Deals run on SimChain against the job stub; a failing artifacts call keeps a deal Held and undelivered.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAddressEqual, recoverTypedDataAddress, type Hex } from 'viem';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { loadConfig, startSellerAdapter, type RunningAdapter } from './seller-adapter.ts';
import { jobStubSellerApi, startJobStub, type JobStub, type JobStubOptions } from './seller-adapter-job-stub.ts';
import { typedOf } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const KEY = 'refund-test-credential-4b2d';
const READY = 'refund-ready-credential-8c3e';
const WS = 'ws-alpha';
const SCOPE = { target: 'vault-core', depth: 2 };
const SCOPE_RULES = { target: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' }, depth: { type: 'integer', min: 1, max: 10 } };
const TEMPLATE = {
  deliverable: { kind: 'document', description: 'A review of {{target}} to depth {{depth}}.', format: 'application/json' },
  checks: [{ id: 'report', type: 'json_schema', required: true, schema: { type: 'object', required: ['summary', 'target', 'notes'], properties: { target: { const: '{{target}}' }, notes: { type: 'array', minItems: 1 } } } }],
};

function api(base: string): J {
  const a = jobStubSellerApi(base);
  delete a.result.files;
  a.quote.path = 'workspaces/{{workspace}}/estimates';
  a.start.path = 'workspaces/{{workspace}}/runs';
  a.workspace = { id: WS, resultPointer: '/run/workspace' };
  a.result.merge = { path: 'runs/{{jobId}}/notes', into: '/output/notes' };
  return a;
}

/** One operator that rewrites the prepare request it relays (red team, T-503): the seller must not sign its answer. */
interface Liar { url: string; lie?: (body: J) => J; close(): Promise<void> }
async function liar(upstream: string): Promise<Liar> {
  const me: Liar = { url: '', close: async () => {} };
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: Buffer | undefined = chunks.length ? Buffer.concat(chunks) : undefined;
    if (body && me.lie && req.url === '/v1/prepare/settlement') body = Buffer.from(JSON.stringify(me.lie(JSON.parse(body.toString('utf8')))));
    const headers: Record<string, string> = { 'content-type': req.headers['content-type'] ?? 'application/json' };
    if (req.headers['idempotency-key']) headers['idempotency-key'] = String(req.headers['idempotency-key']);
    const r = await fetch(`${upstream}${req.url}`, { method: req.method!, headers, ...(body ? { body } : {}) });
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json' }).end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  me.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  me.close = () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); });
  return me;
}

let world: SimWorld;
let stub: JobStub | undefined;
const adapters: RunningAdapter[] = [];
const liars: Liar[] = [];
const acct = (label: string) => world.info.accounts.find((a) => a.label === label)!;
const agent = (label: string) => new Agent(world.info.operators, acct(label).privateKey as Hex, Buffer.from(acct(label).encryptionSecretKey, 'base64url'));

beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {} });
});
afterAll(() => world.close());
afterEach(async () => {
  for (const a of adapters.splice(0)) await a.close();
  for (const l of liars.splice(0)) await l.close();
  await stub?.close();
  stub = undefined;
});

async function adapter(o: Partial<JobStubOptions>, ready = true, operators: string[] = world.info.operators) {
  stub = await startJobStub({ key: KEY, readsUntilComplete: 1, workspaces: true, ...o });
  const dir = mkdtempSync(join(tmpdir(), 't503-'));
  writeFileSync(join(dir, 'template.json'), JSON.stringify(TEMPLATE));
  const file = join(dir, 'seller.json');
  const redelivery = ready ? { refetchEverySec: 0, readyAuth: { kind: 'bearer', env: 'READY_CREDENTIALS' } } : { refetchEverySec: 0 };
  writeFileSync(file, JSON.stringify({ port: 0, pollMs: 50, journal: join(dir, 'journal.json'), template: 'template.json', scope: SCOPE_RULES, redelivery, sellerApi: api(stub.base) }));
  const lines: string[] = [];
  const running = await startSellerAdapter({ ...loadConfig(file), log: (l) => lines.push(l) }, { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: operators.join(','), JOBS_API_KEY: KEY, ...(ready ? { READY_CREDENTIALS: READY } : {}) });
  adapters.push(running);
  return { running, lines };
}
async function quote(a: RunningAdapter, label: string): Promise<{ buyer: Agent; id: Hex; terms: J }> {
  const buyer = agent(label);
  const res = await fetch(`${a.url}/quote`, { method: 'POST', body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: SCOPE }) });
  const q = (await res.json()) as J;
  expect(res.status, JSON.stringify(q)).toBe(200);
  await buyer.waitFor(q.commitmentId, ['AcceptedByAdjudicator']);
  const terms = await buyer.call('GET', `/v1/commitments/${q.commitmentId}/terms`);
  delete terms.id;
  delete terms.signatures;
  return { buyer, id: q.commitmentId as Hex, terms };
}
async function until(what: string, ok: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) if (await ok()) return;
  throw new Error(`timed out waiting for ${what}`);
}
const dealOf = (a: RunningAdapter, id: Hex) => a.deals().find((d) => d.id === id);
/**
 * The refund route as a client calls it. A 409 `deal_busy` means the deal loop holds the deal for a moment (it still
 * works on the deal just after it records the refusal), and its detail says to send again; so does this, up to 5 s.
 * Every other answer comes back as it is (T-516).
 */
async function refund(a: RunningAdapter, id: Hex, o: { credential?: string | null; method?: string } = {}): Promise<Response> {
  for (let tries = 0; ; tries++) {
    const res = await fetch(`${a.url}/deals/${id}/refund`, { method: o.method ?? 'POST', headers: o.credential === null ? {} : { authorization: `Bearer ${o.credential ?? READY}` } });
    if (res.status !== 409 || tries === 50) return res;
    const body = (await res.clone().json().catch(() => null)) as J;
    if (body?.type !== 'deal_busy') return res;
    await new Promise((r) => setTimeout(r, 100));
  }
}
/** A funded deal the seller refused: Held, with nothing delivered. */
async function heldAndRefused(label = 'buyer-1', operators?: string[]) {
  const made = await adapter({ notesStatus: 500 }, true, operators);
  const { buyer, id, terms } = await quote(made.running, label);
  await buyer.agreeAndFund(terms, 2_100_000_000n);
  await until('the refusal', () => dealOf(made.running, id)?.stage === 'refused');
  return { ...made, buyer, id, terms };
}
/** What the buyer does over the public API: prepare the same message, check it, sign its slot, submit both signatures. */
async function buyerCountersigns(buyer: Agent, id: Hex, terms: J, s: J): Promise<J> {
  const prepared = await buyer.call('POST', '/v1/prepare/settlement', { commitmentId: id, nonce: s.nonce, payouts: s.payouts, releaseKey: false, expiresAt: s.expiresAt });
  const { path, body } = await buyer.sign(prepared, { kind: 'settlement', terms, payouts: s.payouts, releaseKey: false, deliveryHash: null, nonce: s.nonce });
  expect({ ...body, buyerSignature: null, sellerSignature: null }).toEqual({ ...s, buyerSignature: null, sellerSignature: null });
  return buyer.call('POST', path, { ...body, sellerSignature: s.sellerSignature });
}

describe('POST /deals/<id>/refund (T-503)', () => {
  it('signs a full refund to the buyer, closes the deal, and settles once the buyer signs too', async () => {
    const { running, lines, buyer, id, terms } = await heldAndRefused();
    const res = await refund(running, id);
    const a = (await res.json()) as J;
    expect(res.status, JSON.stringify(a)).toBe(200);
    const s = a.settlement;
    expect(a).toMatchObject({ commitmentId: id, submit: `/v1/commitments/${id}/settlements`, replayed: false, expiresAt: s.expiresAt });
    expect(s).toMatchObject({ type: 'MutualSettlement', commitmentId: id, deliveryHash: null, releaseKey: false, buyerSignature: null });
    expect(s.payouts).toEqual([{ to: terms.buyerPaymentAddress.toLowerCase(), amount: terms.price }]);
    const message = { type: s.type, commitmentId: s.commitmentId, deliveryHash: s.deliveryHash, payouts: s.payouts, releaseKey: s.releaseKey, nonce: s.nonce, expiresAt: s.expiresAt };
    const by = await recoverTypedDataAddress({ ...typedOf('MutualSettlement', message, buyer.domain), signature: s.sellerSignature });
    expect(isAddressEqual(by, terms.seller)).toBe(true);
    const hours = (Date.parse(s.expiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(22.5);
    expect(hours).toBeLessThan(23.5);
    expect(dealOf(running, id)).toMatchObject({ stage: 'closed', refund: { path: a.submit, body: s } });
    const log = lines.join('\n');
    expect(log).toContain(`${id} the seller signed a full refund: ${terms.price.amount} base units`);
    expect(log).toContain(s.sellerSignature);

    // Asked again, it answers the same settlement.
    const again = (await (await refund(running, id)).json()) as J;
    expect(again).toMatchObject({ replayed: true, settlement: s });

    expect((await buyerCountersigns(buyer, id, terms, s)).escrowState).toBe('Settled');
    const settled = (await buyer.call('GET', `/v1/commitments/${id}/events?limit=200`)).items.filter((e: J) => e.type === 'commitment.settled').at(-1);
    expect(settled.payload).toMatchObject({ keyReleased: false });
    expect(settled.payload.payouts).toEqual([expect.objectContaining({ to: terms.buyerPaymentAddress.toLowerCase(), amount: terms.price })]);

    // Settled now: nothing more is signed.
    const after = await refund(running, id);
    expect(after.status).toBe(409);
    expect(((await after.json()) as J).type).toBe('not_held');
  }, 60_000);

  it('answers two requests at once with one settlement', async () => {
    const { running, id } = await heldAndRefused('buyer-2');
    const [a, b] = await Promise.all([refund(running, id), refund(running, id)]);
    const [x, y] = [(await a.json()) as J, (await b.json()) as J];
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(y.settlement).toEqual(x.settlement);
  }, 60_000);

  it('signs nothing for a deal that is not Held, or was delivered', async () => {
    const { running, lines } = await adapter({});
    const unfunded = await quote(running, 'buyer-1');
    const r1 = await refund(running, unfunded.id);
    expect(r1.status).toBe(409);
    expect(((await r1.json()) as J).detail).toMatch(/every operator reads the deal AcceptedByAdjudicator/);

    const funded = await quote(running, 'buyer-2');
    await funded.buyer.agreeAndFund(funded.terms, 2_100_000_000n);
    expect((await funded.buyer.waitFor(funded.id, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
    await until('the delivery', () => dealOf(running, funded.id)?.stage === 'delivered');
    const r2 = await refund(running, funded.id);
    expect(r2.status).toBe(409);
    expect(((await r2.json()) as J).type).toBe('delivered');
    expect(lines.join('\n')).not.toContain('signed a full refund');
  }, 60_000);

  it('takes the ready credential, POST only, and a deal it holds', async () => {
    const { running, id } = await heldAndRefused();
    expect((await refund(running, id, { credential: null })).status).toBe(401);
    expect((await refund(running, id, { credential: 'not-the-credential' })).status).toBe(401);
    expect((await refund(running, id, { method: 'GET' })).status).toBe(405);
    expect((await refund(running, `0x${'ab'.repeat(32)}` as Hex)).status).toBe(404);
    expect(dealOf(running, id)?.stage).toBe('refused');
  }, 60_000);

  it('passes over an operator that prepares another refund, and signs the one the other prepares', async () => {
    const first = await liar(world.info.operators[0]!);
    liars.push(first);
    const { running, lines, buyer, id, terms } = await heldAndRefused('buyer-1', [first.url, world.info.operators[1]!]);
    // A consistent lie the signer's own check accepts: a full refund that expires in 15 s, not the 23 h asked for.
    first.lie = (b) => ({ ...b, expiresAt: new Date(Date.parse(b.expiresAt) - 23 * 3_600_000 + 15_000).toISOString().replace('.000Z', 'Z') });
    const a = (await (await refund(running, id)).json()) as J;
    expect((Date.parse(a.settlement.expiresAt) - Date.now()) / 3_600_000).toBeGreaterThan(22.5);
    // And one it refuses: the whole price to the seller.
    const second = await heldAndRefused('buyer-2', [first.url, world.info.operators[1]!]);
    first.lie = (b) => ({ ...b, payouts: [{ to: second.terms.sellerPayoutAddress, amount: second.terms.price }] });
    const b = (await (await refund(second.running, second.id)).json()) as J;
    expect(b.settlement.payouts).toEqual([{ to: second.terms.buyerPaymentAddress.toLowerCase(), amount: second.terms.price }]);
    expect((await buyerCountersigns(buyer, id, terms, a.settlement)).escrowState).toBe('Settled');
    expect(lines.join('\n')).toContain(`ALERT ${id} refund.signed`);
  }, 90_000);

  it('signs nothing and keeps the deal open when every operator prepares another refund', async () => {
    const both = [await liar(world.info.operators[0]!), await liar(world.info.operators[1]!)];
    liars.push(...both);
    const { running, lines, id, terms } = await heldAndRefused('buyer-1', both.map((l) => l.url));
    for (const l of both) l.lie = (b) => ({ ...b, payouts: [{ to: terms.sellerPayoutAddress, amount: terms.price }] });
    const res = await refund(running, id);
    expect(res.status).toBe(502);
    expect(((await res.json()) as J).type).toBe('not_signed');
    expect(dealOf(running, id)).toMatchObject({ stage: 'refused' });
    expect(dealOf(running, id)?.refund).toBeUndefined();
    expect(lines.join('\n')).not.toContain('signed a full refund');
  }, 60_000);

  it('is not served without a ready credential', async () => {
    const { running } = await adapter({}, false);
    expect((await refund(running, `0x${'ab'.repeat(32)}` as Hex)).status).toBe(404);
  }, 30_000);
});
