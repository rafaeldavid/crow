// T-502: a hosted seller shows why it refused a result, and the local report check agrees with it. Each case is one
// report the job stub returns; the hosted seller runs it as a live deal on the in-process world (quote, funding, the
// object's alarm), and check-report runs the same answer from files. Every string the reports carry holds a marker,
// and the marker never reaches /health or the deal route.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hex } from 'viem';
import { MemoryStorage } from '@holdback/demo-cloud';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../examples/agent.ts';
import { jobStubSellerApi, startJobStub, type JobStub } from '../../../examples/seller-adapter-job-stub.ts';
import { checkReport } from './check-report.ts';
import { type HostedBundle } from './bundle.ts';
import { HostedSellerObject, setupOf, type Env } from './worker.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const MARK = 'LEAKMARK';
const SECRETS = { JOBS_API_KEY: 'refusal-test-jobs-value', QUOTE_CREDENTIALS: 'refusal-test-quote-value', READY_CREDENTIALS: 'refusal-test-ready-value' };
const SLUG = 'refusal-audits';
const BASE = `https://crow.direct/agents/${SLUG}`;
const WS = 'ws-refusal-1';
const SCOPE_RULES = { target: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' }, depth: { type: 'integer', min: 1, max: 10 } };
const TEMPLATE = {
  deliverable: { kind: 'document', description: 'A review of {{target}} to depth {{depth}}.', format: 'application/json' },
  checks: [
    {
      id: 'report',
      type: 'json_schema',
      required: true,
      schema: {
        type: 'object',
        required: ['summary', 'target', 'findings'],
        properties: {
          target: { const: '{{target}}' },
          findings: { type: 'array', items: { type: 'object', required: ['title'] } },
          meta: { type: 'object', additionalProperties: false, properties: { reviewer: { type: 'string' } } },
        },
      },
    },
    { id: 'hidden', type: 'hidden_characters_max', required: true, max: { total: 0 } },
  ],
};
/** The report in the template's shape: the level is mapped to a severity, and `meta` is copied whole. */
const MAPPING = {
  version: 1,
  report: {
    summary: { $path: 'summary' },
    target: { $path: 'target' },
    findings: { $each: 'findings', $item: { title: { $path: 'title', $optional: true }, severity: { $path: 'level', $map: { low: 'low', high: 'high' }, $optional: true } } },
    meta: { $path: 'meta', $optional: true },
  },
};

/** Each case: the stub's report for the scope target of the same name, and the reason /health should show. */
const base = (target: string): J => ({ summary: `${MARK} review of ${target}`, target, findings: [{ title: `${MARK} first finding`, level: 'low' }] });
const CASES: Array<{ target: string; report: J; want: J }> = [
  { target: 'pass-case', report: base('pass-case'), want: 'pass' },
  { target: 'missing-title', report: { ...base('missing-title'), findings: [{ title: `${MARK} a`, level: 'low' }, { level: 'high' }] }, want: { stage: 'checks', checks: [{ checkId: 'report', required: true, outcome: 'fail', pointer: '/findings/1', message: 'missing title' }] } },
  { target: 'extra-key', report: { ...base('extra-key'), meta: { [`${MARK}-key`]: `${MARK} value` } }, want: { stage: 'checks', checks: [{ checkId: 'report', required: true, outcome: 'fail', pointer: '/meta/*', message: 'additional property: false schema' }] } },
  { target: 'wrong-target', report: { ...base('wrong-target'), target: `${MARK}-target` }, want: { stage: 'checks', checks: [{ checkId: 'report', required: true, outcome: 'fail', pointer: '/target', message: 'not equal to const' }] } },
  { target: 'hidden-chars', report: { ...base('hidden-chars'), summary: `${MARK}​hidden` }, want: { stage: 'checks', checks: [{ checkId: 'hidden', required: true, outcome: 'fail' }] } },
  { target: 'bad-level', report: { ...base('bad-level'), findings: [{ title: 'x', level: `${MARK}-level` }] }, want: { stage: 'not_converted', field: 'findings[0].severity', message: 'findings[0].level is not one of the values the mapping lists' } },
  { target: 'no-summary', report: { target: 'no-summary', findings: [] }, want: { stage: 'not_converted', field: 'summary', message: 'the report has no summary' } },
];

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

function bundleFor(stubBase: string): HostedBundle {
  const api = jobStubSellerApi(stubBase);
  delete api.result.files;
  api.quote.path = 'workspaces/{{workspace}}/estimates';
  api.start.path = 'workspaces/{{workspace}}/runs';
  api.workspace = { id: WS, resultPointer: '/run/workspace' };
  return {
    slug: SLUG,
    card: { name: 'Refusal audits', item: 'audit' },
    config: { template: 'template.json', reportMapping: 'mapping.json', scope: SCOPE_RULES, pollMs: 50, sellerApi: api, quoteAuth: { kind: 'bearer', env: 'QUOTE_CREDENTIALS' }, redelivery: { refetchEverySec: 0, readyAuth: { kind: 'bearer', env: 'READY_CREDENTIALS' } } },
    files: { 'template.json': JSON.stringify(TEMPLATE), 'mapping.json': JSON.stringify(MAPPING) },
  };
}
/** The same seller as a folder on disk, as the deploy and check-report read it. */
function folderOf(b: HostedBundle): (name: string) => string | undefined {
  const dir = mkdtempSync(join(tmpdir(), 't502-'));
  writeFileSync(join(dir, 'hosted.json'), JSON.stringify({ slug: b.slug, card: b.card }));
  writeFileSync(join(dir, 'adapter.json'), JSON.stringify(b.config));
  for (const [name, text] of Object.entries(b.files)) writeFileSync(join(dir, name), text);
  return (name) => {
    try {
      return readFileSync(join(dir, name), 'utf8');
    } catch {
      return undefined;
    }
  };
}
function envFor(): Env {
  return { SELLER: undefined as never, OPERATOR_URLS: world.info.operators.join(','), SELLER_URL: BASE, HOLDBACK_KEY: acct('seller-1').privateKey, ...SECRETS };
}
const get = (o: HostedSellerObject, path: string, headers: Record<string, string> = {}) => o.fetch(new Request(`${BASE}${path}`, { headers }));
async function quote(o: HostedSellerObject, buyer: Agent, scope: J): Promise<Hex> {
  const res = await o.fetch(new Request(`${BASE}/quote`, { method: 'POST', headers: { authorization: `Bearer ${SECRETS.QUOTE_CREDENTIALS}`, 'content-type': 'application/json' }, body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope }) }));
  const body = (await res.json()) as J;
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.commitmentId as Hex;
}
async function fund(buyer: Agent, id: Hex): Promise<J> {
  await buyer.waitFor(id, ['AcceptedByAdjudicator']);
  const terms = await buyer.call('GET', `/v1/commitments/${id}/terms`);
  delete terms.id;
  delete terms.signatures;
  await buyer.agreeAndFund(terms, 2_100_000_000n);
  return terms;
}
async function alarmsUntil(o: HostedSellerObject, storage: FakeStorage, what: string, ok: () => Promise<boolean>, timeoutMs = 60_000) {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) {
    if (storage.alarm !== null) await o.alarm();
    if (await ok()) return;
  }
  throw new Error(`timed out waiting for ${what}`);
}
const stageOf = async (storage: FakeStorage, id: Hex) => ((await storage.get<J>(`deal:${id}`))?.stage as string | undefined);
/** The result call's answer the stub sends for a finished run of this case, as check-report reads it from a file. */
const answerOf = (c: { target: string; report: J }) => new TextEncoder().encode(JSON.stringify({ run: { id: 1, state: 'complete', input: { target: c.target, depth: 2 }, workspace: WS }, output: c.report }));

