// Crow's own product (T-444): the checked deal record of any public deal, sold through the seller adapter. This file is
// the seller's API the adapter calls (its three calls, as examples/seller-adapter-stub.ts serves them), around
// examples/deal-record.ts. It holds no key and no credential: it reads the operators' public routes only, and it uses the
// buyer's input as one deal ID (0x and 64 lowercase hex characters) and nothing else. The terms are
// fixtures/terms/deal-record.yaml; Crow's signer signs an offer only when it equals them (T-443).
//   node examples/record-seller.ts serve [--port <n>]
//       serves POST /quote, POST /jobs and GET /jobs/<id>/result on 127.0.0.1 (default port 8792; 0 picks a free one).
//       HOLDBACK_OPERATORS: the operators it reads (two or more). Every request it sends, its own and deal-record.ts's,
//       goes through a guard: GET only, to those operators' origins only, no redirect followed, each answer at most 4 MiB.
//   node examples/record-seller.ts template
//       prints the adapter's deal template (deliverable and checks) from the terms file, for its `template` setting.
//   node examples/record-seller.ts config <the template's path> <the journal's path> [--port <n>]
//       prints an adapter configuration for the product: this API's three calls, the one scope field `deal`, no
//       options, and the terms file's windows. Run the adapter with CROW_SIGNER_URL so Crow's signer signs.
// The price is the terms file's, in the token the operators name: tUSDC on Sepolia, tUSD on SimChain.
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { loadTermsFile } from '@holdback/testkit';
import type { Hex } from 'viem';
import { dealRecord } from './deal-record.ts';
import { isMain } from './entry.ts';
import type { SellerAdapterConfig } from './seller-adapter-core.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
/** The product's terms: what is sold, its checks, its price and its windows. */
export const TERMS_FILE = fileURLToPath(new URL('../fixtures/terms/deal-record.yaml', import.meta.url));
const DEAL = /^0x[0-9a-f]{64}$/;
/** The longest request body read, in bytes: a quote or a start is a few hundred. */
const MAX_BODY_BYTES = 16 * 1024;
/** The largest answer the guard reads from an operator, in bytes. */
export const MAX_ANSWER_BYTES = 4 * 1024 * 1024;
/** A job's ID: the deal it records, and a hash of the start's idempotency key. After a restart the ID alone restarts the job. */
const JOB = /^(0x[0-9a-f]{64})\.([0-9a-f]{16})$/;

/** The adapter's deal template from the terms file: the deliverable and the checks, `{{deal}}` in place of the deal. */
export function recordTemplate(file = TERMS_FILE): { deliverable: J; checks: J[] } {
  const t = loadTermsFile(file);
  return { deliverable: t.deliverable, checks: t.acceptance.deterministicChecks as J[] };
}

/** The adapter configuration for the product: one scope field, no options, no terms rules, the terms file's windows. */
export function recordAdapterConfig(o: { api: { quote: string; start: string; result: string }; template: string; journal: string; port?: number; file?: string }): Partial<SellerAdapterConfig> {
  const t = loadTermsFile(o.file ?? TERMS_FILE);
  const { maxSubmissions: _m, ...timing } = t.timing as J; // eslint-disable-line @typescript-eslint/no-unused-vars
  return {
    sellerApi: o.api, template: o.template, journal: o.journal, ...(o.port === undefined ? {} : { port: o.port }),
    scope: { deal: { type: 'string', pattern: DEAL.source } }, options: {}, termsRules: [], timing, reportSalt: false,
  } as Partial<SellerAdapterConfig>;
}

