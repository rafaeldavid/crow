// The live rehearsal of a seller's own Worker (T-478), for the person who runs it on a Cloudflare account that is not
// Crow's. Two steps, each one process; test tokens only. The steps around them are in docs/tasks/T-478-*.md, Handoff.
//
//   node apps/own-seller/scripts/rehearse.ts api [--port 8790]
//       a stand-in seller API (examples/seller-adapter-job-stub.ts) behind a small logger on 127.0.0.1:<port>, for a
//       tunnel to reach from Cloudflare. It writes adapter.json and template.json for `setup.mjs cloudflare --config`
//       into reports/rehearsal/ once it is told the tunnel's https address (--public <URL>). For each request it
//       prints the method, the path, the CF-Worker header and the CF-Connecting-IP header: the measurement of what
//       Cloudflare tells the hosts a Worker calls, and of the address the operators would count a faucet grant by.
//       The stand-in API's throwaway key goes to reports/rehearsal/api-key (mode 0600), never to a printed line:
//       the person pipes it to `wrangler secret put JOBS_API_KEY` on standard input.
//   node apps/own-seller/scripts/rehearse.ts deal --at https://<the Worker's address>/
//       one deal with Crow's test buyer: reads its card, asks the Worker for a quote naming the buyer (an open quote
//       address: prepare the Worker with --open for the rehearsal), posts the commitment ID to the buyer's intake, and
//       prints each state the operators show until the deal ends, with the seconds since the quote.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jobStubSellerApi, startJobStub } from '../../../examples/seller-adapter-job-stub.ts';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const OPERATORS = ['https://api.crow.direct', 'https://api2.crow.direct'];
const TEST_BUYER = 'https://crow.direct/agents/test-buyer';

async function api(): Promise<void> {
  const port = Number(arg('--port') ?? 8790);
  const pub = arg('--public');
  if (!pub || !/^https:\/\/[a-z0-9.-]+\/?$/.test(pub)) throw new Error('give --public <the tunnel\'s https address>, such as https://abc.trycloudflare.com');
  const key = randomBytes(16).toString('hex');
  const stub = await startJobStub({ key, readsUntilComplete: 1, estimateOverride: { turnaroundSeconds: 3600 } });
  const inner = new URL(stub.base);
  createServer((req, res) => {
    const worker = req.headers['cf-worker'];
    console.log(JSON.stringify({ at: new Date().toISOString(), method: req.method, path: req.url, cfWorker: worker ?? null, cfConnectingIp: req.headers['cf-connecting-ip'] ?? null }));
    const fwd = httpRequest({ host: inner.hostname, port: inner.port, path: `${inner.pathname.replace(/\/$/, '')}${req.url}`, method: req.method, headers: { ...req.headers, host: inner.host } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    req.pipe(fwd);
  }).listen(port, '127.0.0.1');
  const dir = fileURLToPath(new URL('../../../reports/rehearsal/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  const apiConfig = jobStubSellerApi(`${pub.replace(/\/$/, '')}/`);
  delete apiConfig.result.files;
  writeFileSync(join(dir, 'template.json'), `${JSON.stringify({ deliverable: { kind: 'document', description: 'A review of {{target}} to depth {{depth}}.', format: 'application/json' }, checks: [{ id: 'report', type: 'json_schema', required: true, schema: { type: 'object', required: ['summary', 'target'] } }] }, null, 2)}\n`);
  writeFileSync(join(dir, 'adapter.json'), `${JSON.stringify({ template: 'template.json', scope: { target: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' }, depth: { type: 'integer', min: 1, max: 3 } }, pollMs: 3000, timing: { offerExpiresInSec: 600, fundWithinSec: 900, deliverWithinSec: 3600, judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 }, sellerApi: apiConfig }, null, 2)}\n`);
  const keyFile = join(dir, 'api-key');
  writeFileSync(keyFile, key, { mode: 0o600 });
  console.log(JSON.stringify({ listening: `http://127.0.0.1:${port}`, config: join(dir, 'adapter.json'), apiKeyFile: keyFile, note: `The stand-in API's throwaway key is in ${keyFile}: from the deploy folder, npx wrangler@4.151.3 secret put JOBS_API_KEY --config wrangler.json < ${keyFile}. Stop with Ctrl-C after the deal.` }));
}

async function deal(): Promise<void> {
  const at = arg('--at')?.replace(/\/?$/, '/');
  if (!at || !at.startsWith('https://')) throw new Error("give --at <the Worker's https address>");
  const card = (await (await fetch(`${TEST_BUYER}/agent.json`)).json()) as { buyer: string; buyerEncryptionPublicKey: string; intake: { api: string } };
  const t0 = Date.now();
  const q = await fetch(`${at}quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ buyer: card.buyer, buyerEncryptionPublicKey: card.buyerEncryptionPublicKey, scope: { target: 'rehearsal', depth: 1 } }) });
  const offer = (await q.json()) as { commitmentId?: string };
  console.log(JSON.stringify({ step: 'quote', status: q.status, ms: Date.now() - t0, commitmentId: offer.commitmentId ?? null }));
  if (!offer.commitmentId) return;
  const posted = await fetch(card.intake.api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commitmentId: offer.commitmentId }) });
  console.log(JSON.stringify({ step: 'post', status: posted.status }));
  let state = '';
  for (const stop = Date.now() + 1_800_000; Date.now() < stop; await new Promise((r) => setTimeout(r, 10_000))) {
    const row = (await (await fetch(`${OPERATORS[0]}/v1/commitments/${offer.commitmentId}`)).json().catch(() => null)) as { escrowState?: string } | null;
    if (row?.escrowState && row.escrowState !== state) console.log(JSON.stringify({ step: 'state', state: row.escrowState, seconds: Math.round((Date.now() - t0) / 1000) }));
    state = row?.escrowState ?? state;
    if (['Released', 'Refunded', 'Expired', 'Settled'].includes(state)) break;
  }
}

const step = process.argv[2];
if (step === 'api') await api();
else if (step === 'deal') await deal();
else {
  console.error('usage: node apps/own-seller/scripts/rehearse.ts api --public <https URL> [--port 8790] | deal --at <https URL>');
  process.exitCode = 2;
}