describe('a refused result on /health and the deal route (T-502)', () => {
  it('each refusal shows its stage, check and pointer, the local check gives the same verdict, and no report content shows', async () => {
    const outputs: Record<string, J> = Object.fromEntries(CASES.map((c) => [c.target, c.report]));
    stub = await startJobStub({ key: SECRETS.JOBS_API_KEY, readsUntilComplete: 0, workspaces: true, outputs });
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const bundle = bundleFor(stub.base);
    const storage = new FakeStorage();
    const object = new HostedSellerObject({ storage }, envFor(), setupOf(bundle));
    const deals: Array<{ c: (typeof CASES)[number]; id: Hex; terms: J }> = [];
    for (const [i, c] of CASES.entries()) {
      const buyer = agent(i % 2 ? 'buyer-2' : 'buyer-1');
      const id = await quote(object, buyer, { target: c.target, depth: 2 });
      deals.push({ c, id, terms: await fund(buyer, id) });
    }
    await alarmsUntil(object, storage, 'every deal to be refused or delivered', async () => {
      for (const d of deals) if (!['refused', 'delivered'].includes((await stageOf(storage, d.id)) ?? '')) return false;
      return true;
    });

    const health = (await (await get(object, '/health')).json()) as J;
    expect(health.status).toBe('operational');
    expect(health.refused).toHaveLength(CASES.length - 1);
    const read = folderOf(bundle);
    for (const d of deals) {
      const route = (await (await get(object, `/deals/${d.id}`)).json()) as J;
      // The local check, given the same answer: once with the terms a quote would sign, once with the signed terms.
      const local = await checkReport({ read, job: answerOf(d.c), scope: { target: d.c.target, depth: 2 } });
      const signed = await checkReport({ read, job: answerOf(d.c), scope: { target: d.c.target, depth: 2 }, terms: d.terms });
      expect(signed).toEqual(local);
      if (d.c.want === 'pass') {
        expect(route).toEqual({ commitmentId: d.id, stage: 'delivered' });
        expect(local.verdict).toBe('pass');
        continue;
      }
      expect(route.stage).toBe('refused');
      expect(route.refusal).toMatchObject({ ...d.c.want, refusals: 1 });
      expect(route.refusal.since).toMatch(/^\d{4}-\d\d-\d\dT/);
      // The live seller and the local check refuse the same way, on the same message.
      expect(local.verdict).toBe('refused');
      const reason = { ...route.refusal };
      delete reason.refusals;
      delete reason.since;
      expect(local.reason).toEqual(reason);
      // /health lists the same entry without its time (red team, L5).
      expect(health.refused).toContainEqual({ ...reason, refusals: route.refusal.refusals });
      expect(JSON.stringify(health.refused)).not.toContain('since');
      expect(logs.join('\n')).toContain(`${d.id} REASON refused at`);
    }
    // Nothing from the reports, no commitment ID and no secret reaches the public page; the deal route shows none of the report either.
    const shown = JSON.stringify(health) + JSON.stringify(await Promise.all(deals.map(async (d) => (await get(object, `/deals/${d.id}`)).json())));
    expect(shown).not.toContain(MARK);
    for (const secret of Object.values(SECRETS)) expect(shown).not.toContain(secret);
    for (const d of deals) expect(JSON.stringify(health)).not.toContain(d.id.slice(2, 18));

    // A refetch of the same report logs that it is still refused; a changed report logs the new reason.
    const missing = deals.find((d) => d.c.target === 'missing-title')!;
    logs.length = 0;
    await object.alarm();
    expect(logs.join('\n')).toContain(`${missing.id} still refused, for the same reason (checks).`);
    outputs['missing-title'] = { ...base('missing-title'), target: `${MARK}-moved` };
    logs.length = 0;
    await alarmsUntil(object, storage, 'the new reason', async () => logs.some((l) => l.includes(`${missing.id} REASON refused at checks: FAIL report (required) /target: not equal to const`)));
    const after = (await (await get(object, `/deals/${missing.id}`)).json()) as J;
    expect(after.refusal).toMatchObject({ stage: 'checks', refusals: 2, checks: [{ checkId: 'report', pointer: '/target', message: 'not equal to const' }] });
  }, 180_000);

  it('the deal route answers 404 for a deal this seller does not hold, and takes GET only', async () => {
    stub = await startJobStub({ key: SECRETS.JOBS_API_KEY, readsUntilComplete: 0, workspaces: true });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const object = new HostedSellerObject({ storage: new FakeStorage() }, envFor(), setupOf(bundleFor(stub.base)));
    expect((await get(object, `/deals/0x${'ab'.repeat(32)}`)).status).toBe(404);
    expect((await object.fetch(new Request(`${BASE}/deals/0x${'ab'.repeat(32)}`, { method: 'POST' }))).status).toBe(405);
  }, 30_000);
});

