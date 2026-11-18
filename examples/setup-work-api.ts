// The party's own work, sold from a template (T-543), and the small API that sells it. The setup command serves this
// API on the loopback address, inside its own process, beside the sample's (setup-sample-api.ts), and runs the seller
// adapter against it: the same three calls, so the adapter is the one every seller runs.
//
//   POST /quote              {scope: {}}                      -> {quoteId, price: {token, amount}}: the template's fixed price
//   POST /jobs               {commitmentId, quoteId, scope}   -> {jobId}: the job's ID is the deal's commitment ID
//   GET  /jobs/<id>/result                                    -> 202 until the work for that deal is in the folder's
//                                                                work/ directory, then 200 with its bytes
//
// The work for a deal is one file: work/<commitment ID>.<csv|json|txt|md>, or work/ready.<ext>, the finished work a
// seller named with --file, which every deal of the folder delivers. The API keeps nothing: the folder is the state,
// so a run that stops loses nothing and the next run's API answers for the same deal.
//
// Every call needs the credential the setup made for this run, in `Authorization: Bearer`: the folder is mode 0700,
// and without the credential any account on this machine could read unpaid work through the port. A work file is
// read through no symbolic link, and one that is empty or over the delivery limit counts as not there yet.
import { createHash, timingSafeEqual } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, join } from 'node:path';
import { plain } from './plain.ts';
import { DELIVERY_CAP_BYTES } from './seller-adapter-api.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The folder's directory for work, and the name of the finished work a seller named with --file. */
export const WORK_DIR = 'work';
const READY = 'ready';
/** The formats a delivery may have (spec/schemas/commitment.schema.json), each with its file extension. */
export const FORMATS: Readonly<Record<string, string>> = Object.freeze({ 'text/csv': 'csv', 'application/json': 'json', 'text/plain': 'txt', 'text/markdown': 'md' });
/** What a refusal says of a delivery's limits: the four formats and the size the live operators take. */
export const DELIVERY_LIMITS = `a delivery is CSV, JSON, plain text or Markdown (${Object.keys(FORMATS).join(', ')}) and at most ${DELIVERY_CAP_BYTES.toLocaleString('en-US')} bytes (1 MiB)`;
/** The work is due 23 hours after the offer when the template names no window: Crow's test buyer takes work due within 86,400 s of the post. */
export const DEFAULT_DELIVER_WITHIN_SEC = 82_800;
/** The largest template file the setup reads. */
const MAX_TEMPLATE_BYTES = 65_536;
/** The variable, in the adapter's `env` argument only, that carries this run's credential for the work API. */
export const WORK_CREDENTIAL_ENV = 'CROW_SETUP_WORK';
const BASE_UNITS = /^(0|[1-9][0-9]{0,77})$/;
const COMMITMENT_ID = /^0x[0-9a-f]{64}$/;

/** A template as the person wrote it: what is sold, the fixed price, the checks, and when the work is due. */
export interface WorkTemplate {
  deliverable: { kind: string; description: string; format: string };
  /** Base units of the settlement layer's token, as a decimal string. */
  price: string;
  checks: J[];
  /** Seconds from the offer to the delivery deadline. */
  deliverWithinSec: number;
}
/** A template to show a person: 5.00 of a 6-decimal test token for a CSV with two named columns. */
export const TEMPLATE_EXAMPLE = '{"deliverable": {"kind": "dataset", "description": "What the buyer gets, in a sentence.", "format": "text/csv"}, "price": "5000000", "checks": [{"id": "cols", "type": "csv_columns_exact", "required": true, "columns": ["name", "url"]}], "deliverWithinSec": 82800}';

/** Throws when `path` names an environment file: the setup reads none, whatever flag names it. */
export function refuseEnvFile(path: string, flag: string): void {
  if (/^\.env/i.test(basename(path))) throw new Error(`${flag} names ${plain(basename(path)).slice(0, 80)}, an environment file: the setup reads no .env file. Nothing was made or sent`);
}

/**
 * The template in `file`, checked for its shape. The commitment schema checks the rest (setup-check.ts, `template`).
 * It refuses only what cannot become an offer: a price or a window that is no whole number, a format no delivery has,
 * a field this version does not take. Nothing in it runs.
 */
