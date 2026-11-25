// A seller's own Worker (T-478): the seller adapter's core on the party's own Cloudflare account, at an address the
// party chose, with the party's own secrets. It is the hosted seller of ADR-0037 in a second shell: the same core
// (examples/seller-adapter-core.ts), the same bundle check and journal storage (apps/hosted-sellers/src), none of them
// changed. What differs is who runs it and where: the party deploys it, at the root of a host of its own (a
// workers.dev name or a host on its own zone), and Crow runs nothing of it. `node setup.mjs cloudflare` writes its
// configuration (examples/setup-cloudflare.ts); site/build.mjs bundles this file into site/seller-worker.mjs.
//
//   GET  /             the seller's page: a <script id="crow-agent"> card with the quote and defaults addresses
//   GET  /agent.json   the same card as JSON
//   GET  /health       operational or degraded, the open deals by stage, why each refused result was refused
//   GET  /export       the journal, to the folder that owns the Worker only: a signature of the owner's key over
//                      the host and the time, within 300 s (`setup.mjs leave` sends it before it removes the Worker)
//   POST /quote, GET /defaults, GET /deals/<id>, POST /deals/<id>/ready, /job and /refund: the adapter's own routes
//
// The bundle (seller-bundle.txt beside the Worker) holds the owner's public address and a hosted seller's bundle: the
// configuration, the template and the files it names. No secret. The secrets are Worker secrets, read by name:
// HOLDBACK_KEY, the Worker's own signing key, and the variables the configuration names for its credentials. Test
// tokens only: the object starts only on a chain in TEST_CHAINS.
import { getAddress, verifyMessage, type Hex } from 'viem';
import { createSellerAdapter, type SellerAdapterCore, type Stage } from '../../../examples/seller-adapter-core.ts';
import { checkBundle, type HostedSeller } from '../../hosted-sellers/src/bundle.ts';
import { journalStore, TEST_CHAINS, type DurableObjectState } from '../../hosted-sellers/src/worker.ts';

export { TEST_CHAINS };

interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

export interface Env {
  SELLER: DurableObjectNamespace;
  /** Comma-separated operator base URLs, two distinct origins. */
  OPERATOR_URLS: string;
  /** The Worker's public address: https://<host>/, the root of a host the party chose. */
  SELLER_URL: string;
  /** Worker secret: the Worker's own signing key. */
  HOLDBACK_KEY?: string;
  /** The Worker secrets the configuration names for its credentials, by those names. */
  [name: string]: unknown;
}

/** What `setup.mjs cloudflare` writes beside the Worker as seller.json. */
export interface OwnBundle {
  /** The folder's standing address: the one key that may read the journal through GET /export. */
  owner: string;
  /** A hosted seller's bundle (apps/hosted-sellers/src/bundle.ts): slug, card, config and files. */
  seller: unknown;
}

/** The text a `leave` signs to read the journal: the Worker's host and the time in whole seconds. */
export const exportMessage = (host: string, time: number) => `crow own-seller export ${host} ${time}`;
/** How far the export's time may be from the Worker's clock, in seconds. */
export const EXPORT_WINDOW_SEC = 300;
/** Hosts Crow serves from: a party's Worker never takes an address there. */
export const CROW_ZONES: readonly string[] = ['crow.direct', 'escrow.stream'];
const isCrowHost = (host: string) => CROW_ZONES.some((z) => host === z || host.endsWith(`.${z}`));

const RETRY_MS = 60_000;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const scriptJson = (v: unknown) => JSON.stringify(v, null, 2).replace(/</g, '\\u003c');

/** The object's name: one per Worker, the same across deploys, so a deploy keeps the seller's open deals. */
export const OBJECT_NAME = 'crow-own-seller';

/** The bundle, checked once per isolate: a bad bundle makes every request answer 503, and the log says why. */
export interface OwnSetup {
  seller: HostedSeller | undefined;
  owner: string | undefined;
  bundleError: string | undefined;
}

