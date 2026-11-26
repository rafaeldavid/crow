// T-626: the operator's quota hook (OperatorOptions.quota). A node asks it just before it relays a write or stores a
// ciphertext. Its refusal is a problem like any other and is not stored, and a take is settled with the outcome.
import { MemoryCiphertextStore, StoreError } from '@holdback/core/store';
import { requestOf, type Operation } from '@holdback/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { holdOf, world, type World } from './_world.js';
import { refuseParties } from './policy.js';
import type { LogEntry, QuotaSubject, QuotaTake } from './server.js';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let w: World;
beforeEach(async () => {
  w = await world();
});
afterEach(async () => w.close());

const send = (base: string, op: Operation, key: string, query = '') => {
  const { path, body } = requestOf(op);
  return fetch(`${base}${path}${query}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) });
};
const upload = (base: string, bytes: Uint8Array, key: string) => fetch(`${base}/v1/ciphertext`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'idempotency-key': key }, body: bytes });

/** A quota that records what it is asked and how each take is settled. `first` answers before it does, when it answers. */
function recorder(first?: (about: QuotaSubject) => QuotaTake) {
  const asked: QuotaSubject[] = [];
  const settled: boolean[] = [];
  const quota = async (about: QuotaSubject): Promise<QuotaTake> => {
    asked.push(about);
    return first?.(about) ?? { settle: async (accepted) => void settled.push(accepted) };
  };
  return { asked, settled, quota };
}

describe('the quota on a write', () => {
  it('is asked once for a relayed write and told it succeeded; a replay from the store does not ask again', async () => {
    const r = recorder();
    const { url } = await w.operator('op-1', { quota: r.quota });
    const hold = await holdOf(w.deal);
    expect((await send(url, hold, 'h-1')).status).toBe(200);
    expect(r.asked).toMatchObject([{ kind: 'relay', idempotencyKey: 'h-1', path: '/v1/holds', op: { kind: 'hold' }, body: { commitment: { id: hold.commitment.id } } }]);
    expect(r.asked[0]!.client).toBeTruthy();
    expect((await send(url, hold, 'h-1')).status).toBe(200);
    expect({ asked: r.asked.length, settled: r.settled }).toEqual({ asked: 1, settled: [true] });
  });

  it('is told that a relay the settlement layer refused did not succeed', async () => {
    const r = recorder();
    const { url } = await w.operator('op-1', { quota: r.quota });
    const hold = await holdOf(w.deal);
    // The buyer's Agree signature in the funding's place: well formed, and not the funding's signature.
    const response = await send(url, { ...hold, funding: { ...hold.funding, signature: hold.agree.signature } }, 'h-1');
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect({ asked: r.asked.length, settled: r.settled }).toEqual({ asked: 1, settled: [false] });
  });

  it('is not asked about a dry run or about a write the node refuses itself', async () => {
    const r = recorder();
    const open = await w.operator('op-1', { quota: r.quota });
    const closed = await w.operator('op-2', { quota: r.quota, policy: refuseParties([w.cast.seller.address]) });
    const hold = await holdOf(w.deal);
    expect((await send(open.url, hold, 'dry', '?validateOnly=true')).status).toBe(200);
    expect((await send(closed.url, hold, 'refused')).status).toBe(403);
    expect(r.asked).toEqual([]);
  });

  it('refuses with its own problem under the request’s ID, relays nothing and stores nothing', async () => {
    let allow = false;
    const r = recorder(() => (allow ? undefined : { refuse: { type: 'rate_limited', detail: 'none left today', retryAfterSec: 7 } }));
    const logs: LogEntry[] = [];
    const { url } = await w.operator('op-1', { quota: r.quota, log: (e) => void logs.push(e) });
    const hold = await holdOf(w.deal);
    const refused = await send(url, hold, 'h-1');
    const id = refused.headers.get('request-id');
    expect({ status: refused.status, retryAfter: refused.headers.get('retry-after') }).toEqual({ status: 429, retryAfter: '7' });
    expect(await refused.json()).toMatchObject({ type: 'rate_limited', detail: 'none left today', retryAfterSec: 7, instance: `urn:holdback:request:${id}` });
    expect(logs.find((e) => e.requestId === id)).toMatchObject({ status: 429, problem: 'rate_limited' });
    expect(w.chain.log()).toHaveLength(0);
    allow = true;
    expect((await send(url, hold, 'h-1')).status).toBe(200);
  });

  it('that throws answers internal, saying nothing was sent, and the same key works afterwards (T-609)', async () => {
    let broken = true;
    const r = recorder(() => {
      if (broken) throw new Error('storage is down');
      return undefined;
    });
    const { url } = await w.operator('op-1', { quota: r.quota });
    const hold = await holdOf(w.deal);
    const failed = await send(url, hold, 'h-1');
    expect(failed.status).toBe(500);
    const problem = (await failed.json()) as J;
    expect(problem).toMatchObject({ type: 'internal', retryAfterSec: 5 });
    expect(problem.detail).toMatch(/nothing was sent/);
    expect(w.chain.log()).toHaveLength(0);
    broken = false;
    expect((await send(url, hold, 'h-1')).status).toBe(200);
  });

  it('gets a frozen copy: it cannot change what is relayed', async () => {
    const mutations: unknown[] = [];
    const { url } = await w.operator('op-1', {
      quota: async (about) => {
        if (about.kind !== 'relay' || about.op.kind !== 'hold') return undefined;
        const op = about.op;
        const body = about.body as { commitment: { price: unknown } };
        for (const change of [() => (op.commitment.price = { token: 'tUSD', amount: '1' } as typeof op.commitment.price), () => (body.commitment.price = null)]) {
          try {
            change();
          } catch (e) {
            mutations.push(e);
          }
        }
        return undefined;
      },
    });
    const hold = await holdOf(w.deal);
    const response = await send(url, hold, 'h-1');
    expect({ status: response.status, escrowState: ((await response.json()) as J).escrowState }).toEqual({ status: 200, escrowState: 'Held' });
    expect(mutations).toEqual([expect.any(TypeError), expect.any(TypeError)]);
  });
});

describe('the quota on an upload', () => {
  it('is asked with the bytes’ hash and length and told how the store answered; a replay does not ask again', async () => {
    const r = recorder();
    const store = new MemoryCiphertextStore();
    const put = store.put.bind(store);
    let full = true;
    store.put = async (bytes) => {
      if (full) throw new StoreError('too_large');
      return put(bytes);
    };
    const { url } = await w.operator('op-1', { store, quota: r.quota });
    const bytes = new Uint8Array(64).fill(3);
    expect((await upload(url, bytes, 'up-1')).status).toBe(413);
    full = false;
    const stored = await upload(url, bytes, 'up-1');
    expect(stored.status).toBe(200);
    const { id } = (await stored.json()) as J;
    expect((await upload(url, bytes, 'up-1')).status).toBe(200);
    expect(r.asked).toMatchObject([
      { kind: 'ciphertext', id, bytes: 64 },
      { kind: 'ciphertext', id, bytes: 64 },
    ]);
    expect(r.settled).toEqual([false, true]);
  });
});