/** Why a quote's body is refused, or null: exactly `{scope: {deal}}`, with nothing else the buyer could slip in. */
export function quoteRefusal(body: J): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'the quote is not a JSON object';
  const extra = Object.keys(body).filter((k) => k !== 'scope' && !(k === 'options' && isEmpty(body.options)));
  if (extra.length) return `the quote takes only scope, not ${extra.slice(0, 3).map((k) => String(k).slice(0, 40)).join(', ')}`;
  const s = body.scope;
  if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).length !== 1 || typeof s.deal !== 'string') return 'the scope holds exactly one field, deal';
  if (!DEAL.test(s.deal)) return 'deal is a commitment ID: 0x and 64 lowercase hex characters';
  return null;
}
const isEmpty = (v: J) => v === undefined || (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/**
 * A fetch that sends GET requests only, to the given origins only, follows no redirect, and reads each answer up to
 * `maxBytes`: what the record seller and deal-record.ts send through, so an operator cannot point the record elsewhere
 * or fill memory.
 */
export function guardedFetch(origins: string[], maxBytes = MAX_ANSWER_BYTES, base: typeof fetch = fetch): typeof fetch {
  const allowed = new Set(origins.map((u) => new URL(u).origin));
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET') throw new Error(`the record seller sends GET requests only, not ${method}`);
    if (!allowed.has(url.origin)) throw new Error(`the record seller reads the configured operators only, not ${url.origin}`);
    const res = await base(url, { ...init, method: 'GET', redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) throw new Error(`an operator answered a redirect (${res.status}): the record seller follows none`);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const r = reader ? await reader.read() : { done: true as const, value: undefined };
      if (r.done) break;
      size += r.value.length;
      if (size > maxBytes) {
        await reader!.cancel();
        throw new Error(`an operator's answer is above ${maxBytes} bytes`);
      }
      chunks.push(r.value);
    }
    return new Response(Buffer.concat(chunks), { status: res.status, headers: res.headers });
  }) as typeof fetch;
}

/** The record as bytes: JSON with every character above 0x7E written as \uXXXX, so the same value holds no hidden character as raw text. */
export const recordBytes = (r: J): Buffer => Buffer.from(JSON.stringify(r, null, 2).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`), 'utf8');

export interface RecordSeller {
  url: string;
  api: { quote: string; start: string; result: string };
  close(): Promise<void>;
}

/**
 * Serves the three calls the seller adapter makes. A quote reads the deal's terms from every operator to refuse a deal
 * that is not public: one operator that answers public and none that answers otherwise. The job writes the deal's
 * record from every operator (deal-record.ts). `fetch` is the request function its own reads use.
 */
export async function startRecordSeller(o: { operators: string[]; port?: number; file?: string; fetch?: typeof fetch }): Promise<RecordSeller> {
  if (o.operators.length < 2) throw new Error('the record reads two or more operators: set HOLDBACK_OPERATORS');
  const operators = o.operators.map((u) => u.replace(/\/+$/, ''));
  const get = o.fetch ?? fetch;
  const terms = loadTermsFile(o.file ?? TERMS_FILE);
  /** One record job per sale, by job ID; a failed one is started again on the next result poll. */
  const jobs = new Map<string, { state: 'running' | 'done' | 'failed'; bytes: Buffer | undefined }>();
  /** Which deal each idempotency key started: the same key with another deal is a conflict. */
  const byKey = new Map<string, string>();
  const run = (jobId: string, deal: string) => {
    const job = { state: 'running' as 'running' | 'done' | 'failed', bytes: undefined as Buffer | undefined };
    jobs.set(jobId, job);
    // The record of the deal the buyer named, from every operator's public routes: an outsider's view, no key.
    void dealRecord(deal as Hex, { operators, party: 'seller' }).then(
      (r) => Object.assign(job, { state: 'done', bytes: recordBytes(r) }),
      () => Object.assign(job, { state: 'failed' }),
    );
  };
  const read = async (req: IncomingMessage): Promise<J> => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_BODY_BYTES) return undefined;
      chunks.push(c as Buffer);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return undefined;
    }
  };
  const answer = async (url: string): Promise<J | undefined> => {
    try {
      const r = await get(url, { signal: AbortSignal.timeout(10_000) });
      return { status: r.status, body: r.ok ? await r.json().catch(() => null) : null };
    } catch {
      return undefined; // no answer: this operator neither confirms nor denies
    }
  };
  const server: Server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
    const path = new URL(req.url ?? '/', 'http://record').pathname;
    try {
      if (req.method === 'POST' && path === '/quote') {
        const body = await read(req);
        const why = quoteRefusal(body);
        if (why) return send(400, { type: 'invalid_scope', detail: why });
        const deal = body.scope.deal as string;
        const said = (await Promise.all(operators.map((op) => answer(`${op}/v1/commitments/${deal}/terms`)))).filter((x) => x !== undefined);
        if (!said.some((x) => x.body?.disclosure?.level === 'public') || said.some((x) => x.body?.disclosure?.level !== 'public')) return send(400, { type: 'invalid_scope', detail: 'no public deal has that ID on these operators' });
        const found = (await Promise.all(operators.map((op) => answer(`${op}/.well-known/holdback.json`)))).find((x) => typeof x?.body?.demo?.token?.id === 'string');
        if (!found) return send(502, { type: 'record_failed', detail: 'the operators name no token' });
        return send(200, { quoteId: createHash('sha256').update(deal).digest('hex').slice(0, 32), price: { token: found.body.demo.token.id, amount: terms.price.amount }, deliverWithinSec: terms.timing.deliverWithinSec });
      }
      if (req.method === 'POST' && path === '/jobs') {
        const body = await read(req);
        const why = quoteRefusal({ scope: body?.scope });
        if (why || typeof body?.commitmentId !== 'string') return send(400, { type: 'invalid_scope', detail: why ?? 'the start names no commitmentId' });
        const deal = body.scope.deal as string;
        const key = String(req.headers['idempotency-key'] ?? body.commitmentId);
        const known = byKey.get(key);
        if (known !== undefined && known !== deal) return send(409, { type: 'idempotency_conflict', detail: 'this Idempotency-Key started a job for another deal' });
        byKey.set(key, deal);
        const jobId = `${deal}.${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
        if (!jobs.has(jobId)) run(jobId, deal);
        return send(200, { jobId });
      }
      const m = /^\/jobs\/([^/]+)\/result$/.exec(path);
      if (req.method === 'GET' && m) {
        const id = JOB.exec(m[1]!);
        if (!id) return send(404, { type: 'not_found', detail: 'no such job' });
        const job = jobs.get(m[1]!);
        // A job this process does not hold (after a restart) or one that failed (every operator down) runs again.
        if (!job || job.state === 'failed') {
          run(m[1]!, id[1]!);
          return send(202, { status: 'running' });
        }
        if (job.state === 'running') return send(202, { status: 'running' });
        return res.writeHead(200, { 'content-type': 'application/json' }).end(job.bytes);
      }
      return send(404, { type: 'not_found', detail: 'this API serves POST /quote, POST /jobs and GET /jobs/<id>/result' });
    } catch {
      return send(502, { type: 'record_failed', detail: 'the operators did not answer' });
    }
  });
  await new Promise<void>((ok) => server.listen(o.port ?? 0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    api: { quote: `${url}/quote`, start: `${url}/jobs`, result: `${url}/jobs/{jobId}/result` },
    close: () => new Promise((ok) => (server.closeAllConnections(), server.close(() => ok()))),
  };
}

