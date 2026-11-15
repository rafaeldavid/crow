// T-486 (D75): POST /listing on crow-early-access, the receiver of the setup's listing step. A party's own command sends
// its website and nothing else; the route stores the website and the time it first arrived, and nothing else. It
// fetches nothing: whether a listed site publishes a Crow card is read later, by a person, with
// scripts/listing-check.mjs. The list is private: no GET on the Worker serves an entry, and the answer to a POST is the
// same for a new website and a known one. No deal reads the list. Nothing here opens a connection: the store is a Map.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { API_HEADERS } from '../apps/demo-cloud/src/headers.ts';
// @ts-expect-error -- plain ESM Worker module without type declarations
import { clientKey, LIMITS, listing, LISTING_PREFIX, makeLimiter, websiteOf as receiverWebsiteOf } from '../apps/early-access/listing.js';
// @ts-expect-error -- plain ESM Worker without type declarations
import worker from '../apps/early-access/worker.js';
import { websiteOf as commandWebsiteOf } from '../examples/setup-list.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Fetcher = { fetch(request: Request, env: unknown): Promise<Response> };
const J_URL = 'https://join.crow.direct/listing';
const T0 = Date.parse('2026-11-15T10:00:00Z');

const kv = () => {
  const store = new Map<string, string>();
  let puts = 0;
  return { store, puts: () => puts, EMAILS: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => void ((puts += 1), store.set(k, v)) } };
};
const post = (body: unknown, headers: Record<string, string> = {}, url = J_URL) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
/** One call of the route with its own store, clock and limiter, unless the test passes them. */
async function send(body: unknown, o: { env?: ReturnType<typeof kv>; headers?: Record<string, string>; now?: number; limiter?: unknown } = {}) {
  const env = o.env ?? kv();
  const r: Response = await listing(post(body, o.headers), env, { now: () => o.now ?? T0, limiter: o.limiter ?? makeLimiter() });
  return { r, body: (await r.json().catch(() => null)) as J, env };
}