export function readWorkTemplate(file: string): WorkTemplate {
  refuseEnvFile(file, '--template');
  const where = plain(file).slice(0, 200);
  let text: string;
  try {
    const bytes = readFileSync(file);
    if (bytes.length > MAX_TEMPLATE_BYTES) throw new Error(`is ${bytes.length} bytes; a template is at most ${MAX_TEMPLATE_BYTES}`);
    text = bytes.toString('utf8');
  } catch (e) {
    throw new Error(`--template: ${where} ${(e as NodeJS.ErrnoException).code === 'ENOENT' ? 'is not there' : (e as NodeJS.ErrnoException).code ? `cannot be read (${(e as NodeJS.ErrnoException).code})` : plain((e as Error).message)}. Nothing was made or sent`);
  }
  let t: J;
  try {
    t = JSON.parse(text);
  } catch {
    throw new Error(`--template: ${where} is not JSON. A template looks like ${TEMPLATE_EXAMPLE}`);
  }
  const isRecord = (v: J): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isRecord(t)) throw new Error(`--template: ${where} must hold one JSON object, like ${TEMPLATE_EXAMPLE}`);
  for (const k of Object.keys(t)) if (!['deliverable', 'price', 'checks', 'deliverWithinSec'].includes(k)) throw new Error(`--template: ${where} has a field this version does not take: ${plain(k).slice(0, 60)}. It takes deliverable, price, checks and deliverWithinSec`);
  if (!isRecord(t.deliverable) || typeof t.deliverable.description !== 'string' || typeof t.deliverable.kind !== 'string') throw new Error(`--template: ${where} needs deliverable: {"kind", "description", "format"}`);
  if (!Object.hasOwn(FORMATS, String(t.deliverable.format))) throw new Error(`--template: the format ${plain(String(t.deliverable.format)).slice(0, 60)} is none a delivery can have: ${DELIVERY_LIMITS}`);
  if (typeof t.price !== 'string' || !BASE_UNITS.test(t.price)) throw new Error(`--template: price must be base units of the test token as a decimal string, such as "5000000" for 5.00 of a 6-decimal token`);
  if (!Array.isArray(t.checks)) throw new Error(`--template: checks must be a list of declarative checks; it may be empty, and a buyer may then refuse the offer`);
  const within = t.deliverWithinSec ?? DEFAULT_DELIVER_WITHIN_SEC;
  if (!Number.isSafeInteger(within) || within < 0) throw new Error('--template: deliverWithinSec must be a whole number of seconds, 0 or more');
  // The adapter fills `{{name}}` from a buyer's scope, and this version's template takes none.
  const opens = (node: J): boolean => (typeof node === 'string' ? /(^|[^\\])\{\{/.test(node) : node !== null && typeof node === 'object' ? Object.entries(node).some(([k, v]) => opens(k) || opens(v)) : false);
  if (opens({ d: t.deliverable, c: t.checks })) throw new Error('--template: the text {{ starts a placeholder, and this version takes none: write \\\\{{ in the JSON file for the text {{');
  return { deliverable: t.deliverable, price: t.price, checks: t.checks, deliverWithinSec: within };
}

/** A plain file's bytes, read through no symbolic link, or why it is not work that can be delivered; undefined when nothing is there. */
export function readWorkFile(path: string, followLink = false): { bytes?: Uint8Array; problem?: string } | undefined {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | (followLink ? 0 : (constants.O_NOFOLLOW ?? 0)));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return undefined;
    return { problem: code === 'ELOOP' || code === 'EMLINK' ? 'is a symbolic link: the setup reads no work through a link. Put the file itself there' : `cannot be read (${plain(String(code))})` };
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { problem: 'is not a plain file' };
    if (stat.size === 0) return { problem: 'is empty: a delivery holds 1 byte or more' };
    if (stat.size > DELIVERY_CAP_BYTES) return { problem: `is ${stat.size.toLocaleString('en-US')} bytes: ${DELIVERY_LIMITS}` };
    const bytes = readFileSync(fd);
    if (bytes.length === 0 || bytes.length > DELIVERY_CAP_BYTES) return { problem: `changed while it was read: ${DELIVERY_LIMITS}` };
    return { bytes: new Uint8Array(bytes) };
  } finally {
    closeSync(fd);
  }
}

/** Where a deal's work goes, and where the finished work of --file is kept. */
export const workPath = (folder: string, commitmentId: string, format: string): string => join(folder, WORK_DIR, `${commitmentId}.${FORMATS[format]}`);
export const readyPath = (folder: string, format: string): string => join(folder, WORK_DIR, `${READY}.${FORMATS[format]}`);

