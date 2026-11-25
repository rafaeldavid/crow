// A seller's own Worker (T-478) on the in-process world, against the job stub: its card at the party's own address, a
// whole deal driven by the object's alarm with the per-deal keys the setup writes, the export only to the owner's
// signature, and the refusals of an address that is not the party's own. The Durable Object's state is faked with
// MemoryStorage and an alarm, as apps/hosted-sellers' tests do.
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { MemoryStorage } from '@holdback/demo-cloud';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../examples/agent.ts';
import { jobStubSellerApi, startJobStub, type JobStub } from '../../../examples/seller-adapter-job-stub.ts';
import { baseOf, exportMessage, OwnSellerObject, setupOf, workerFor, type Env, type OwnBundle } from './worker.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const SECRETS = { JOBS_API_KEY: 'own-api-key-5e1c', QUOTE_CREDENTIALS: 'own-quote-cred-8d02' };
const BASE = 'https://reviews.party-example.workers.dev';
const SCOPE = { target: 'vault-core', depth: 2 };
const SCOPE_RULES = { target: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' }, depth: { type: 'integer', min: 1, max: 10 } };
const TEMPLATE = {
  deliverable: { kind: 'document', description: 'A review of {{target}} to depth {{depth}}.', format: 'application/json' },
  checks: [{ id: 'report', type: 'json_schema', required: true, schema: { type: 'object', required: ['summary', 'target'], properties: { target: { const: '{{target}}' } } } }],
};
const OWNER_KEY = generatePrivateKey();
const OWNER = privateKeyToAccount(OWNER_KEY);

class FakeStorage extends MemoryStorage {
  alarm: number | null = null;
  async getAlarm() {
    return this.alarm;
  }
  async setAlarm(at: number) {
    this.alarm = at;
  }
}

let world: SimWorld;
let stub: JobStub | undefined;
const acct = (label: string) => world.info.accounts.find((a) => a.label === label)!;
const agent = (label: string) => new Agent(world.info.operators, acct(label).privateKey as Hex, Buffer.from(acct(label).encryptionSecretKey, 'base64url'));
let logs: string[] = [];

beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {} });
});
afterAll(() => world.close());
afterEach(async () => {
  vi.restoreAllMocks();
  await stub?.close();
  stub = undefined;
});

/** The bundle `setup.mjs cloudflare` writes: the owner, and a seller with per-deal keys and a quote credential. */
function bundleFor(apiBase: string, over: { config?: J } = {}): OwnBundle {
  const api = jobStubSellerApi(apiBase);
  delete api.result.files;
  return {
    owner: OWNER.address,
    seller: {
      slug: 'reviews',
      card: { name: 'Party reviews', item: 'review' },
      config: { template: 'template.json', scope: SCOPE_RULES, pollMs: 50, sellerApi: api, signingKey: 'per-deal', quoteAuth: { kind: 'bearer', env: 'QUOTE_CREDENTIALS' }, quoteRateLimit: { overall: { requests: 50, windowSec: 86_400 } }, redelivery: { refetchEverySec: 0 }, ...over.config },
      files: { 'template.json': JSON.stringify(TEMPLATE) },
    },
  };
}
function envFor(extra: Record<string, unknown> = {}): Env {
  return { SELLER: undefined as never, OPERATOR_URLS: world.info.operators.join(','), SELLER_URL: `${BASE}/`, HOLDBACK_KEY: generatePrivateKey(), ...SECRETS, ...extra };
}
async function seller(o: { storage?: FakeStorage; bundle?: OwnBundle; env?: Env } = {}) {
  stub ??= await startJobStub({ key: SECRETS.JOBS_API_KEY, readsUntilComplete: 1 });
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
  const storage = o.storage ?? new FakeStorage();
  const env = o.env ?? envFor();
  const object = new OwnSellerObject({ storage }, env, setupOf(o.bundle ?? bundleFor(stub.base)));
  return { object, storage, env };
}
const get = (o: OwnSellerObject, path: string, headers: Record<string, string> = {}) => o.fetch(new Request(`${BASE}${path}`, { headers }));
async function quote(o: OwnSellerObject, buyer: Agent, credential = SECRETS.QUOTE_CREDENTIALS): Promise<{ status: number; body: J }> {
  const res = await o.fetch(new Request(`${BASE}/quote`, { method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: SCOPE }) }));
  return { status: res.status, body: await res.json() };
}
async function fund(buyer: Agent, id: Hex) {
  await buyer.waitFor(id, ['AcceptedByAdjudicator']);
  const terms = await buyer.call('GET', `/v1/commitments/${id}/terms`);
  delete terms.id;
  delete terms.signatures;
  await buyer.agreeAndFund(terms, 2_100_000_000n);
}
async function alarmsUntil(o: OwnSellerObject, storage: FakeStorage, what: string, ok: () => Promise<boolean>, timeoutMs = 20_000) {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) {
    if (storage.alarm !== null) await o.alarm();
    if (await ok()) return;
  }
  throw new Error(`timed out waiting for ${what}`);
}
const stageOf = async (storage: FakeStorage, id: Hex) => ((await storage.get<J>(`deal:${id}`))?.stage as string | undefined);
/** The headers `leave` sends: the owner's signature over the host and the time. */
async function ownerHeaders(key: Hex, time = Math.floor(Date.now() / 1000), host = new URL(BASE).host) {
  return { 'x-crow-owner-time': String(time), 'x-crow-owner-signature': await privateKeyToAccount(key).signMessage({ message: exportMessage(host, time) }) };
}