export function setupOf(raw: unknown): OwnSetup {
  // The owner is read on its own, so a seller the check refuses can still be exported and removed by `leave`.
  const b = raw as OwnBundle;
  const owner = b !== null && typeof b === 'object' && typeof b.owner === 'string' && /^0x[0-9a-fA-F]{40}$/.test(b.owner) ? getAddress(b.owner) : undefined;
  try {
    if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new Error('the bundle must be one JSON object: owner and seller');
    for (const k of Object.keys(b)) if (!['owner', 'seller'].includes(k)) throw new Error(`the bundle has a field the Worker does not take: ${String(k).slice(0, 40)}`);
    if (owner === undefined) throw new Error("owner must be the folder's address: 0x and 40 hex characters");
    return { seller: checkBundle(b.seller), owner, bundleError: undefined };
  } catch (e) {
    const bundleError = (e as Error).message;
    console.log(`The seller's bundle is refused: ${bundleError}`);
    return { seller: undefined, owner, bundleError };
  }
}

/**
 * The Worker's own address from SELLER_URL: https at the root of a host that is not Crow's, or this machine over
 * http for a local run (`wrangler dev --local`). Throws, naming why, for anything else.
 */
export function baseOf(sellerUrl: unknown): URL {
  let base: URL;
  try {
    base = new URL(String(sellerUrl));
  } catch {
    throw new Error('SELLER_URL is not an address: set it to https://<host>/, the address the party chose');
  }
  const local = base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname);
  if (base.protocol !== 'https:' && !local) throw new Error(`SELLER_URL is ${base.href}: a seller's Worker serves https only`);
  if (base.pathname !== '/' || base.search !== '' || base.hash !== '' || base.username !== '' || base.password !== '') throw new Error(`SELLER_URL is ${base.href}: the Worker serves the root of its own host, https://<host>/`);
  if (isCrowHost(base.hostname)) throw new Error(`SELLER_URL is ${base.href}: a party's own Worker never takes an address on Crow's zones`);
  return base;
}

