// T-489: the test seller's quote address, as a buyer that follows site/buy.txt meets it. The buyer is the pinned
// site/buy.mjs itself, unchanged, run in its own Node process from a folder that holds only it and its two packages,
// as crow-buy does; the seller is served over HTTP and worked as its Durable Object's alarm works it; the public demo's
// own world runs on two origins in this process. No network beyond 127.0.0.1, no credential.
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStorage } from '@holdback/demo-cloud';
import nacl from 'tweetnacl';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sampleResult } from '../../../examples/setup-sample-api.ts';
import { knownPins } from '../../../examples/verify.ts';
import { QUOTE_LIMITS, QUOTE_TIMING } from './catalog.ts';
import { QUOTE_ID, QUOTE_PRICE_UNITS, readQuote } from './quote.ts';
import { TestSeller, type Limits, type SellerOptions } from './seller.ts';
import { serveWorld, type TestWorld } from './test-world.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const pin = knownPins()[0]!; // SimChain, as the in-process world settles
const BUY = new URL('../../../site/buy.mjs', import.meta.url);

/** The test seller over HTTP at http://127.0.0.1:<port>/agents/test-seller, worked as the alarm works it. */
async function serveSeller(operators: readonly string[], o: Partial<SellerOptions> = {}): Promise<{ url: string; seller: TestSeller; close(): Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks);
    const r = await seller.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method ?? 'GET', headers: req.headers as Record<string, string>, ...(body ? { body } : {}) }), req.socket.remoteAddress ?? 'unknown');
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/agents/test-seller`;
  const seller = new TestSeller({ storage: new MemoryStorage(), operators: [...operators], seed: generatePrivateKey(), pin, base: url, log: () => {}, ...o });
  let running = true;
  const loop = (async () => {
    while (running) {
      await seller.work();
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  return {
    url,
    seller,
    close: async () => {
      running = false;
      await loop;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}

/** A folder like crow-buy: the pinned buy.mjs and its two packages, nothing else. */
function crowBuy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'crow-buy-quote-'));
  mkdirSync(join(dir, 'node_modules'));
  for (const p of ['viem', 'tweetnacl']) symlinkSync(realpathSync(new URL(`../../../examples/node_modules/${p}`, import.meta.url)), join(dir, 'node_modules', p));
  copyFileSync(BUY, join(dir, 'buy.mjs'));
  return dir;
}

type Run = { code: number | null; stdout: string; stderr: string };
/** One buy.mjs command, as buy.txt writes it: HOLDBACK_OPERATORS and nothing else of this process's environment. */
function buy(dir: string, operators: readonly string[], args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['buy.mjs', ...args], { cwd: dir, env: { PATH: process.env['PATH'] ?? '', HOME: dir, HOLDBACK_OPERATORS: operators.join(',') } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

const quoteBody = (o: J = {}) => {
  const account = privateKeyToAccount(generatePrivateKey());
  return { buyer: account.address, buyerEncryptionPublicKey: Buffer.from(nacl.box.keyPair().publicKey).toString('base64url'), scope: { rows: 5 }, ...o };
};
const post = (seller: TestSeller, body: unknown, o: { key?: string | null; client?: string; raw?: string } = {}) =>
  seller.fetch(
    new Request('https://crow.direct/agents/test-seller/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(o.key === null ? {} : { 'idempotency-key': o.key ?? crypto.randomUUID() }) },
      body: o.raw ?? JSON.stringify(body),
    }),
    o.client ?? '203.0.113.9',
  );
const quiet = (operators: readonly string[], o: { limits?: Partial<Limits>; quoteLimits?: Partial<typeof QUOTE_LIMITS>; storage?: MemoryStorage } = {}) =>
  new TestSeller({ storage: o.storage ?? new MemoryStorage(), operators: [...operators], seed: generatePrivateKey(), pin, base: 'https://crow.direct/agents/test-seller', log: () => {}, ...(o.limits ? { limits: o.limits } : {}), ...(o.quoteLimits ? { quoteLimits: o.quoteLimits } : {}) });

let demo: TestWorld;
beforeAll(async () => {
  demo = await serveWorld();
});
afterAll(() => demo.close());

describe('a buyer that follows buy.txt with the pinned buy.mjs', () => {
  it('gets a quote, stops for approval, funds, receives the work, and the deal is Released', async () => {
    const s = await serveSeller(demo.urls);
    const dir = crowBuy();
    try {
      const card = await (await fetch(`${s.url}/agent.json`)).json();
      const offer = card.offers.find((o: J) => o.id === QUOTE_ID);
      expect(offer.pricing).toEqual({ kind: 'quoted', quote: `${s.url}/quote`, defaults: `${s.url}/defaults` });
      // Step 3: quote, then stop. Exit 3, nothing signed or paid, the offer and how it differs from the defaults.
      const stop = await buy(dir, demo.urls, [offer.pricing.quote, 'deal-1', '{"rows":5}', '5000000', offer.pricing.defaults]);
      expect(stop.code, stop.stderr).toBe(3);
      const shown = JSON.parse(stop.stdout.trim().split('\n').pop()!);
      expect(shown.approval).toBe('needed');
      expect(shown.seller).toBe(card.seller);
      expect(shown.price).toEqual({ token: pin.token.id, amount: QUOTE_PRICE_UNITS });
      // The offer is the published defaults filled with this scope: no term differs (a clock entry is not a term).
      expect(shown.differences.filter((d: J) => !['createdAt', 'settlementTime'].includes(d.field))).toEqual([]);
      expect(shown.checks.map((c: J) => [c.id, c.min, c.max])).toEqual([['cols', undefined, undefined], ['rows', 5, 5], ['uniq', undefined, undefined]]);
      const approve = stop.stderr.trim().split('\n').pop()!;
      expect(approve).toMatch(/node buy\.mjs approve deal-1 0x[0-9a-f]{64} 5000000$/);
      // Step 5: the approve command the stop printed, unchanged: it funds and follows the deal to its end.
      const id = /approve deal-1 (0x[0-9a-f]{64})/.exec(approve)![1]!;
      const end = await buy(dir, demo.urls, ['approve', 'deal-1', id, '5000000']);
      expect(end.code, end.stderr).toBe(0);
      const done = JSON.parse(end.stdout.trim().split('\n').pop()!);
      expect(done).toMatchObject({ commitmentId: id, outcome: 'Released' });
      expect(done.work).toBe(new TextDecoder().decode(sampleResult({ rows: 5 })));
      const state = await (await fetch(`${demo.urls[0]}/v1/commitments/${id}`)).json();
      expect(state.escrowState).toBe('Released');
    } finally {
      await s.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('the quote address', () => {
  it('answers {commitmentId, price, fees, expiresAt}, and the same key and body replay it', async () => {
    const seller = quiet(demo.urls);
    const body = quoteBody();
    const first = await post(seller, body, { key: 'k-1' });
    expect(first.status).toBe(200);
    const a = await first.json();
    expect(a.commitmentId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.price).toEqual({ token: pin.token.id, amount: QUOTE_PRICE_UNITS });
    expect(BigInt(a.fees.total.amount)).toBe(BigInt(a.price.amount) + BigInt(a.fees.adjudication.amount) + BigInt(a.fees.operator.amount));
    expect(Date.parse(a.expiresAt)).toBeGreaterThan(Date.now());
    const again = await post(seller, body, { key: 'k-1' });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(a);
    const other = await post(seller, { ...body, scope: { rows: 6 } }, { key: 'k-1' });
    expect(other.status).toBe(409);
    expect((await other.json()).detail).toMatch(/new key store directory/);
    // The offer on Crow names the buyer, the sample's terms filled with the scope, and the quote's windows.
    const terms = await (await fetch(`${demo.urls[0]}/v1/commitments/${a.commitmentId}/terms`)).json();
    expect(terms.buyer.toLowerCase()).toBe(body.buyer.toLowerCase());
    expect(terms.acceptance.deterministicChecks.find((c: J) => c.id === 'rows')).toMatchObject({ min: 5, max: 5 });
    expect(Date.parse(terms.timing.fundBy) - Date.parse(terms.createdAt)).toBe(QUOTE_TIMING.fundWithinSec * 1000);
  }, 30_000);

  it('offers to a payment address the quote names', async () => {
    const seller = quiet(demo.urls);
    const pays = privateKeyToAccount(generatePrivateKey()).address;
    const res = await post(seller, quoteBody({ buyerPaymentAddress: pays }));
    expect(res.status).toBe(200);
    const terms = await (await fetch(`${demo.urls[0]}/v1/commitments/${(await res.json()).commitmentId}/terms`)).json();
    expect(String(terms.buyerPaymentAddress).toLowerCase()).toBe(pays.toLowerCase());
  }, 30_000);

  it('refuses a bad body with 400 naming the field and the next step, and counts nothing', async () => {
    const seller = quiet(demo.urls, { limits: { perClientPerHour: 1 } });
    const cases: Array<[J, RegExp]> = [
      [quoteBody({ scope: { rows: 2 } }), /scope\.rows must be a whole number from 3 to 50/],
      [quoteBody({ scope: { rows: 5, commit: 'x' } }), /scope has a field this seller does not take: commit/],
      [quoteBody({ buyer: 'me' }), /buyer must be your address/],
      [quoteBody({ buyerEncryptionPublicKey: 'short' }), /buyerEncryptionPublicKey/],
      [quoteBody({ options: { fast: true } }), /takes no options/],
      [quoteBody({ extra: 1 }), /does not take: extra/],
    ];
    for (const [body, why] of cases) {
      const r = await post(seller, body);
      expect(r.status).toBe(400);
      const j = await r.json();
      expect(j.type).toBe('invalid_request');
      expect(j.detail).toMatch(why);
      expect(j.detail).toMatch(/buy\.txt, step 3/);
    }
    expect((await post(seller, null, { raw: 'not json' })).status).toBe(400);
    expect((await post(seller, quoteBody(), { key: null })).status).toBe(400);
    expect((await post(seller, null, { raw: JSON.stringify({ ...quoteBody(), pad: 'x'.repeat(QUOTE_LIMITS.bodyBytes) }) })).status).toBe(413);
    // Nothing above used the client's one request this hour.
    expect((await post(seller, quoteBody())).status).toBe(200);
  }, 30_000);

  it('answers GET /quote with 405 and serves the defaults in the adapter\'s shape', async () => {
    const seller = quiet(demo.urls);
    const get = await seller.fetch(new Request('https://crow.direct/agents/test-seller/quote'), '203.0.113.9');
    expect(get.status).toBe(405);
    expect((await get.json()).detail).toMatch(/POST the quote/);
    const d = await (await seller.fetch(new Request('https://crow.direct/agents/test-seller/defaults'), '203.0.113.9')).json();
    expect(Object.keys(d).sort()).toEqual(['checks', 'deliverable', 'options', 'scope', 'timing', 'version']);
    expect(d.timing).toEqual(QUOTE_TIMING);
    expect(d.scope).toEqual({ rows: { type: 'integer', min: 3, max: 50 } });
  });

  it('caps one client at its hour, with 429, Retry-After and the seconds in the detail', async () => {
    const seller = quiet(demo.urls, { limits: { perClientPerHour: 2 } });
    expect((await post(seller, quoteBody(), { client: '198.51.100.1' })).status).toBe(200);
    expect((await post(seller, quoteBody(), { client: '198.51.100.1' })).status).toBe(200);
    const third = await post(seller, quoteBody(), { client: '198.51.100.1' });
    expect(third.status).toBe(429);
    const sec = Number(third.headers.get('retry-after'));
    expect(sec).toBeGreaterThan(3000);
    const j = await third.json();
    expect(j).toMatchObject({ type: 'rate_limited', retryAfterSec: sec });
    expect(j.detail).toMatch(new RegExp(`Wait ${sec} s, then run buy\\.mjs again`));
    // Another client is not held up.
    expect((await post(seller, quoteBody(), { client: '198.51.100.2' })).status).toBe(200);
  }, 60_000);

  it('lets offers by quote wait for funding up to QUOTE_LIMITS.waiting, and names when the next slot frees', async () => {
    const seller = quiet(demo.urls, { quoteLimits: { waiting: 2 }, limits: { perClientPerHour: 100, perClientPerDay: 100 } });
    expect((await post(seller, quoteBody())).status).toBe(200);
    expect((await post(seller, quoteBody())).status).toBe(200);
    const full = await post(seller, quoteBody());
    expect(full.status).toBe(429);
    const j = await full.json();
    expect(j.detail).toMatch(/2 offers by quote are waiting to be funded/);
    // The next slot frees when the first funding window closes: about QUOTE_TIMING.fundWithinSec from now.
    expect(j.retryAfterSec).toBeGreaterThan(QUOTE_TIMING.fundWithinSec - 60);
    expect(j.retryAfterSec).toBeLessThanOrEqual(QUOTE_TIMING.fundWithinSec + 5);
  }, 60_000);

  it('shares the seller-wide hour cap with the intake', async () => {
    const seller = quiet(demo.urls, { limits: { perHour: 1, perClientPerHour: 100, perClientPerDay: 100 } });
    expect((await post(seller, quoteBody())).status).toBe(200);
    const r = await post(seller, quoteBody(), { client: '192.0.2.44' });
    expect(r.status).toBe(429);
    expect((await r.json()).detail).toMatch(/1 offers in the last hour/);
  }, 30_000);

  it('spends no faucet grant per quote: the standing address takes one mandate for many quotes', async () => {
    const seller = quiet(demo.urls, { limits: { perClientPerHour: 100, perClientPerDay: 100 } });
    const real = globalThis.fetch;
    let grants = 0;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input instanceof Request ? input.url : input).endsWith('/v1/faucet')) grants++;
      return real(input, init);
    });
    try {
      for (let i = 0; i < 4; i++) expect((await post(seller, quoteBody())).status).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expect(grants).toBeLessThanOrEqual(1);
  }, 60_000);

  it('answers 503 with Retry-After when the operators cannot take the offer, and makes no deal', async () => {
    const storage = new MemoryStorage();
    const seller = new TestSeller({ storage, operators: ['http://127.0.0.1:9', 'http://localhost:9'], seed: generatePrivateKey(), pin, base: 'https://crow.direct/agents/test-seller', log: () => {} });
    const r = await post(seller, quoteBody());
    expect(r.status).toBe(503);
    expect(r.headers.get('retry-after')).toBe('60');
    expect((await r.json()).detail).toMatch(/run buy\.mjs again with a new key store directory/);
    expect((await storage.list({ prefix: 'o:' })).size).toBe(0);
  });
});

describe('readQuote', () => {
  it('takes exactly the body buy.mjs sends, lowercasing the addresses', () => {
    const b = quoteBody();
    expect(readQuote(b)).toEqual({ buyer: b.buyer.toLowerCase(), buyerEncryptionPublicKey: b.buyerEncryptionPublicKey, scope: { rows: 5 } });
    expect(typeof readQuote({ ...b, scope: { rows: 5.5 } })).toBe('string');
    expect(typeof readQuote([b])).toBe('string');
  });
});
