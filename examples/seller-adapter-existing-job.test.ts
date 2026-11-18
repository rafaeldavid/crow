// T-501: the artifacts call and an existing job for a new deal. A seller API may serve a finished job's artifacts from a
// second call (`sellerApi.result.merge`), which the adapter adds to the result after the workspace check. And the
// seller's operator may name a job that already finished for a new deal before the adapter starts one
// (`POST /deals/<id>/job` with `"existing": true`): the adapter then sends no start, and delivers the job only if it
// ran in the pinned workspace, is done, and its own request matches the deal's scope (`sellerApi.result.jobScope`).
// Deals run on SimChain against the job stub.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hex } from 'viem';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { loadConfig, startSellerAdapter, type RunningAdapter } from './seller-adapter.ts';
import { sellerApiClient, WrongScope } from './seller-adapter-api.ts';
import { jobStubSellerApi, startJobStub, type JobStub, type JobStubOptions } from './seller-adapter-job-stub.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const KEY = 'existing-job-test-credential-7a1c';
const READY = 'existing-job-ready-credential-2f9e';
const WS = 'ws-alpha';
const SCOPE = { target: 'vault-core', depth: 2 };
const SCOPE_RULES = { target: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' }, depth: { type: 'integer', min: 1, max: 10 } };
const FIELDS = { scope: ['target', 'depth'], options: [] };
/** The check needs the notes the artifacts call adds: a result without them is refused. */
const TEMPLATE = {
  deliverable: { kind: 'document', description: 'A review of {{target}} to depth {{depth}}.', format: 'application/json' },
  checks: [{ id: 'report', type: 'json_schema', required: true, schema: { type: 'object', required: ['summary', 'target', 'notes'], properties: { target: { const: '{{target}}' }, notes: { type: 'array', minItems: 1 } } } }],
};

/** The stub's mapping with the account pinned, the notes merged into the report, and the job's request read. */
function api(base: string, over: { merge?: J; jobScope?: J; resultPointer?: string | null } = {}): J {
  const a = jobStubSellerApi(base);
  delete a.result.files;
  a.quote.path = 'workspaces/{{workspace}}/estimates';
  a.start.path = 'workspaces/{{workspace}}/runs';
  a.workspace = { id: WS, ...(over.resultPointer === null ? {} : { resultPointer: over.resultPointer ?? '/run/workspace' }) };
  if (over.merge !== null) a.result.merge = over.merge ?? { path: 'runs/{{jobId}}/notes', into: '/output/notes' };
  if (over.jobScope !== null) a.result.jobScope = over.jobScope ?? { target: '/run/input/target', depth: '/run/input/depth' };
  return a;
}

let world: SimWorld;
let stub: JobStub | undefined;
const adapters: RunningAdapter[] = [];
const acct = (label: string) => world.info.accounts.find((a) => a.label === label)!;
const agent = (label: string) => new Agent(world.info.operators, acct(label).privateKey as Hex, Buffer.from(acct(label).encryptionSecretKey, 'base64url'));

beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {} });
});
afterAll(() => world.close());
afterEach(async () => {
  for (const a of adapters.splice(0)) await a.close();
  await stub?.close();
  stub = undefined;
});