/** The seller's Durable Object. entry.ts exports a subclass bound to the deployed bundle. */
export class OwnSellerObject {
  private core: Promise<SellerAdapterCore> | undefined;
  private failure: string | undefined;
  private retryAt = 0;
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
    private readonly setup: OwnSetup,
  ) {}

  /** The environment the core sees: the signing key, the operators, and the credentials the configuration names. */
  private coreEnv(s: HostedSeller): Record<string, string | undefined> {
    // A HOLDBACK_ variable would change what verify.ts pins (HOLDBACK_DEPLOYMENT, HOLDBACK_CHAIN_ID): refuse them all.
    const stray = Object.keys(this.env).find((k) => k.startsWith('HOLDBACK_') && k !== 'HOLDBACK_KEY');
    if (stray) throw new Error(`${stray} is set on this Worker; a seller's Worker signs for the pinned deployment only: remove it`);
    const out: Record<string, string | undefined> = { HOLDBACK_KEY: typeof this.env.HOLDBACK_KEY === 'string' ? this.env.HOLDBACK_KEY : undefined, HOLDBACK_OPERATORS: this.env.OPERATOR_URLS };
    for (const name of s.credentialVars) out[name] = typeof this.env[name] === 'string' ? (this.env[name] as string) : undefined;
    return out;
  }

  /** The core, started once: on the first request or alarm, and again after a start that failed. */
  private open(s: HostedSeller): Promise<SellerAdapterCore> {
    if (!this.core && Date.now() < this.retryAt) return Promise.reject(new Error(this.failure ?? 'not started'));
    this.core ??= (async () => {
      const base = baseOf(this.env.SELLER_URL);
      const store = journalStore(this.state.storage, (line) => console.log(line));
      const core = await createSellerAdapter({ ...s.config, log: (line) => console.log(`${new Date().toISOString()} ${line}`) }, this.coreEnv(s), {
        readText: (name) => {
          if (!Object.hasOwn(s.files, name)) throw Object.assign(new Error(`the bundle holds no file ${name.slice(0, 80)}`), { code: 'ENOENT' });
          return s.files[name] as string;
        },
        loadJournal: () => store.load(),
        // Not awaited: the output gate holds the next outgoing request until the writes are stored.
        saveJournal: (journal) => store.save(journal),
      });
      if (!TEST_CHAINS.includes(core.chainId)) {
        await core.close();
        throw new Error(`the operators serve chain ${core.chainId}; a seller's Worker signs on test networks only (${TEST_CHAINS.join(', ')})`);
      }
      core.announce(`serves POST ${base.origin}/quote; journal in its Durable Object`);
      this.failure = undefined;
      return core;
    })().catch((e: Error) => {
      this.core = undefined;
      this.failure = e.message;
      this.retryAt = Date.now() + RETRY_MS;
      console.log(`The seller did not start: ${e.message}`);
      throw e;
    });
    return this.core;
  }

  private async schedule(at: number): Promise<void> {
    const set = await this.state.storage.getAlarm();
    if (set === null || set > at || set < Date.now() - 5000) await this.state.storage.setAlarm(at);
  }

  private card(s: HostedSeller, core: SellerAdapterCore): Record<string, unknown> {
    const base = baseOf(this.env.SELLER_URL).origin;
    return {
      type: 'crow-agent',
      name: s.card.name,
      ...(core.perDealKeys ? {} : { seller: core.address }),
      offers: [{ id: s.card.item, ...(s.card.description === undefined ? {} : { description: s.card.description }), pricing: { kind: 'quoted', quote: `${base}/quote`, defaults: `${base}/defaults` } }],
      health: `${base}/health`,
      operatedBy: 'The seller runs this Worker on its own Cloudflare account. It reaches the operators over their public API, as any agent does.',
      configSha256: s.configSha256,
      testTokensOnly: true,
    };
  }

  /** GET /export: the journal, to a signature of the owner's key over this host and a time within 300 s. */
  private async export(request: Request): Promise<Response> {
    const time = Number(request.headers.get('x-crow-owner-time'));
    const signature = request.headers.get('x-crow-owner-signature') ?? '';
    const refused = json(401, { type: 'unauthorized', detail: "GET /export takes a signature of the owner's key: run setup.mjs leave from the folder" });
    if (!Number.isSafeInteger(time) || Math.abs(Date.now() / 1000 - time) > EXPORT_WINDOW_SEC || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return refused;
    const host = new URL(request.url).host;
    let ok = false;
    try {
      ok = await verifyMessage({ address: this.setup.owner as Hex, message: exportMessage(host, time), signature: signature as Hex });
    } catch {
      ok = false;
    }
    if (!ok) return refused;
    if (this.setup.owner === undefined) return refused;
    const journal = await journalStore(this.state.storage, () => undefined).load();
    return json(200, { type: 'crow-own-seller-export', host, exportedAt: new Date().toISOString(), journal: journal ?? { deals: {}, quotes: {} } });
  }

  async fetch(request: Request): Promise<Response> {
    const { seller } = this.setup;
    const path = new URL(request.url).pathname;
    const sub = path === '/' ? '' : path;
    // The export comes first: the owner can take its journal and remove the Worker even when the seller is refused.
    if (sub === '/export' && request.method === 'GET') return this.export(request);
    if (!seller) return json(503, { type: 'unavailable', detail: 'this seller is not set up' });
    if (sub === '/health' && request.method === 'GET') {
      let core: SellerAdapterCore | undefined;
      try {
        core = await this.open(seller);
      } catch {
        // reported below
      }
      const stages: Partial<Record<Stage, number>> = {};
      const open = (core?.deals() ?? []).filter((d) => !['delivered', 'closed'].includes(d.stage));
      for (const d of open) stages[d.stage] = (stages[d.stage] ?? 0) + 1;
      if (core?.hasOpen()) await this.schedule(Date.now() + core.pollMs);
      return json(core ? 200 : 503, { status: core ? 'operational' : 'degraded', seller: seller.slug, configSha256: seller.configSha256, ...(core ? { open: open.length, stages, refused: core.refusals() } : { reason: 'the seller could not start; its log says why' }) });
    }
    let core: SellerAdapterCore;
    try {
      core = await this.open(seller);
    } catch {
      await this.schedule(Date.now() + RETRY_MS);
      return json(503, { type: 'seller_unavailable', detail: 'the seller cannot take requests now; try again in a minute' });
    }
    let response: Response;
    if (sub === '' && request.method === 'GET') {
      const card = this.card(seller, core);
      const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(seller.card.name)}</title></head>
<body>
<h1>${escapeHtml(seller.card.name)}</h1>
${seller.card.description === undefined ? '' : `<p>${escapeHtml(seller.card.description)}</p>\n`}<p>This seller prices each job by quote on Crow, with test tokens only. A buyer's agent follows <a href="https://crow.direct/buy.txt">https://crow.direct/buy.txt</a> with the quote and defaults addresses in the card below.</p>
<p>The seller runs this Worker on its own Cloudflare account. It reaches the operators over their public API, as any agent does.</p>
<script type="application/json" id="crow-agent">${scriptJson(card)}</script>
</body></html>
`;
      response = new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    } else if (sub === '/agent.json' && request.method === 'GET') {
      response = json(200, this.card(seller, core));
    } else if (sub === '/quote' && request.method === 'POST') {
      response = await this.quote(seller, core, request);
    } else {
      response = await core.handle(request, sub);
    }
    if (core.hasOpen()) await this.schedule(Date.now() + core.pollMs);
    return response;
  }

  /**
   * POST /quote under the day's cap: the configuration's `quoteRateLimit.overall` with a window of 86,400 s is the most
   * offers in one UTC day, over all callers. The core counts its window in memory, which a restart of the object
   * empties (red team, T-478); this count is in storage. A place is taken before the quote and given back when no offer
   * was made, so two quotes at once cannot both take the last one.
   */
  private async quote(s: HostedSeller, core: SellerAdapterCore, request: Request): Promise<Response> {
    const limit = s.config.quoteRateLimit?.overall;
    if (!limit || limit.windowSec !== 86_400) return core.handle(request, '/quote');
    const now = new Date();
    const key = `offers:${now.toISOString().slice(0, 10)}`;
    const taken = (await this.state.storage.get<number>(key)) ?? 0;
    if (taken >= limit.requests) {
      const wait = Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000);
      return new Response(JSON.stringify({ type: 'rate_limited', detail: `this seller makes at most ${limit.requests} offers a UTC day; try again in ${wait} s` }), { status: 429, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': String(wait) } });
    }
    await this.state.storage.put({ [key]: taken + 1 });
    const response = await core.handle(request, '/quote');
    if (response.status !== 200) await this.state.storage.put({ [key]: Math.max(((await this.state.storage.get<number>(key)) ?? 1) - 1, 0) });
    return response;
  }

  /** Moves the open deals. It never throws: a throwing alarm is retried only six times, then never again. */
  async alarm(): Promise<void> {
    const { seller } = this.setup;
    if (!seller) return;
    let next: number | null;
    try {
      const core = await this.open(seller);
      core.wake();
      await core.idle();
      next = core.hasOpen() ? Date.now() + core.pollMs : null;
    } catch {
      next = Date.now() + RETRY_MS;
    }
    try {
      if (next !== null) await this.state.storage.setAlarm(next);
    } catch (e) {
      console.log(`The next alarm could not be set: ${(e as Error).message}. Any request sets it again.`);
    }
  }
}

/**
 * The Worker in front of the object. It passes on only requests to the host SELLER_URL names, so a preview address
 * or another route to the same Worker serves nothing; every other request answers 404.
 */
export function workerFor(setup: OwnSetup) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const exporting = new URL(request.url).pathname === '/export' && setup.owner !== undefined;
      if (!setup.seller && !exporting) return json(503, { type: 'unavailable', detail: 'this seller is not set up; its log says why' });
      let base: URL;
      try {
        base = baseOf(env.SELLER_URL);
      } catch (e) {
        console.log(`The seller's address is refused: ${(e as Error).message}`);
        return json(503, { type: 'unavailable', detail: 'this seller is not set up; its log says why' });
      }
      if (new URL(request.url).host !== base.host) return json(404, { type: 'not_found', detail: 'this Worker serves one address' });
      return env.SELLER.get(env.SELLER.idFromName(OBJECT_NAME)).fetch(request);
    },
  };
}