/** A seller with the artifacts call (T-501) and a salt in each report (T-431): the template needs both. */
const MERGE_TEMPLATE = {
  deliverable: { kind: 'document', description: 'A review of {{target}} to depth {{depth}}.', format: 'application/json' },
  checks: [{ id: 'report', type: 'json_schema', required: true, schema: { type: 'object', required: ['summary', 'notes', 'salt'], properties: { notes: { type: 'array', minItems: 1 } } } }],
};
function mergeBundle(stubBase: string): HostedBundle {
  const b = bundleFor(stubBase);
  const config = b.config as J;
  config.sellerApi.result.merge = { path: 'runs/{{jobId}}/notes', into: '/output/notes' };
  delete config.reportMapping;
  config.reportSalt = true;
  return { ...b, config, files: { 'template.json': JSON.stringify(MERGE_TEMPLATE) } };
}
function writeFolder(b: HostedBundle): string {
  const dir = mkdtempSync(join(tmpdir(), 't502-cli-'));
  writeFileSync(join(dir, 'hosted.json'), JSON.stringify({ slug: b.slug, card: b.card }));
  writeFileSync(join(dir, 'adapter.json'), JSON.stringify(b.config));
  for (const [name, text] of Object.entries(b.files)) writeFileSync(join(dir, name), text);
  return dir;
}
const readerOf = (dir: string) => (name: string) => {
  try {
    return readFileSync(join(dir, name), 'utf8');
  } catch {
    return undefined;
  }
};
const enc = (v: J) => new TextEncoder().encode(JSON.stringify(v));