async function adapter(o: Partial<JobStubOptions>, shape: (base: string) => J = (b) => api(b)) {
  stub = await startJobStub({ key: KEY, readsUntilComplete: 1, workspaces: true, ...o });
  const dir = mkdtempSync(join(tmpdir(), 't501-'));
  writeFileSync(join(dir, 'template.json'), JSON.stringify(TEMPLATE));
  const file = join(dir, 'seller.json');
  writeFileSync(file, JSON.stringify({ port: 0, pollMs: 50, journal: join(dir, 'journal.json'), template: 'template.json', scope: SCOPE_RULES, redelivery: { refetchEverySec: 0, readyAuth: { kind: 'bearer', env: 'READY_CREDENTIALS' } }, sellerApi: shape(stub.base) }));
  const lines: string[] = [];
  const running = await startSellerAdapter({ ...loadConfig(file), log: (l) => lines.push(l) }, { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: world.info.operators.join(','), JOBS_API_KEY: KEY, READY_CREDENTIALS: READY });
  adapters.push(running);
  return { running, lines };
}
async function quote(a: RunningAdapter, label: string, scope: J = SCOPE): Promise<{ buyer: Agent; id: Hex }> {
  const buyer = agent(label);
  const res = await fetch(`${a.url}/quote`, { method: 'POST', body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope }) });
  const q = (await res.json()) as J;
  expect(res.status, JSON.stringify(q)).toBe(200);
  await buyer.waitFor(q.commitmentId, ['AcceptedByAdjudicator']);
  return { buyer, id: q.commitmentId as Hex };
}
async function fund(buyer: Agent, id: Hex): Promise<void> {
  const terms = await buyer.call('GET', `/v1/commitments/${id}/terms`);
  delete terms.id;
  delete terms.signatures;
  await buyer.agreeAndFund(terms, 2_100_000_000n);
}
/**
 * The job route as a client calls it. A 409 `holder_busy` means the deal loop is part-way through the holding deal's
 * pass (it still works on a deal for a moment after it records the refusal), and its detail says to send again; so
 * does this, every 100 ms for up to 5 s. Every other answer, every other 409 included, comes back as it is (T-520).
 */
async function name(a: RunningAdapter, id: Hex, body: J, credential: string | null = READY): Promise<Response> {
  for (let tries = 0; ; tries++) {
    const res = await fetch(`${a.url}/deals/${id}/job`, { method: 'POST', headers: { 'content-type': 'application/json', ...(credential === null ? {} : { authorization: `Bearer ${credential}` }) }, body: JSON.stringify(body) });
    if (res.status !== 409 || tries === 50) return res;
    const answer = (await res.clone().json().catch(() => null)) as J;
    if (answer?.type !== 'holder_busy') return res;
    await new Promise((r) => setTimeout(r, 100));
  }
}
async function until(what: string, ok: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) if (await ok()) return;
  throw new Error(`timed out waiting for ${what}`);
}
const dealOf = (a: RunningAdapter, id: Hex) => a.deals().find((d) => d.id === id);
const starts = () => stub!.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/runs')).length;
const deliveries = async (buyer: Agent, id: Hex): Promise<J[]> => (await buyer.call('GET', `/v1/commitments/${id}/events?limit=200`)).items.filter((e: J) => e.type === 'delivery.submitted');

