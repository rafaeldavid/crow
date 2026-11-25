// T-609: a write survives an RPC node that fails one chain read, and when it cannot, the answer says what is true and
// the node logs why. On 2026-11-25 outside clients got a bare 500 `internal` on offers and on funded agreements. The
// demo world runs here as two operator nodes over anvil, with a JSON-RPC stand-in between the relayer and anvil that
// answers chosen calls with "header not found", as a load-balanced RPC node that trails the head does (T-232).
// No network and no secret. Needs `anvil` on PATH and `forge build` output.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { canonicalKeccak } from '@holdback/core';
import { LiveChain, type DeploymentFile } from '@holdback/settlement/live';
import { EvmWorld } from '@holdback/settlement/evm';
import type { Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deploymentOf, lc, party, PRICE, ready, RELAYER, root, serve, sleep, untilBoth, type J } from '../test/anvil.ts';
import { MemoryStorage, PublicWorld } from './index.js';

/** Production's schedule: published, and zero (T-389). */
const ENV = { OPERATOR_FEE_BPS: '0', OPERATOR_FEE_MIN: '0', OPERATOR_FEE_GAS: '0' };

type Rpc = { id: number; method: string; params?: unknown[] };
/** One fault: the calls `match` names answer "header not found", `left` times. */
interface Fault {
  match: (r: Rpc) => boolean;
  left: number;
  hits: number;
}