describe('the local report check agrees with the live seller on the artifacts call, the salt and the workspace (T-502 review)', () => {
  /** One live deal on a seller that merges the stub's notes, and what the deal route then says. */
  async function liveDeal(o: { notesBody?: J; reportsWorkspace?: string }, target: string): Promise<J> {
    stub = await startJobStub({ key: SECRETS.JOBS_API_KEY, readsUntilComplete: 0, workspaces: true, ...o });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const storage = new FakeStorage();
    const object = new HostedSellerObject({ storage }, envFor(), setupOf(mergeBundle(stub.base)));
    const buyer = agent('buyer-1');
    const id = await quote(object, buyer, { target, depth: 2 });
    await fund(buyer, id);
    await alarmsUntil(object, storage, 'the deal to be refused or delivered', async () => ['refused', 'delivered'].includes((await stageOf(storage, id)) ?? ''));
    return (await get(object, `/deals/${id}`)).json();
  }
  const output = (target: string) => ({ summary: `Reviewed ${target} to depth 2.`, target, proofs: ['poc/overflow.t.sol', 'poc/reentry.t.sol'] });
  const job = (target: string, workspace = WS, notes?: J) => enc({ run: { id: 41, state: 'complete', input: { target, depth: 2 }, workspace }, output: { ...output(target), ...(notes === undefined ? {} : { notes }) } });
  const scope = (target: string) => ({ target, depth: 2 });
  const note = (target: string) => [{ kind: 'note', run: 41, text: `notes on ${target}` }];

  it('the artifacts call and the salt: the live seller delivers, and so does the check, from two files or from one export', async () => {
    const live = await liveDeal({}, 'merged');
    expect(live.stage).toBe('delivered');
    const read = readerOf(writeFolder(mergeBundle('http://127.0.0.1:9/api/v2/')));
    expect((await checkReport({ read, job: job('merged'), second: enc(note('merged')), scope: scope('merged') })).verdict).toBe('pass');
    expect((await checkReport({ read, job: job('merged', WS, note('merged')), scope: scope('merged') })).verdict).toBe('pass');
    // A deal offered without a salt: its report has none, and this template needs one.
    const unsalted = await checkReport({ read, job: job('merged'), second: enc(note('merged')), scope: scope('merged'), salt: false });
    expect(unsalted.reason).toMatchObject({ stage: 'checks', checks: [{ checkId: 'report', message: 'missing salt' }] });
  }, 60_000);

  it('artifacts that fail a check, and a job from another workspace: the same refusal from both', async () => {
    const read = readerOf(writeFolder(mergeBundle('http://127.0.0.1:9/api/v2/')));
    const empty = await liveDeal({ notesBody: [] }, 'no-notes');
    const local = await checkReport({ read, job: job('no-notes'), second: enc([]), scope: scope('no-notes') });
    expect(empty.refusal).toMatchObject({ stage: 'checks', checks: [{ checkId: 'report', pointer: '/notes', message: 'fewer than 1 items' }] });
    expect(local.reason).toEqual({ stage: empty.refusal.stage, message: empty.refusal.message, checks: empty.refusal.checks });
    await stub!.close();
    stub = undefined;
    const elsewhere = await liveDeal({ reportsWorkspace: 'ws-other' }, 'elsewhere');
    const away = await checkReport({ read, job: job('elsewhere', 'ws-other'), second: enc(note('elsewhere')), scope: scope('elsewhere') });
    expect(elsewhere.refusal).toMatchObject({ stage: 'wrong_workspace' });
    expect(away.reason).toEqual({ stage: 'wrong_workspace', message: elsewhere.refusal.message, checks: [] });
  }, 90_000);
});