describe("a seller's own Worker (T-478): its card at the party's own address", () => {
  it('serves the crow-agent card with quote and defaults addresses on its own host, and says the party runs it', async () => {
    const { object } = await seller();
    const card = (await (await get(object, '/agent.json')).json()) as J;
    expect(card).toMatchObject({ type: 'crow-agent', name: 'Party reviews', testTokensOnly: true, health: `${BASE}/health` });
    expect(card.seller).toBeUndefined(); // per-deal keys: the card lists no address
    expect(card.offers).toEqual([{ id: 'review', pricing: { kind: 'quoted', quote: `${BASE}/quote`, defaults: `${BASE}/defaults` } }]);
    expect(card.operatedBy).toContain('its own Cloudflare account');
    expect(JSON.stringify(card)).not.toMatch(/crow\.direct/);
    const html = await (await get(object, '/')).text();
    expect(JSON.parse(/<script type="application\/json" id="crow-agent">([\s\S]*?)<\/script>/.exec(html)![1]!)).toEqual(card);
    expect((await get(object, '/defaults')).status).toBe(200);
    expect(await (await get(object, '/health')).json()).toMatchObject({ status: 'operational', open: 0 });
  }, 30_000);

  it('the quote route takes the quote credential only, and nothing reaches the API without it', async () => {
    const { object } = await seller();
    expect((await quote(object, agent('buyer-1'), 'not-it')).status).toBe(401);
    expect(stub!.requests).toEqual([]);
  }, 30_000);
});