async function main(argv: string[]): Promise<number> {
  const args = [...argv];
  const at = args.indexOf('--port');
  const port = at >= 0 ? Number(args.splice(at, 2)[1]) : 8792;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) return console.error('--port takes 0 to 65535'), 2;
  const [command, a, b] = args;
  if (command === 'template' && args.length === 1) return console.log(JSON.stringify(recordTemplate(), null, 2)), 0;
  if (command === 'config' && a && b && args.length === 3) {
    const base = `http://127.0.0.1:${port}`;
    console.log(JSON.stringify(recordAdapterConfig({ api: { quote: `${base}/quote`, start: `${base}/jobs`, result: `${base}/jobs/{jobId}/result` }, template: a, journal: b }), null, 2));
    return 0;
  }
  if (command === 'serve' && args.length === 1) {
    const operators = String(process.env['HOLDBACK_OPERATORS'] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    // Every request this process sends, deal-record.ts's included, goes through the guard.
    const guard = guardedFetch(operators);
    globalThis.fetch = guard;
    const s = await startRecordSeller({ operators, port, fetch: guard });
    console.log(`listening ${s.url}`);
    return -1;
  }
  console.error('node examples/record-seller.ts serve [--port <n>] | template | config <template path> <journal path> [--port <n>]');
  return 2;
}

if (isMain(import.meta.url, 'record-seller')) {
  main(process.argv.slice(2)).then(
    (code) => void (code >= 0 && (process.exitCode = code)),
    (e: unknown) => {
      console.error((e as Error).message);
      process.exitCode = 1;
    },
  );
}