/**
 * The work for one deal: `path` is where it goes; `bytes` is set when it is there and can be delivered, read from
 * `from` (the deal's own file, or the folder's finished work); `problem` says why a file that is there cannot be.
 */
export function workFor(folder: string, commitmentId: string, format: string): { path: string; from?: string; bytes?: Uint8Array; problem?: string } {
  if (!COMMITMENT_ID.test(commitmentId) || !Object.hasOwn(FORMATS, format)) throw new Error('not a deal of this folder');
  const path = workPath(folder, commitmentId, format);
  let dir;
  try {
    dir = lstatSync(join(folder, WORK_DIR));
  } catch {
    return { path }; // no work/ yet: no work
  }
  if (dir.isSymbolicLink() || !dir.isDirectory()) return { path, problem: `${WORK_DIR}/ is ${dir.isSymbolicLink() ? 'a symbolic link' : 'not a folder'}: the setup reads no work through a link. Make ${WORK_DIR}/ a plain folder` };
  for (const from of [path, readyPath(folder, format)]) {
    const read = readWorkFile(from);
    if (read?.problem) return { path, from, problem: `${from} ${read.problem}` };
    if (read?.bytes) return { path, from, bytes: read.bytes };
  }
  return { path };
}

/** The work API's addresses on `port`, as the adapter's `sellerApi` setting takes them: every call under one base URL, with the run's credential. */
export const workAddresses = (port: number) => ({
  baseUrl: `http://127.0.0.1:${port}/`,
  auth: { env: WORK_CREDENTIAL_ENV, header: 'authorization', prefix: 'Bearer ' },
  quote: `http://127.0.0.1:${port}/quote`,
  start: `http://127.0.0.1:${port}/jobs`,
  result: `http://127.0.0.1:${port}/jobs/{jobId}/result`,
});

export interface WorkApi {
  url: string;
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

/**
 * Starts the work API on the loopback address. `token` is the settlement layer's token ID and `price` the template's
 * fixed price; `folder` holds work/; `credential` is the one every call must carry; `port` is the folder's own
 * (adapter.json names it), or 0 for a port the system picks. A port another program holds stops the start, naming it.
 */
export async function startWorkApi(o: { token: string; price: string; folder: string; format: string; credential: string; port?: number }): Promise<WorkApi> {
  if (!BASE_UNITS.test(o.price) || !Object.hasOwn(FORMATS, o.format) || o.credential.length < 16) throw new Error('the work API needs a price in base units, a delivery format and a credential');
  const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();
  const wanted = digest(`Bearer ${o.credential}`);
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
    void (async () => {
      if (!timingSafeEqual(digest(String(req.headers.authorization ?? '')), wanted)) {
        req.resume();
        return send(401, { detail: "this API answers only the setup's own adapter" });
      }
      const path = new URL(req.url ?? '/', 'http://work').pathname;
      if (req.method === 'POST' && path === '/quote') {
        const scope = (await json(req))?.scope;
        if (scope === null || typeof scope !== 'object' || Array.isArray(scope) || Object.keys(scope).length) return send(400, { detail: 'a template takes an empty scope' });
        return send(200, { quoteId: 'template', price: { token: o.token, amount: o.price } });
      }
      if (req.method === 'POST' && path === '/jobs') {
        if (!String(req.headers['idempotency-key'] ?? '')) return send(400, { detail: 'POST /jobs needs an Idempotency-Key' });
        const id = String((await json(req))?.commitmentId);
        if (!COMMITMENT_ID.test(id)) return send(400, { detail: 'POST /jobs needs the commitment ID' });
        return send(200, { jobId: id });
      }
      const result = /^\/jobs\/(0x[0-9a-f]{64})\/result$/.exec(path);
      if (req.method === 'GET' && result) {
        // Work that is missing, or that cannot be delivered as it is, is not there yet: the setup's own line says why.
        const work = workFor(o.folder, result[1]!, o.format);
        if (!work.bytes) return send(202, { state: 'running' });
        return res.writeHead(200, { 'content-type': o.format, 'cache-control': 'no-store' }).end(work.bytes);
      }
      return send(404, { detail: 'not found' });
    })().catch((e: Error) => send(400, { detail: plain(e.message).slice(0, 200) }));
  });
  const port = o.port ?? 0;
  await new Promise<void>((resolve, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) => reject(e.code === 'EADDRINUSE' ? new Error(`port ${port} on the loopback address is in use, and the work API needs it: stop the program that holds it, or another run of this command`) : e));
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
