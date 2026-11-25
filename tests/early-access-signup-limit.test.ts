// T-581 (roadmap N222): the sign-up's write limit. The attack is a script posting addresses without end; before the
// change every post was stored.
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM Worker without type declarations
import join from '../apps/early-access/worker.js';

type Fetcher = { fetch(request: Request, env: unknown): Promise<Response> };
const J = 'https://join.crow.direct';
const sign = (email: string, ip = '198.51.100.7') => new Request(`${J}/early-access`, { method: 'POST', headers: { origin: 'https://crow.direct', 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ email }) });
/** A KV store and a rate-limit binding that admits `limit` calls per key, as Cloudflare's does per period. */
const env = (limit: number | null) => {
  const store = new Map<string, string>();
  const seen = new Map<string, number>();
  return {
    store,
    EMAILS: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => void store.set(k, v) },
    ...(limit === null ? {} : { SIGNUP_LIMIT: { limit: async ({ key }: { key: string }) => (seen.set(key, (seen.get(key) ?? 0) + 1), { success: seen.get(key)! <= limit }) } }),
  };
};
const call = (r: Request, e: unknown) => (join as Fetcher).fetch(r, e);

describe('the sign-up write limit (T-581 item 4)', () => {
  it('answers 429 with Retry-After, and stores nothing, past the limit from one client', async () => {
    const e = env(2);
    for (const n of [1, 2]) expect((await call(sign(`a${n}@example.com`), e)).status).toBe(200);
    const over = await call(sign('a3@example.com'), e);
    expect(over.status).toBe(429);
    expect(over.headers.get('retry-after')).toBe('60');
    expect(over.headers.get('access-control-allow-origin')).toBe('https://crow.direct');
    expect([...e.store.keys()].sort()).toEqual(['email:a1@example.com', 'email:a2@example.com']);
    // Another client is counted apart.
    expect((await call(sign('b1@example.com', '203.0.113.9'), e)).status).toBe(200);
  });

  it('limits the listing write too, and leaves reads and preflights alone', async () => {
    const e = env(0);
    const listed = await call(new Request(`${J}/listing`, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.7' }, body: '{"website":"https://example.com"}' }), e);
    expect(listed.status).toBe(429);
    expect((await call(new Request(`${J}/early-access`, { method: 'OPTIONS', headers: { origin: 'https://crow.direct' } }), e)).status).toBe(204);
    expect((await call(new Request(`${J}/nothing`), e)).status).toBe(404);
  });

  it('fails open when the binding is absent, errors, or does not answer', async () => {
    expect((await call(sign('c@example.com'), env(null))).status).toBe(200);
    const broken = { ...env(null), SIGNUP_LIMIT: { limit: async () => Promise.reject(new Error('down')) } };
    expect((await call(sign('d@example.com'), broken)).status).toBe(200);
    const hung = { ...env(null), SIGNUP_LIMIT: { limit: () => new Promise(() => {}) } };
    expect((await call(sign('e@example.com'), hung)).status).toBe(200);
  });
});

describe('the sign-up limit counts an IPv6 /64 as one client (T-581 red team, item 3)', () => {
  it('refuses a host that rotates addresses inside its /64', async () => {
    const e = env(2);
    const ips = ['2001:db8:1:2::1', '2001:db8:1:2::2', '2001:db8:1:2:aaaa::3'];
    const answers = [];
    for (const [i, ip] of ips.entries()) answers.push((await call(sign(`v6-${i}@example.com`, ip), e)).status);
    expect(answers).toEqual([200, 200, 429]);
    expect((await call(sign('v6-other@example.com', '2001:db8:1:3::1'), e)).status).toBe(200);
  });
});