describe("a seller's own Worker (T-478): a deal", () => {
  it('a quote becomes an offer signed by a fresh deal key, and the alarm starts one job and delivers once', async () => {
    const { object, storage, env } = await seller();
    const buyer = agent('buyer-1');
    const q = await quote(object, buyer);
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    const id = q.body.commitmentId as Hex;
    const terms = await buyer.call('GET', `/v1/commitments/${id}/terms`);
    expect(terms.seller.toLowerCase()).not.toBe(privateKeyToAccount(env.HOLDBACK_KEY as Hex).address.toLowerCase());
    await fund(buyer, id);
    await alarmsUntil(object, storage, 'the delivery', async () => (await stageOf(storage, id)) === 'delivered');
    expect((await buyer.waitFor(id, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
    expect(stub!.runs()).toHaveLength(1);
    const stored = JSON.stringify([...(await storage.list({ prefix: '' })).entries()]);
    const shown = (await (await get(object, '/')).text()) + JSON.stringify(await (await get(object, '/health')).json());
    for (const secret of [...Object.values(SECRETS), env.HOLDBACK_KEY as string, (env.HOLDBACK_KEY as string).slice(2)]) {
      expect(stored).not.toContain(secret);
      expect(logs.join('\n')).not.toContain(secret);
      expect(shown).not.toContain(secret);
    }
    // The export, to the owner's signature, holds the deal and no secret.
    const exported = await get(object, '/export', await ownerHeaders(OWNER_KEY));
    expect(exported.status).toBe(200);
    const body = (await exported.json()) as J;
    expect(body.journal.deals[id].stage).toBe('delivered');
    for (const secret of [...Object.values(SECRETS), (env.HOLDBACK_KEY as string).slice(2)]) expect(JSON.stringify(body)).not.toContain(secret);
  }, 45_000);
});

describe("a seller's own Worker (T-478): the day's cap", () => {
  it('counts offers in storage, so a restart of the object starts no new count', async () => {
    const b = bundleFor((await startJobStub({ key: SECRETS.JOBS_API_KEY, readsUntilComplete: 1 }).then((s) => ((stub = s), s))).base, { config: { quoteRateLimit: { overall: { requests: 2, windowSec: 86_400 } } } });
    const first = await seller({ bundle: b });
    expect((await quote(first.object, agent('buyer-1'))).status).toBe(200);
    expect((await quote(first.object, agent('buyer-2'), 'wrong')).status).toBe(401); // a refused quote takes no place
    const second = await seller({ bundle: b, storage: first.storage });
    expect((await quote(second.object, agent('buyer-2'))).status).toBe(200);
    const third = await seller({ bundle: b, storage: first.storage });
    const over = await quote(third.object, agent('buyer-1'));
    expect(over.status).toBe(429);
    expect(over.body.detail).toMatch(/at most 2 offers a UTC day/);
  }, 45_000);
});

describe("a seller's own Worker (T-478): the export", () => {
  it('answers 401 with no signature, another key, an old time or a signature over another host', async () => {
    const { object } = await seller();
    expect((await get(object, '/export')).status).toBe(401);
    expect((await get(object, '/export', await ownerHeaders(generatePrivateKey()))).status).toBe(401);
    expect((await get(object, '/export', await ownerHeaders(OWNER_KEY, Math.floor(Date.now() / 1000) - 301))).status).toBe(401);
    expect((await get(object, '/export', await ownerHeaders(OWNER_KEY, Math.floor(Date.now() / 1000), 'other.workers.dev'))).status).toBe(401);
    expect((await get(object, '/export', await ownerHeaders(OWNER_KEY))).status).toBe(200);
  }, 30_000);
});

describe("a seller's own Worker (T-478): the address is the party's own", () => {
  it('takes https at the root of a host, or this machine over http, and refuses a path, plain http or a Crow zone', () => {
    expect(baseOf('https://reviews.example.com/').host).toBe('reviews.example.com');
    expect(baseOf('http://127.0.0.1:8787/').port).toBe('8787');
    for (const bad of ['http://reviews.example.com/', 'https://example.com/agents/x', 'https://crow.direct/', 'https://seller.crow.direct/', 'https://x.escrow.stream/', 'nope']) expect(() => baseOf(bad), bad).toThrow();
  });

  it('the Worker in front passes on only requests to its own host', async () => {
    const setup = setupOf(bundleFor('https://api.example.com/'));
    const reached: string[] = [];
    const env = { ...envFor(), SELLER: { idFromName: (n: string) => n, get: () => ({ fetch: async (r: Request) => (reached.push(r.url), new Response('ok')) }) } } as Env;
    const w = workerFor(setup);
    expect((await w.fetch(new Request(`${BASE}/agent.json`), env)).status).toBe(200);
    expect((await w.fetch(new Request('https://preview-1234.reviews.party-example.workers.dev/agent.json'), env)).status).toBe(404);
    expect((await w.fetch(new Request(`${BASE}/agent.json`), { ...env, SELLER_URL: 'https://crow.direct/' })).status).toBe(503);
    expect(reached).toEqual([`${BASE}/agent.json`]);
  });

  it('refuses a bundle with no owner, a field it does not take, or a seller the hosted check refuses', () => {
    const b = bundleFor('https://api.example.com/');
    expect(setupOf({ ...b, owner: 'me' }).bundleError).toMatch(/owner/);
    expect(setupOf({ ...b, extra: 1 }).bundleError).toMatch(/does not take/);
    expect(setupOf({ ...b, seller: { ...(b.seller as J), config: { ...(b.seller as J).config, port: 8791 } } }).bundleError).toMatch(/config\.port/);
    expect(setupOf(b).seller?.slug).toBe('reviews');
  });

  it('a refused seller still answers /export to the owner, so leave can take the journal and remove the Worker', async () => {
    const b = bundleFor('https://api.example.com/');
    const setup = setupOf({ ...b, seller: { ...(b.seller as J), slug: 'shop-' } });
    expect(setup.seller).toBeUndefined();
    expect(setup.owner).toBe(OWNER.address);
    const object = new OwnSellerObject({ storage: new FakeStorage() }, envFor(), setup);
    expect((await get(object, '/agent.json')).status).toBe(503);
    expect((await get(object, '/export', await ownerHeaders(OWNER_KEY))).status).toBe(200);
    expect((await get(object, '/export')).status).toBe(401);
    const env = { ...envFor(), SELLER: { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('ok') }) } } as Env;
    expect((await workerFor(setup).fetch(new Request(`${BASE}/export`), env)).status).toBe(200);
    expect((await workerFor(setup).fetch(new Request(`${BASE}/quote`), env)).status).toBe(503);
  });
});