describe('POST /listing: what is stored (T-486)', () => {
  it('stores one entry for a website, with exactly the website and the time, and keeps no IP address or header', async () => {
    const { r, body, env } = await send({ website: 'https://seller.example' }, { headers: { 'user-agent': 'a-client/9.9', 'x-forwarded-for': '198.51.100.9' } });
    expect(r.status).toBe(200);
    expect(body).toEqual({ ok: true, website: 'https://seller.example/' });
    expect(LISTING_PREFIX).toBe('listing:');
    expect([...env.store.keys()]).toEqual(['listing:https://seller.example/']);
    expect(JSON.parse(env.store.get('listing:https://seller.example/')!)).toEqual({ website: 'https://seller.example/', receivedAt: '2026-11-15T10:00:00.000Z' });
    const all = [...env.store.entries()].flat().join('\n');
    for (const leaked of ['203.0.113.7', '198.51.100.9', 'a-client', 'seller"', 'buyer', 'role']) expect(all).not.toContain(leaked);
  });

  it('fetches nothing: no request leaves the route, whatever the website', async () => {
    const fetched = vi.fn(() => Promise.reject(new Error('the route must fetch nothing')));
    vi.stubGlobal('fetch', fetched);
    try {
      expect((await send({ website: 'https://seller.example/' })).r.status).toBe(200);
      expect((await send({ website: 'https://crow.example/agents/test-seller' })).r.status).toBe(200);
      expect(fetched).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('one website is one entry: a repeat writes nothing, keeps the first time, and gets the same answer as the first', async () => {
    const env = kv();
    const first = await send({ website: 'https://seller.example/' }, { env });
    const again = await send({ website: 'https://seller.example' }, { env, now: T0 + 60_000, headers: { 'cf-connecting-ip': '192.0.2.9' } });
    expect(env.puts()).toBe(1);
    expect(JSON.parse(env.store.get('listing:https://seller.example/')!).receivedAt).toBe('2026-11-15T10:00:00.000Z');
    // The same status, body and headers: a caller cannot learn from the answer whether a site was on the list.
    expect([again.r.status, again.body, [...again.r.headers]]).toEqual([first.r.status, first.body, [...first.r.headers]]);
    // Another path on the same site is another website.
    await send({ website: 'https://seller.example/shop/' }, { env });
    expect([...env.store.keys()].sort()).toEqual(['listing:https://seller.example/', 'listing:https://seller.example/shop/']);
  });
});

describe('POST /listing: what is refused, with nothing stored (T-486)', () => {
  const refused = async (body: unknown, headers: Record<string, string> = {}) => {
    const out = await send(body, { headers });
    expect(out.env.store.size, JSON.stringify(body)).toBe(0);
    return out.r.status;
  };
  const ok = { website: 'https://seller.example/' };

  it('a request with an Origin header: the command sends none, a browser always does', async () => {
    expect(await refused(ok, { origin: 'https://crow.direct' })).toBe(403);
    expect(await refused(ok, { origin: 'null' })).toBe(403);
  });

  it('another content type, a body that is not a JSON object, and a body over 1,024 bytes', async () => {
    expect(await refused(ok, { 'content-type': 'text/plain' })).toBe(400);
    expect(await refused('{"website":')).toBe(400);
    expect(await refused('["https://seller.example/"]')).toBe(400);
    expect(await refused('null')).toBe(400);
    expect(LIMITS.bodyBytes).toBe(1024);
    expect(await refused({ website: `https://seller.example/${'a'.repeat(1100)}` })).toBe(413);
  });

  it('a second field of any name, the role included, and a missing website', async () => {
    for (const extra of [{ role: 'seller' }, { role: 'buyer' }, { address: `0x${'12'.repeat(20)}` }, { email: 'a@example.com' }, { name: 'A seller' }, { verified: 'card' }]) expect(await refused({ ...ok, ...extra }), JSON.stringify(extra)).toBe(400);
    expect(await refused({})).toBe(400);
    expect(await refused({ role: 'seller' })).toBe(400);
  });

  // One table for both copies of the rule: the receiver's and the command's (examples/setup-list.ts) agree on every row.
  const WEBSITES: Array<[string, boolean]> = [
    ['https://seller.example', true],
    ['https://seller.example/shop/', true],
    ['https://xn--bcher-kva.example/', true],
    ['HTTPS://Seller.Example/Shop', true],
    ['http://seller.example/', false],
    ['ftp://seller.example/', false],
    ['seller.example', false],
    ['', false],
    ['https://user@seller.example/', false],
    ['https://user:word@seller.example/', false],
    ['https://seller.example/?ref=1', false],
    ['https://seller.example/?', false],
    ['https://seller.example/#top', false],
    ['https://seller.example:8443/', false],
    ['https://127.0.0.1/', false],
    ['https://2130706433/', false],
    ['https://0x7f.1/', false],
    ['https://[::1]/', false],
    ['https://[2001:db8::1]/', false],
    ['https://localhost/', false],
    ['https://intranet/', false],
    ['https://printer.local/', false],
    ['https://db.internal/', false],
    ['https://a.localhost/', false],
    ['https://router.home.arpa/', false],
    ['https://seller.example./', false],
    [`https://seller.example/${'a'.repeat(200)}`, false],
  ];
  it.each(WEBSITES)('the website %s: taken %s, by the receiver and by the command alike', async (website, taken) => {
    const r = receiverWebsiteOf(website), c = commandWebsiteOf(website);
    expect('website' in r, JSON.stringify(r)).toBe(taken);
    expect('website' in c, JSON.stringify(c)).toBe(taken);
    if (taken) {
      expect(r.website).toBe(new URL(website).href);
      expect((c as { website: string }).website).toBe(r.website);
      expect(r.website.length).toBeLessThanOrEqual(LIMITS.websiteChars);
    } else {
      expect(await refused({ website })).toBe(400);
    }
  });
  it('a website that is not text', async () => {
    for (const website of [7, null, ['https://seller.example/'], { href: 'https://seller.example/' }]) expect(await refused({ website })).toBe(400);
  });

  it('the eleventh request of one client within an hour, and request 501 of a UTC day: 429 with retryAfterSec', async () => {
    expect([LIMITS.perClientPerHour, LIMITS.perDay]).toEqual([10, 500]);
    const env = kv(), limiter = makeLimiter();
    const from = (ip: string, n: number, now = T0) => send({ website: `https://s${n}.example/` }, { env, limiter, now, headers: { 'cf-connecting-ip': ip } });
    for (let i = 0; i < 10; i++) expect((await from('203.0.113.7', i)).r.status).toBe(200);
    const eleventh = await from('203.0.113.7', 10, T0 + 600_000);
    expect(eleventh.r.status).toBe(429);
    expect(eleventh.body.retryAfterSec).toBe(3000); // the hour began at T0
    expect(eleventh.r.headers.get('retry-after')).toBe('3000');
    expect(env.store.size).toBe(10);
    // A repeat of a known website is counted like any other request: the limit does not tell known from new.
    expect((await from('203.0.113.7', 0, T0 + 600_000)).r.status).toBe(429);
    // Another client still has its turn; the first has one again when its hour is over.
    expect((await from('203.0.113.8', 11)).r.status).toBe(200);
    expect((await from('203.0.113.7', 12, T0 + 3_600_000)).r.status).toBe(200);
    // A refused body is not counted: a corrected call keeps its turn.
    const fresh = makeLimiter();
    for (let i = 0; i < 20; i++) expect((await send({ website: 'http://no.example/' }, { limiter: fresh })).r.status).toBe(400);
    expect((await send({ website: 'https://yes.example/' }, { limiter: fresh })).r.status).toBe(200);

    // The day: 500 in all, from any number of clients, then 429 until 00:00 UTC.
    const day = makeLimiter(), store = kv();
    for (let i = 0; i < 500; i++) expect(day.take(`198.51.${Math.floor(i / 250)}.${i % 250}`, T0).ok).toBe(true);
    const over = await send({ website: 'https://late.example/' }, { env: store, limiter: day, headers: { 'cf-connecting-ip': '192.0.2.1' } });
    expect(over.r.status).toBe(429);
    expect(over.body.retryAfterSec).toBe(14 * 3600);
    expect(store.store.size).toBe(0);
    expect(day.take('192.0.2.1', Date.parse('2026-11-16T00:00:00Z')).ok).toBe(true);
  });

  it('counts a client as an IPv4 address or an IPv6 /64', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(clientKey('2001:db8:1:2::1'));
    expect(clientKey('2001:db8:1:2::1')).not.toBe(clientKey('2001:db8:1:3::1'));
    expect(clientKey('')).toBe('unknown');
  });
});

describe('the route on the Worker (T-486)', () => {
  const call = (request: Request, env: unknown) => (worker as Fetcher).fetch(request, env);
  const hasAll = (r: Response) => {
    for (const [k, v] of Object.entries(API_HEADERS)) expect(r.headers.get(k), k).toBe(v);
  };

  it('answers POST /listing with the security headers, and leaves the email sign-up and the 404 as they were', async () => {
    const env = kv();
    const listed = await call(post({ website: 'https://buyer.example/' }, { 'cf-connecting-ip': '192.0.2.44' }), env);
    expect(listed.status).toBe(200);
    hasAll(listed);
    expect(listed.headers.get('cache-control')).toBe('no-store');
    expect(await listed.json()).toEqual({ ok: true, website: 'https://buyer.example/' });
    const refused = await call(post({ website: 'https://buyer.example/' }, { origin: 'https://crow.direct' }), env);
    expect(refused.status).toBe(403);
    hasAll(refused);
    const signup = await call(new Request('https://join.crow.direct/early-access', { method: 'POST', headers: { origin: 'https://crow.direct', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@example.com' }) }), env);
    expect(signup.status).toBe(200);
    expect([...env.store.keys()].sort()).toEqual(['email:a@example.com', 'listing:https://buyer.example/']);
  });

  it('the list is private: no GET, HEAD or other read on the Worker serves an entry, or says whether a website is listed', async () => {
    const env = kv();
    const site = 'https://private-partner.example/';
    expect((await call(post({ website: site }, { 'cf-connecting-ip': '192.0.2.46' }), env)).status).toBe(200);
    const enc = encodeURIComponent(site);
    const paths = ['/listing', '/listing/', `/listing/${enc}`, `/listing?website=${enc}`, `/listing:${enc}`, '/listings', '/list', '/registry', '/early-access', `/early-access?website=${enc}`, '/', '/version.json', '/kv', '/EMAILS'];
    for (const path of paths) {
      for (const method of ['GET', 'HEAD', 'OPTIONS', 'DELETE', 'PUT']) {
        const r = await call(new Request(`https://join.crow.direct${path}`, { method, headers: { 'cf-connecting-ip': '192.0.2.47' } }), env);
        const text = `${await r.text()}\n${[...r.headers].flat().join('\n')}`;
        expect(text, `${method} ${path}`).not.toContain('private-partner');
        // Only the build read answers 200 to a read, and it names a commit and nothing stored.
        if (r.status === 200) expect(path, `${method} ${path} answered 200`).toBe('/version.json');
      }
    }
    const read = await call(new Request(J_URL), env);
    expect([read.status, read.headers.get('allow')]).toEqual([405, 'POST']);
    hasAll(read);
    // A listed website and one that is not get the same answer to a read.
    const a = await call(new Request(`${J_URL}?website=${enc}`), env), b = await call(new Request(`${J_URL}?website=${encodeURIComponent('https://unknown.example/')}`), env);
    expect([a.status, await a.text()]).toEqual([b.status, await b.text()]);
  });

  it('plain HTTP is redirected before anything is stored, and a failed store write is a 500 with the headers', async () => {
    const env = kv();
    const plain = await call(post({ website: 'https://buyer.example/' }, {}, 'http://join.crow.direct/listing'), env);
    expect([plain.status, plain.headers.get('location')]).toEqual([308, J_URL]);
    expect(env.store.size).toBe(0);
    const broken = { EMAILS: { get: async () => null, put: async () => Promise.reject(new Error('KV write limit')) } };
    const r = await call(post({ website: 'https://buyer2.example/' }, { 'cf-connecting-ip': '192.0.2.45' }), broken);
    expect(r.status).toBe(500);
    hasAll(r);
  });
});

describe('neutrality: nothing that settles a deal reads the list (T-486, D75)', () => {
  // The operators, the test agents, the hosted sellers and the packages name neither the route nor the store.
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const NAMES = [/join\.crow\.direct/, /\bEMAILS\b/, /\/listing\b/, /['"`]listing:/, /setup-list/, /listing-check/, /early-access/];
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.isDirectory()) return ['node_modules', 'dist', '.wrangler', 'reports'].includes(e.name) ? [] : sources(join(dir, e.name));
      return /\.(ts|js|mjs|json|jsonc)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [join(dir, e.name)] : [];
    });
  it.each(['apps/operator', 'apps/demo-cloud', 'apps/test-agents', 'apps/hosted-sellers', 'packages'])('%s names neither the listing route nor the sign-up store', (dir) => {
    const files = sources(join(ROOT, dir));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const name of NAMES) expect(name.test(text), `${f} matches ${name}`).toBe(false);
    }
  });
});