describe('the artifacts call (T-501): deals', () => {
  it('adds the notes to the result after the workspace check, and the deal is Released', async () => {
    const { running } = await adapter({});
    const { buyer, id } = await quote(running, 'buyer-1');
    await fund(buyer, id);
    expect((await buyer.waitFor(id, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
    const report = JSON.parse(await buyer.openDelivery(id));
    expect(report.notes).toEqual([{ kind: 'note', run: 41, text: 'notes on vault-core' }]);
    const gets = stub!.requests.filter((r) => r.method === 'GET').map((r) => r.path);
    expect(gets.indexOf('/api/v2/runs/41/notes')).toBeGreaterThan(gets.indexOf('/api/v2/runs/41'));
  }, 45_000);

  it('never makes the call for a job that ran in another account', async () => {
    const { running, lines } = await adapter({ reportsWorkspace: 'ws-beta' });
    const { buyer, id } = await quote(running, 'buyer-2');
    await fund(buyer, id);
    await until('the refusal', () => dealOf(running, id)?.stage === 'refused');
    expect(stub!.requests.some((r) => r.path.endsWith('/notes'))).toBe(false);
    expect(lines.join('\n')).toContain('the job did not run in the pinned workspace');
  }, 45_000);

  it('holds the delivery when the call answers other than 2xx, or the result already has the field', async () => {
    const { running, lines } = await adapter({ notesStatus: 500 });
    const { buyer, id } = await quote(running, 'buyer-1');
    await fund(buyer, id);
    await until('the refusal', () => dealOf(running, id)?.stage === 'refused');
    expect(lines.join('\n')).toMatch(/FILES NOT ADDED the seller API answered 500 to the artifacts call/);
    expect(await deliveries(buyer, id)).toEqual([]);
  }, 45_000);

  it('holds the delivery when the result with its artifacts is over the delivery cap', async () => {
    const { running, lines } = await adapter({ notesBody: [{ kind: 'note', text: 'x'.repeat(1_100_000) }] });
    const { buyer, id } = await quote(running, 'buyer-1');
    await fund(buyer, id);
    await until('the refusal', () => dealOf(running, id)?.stage === 'refused');
    expect(lines.join('\n')).toMatch(/FILES NOT ADDED the artifacts call: the seller API's answer to the artifacts call is larger than 1048576 bytes/);
    expect(await deliveries(buyer, id)).toEqual([]);
  }, 45_000);
});

describe('the artifacts call (T-501): the mapping', () => {
  const base = 'http://127.0.0.1:1/api/v2/';
  const client = (a: J) => sellerApiClient(a, { JOBS_API_KEY: KEY }, FIELDS);
  it('takes a path filled from the job ID only', () => {
    expect(client(api(base)).describe).toContain('the artifacts call adds its answer at /output/notes');
    for (const path of ['runs/{{commitmentId}}/notes', 'runs/{{jobId}}/{{scope.target}}', 'runs/notes']) {
      expect(() => client(api(base, { merge: { path, into: '/output/notes' } })), path).toThrow(/sellerApi\.result\.merge\.path/);
    }
  });
  it('needs the job\'s workspace read first when its path names none', () => {
    expect(() => client(api(base, { resultPointer: null, jobScope: null }))).toThrow('sellerApi.result.merge needs sellerApi.workspace.resultPointer');
  });
  it('refuses a field it does not take, a whole-result target, and a report call beside it', () => {
    expect(() => client(api(base, { merge: { path: 'runs/{{jobId}}/notes', into: '/output/notes', method: 'POST' } }))).toThrow('sellerApi.result.merge has a field the adapter does not take');
    expect(() => client(api(base, { merge: { path: 'runs/{{jobId}}/notes', into: '' } }))).toThrow('sellerApi.result.merge.into must name a field');
    const both = api(base);
    both.result.reportCall = { path: 'workspaces/{{workspace}}/runs/{{jobId}}/report' };
    expect(() => client(both)).toThrow('sellerApi.result.merge and sellerApi.result.reportCall');
  });
  it('refuses a jobScope field the scope rules do not define', () => {
    expect(() => client(api(base, { jobScope: { colour: '/run/input/colour' } }))).toThrow('sellerApi.result.jobScope names colour');
    expect(() => client(api(base, { jobScope: {} }))).toThrow('sellerApi.result.jobScope must name one or more');
  });
});

describe('the job\'s request (T-501): jobScope on every result', () => {
  it('refuses a result whose job asked for another scope', async () => {
    stub = await startJobStub({ key: KEY, workspaces: true, seedRuns: [{ id: 'done-1', input: { target: 'vault-core', depth: 3 }, workspace: WS }] });
    const c = sellerApiClient(api(stub.base), { JOBS_API_KEY: KEY }, FIELDS);
    await expect(c.result({ jobId: 'done-1', scope: SCOPE })).rejects.toThrow(WrongScope);
    await expect(c.result({ jobId: 'done-1', scope: SCOPE })).rejects.toThrow('the job asked for depth 3, not the deal\'s 2');
    const same = await c.result({ jobId: 'done-1', scope: { target: 'vault-core', depth: 3 } });
    expect(same.state).toBe('done');
  });
  it('matches a list in any order, and refuses one with another item', async () => {
    stub = await startJobStub({ key: KEY, workspaces: true, seedRuns: [{ id: 'done-2', input: { target: 'a', files: ['x.sol', 'y.sol'] }, workspace: WS }] });
    const a = api(stub.base, { jobScope: { files: '/run/input/files' } });
    const c = sellerApiClient(a, { JOBS_API_KEY: KEY }, { scope: ['target', 'depth', 'files'], options: [] });
    expect((await c.result({ jobId: 'done-2', scope: { files: ['y.sol', 'x.sol'] } })).state).toBe('done');
    await expect(c.result({ jobId: 'done-2', scope: { files: ['x.sol', 'z.sol'] } })).rejects.toThrow(WrongScope);
    await expect(c.result({ jobId: 'done-2', scope: { files: ['x.sol'] } })).rejects.toThrow(WrongScope);
  });
});

describe('an existing job for a new deal (T-501)', () => {
  const seeded = [
    { id: 'done-7', input: SCOPE, workspace: WS },
    { id: 'beta-1', input: SCOPE, workspace: 'ws-beta' },
    { id: 'other-1', input: { target: 'vault-core', depth: 5 }, workspace: WS },
    { id: 'busy-1', input: SCOPE, workspace: WS, state: 'running' as const },
    { id: 'bad-1', input: SCOPE, workspace: WS, state: 'error' as const },
  ];

  it('delivers a finished job named before funding, with no start call, and records where it came from', async () => {
    const { running, lines } = await adapter({ seedRuns: seeded });
    const { buyer, id } = await quote(running, 'buyer-1');
    const res = await name(running, id, { jobId: 'done-7', existing: true });
    expect(res.status, await res.clone().text()).toBe(202);
    expect(await res.json()).toMatchObject({ commitmentId: id, stage: 'offered', jobId: 'done-7' });
    expect(dealOf(running, id)?.existingJob).toMatchObject({ jobId: 'done-7' });
    await fund(buyer, id);
    expect((await buyer.waitFor(id, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
    await until('the delivery', () => dealOf(running, id)?.stage === 'delivered');
    expect(starts()).toBe(0);
    expect(dealOf(running, id)?.jobId).toBe('done-7');
    expect(JSON.parse(await buyer.openDelivery(id)).notes).toHaveLength(1);
    expect(lines.join('\n')).toContain('an existing job, named by the seller\'s operator; no start was sent');
  }, 60_000);

  it('refuses a job from another workspace or scope, an unfinished or failed one, and a caller with no credential', async () => {
    const { running } = await adapter({ seedRuns: seeded });
    const { buyer, id } = await quote(running, 'buyer-2');
    const cases: Array<[J, string | null, number, string]> = [
      [{ jobId: 'done-7', existing: true }, null, 401, 'unauthorized'],
      [{ jobId: 'done-7', existing: true }, 'wrong-credential', 401, 'unauthorized'],
      [{ jobId: 'done-7' }, READY, 409, 'not_waiting'],
      [{ jobId: 'beta-1', existing: true }, READY, 409, 'wrong_workspace'],
      [{ jobId: 'other-1', existing: true }, READY, 409, 'wrong_scope'],
      [{ jobId: 'busy-1', existing: true }, READY, 409, 'not_finished'],
      [{ jobId: 'bad-1', existing: true }, READY, 409, 'job_failed'],
      [{ jobId: 'no-such-job', existing: true }, READY, 502, 'seller_api'],
      [{ jobId: 'done-7', existing: 'yes' }, READY, 400, 'invalid_body'],
    ];
    for (const [body, cred, status, type] of cases) {
      const res = await name(running, id, body, cred);
      const got = (await res.json()) as J;
      expect([res.status, got.type], JSON.stringify(body)).toEqual([status, type]);
    }
    expect(dealOf(running, id)?.existingJob).toBeUndefined();
    // None of them stops the deal: once funded, the adapter starts its own job as usual.
    await fund(buyer, id);
    expect((await buyer.waitFor(id, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
    expect(starts()).toBe(1);
    // A funded deal takes no existing job: its start may already be on its way.
    const late = await name(running, id, { jobId: 'done-7', existing: true });
    expect([late.status, ((await late.json()) as J).type]).toEqual([409, 'not_waiting']);
  }, 60_000);

  it('refuses every existing job when the configuration cannot check the job\'s scope or workspace', async () => {
    const { running } = await adapter({ seedRuns: seeded }, (b) => api(b, { jobScope: null }));
    const { id } = await quote(running, 'buyer-1');
    const res = await name(running, id, { jobId: 'done-7', existing: true });
    expect([res.status, ((await res.json()) as J).type]).toEqual([409, 'cannot_check']);
    expect(stub!.requests.some((r) => r.path.endsWith('/done-7'))).toBe(false);
  }, 45_000);

  it('refuses every existing job when jobScope leaves out a scope field the start sends (T-501 red team)', async () => {
    const { running } = await adapter({ seedRuns: [{ id: 'shallow-1', input: { target: 'vault-core', depth: 1 }, workspace: WS }] }, (b) => api(b, { jobScope: { target: '/run/input/target' } }));
    const { id } = await quote(running, 'buyer-2');
    const res = await name(running, id, { jobId: 'shallow-1', existing: true });
    const body = (await res.json()) as J;
    expect([res.status, body.type]).toEqual([409, 'cannot_check']);
    expect(body.detail).toContain('sellerApi.result.jobScope must also name depth, which the start sends');
  }, 45_000);

  it('moves a job from a refused deal only when the request names that deal, and closes it', async () => {
    const { running } = await adapter({ seedRuns: seeded, notesStatus: 500 });
    const first = await quote(running, 'buyer-1');
    expect((await name(running, first.id, { jobId: 'done-7', existing: true })).status).toBe(202);
    const second = await quote(running, 'buyer-2');
    // Taken by an offered deal: refused with or without its name.
    for (const body of [{ jobId: 'done-7', existing: true }, { jobId: 'done-7', existing: true, from: first.id }]) {
      const res = await name(running, second.id, body);
      expect([res.status, ((await res.json()) as J).type], JSON.stringify(body)).toEqual([409, 'job_taken']);
    }
    await fund(first.buyer, first.id);
    await until('the first deal refused', () => dealOf(running, first.id)?.stage === 'refused'); // the notes call fails
    const plain = await name(running, second.id, { jobId: 'done-7', existing: true });
    expect([plain.status, ((await plain.json()) as J).type]).toEqual([409, 'job_taken']);
    const wrongFrom = await name(running, second.id, { jobId: 'done-7', existing: true, from: second.id });
    expect([wrongFrom.status, ((await wrongFrom.json()) as J).type]).toEqual([409, 'job_taken']);
    const moved = await name(running, second.id, { jobId: 'done-7', existing: true, from: first.id.toUpperCase().replace('0X', '0x') });
    expect(moved.status, await moved.clone().text()).toBe(202);
    expect(dealOf(running, first.id)).toMatchObject({ stage: 'closed', jobMovedTo: second.id });
    expect(dealOf(running, second.id)?.existingJob).toMatchObject({ jobId: 'done-7', from: first.id });
    // The closed deal never fetches or delivers the job again.
    const reads = stub!.requests.filter((r) => r.path === '/api/v2/runs/done-7').length;
    await new Promise((r) => setTimeout(r, 400));
    expect(stub!.requests.filter((r) => r.path === '/api/v2/runs/done-7').length).toBe(reads);
    expect(await deliveries(first.buyer, first.id)).toEqual([]);
    expect(starts()).toBe(0);
    // T-501 review: the closed deal no longer holds the job, so naming it as "from" again moves nothing.
    const third = await quote(running, 'buyer-1');
    const again = await name(running, third.id, { jobId: 'done-7', existing: true, from: first.id });
    expect([again.status, ((await again.json()) as J).type]).toEqual([409, 'job_taken']);
    expect(dealOf(running, third.id)?.existingJob).toBeUndefined();
    expect(dealOf(running, first.id)?.jobMovedTo).toBe(second.id);
  }, 90_000);

  it('never moves a job out of a delivered deal', async () => {
    const { running } = await adapter({ seedRuns: seeded });
    const first = await quote(running, 'buyer-1');
    expect((await name(running, first.id, { jobId: 'done-7', existing: true })).status).toBe(202);
    await fund(first.buyer, first.id);
    await until('the delivery', () => dealOf(running, first.id)?.stage === 'delivered');
    const second = await quote(running, 'buyer-2');
    const res = await name(running, second.id, { jobId: 'done-7', existing: true, from: first.id });
    expect([res.status, ((await res.json()) as J).type]).toEqual([409, 'job_taken']);
  }, 60_000);
});
