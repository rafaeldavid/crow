// The replay's job API (T-500): the seller's own HTTP API in the local run, in the shape the seller adapter calls
// (examples/seller-adapter-stub.ts), answering with the demo security review of tools/duet/review.ts. The repository's
// stub stays as it is: it is bundled into buy.mjs and setup.mjs, and its sample report names other files.
//
//   POST /quote              {scope}                         -> {quoteId, price: {token, amount}, deliverWithinSec}
//   POST /jobs               {commitmentId, quoteId, scope}  -> {jobId}; the same Idempotency-Key gives the same job
//   GET  /jobs/<id>/result                                   -> 202 while the job runs; 200 with the report
//
// It reviews one scope only, the demo's: a quote for any other scope answers 422. The price is the demo's quote,
// 40.00 test tokens, due within a day.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { StubSellerApi } from '../../examples/seller-adapter-stub.ts';
import { REVIEW_PRICE_UNITS, REVIEW_SCOPE, reviewReport, type ReportKind } from './review.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ReviewJobApiOptions {
  /** `ok`: the demo report, which the five checks pass. `missing-file`: it leaves out the last file in scope. */
  report?: Extract<ReportKind, 'ok' | 'missing-file'>;
  /** The token the quote names: the settlement layer's token ID. Default `tUSD`, SimChain's. */
  token?: string;
  /** How many times the result answers 202 before the job is complete. Default 1. */
  pollsUntilComplete?: number;
}

export const DELIVER_WITHIN_SEC = 86_400;

const sameScope = (s: J) => s?.commit === REVIEW_SCOPE.commit && JSON.stringify(s?.files) === JSON.stringify(REVIEW_SCOPE.files) && Number(s?.lines) === REVIEW_SCOPE.lines;

async function json(req: IncomingMessage): Promise<J> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function startReviewJobApi(o: ReviewJobApiOptions = {}): Promise<StubSellerApi> {
  const calls = { quote: 0, start: 0, result: 0 };
  const quotes: J[] = [];
  const starts: J[] = [];
  const jobs = new Map<string, { jobId: string; commitmentId: string; polls: number }>(); // by Idempotency-Key
  let completeAll = false;
  let report: ReportKind = o.report ?? 'ok';
  const refuse = { detail: `this job API reviews one scope only: commit ${REVIEW_SCOPE.commit}, files ${REVIEW_SCOPE.files.join(', ')}, ${REVIEW_SCOPE.lines} lines` };

  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://jobs').pathname;
      if (req.method === 'POST' && path === '/quote') {
        calls.quote++;
        const asked = await json(req);
        quotes.push(asked);
        if (!sameScope(asked.scope)) return send(422, refuse);
        return send(200, { quoteId: `q-${calls.quote}`, price: { token: o.token ?? 'tUSD', amount: REVIEW_PRICE_UNITS }, deliverWithinSec: DELIVER_WITHIN_SEC });
      }
      if (req.method === 'POST' && path === '/jobs') {
        calls.start++;
        const key = String(req.headers['idempotency-key'] ?? '');
        if (!key) return send(400, { detail: 'POST /jobs needs an Idempotency-Key' });
        const started = await json(req);
        starts.push(started);
        if (!sameScope(started.scope)) return send(422, refuse);
        if (!jobs.has(key)) jobs.set(key, { jobId: `job-${jobs.size + 1}`, commitmentId: started.commitmentId, polls: 0 });
        return send(200, { jobId: jobs.get(key)!.jobId });
      }
      const result = /^\/jobs\/([^/]+)\/result$/.exec(path);
      if (req.method === 'GET' && result) {
        calls.result++;
        const job = [...jobs.values()].find((j) => j.jobId === result[1]);
        if (!job) return send(404, { detail: 'no such job' });
        if (!completeAll && job.polls++ < (o.pollsUntilComplete ?? 1)) return send(202, { status: 'running' });
        return res.writeHead(200, { 'content-type': 'application/json' }).end(reviewReport(report));
      }
      return send(404, { detail: 'not found' });
    })().catch((e: Error) => send(400, { detail: e.message }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    api: { quote: `${url}/quote`, start: `${url}/jobs`, result: `${url}/jobs/{jobId}/result` },
    calls,
    quotes,
    starts,
    jobs: () => [...jobs.values()].map(({ jobId, commitmentId }) => ({ jobId, commitmentId })),
    completeAll: () => void (completeAll = true),
    setReport: (kind) => {
      if (kind !== 'ok' && kind !== 'missing-file') throw new Error(`the review job API has no ${kind} report`);
      report = kind;
    },
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