describe('the local report check: what it refuses to judge, and the command (T-502 review and red team)', () => {
  const folder = (over: (config: J) => void) => {
    const b = mergeBundle('http://127.0.0.1:9/api/v2/');
    over(b.config as J);
    return writeFolder(b);
  };
  const answer = enc({ run: { id: 41, state: 'complete', input: { target: 'cli', depth: 2 }, workspace: WS }, output: { summary: 's', target: 'cli', notes: [{ text: 'n' }] } });

  it('gives no verdict for a result with further files, or an artifacts file the configuration makes no call for', async () => {
    const files = readerOf(folder((c) => (c.sellerApi.result.files = { list: '/proofs', path: 'runs/{{jobId}}/files/{{file}}', into: '/proofs', maxCount: 5, maxTotalBytes: 65_536 })));
    await expect(checkReport({ read: files, job: answer, scope: { target: 'cli', depth: 2 } })).rejects.toThrow(/further files/);
    const noMerge = readerOf(folder((c) => delete c.sellerApi.result.merge));
    await expect(checkReport({ read: noMerge, job: answer, second: enc([]), scope: { target: 'cli', depth: 2 } })).rejects.toThrow(/makes no artifacts or report call/);
  });

  it('reads a job by HTTP status, and takes signed terms past a rule that now refuses the scope', async () => {
    const http = readerOf(folder((c) => (c.sellerApi.result.status = { by: 'http', running: [202], done: [201] })));
    expect((await checkReport({ read: http, job: answer, scope: { target: 'cli', depth: 2 } })).verdict).toBe('pass');
    const rule = readerOf(folder((c) => (c.termsRules = [{ when: [{ field: 'scope.depth', atLeast: 1 }], refuse: 'no longer offered' }])));
    await expect(checkReport({ read: rule, job: answer, scope: { target: 'cli', depth: 2 } })).rejects.toThrow(/no longer offered/);
    const terms = { deliverable: MERGE_TEMPLATE.deliverable, acceptance: { deterministicChecks: MERGE_TEMPLATE.checks, rubric: { criteria: [], passThreshold: 0 } } };
    expect((await checkReport({ read: rule, job: answer, scope: { target: 'cli', depth: 2 }, terms })).verdict).toBe('pass');
  });

  it('the command: exit 0 on a pass, 1 on a refusal with no check message unless --detail, 2 on bad usage', () => {
    const dir = folder(() => {});
    const tmp = mkdtempSync(join(tmpdir(), 't502-cli-in-'));
    writeFileSync(join(tmp, 'scope.json'), JSON.stringify({ target: 'cli', depth: 2 }));
    writeFileSync(join(tmp, 'pass.json'), Buffer.from(answer));
    writeFileSync(join(tmp, 'fail.json'), JSON.stringify({ run: { id: 41, state: 'complete', input: { target: 'cli', depth: 2 }, workspace: WS }, output: { summary: 's', target: 'cli', notes: [] } }));
    const script = join(import.meta.dirname, '..', 'scripts', 'check-report.ts');
    const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    const pass = run(dir, join(tmp, 'pass.json'), '--scope', join(tmp, 'scope.json'));
    expect(pass.status, pass.stderr).toBe(0);
    expect(pass.stdout).toMatch(/^PASS: the seller would deliver this report/);
    const fail = run(dir, join(tmp, 'fail.json'), '--scope', join(tmp, 'scope.json'), '--json');
    expect(fail.status, fail.stderr).toBe(1);
    const verdict = JSON.parse(fail.stdout);
    expect(verdict.reason.checks).toEqual([{ checkId: 'report', required: true, outcome: 'fail', pointer: '/notes', message: 'fewer than 1 items' }]);
    expect(fail.stdout).not.toContain('schema:');
    expect(run(dir, join(tmp, 'fail.json'), '--scope', join(tmp, 'scope.json'), '--detail').stdout).toContain("the check's own message: schema: /notes: fewer than 1 items");
    expect(run(dir, join(tmp, 'pass.json')).status).toBe(2);
    expect(run(dir, join(tmp, 'pass.json'), '--scope', join(tmp, 'scope.json'), '--salt', '--no-salt').status).toBe(2);
  });
});
