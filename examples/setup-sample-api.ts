// Crow's sample product, and the small API that sells it (T-472). The setup command serves this API on the loopback
// address, inside its own process, and runs the seller adapter against it: the same three calls a party's own API
// answers (seller-adapter.ts), so the party's own API later takes this one's place with no other change.
//
//   POST /quote              {scope}                          -> {quoteId, price: {token, amount}}
//   POST /jobs               {commitmentId, quoteId, scope}   -> {jobId}; the same Idempotency-Key gives the same job
//   GET  /jobs/<id>/result                                    -> 200 with the result's bytes
//
// The product: squares.csv, the squares of the whole numbers from 1 to `rows`, for 1.00 of the settlement layer's test
// token. It is worth nothing and says so. Nothing here reads a key or calls another host.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The sample's price: 1.00 of a 6-decimal test token, in base units. */
export const SAMPLE_PRICE_UNITS = '1000000';
/** What a buyer's scope must hold, the scope the first deal asks for, and the deal template with its placeholders. */
export const SAMPLE = Object.freeze({
  scope: { rows: { type: 'integer', min: 3, max: 50 } } as const,
  firstScope: { rows: 5 },
  template: {
    deliverable: { kind: 'dataset', description: "Crow's sample product, worth nothing: squares.csv, the squares of the whole numbers from 1 to {{rows}}, one row per number.", format: 'text/csv' },
    checks: [
      { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['n', 'square'] },
      { id: 'rows', type: 'row_count_range', required: true, min: '{{rows}}', max: '{{rows}}' },
      { id: 'uniq', type: 'unique_key', required: true, columns: ['n'] },
    ],
  },
});

/** The sample result for a scope: `rows` lines of n and its square, under a header. */
export function sampleResult(scope: { rows: number }): Uint8Array {
  const lines = ['n,square'];
  for (let n = 1; n <= scope.rows; n++) lines.push(`${n},${n * n}`);
  return new TextEncoder().encode(`${lines.join('\n')}\n`);
}

export interface SampleApi {
  url: string;
  /** The three addresses, as the adapter's `sellerApi` setting takes them. */
  api: { quote: string; start: string; result: string };
  close(): Promise<void>;
}

async function json(req: IncomingMessage): Promise<J> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 65_536) throw new Error('the request is over 65,536 bytes');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** A port on the loopback address that is free now: the system picks it, and the caller keeps it for the folder. */
export async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** The three addresses of a sample API on `port`, as the adapter's `sellerApi` setting takes them. */
export const sampleAddresses = (port: number) => ({ quote: `http://127.0.0.1:${port}/quote`, start: `http://127.0.0.1:${port}/jobs`, result: `http://127.0.0.1:${port}/jobs/{jobId}/result` });

/**
 * Starts the sample API on the loopback address. `token` is the settlement layer's token ID. `port` is the folder's
 * own (adapter.json names it, and the adapter starts a job only at the address its offer was priced at), or 0 for a
 * port the system picks. A port another program holds stops the start, naming it.
 */
export async function startSampleApi(token: string, port = 0): Promise<SampleApi> {
  // The API keeps nothing: a job's ID carries the one number its result is made from. So a run that stops between
  // the job's start and the delivery loses nothing, and the next run's API answers for the same job.
  const rowsOf = (scope: J): number => {
    const rows = scope?.rows;
    if (!Number.isSafeInteger(rows) || rows < SAMPLE.scope.rows.min || rows > SAMPLE.scope.rows.max) throw new Error(`scope.rows must be a whole number from ${SAMPLE.scope.rows.min} to ${SAMPLE.scope.rows.max}`);
    return rows;
  };
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://sample').pathname;
      if (req.method === 'POST' && path === '/quote') {
        const rows = rowsOf((await json(req)).scope);
        return send(200, { quoteId: `sample-${rows}`, price: { token, amount: SAMPLE_PRICE_UNITS } });
      }
      if (req.method === 'POST' && path === '/jobs') {
        const key = String(req.headers['idempotency-key'] ?? '');
        if (!key) return send(400, { detail: 'POST /jobs needs an Idempotency-Key' });
        return send(200, { jobId: `squares-${rowsOf((await json(req)).scope)}` });
      }
      const result = /^\/jobs\/squares-([1-9][0-9]?)\/result$/.exec(path);
      if (req.method === 'GET' && result) return res.writeHead(200, { 'content-type': 'text/csv' }).end(sampleResult({ rows: rowsOf({ rows: Number(result[1]) }) }));
      if (req.method === 'GET' && /^\/jobs\/[^/]+\/result$/.test(path)) return send(404, { detail: 'no such job' });
      return send(404, { detail: 'not found' });
    })().catch((e: Error) => send(400, { detail: e.message }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) => reject(e.code === 'EADDRINUSE' ? new Error(`port ${port} on the loopback address is in use, and the sample API needs it: stop the program that holds it, or another run of this command`) : e));
    server.listen(port, '127.0.0.1', resolve);
  });
  const bound = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${bound}`,
    api: sampleAddresses(bound),
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
