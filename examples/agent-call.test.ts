// T-497: Agent.call when an answer is lost on the network. On 2026-11-16 a live run of the published try command
// stopped at "fund: fetch failed" while its deal funded and released on both operators: the operator did the work and
// the answer never reached the buyer. A retry of the same request with the same Idempotency-Key replays that answer,
// so the call retries a bounded number of times, and when it gives up it names the network error's cause.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import nacl from 'tweetnacl';
import { generatePrivateKey } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent, CALL_ATTEMPTS } from './agent.ts';

type Seen = { method: string; url: string; key: string | undefined; body: string };
let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

/** A server that drops the connection, after reading the whole request, on the requests `drop` names (1-based). */
async function serve(drop: (n: number) => boolean): Promise<{ url: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  server = createServer((req: IncomingMessage, res) => {
    let body = '';
    req.on('data', (d: Buffer) => (body += d.toString()));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, key: req.headers['idempotency-key'] as string | undefined, body });
      if (drop(seen.length)) return req.socket.destroy();
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, n: seen.length }));
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, seen };
}
const agent = (url: string) => new Agent([url, url.replace('127.0.0.1', 'localhost')], generatePrivateKey(), nacl.randomBytes(32));

describe('Agent.call when the answer is lost (T-497)', () => {
  it('retries a POST whose answer was lost, with the same Idempotency-Key and body, and returns the answer', async () => {
    const { url, seen } = await serve((n) => n === 1);
    const out = await agent(url).call<{ ok: boolean; n: number }>('POST', '/v1/commitments/0xabc/agree', { fund: { amount: '1' } });
    expect(out).toEqual({ ok: true, n: 2 });
    expect(seen).toHaveLength(2);
    expect(seen[0]!.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[1]!.key).toBe(seen[0]!.key);
    expect(seen[1]!.body).toBe(seen[0]!.body);
  }, 20_000);

  it('retries a GET too, and sends no Idempotency-Key with it', async () => {
    const { url, seen } = await serve((n) => n === 1);
    expect(await agent(url).call('GET', '/v1/commitments/0xabc')).toEqual({ ok: true, n: 2 });
    expect(seen.map((s) => s.key)).toEqual([undefined, undefined]);
  }, 20_000);

  it(`gives up after ${CALL_ATTEMPTS} tries, and names the request, the host and the network error's cause`, async () => {
    const { url, seen } = await serve(() => true);
    const err = await agent(url).call('POST', '/v1/faucet', { address: '0x1' }).catch((e: Error) => e);
    expect(seen).toHaveLength(CALL_ATTEMPTS);
    // Still a TypeError, as fetch's own failure: callers that fail over to the next operator on one keep doing so.
    expect(err).toBeInstanceOf(TypeError);
    expect(new Set(seen.map((s) => s.key)).size).toBe(1);
    expect((err as Error).message).toMatch(new RegExp(`^POST /v1/faucet at 127\\.0\\.0\\.1:\\d+: no answer after ${CALL_ATTEMPTS} tries \\(fetch failed: .+\\)$`));
    expect((err as Error).message).toMatch(/other side closed|socket hang up|ECONNRESET|terminated/i);
  }, 20_000);

  it('does not retry a connection the operator refused: the request never reached it, so the caller moves on at once', async () => {
    // A port nothing listens on: the one a closed server held.
    const { url } = await serve(() => false);
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    for (const [to, cause] of [[url, /ECONNREFUSED/], ['http://127.0.0.1:9', /bad port/]] as const) {
      const started = Date.now();
      const err = await agent(to).call('GET', '/v1/commitments/0xabc').catch((e: Error) => e);
      expect((err as Error).message).toMatch(/^GET \/v1\/commitments\/0xabc at 127\.0\.0\.1:\d+: no answer after 1 try \(fetch failed: /);
      expect((err as Error).message).toMatch(cause);
      expect(Date.now() - started).toBeLessThan(900);
    }
    // A TLS failure is not retried either: the request never reached the operator.
    const tls = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('unable to verify the first certificate'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }) });
    const real = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw tls;
    }) as typeof fetch;
    try {
      await expect(agent('https://op.example').call('GET', '/x')).rejects.toThrow(/no answer after 1 try \(fetch failed: unable to verify the first certificate \(UNABLE_TO_VERIFY_LEAF_SIGNATURE\)\)/);
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = real;
    }
  });

  it('does not retry an answer that arrived, even a refusal', async () => {
    const seen: Seen[] = [];
    server = createServer((req, res) => {
      seen.push({ method: req.method!, url: req.url!, key: undefined, body: '' });
      res.statusCode = 409;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ type: 'idempotency_conflict', detail: 'used with another request' }));
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await expect(agent(url).call('POST', '/v1/faucet', {})).rejects.toThrow('POST /v1/faucet: idempotency_conflict: used with another request');
    expect(seen).toHaveLength(1);
  });
});
