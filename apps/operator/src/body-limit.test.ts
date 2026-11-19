// T-559: a JSON body over a route's limit is refused with 413 and the connection stays usable. Before, the reader left
// its loop at the limit, which destroyed the request's socket: the client's upload or its next request on that
// keep-alive connection was reset (T-547 fixed the same for ciphertext uploads).
import { Agent, request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_CIPHERTEXT_BYTES } from '@holdback/core/store';
import { simActor } from '@holdback/settlement/sim';
import { MAX_REPORT_BYTES, MemoryFeedbackStore } from './feedback.js';
import { fetchHandler } from './fetch.js';
import { Operator, simRegistry } from './index.js';
import { MAX_REGISTRATION_BYTES } from './registrations.js';
import { world, type World } from './_world.js';

let w: World;
let url: URL;

beforeAll(async () => {
  w = await world();
  url = new URL((await w.operator('op-1', { feedback: { store: new MemoryFeedbackStore() } })).url);
});
afterAll(async () => w.close());

interface Answer {
  status: number;
  body: Record<string, unknown>;
  reused: boolean;
  port: number | undefined;
}

/** One request on the given agent; resolves with the answer, rejects with the socket's error (a reset). */
function send(agent: Agent, method: string, path: string, body?: Buffer): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request({ host: url.hostname, port: url.port, method, path, agent, headers: { 'content-type': 'application/json', 'idempotency-key': `k-${path}-${body?.length ?? 0}` } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>, reused: req.reusedSocket, port: req.socket?.localPort }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** A well-formed JSON object of exactly `bytes` bytes. */
const jsonOf = (bytes: number) => Buffer.from(`{"pad":"${'a'.repeat(bytes - 10)}"}`, 'utf8');

const ROUTES: Array<{ name: string; path: string; limit: number }> = [
  { name: 'a write', path: '/v1/commitments', limit: 1_048_576 },
  { name: 'a prepare', path: '/v1/prepare/offer', limit: 1_048_576 },
  { name: 'an adjudicator registration', path: '/v1/adjudicators', limit: MAX_REGISTRATION_BYTES },
  { name: 'a feedback report', path: '/v1/feedback', limit: MAX_REPORT_BYTES },
];

describe('an oversized JSON body (T-559)', () => {
  for (const route of ROUTES) {
    it(`refuses ${route.name} over its limit with 413 and keeps the connection for the next request`, async () => {
      const agent = new Agent({ keepAlive: true, maxSockets: 1 });
      try {
        const over = await send(agent, 'POST', route.path, jsonOf(route.limit + 512 * 1024));
        expect([over.status, over.body.type, over.body.maxBytes, over.body.detail]).toEqual([413, 'payload_too_large', route.limit, `request bodies are limited to ${route.limit} bytes here`]);
        const next = await send(agent, 'GET', '/v1/status');
        expect(next.status).toBe(200);
        expect(next.reused).toBe(true);
        expect(next.port).toBe(over.port);
      } finally {
        agent.destroy();
      }
    });
  }

  // A boundary check, not evidence of the fix: a 16 KiB body arrives in one chunk, so the old reader passed this too.
  it('still refuses a body at exactly the limit plus one byte, and accepts one at the limit as a body to parse', async () => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const over = await send(agent, 'POST', '/v1/feedback', jsonOf(MAX_REPORT_BYTES + 1));
      expect([over.status, over.body.type]).toEqual([413, 'payload_too_large']);
      const at = await send(agent, 'POST', '/v1/feedback', jsonOf(MAX_REPORT_BYTES));
      expect(at.status).not.toBe(413);
      expect(at.reused).toBe(true);
    } finally {
      agent.destroy();
    }
  });

  // The cost of refusing is bounded: a body far past the ceiling is read up to the ceiling and no further, then refused
  // with the same 413. Counted at the source, through the Worker's fetch entry. The body ends 4 MiB past the ceiling, so
  // a reader with no ceiling reads all of it and fails the count instead of hanging.
  it('stops reading a body far past the fixed ceiling at the ceiling and refuses it with the same 413', async () => {
    const op = new Operator({ settlement: w.chain, registry: simRegistry(w.chain), signerKey: simActor('op-ceiling', 'operator').key, operatorId: 'op-ceiling', env: {}, baseUrl: 'https://op.example.test', feedback: { store: new MemoryFeedbackStore() } });
    const chunk = new Uint8Array(64 * 1024).fill(0x61);
    for (const [path, limit] of [['/v1/feedback', MAX_REPORT_BYTES], ['/v1/commitments', 1_048_576]] as const) {
      let pulled = 0;
      const endless = new ReadableStream<Uint8Array>({
        pull(c) {
          if (pulled >= MAX_CIPHERTEXT_BYTES + 4 * 1024 * 1024) return c.close();
          pulled += chunk.length;
          c.enqueue(chunk);
        },
      }, { highWaterMark: 0 });
      const r = await fetchHandler(op)(new Request(`https://op.example.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'endless' }, body: endless, duplex: 'half' } as RequestInit));
      expect([r.status, ((await r.json()) as { maxBytes: number }).maxBytes], path).toEqual([413, limit]);
      // Read past the limit, to the ceiling, and stopped within a chunk or two of it.
      expect(pulled, path).toBeGreaterThan(MAX_CIPHERTEXT_BYTES);
      expect(pulled, path).toBeLessThanOrEqual(MAX_CIPHERTEXT_BYTES + 2 * chunk.length);
    }
  });
});