/** A JSON-RPC stand-in in front of `upstream`: it forwards every call but the ones the armed fault names. */
async function faultyRpc(upstream: string): Promise<{ url: string; arm(match: Fault['match'], times: number): Fault; clear(): void; close(): Promise<void> }> {
  let fault: Fault | undefined;
  const forward = (body: unknown) => fetch(upstream, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<unknown>);
  const one = async (r: Rpc) => {
    if (fault && fault.left > 0 && fault.match(r)) {
      fault.left--;
      fault.hits++;
      return { jsonrpc: '2.0', id: r.id, error: { code: -32000, message: 'header not found' } };
    }
    return forward(r);
  };
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Rpc | Rpc[];
    const out = Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    arm: (match, times) => (fault = { match, left: times, hits: 0 }),
    clear: () => (fault = undefined),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const codeOf = (address: string) => (r: Rpc) => r.method === 'eth_getCode' && lc(String(r.params?.[0])) === lc(address);
const balanceOf = (token: string, owner: string) => (r: Rpc) => {
  const call = r.params?.[0] as { to?: string; data?: string; input?: string } | undefined;
  return r.method === 'eth_call' && lc(call?.to ?? '') === lc(token) && lc(call?.data ?? call?.input ?? '') === `0x70a08231${lc(owner).slice(2).padStart(64, '0')}`;
};
const receipts = (r: Rpc) => r.method === 'eth_getTransactionReceipt';

describe.skipIf(!ready)(`operator writes over an RPC that fails a read (anvil; T-609)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let deployment: DeploymentFile;
  let rpc: Awaited<ReturnType<typeof faultyRpc>>;
  let demo: Awaited<ReturnType<typeof serve>>;
  let chain: LiveChain;
  let discovery: J;
  const errors: string[] = [];

  beforeAll(async () => {
    anvil = await EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
    deployment = deploymentOf(anvil);
    rpc = await faultyRpc(anvil.rpcUrl);
    chain = new LiveChain({ deployment, rpcUrls: [rpc.url], relayerKey: RELAYER, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
    const storage = new MemoryStorage();
    const world = await PublicWorld.open({ storage, env: ENV, live: { chain }, minWindowSec: 5, faucetPerClient: 100, onError: (e) => errors.push(e.message) });
    const { start } = (await storage.get<{ start: string }>('meta'))!;
    await anvil.fresh(canonicalKeccak({ sim: 'holdback/demo-cloud/v1', start }));
    demo = await serve(world);
    for (const end = Date.now() + 90_000; !world.ready() && Date.now() < end; ) await sleep(250);
    expect(world.ready()).toBe(true);
    discovery = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
  }, 180_000);
  afterAll(async () => {
    await demo?.close();
    await rpc?.close();
    await anvil?.stop();
  });

  const post = async (path: string, body: unknown, key: string) => {
    const res = await fetch(`${demo.urls[0]}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) });
    return { status: res.status, retryAfter: res.headers.get('retry-after'), body: (await res.json()) as J };
  };

  /** A buyer and a seller with test tokens, and a checks-only public offer the seller signed, not yet posted. */
  const signedOffer = async () => {
    const [b, s] = [party(demo.urls, deployment), party(demo.urls, deployment)];
    for (const a of [b.agent, s.agent]) await a.call('POST', '/v1/faucet', { address: a.address });
    const [primary, fallback, appeal] = discovery.demo.adjudicators.map((a: J) => a.address as string);
    const request = {
      nonce: `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`,
      disclosure: 'public',
      template: 'checks-only',
      clubId: discovery.demo.clubId,
      seller: s.agent.address,
      buyer: { address: b.agent.address, encryptionPublicKey: b.agent.encryptionPublicKey },
      adjudicators: { primary, fallback, appeal },
      price: { token: lc(deployment.token.address), amount: PRICE },
      deliverable: { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' },
      checks: [{ id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 }],
      timing: { judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 120 },
    };
    const signed = await s.agent.sign(await s.agent.call('POST', '/v1/prepare/offer', request), { kind: 'offer', request, registration: await s.agent.registration(primary), rulebookHash: (await s.agent.rulebookHash(request.clubId)) as Hex });
    const id = signed.body.id as Hex;
    const terms: J = { ...(signed.body as J) };
    delete terms.id;
    delete terms.signatures;
    return { buyer: b.agent, seller: s.agent, id, terms, signed };
  };

  /** A deal the primary accepted, and the buyer's signed agreement and funding, not yet posted. */
  const signedAgreement = async () => {
    const offer = await signedOffer();
    expect((await post(offer.signed.path, offer.signed.body, crypto.randomUUID())).status).toBe(200);
    await untilBoth(offer.buyer, offer.id, ['AcceptedByAdjudicator'], 30_000);
    const { prepared, intent } = await offer.buyer.prepareAgreeAndFund(offer.terms, 40_000_000n);
    return { ...offer, agreement: await offer.buyer.sign(prepared, intent) };
  };

  const relayerSends = async () => {
    const counts = await Promise.all(chain.lanes.map((a) => anvil.publicClient.getTransactionCount({ address: a.address })));
    return counts.reduce((a, b) => a + b, 0);
  };

  it('relays an offer when the signature check meets a node that lacks the block, twice', async () => {
    const offer = await signedOffer();
    const fault = rpc.arm(codeOf(offer.seller.address), 2);
    const res = await post(offer.signed.path, offer.signed.body, crypto.randomUUID());
    rpc.clear();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(fault.hits).toBe(2);
  }, 60_000);

  it('funds when the check of the buyer\'s signature meets a node that lacks the block, twice', async () => {
    const deal = await signedAgreement();
    const fault = rpc.arm(codeOf(deal.buyer.address), 2);
    const res = await post(deal.agreement.path, deal.agreement.body, crypto.randomUUID());
    rpc.clear();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(fault.hits).toBe(2);
    expect(res.body.escrowState).toBe('Held');
  }, 90_000);

  it('funds when the balances read for the advisory notices fails every retry', async () => {
    const deal = await signedAgreement();
    // Past the balance cache (BALANCE_TTL_MS, 4 s), so the reads before the relay go to the node, as on a signed
    // agreement that arrives later than its prepare.
    await sleep(4_200);
    // Two reads of the deal's state before the relay, five tries each (the pinned read's bound, T-232), on the buyer's
    // balance: the request limit's, which already goes on without it, then the advisory notices'.
    const fault = rpc.arm(balanceOf(deployment.token.address, deal.buyer.address), 10);
    errors.length = 0;
    const res = await post(deal.agreement.path, deal.agreement.body, crypto.randomUUID());
    rpc.clear();
    expect(res.status, `${JSON.stringify(res.body)} ${errors.join(' ')}`).toBe(200);
    expect(res.body.escrowState).toBe('Held');
    expect(fault.hits).toBe(10);
  }, 90_000);

  it('answers the mined result when a receipt poll fails after the broadcast', async () => {
    const deal = await signedAgreement();
    const fault = rpc.arm(receipts, 2);
    const res = await post(deal.agreement.path, deal.agreement.body, crypto.randomUUID());
    rpc.clear();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(fault.hits).toBe(2);
    expect(res.body.escrowState).toBe('Held');
  }, 90_000);

  it('says nothing was sent when the chain cannot be read, logs the cause without addresses, and takes the same key later', async () => {
    const deal = await signedAgreement();
    const key = crypto.randomUUID();
    const sentBefore = await relayerSends();
    errors.length = 0;
    const fault = rpc.arm(codeOf(deal.buyer.address), 1_000);
    const res = await post(deal.agreement.path, deal.agreement.body, key);
    rpc.clear();
    expect(res.status, JSON.stringify(res.body)).toBe(500);
    expect(fault.hits).toBeGreaterThan(1);
    expect(res.body.type).toBe('internal');
    expect(res.body.detail).toMatch(/this attempt failed before the operator sent any transaction/);
    expect(res.body.detail).toMatch(/same Idempotency-Key/);
    expect(res.body.retryAfterSec).toBe(5);
    expect(res.retryAfter).toBe('5');
    // The answer never names the cause; the node's log does, under the same Request-Id, with no address or calldata.
    expect(res.body.detail).not.toMatch(/header not found/);
    const requestId = String(res.body.instance).split(':').at(-1)!;
    const line = errors.find((m) => m.includes(requestId));
    expect(line, errors.join('\n')).toBeDefined();
    expect(line).toMatch(/header not found/);
    expect(line).toMatch(/POST \/v1\/commitments\/\{commitmentId\}\/agree/);
    expect(line).not.toMatch(/0x[0-9a-fA-F]{16,}/);
    expect(await relayerSends()).toBe(sentBefore);

    const again = await post(deal.agreement.path, deal.agreement.body, key);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.escrowState).toBe('Held');
  }, 90_000);

  it('claims nothing once the funding is out: no retryAfterSec while its receipt cannot be read, on the first try or a same-key retry, and one funding in all', async () => {
    const deal = await signedAgreement();
    const key = crypto.randomUUID();
    const lane = chain.senderFor(deal.id);
    const nonce = () => anvil.publicClient.getTransactionCount({ address: lane });
    const before = await nonce();
    rpc.arm(receipts, 1_000_000);
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await post(deal.agreement.path, deal.agreement.body, key);
      expect(res.status, JSON.stringify(res.body)).toBe(500);
      expect(res.body.type).toBe('internal');
      expect(res.body.retryAfterSec).toBeUndefined();
      expect(res.body.detail).not.toMatch(/sent/);
    }
    rpc.clear();
    const again = await post(deal.agreement.path, deal.agreement.body, key);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.escrowState).toBe('Held');
    expect(await nonce()).toBe(before + 1);
  }, 90_000);

  it("claims nothing while a deployment with no note waits on the deal's lane (a first take's)", async () => {
    const deal = await signedAgreement();
    const from = chain.senderFor(deal.id);
    const spy = vi.spyOn(chain, 'openRows').mockReturnValue([{ lane: 1, from, nonce: 0, hashes: [], raw: '0x', sentAt: Date.now() }]);
    try {
      rpc.arm(codeOf(deal.buyer.address), 1_000);
      const res = await post(deal.agreement.path, deal.agreement.body, crypto.randomUUID());
      expect(res.status, JSON.stringify(res.body)).toBe(500);
      expect(res.body.retryAfterSec).toBeUndefined();
    } finally {
      rpc.clear();
      spy.mockRestore();
    }
  }, 90_000);
});
