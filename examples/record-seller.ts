// Crow's own product (T-444): the checked deal record of any public deal, sold through the seller adapter. This file is
// the seller's API the adapter calls (its three calls, as examples/seller-adapter-stub.ts serves them), around
// examples/deal-record.ts. It holds no key and no credential: it reads the operators' public routes only, and it uses the
// buyer's input as one deal ID (0x and 64 lowercase hex characters) and nothing else. The terms are
// fixtures/terms/deal-record.yaml; Crow's signer signs an offer only when it equals them (T-443).
//   node examples/record-seller.ts serve [--port <n>]
//       serves POST /quote, POST /jobs and GET /jobs/<id>/result on 127.0.0.1 (default port 8792). HOLDBACK_OPERATORS:
//       the operators it reads (two or more).
//   node examples/record-seller.ts template
//       prints the adapter's deal template (deliverable and checks) from the terms file, for its `template` setting.
//   node examples/record-seller.ts config <the template's path> <the journal's path>
//       prints an adapter configuration for the product: this API's three calls, the one scope field `deal`, no
//       options, and the terms file's windows. Run the adapter with CROW_SIGNER_URL so Crow's signer signs.
import { randomUUID } from 'node:crypto';
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

export interface RecordSeller {
  url: string;
  api: { quote: string; start: string; result: string };
  close(): Promise<void>;
}

/**
 * Serves the three calls the seller adapter makes. A quote reads the deal's terms from the first operator only to
 * refuse a deal that is not public; the job writes the deal's record from every operator (deal-record.ts).
 */
export async function startRecordSeller(o: { operators: string[]; port?: number; file?: string }): Promise<RecordSeller> {
  if (o.operators.length < 2) throw new Error('the record reads two or more operators: set HOLDBACK_OPERATORS');
  const operators = o.operators.map((u) => u.replace(/\/+$/, ''));
  const terms = loadTermsFile(o.file ?? TERMS_FILE);
  const jobs = new Map<string, { deal: string; state: 'running' | 'done' | 'failed'; bytes: Buffer | undefined }>();
  const byKey = new Map<string, string>();
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
  const tokenOf = async (): Promise<string> => {
    const d = (await (await fetch(`${operators[0]}/.well-known/holdback.json`, { signal: AbortSignal.timeout(10_000) })).json()) as J;
    const id = d?.demo?.token?.id;
    if (typeof id !== 'string') throw new Error('the operators name no token');
    return id;
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
        const t = await fetch(`${operators[0]}/v1/commitments/${deal}/terms`, { signal: AbortSignal.timeout(10_000) });
        const found = t.ok ? ((await t.json()) as J) : null;
        if (found?.disclosure?.level !== 'public') return send(400, { type: 'invalid_scope', detail: 'no public deal has that ID on these operators' });
        return send(200, { quoteId: randomUUID(), price: { token: await tokenOf(), amount: terms.price.amount }, deliverWithinSec: terms.timing.deliverWithinSec });
      }
      if (req.method === 'POST' && path === '/jobs') {
        const body = await read(req);
        const why = quoteRefusal({ scope: body?.scope });
        if (why || typeof body?.commitmentId !== 'string') return send(400, { type: 'invalid_scope', detail: why ?? 'the start names no commitmentId' });
        const key = String(req.headers['idempotency-key'] ?? body.commitmentId);
        const known = byKey.get(key);
        if (known) return send(200, { jobId: known });
        const jobId = randomUUID();
        const job = { deal: body.scope.deal as string, state: 'running' as 'running' | 'done' | 'failed', bytes: undefined as Buffer | undefined };
        jobs.set(jobId, job);
        byKey.set(key, jobId);
        // The record of the deal the buyer named, from every operator's public routes; no key opens anything.
        void dealRecord(job.deal as Hex, { operators, party: 'buyer' }).then(
          (r) => Object.assign(job, { state: 'done', bytes: Buffer.from(JSON.stringify(r, null, 2)) }),
          () => Object.assign(job, { state: 'failed' }),
        );
        return send(200, { jobId });
      }
      const m = /^\/jobs\/([0-9a-f-]{36})\/result$/.exec(path);
      if (req.method === 'GET' && m) {
        const job = jobs.get(m[1]!);
        if (!job) return send(404, { type: 'not_found', detail: 'no such job' });
        if (job.state === 'running') return send(202, { status: 'running' });
        if (job.state === 'failed') return send(502, { type: 'record_failed', detail: 'the record could not be written from the operators' });
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
  const [command, a, b] = argv;
  if (command === 'template' && argv.length === 1) return console.log(JSON.stringify(recordTemplate(), null, 2)), 0;
  if (command === 'config' && a && b && argv.length === 3) {
    console.log(JSON.stringify(recordAdapterConfig({ api: { quote: 'http://127.0.0.1:8792/quote', start: 'http://127.0.0.1:8792/jobs', result: 'http://127.0.0.1:8792/jobs/{jobId}/result' }, template: a, journal: b }), null, 2));
    return 0;
  }
  if (command === 'serve') {
    const at = argv.indexOf('--port');
    const port = at >= 0 ? Number(argv[at + 1]) : 8792;
    const operators = String(process.env['HOLDBACK_OPERATORS'] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const s = await startRecordSeller({ operators, port });
    console.log(`listening ${s.url}`);
    return -1;
  }
  console.error('node examples/record-seller.ts serve [--port <n>] | template | config <template path> <journal path>');
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
