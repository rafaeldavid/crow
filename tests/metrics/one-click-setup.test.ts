// T-473: the benchmark's two setup scenarios (s7 set up as a seller, s8 set up as a buyer) and the two counts a setup
// record adds: the requests that name the party before the first deal, and the guide files fetched. The first deal
// starts at the setup command's first-deal marker; a run with no marker records both counts as unknown, never as 0.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { check } from '../../scripts/metrics/check.mjs';
import { buildSummary, readRecords } from '../../scripts/metrics/one-click-summary.mjs';
import { markerTimesOf, webFetchCallsOf } from '../../tools/one-click/bench-live.mjs';
import { playScripted, startJobApi } from '../../tools/one-click/bench-local.mjs';
import { buyerCheck, buildBenchRecord, firstDealAtOf, setupOf } from '../../tools/one-click/bench-record.mjs';
import { curlMethodOf, markerFilesUnder, readCalls, writeFetchProbe } from '../../tools/one-click/probes.mjs';
import { DEAL_IDS, SCENARIOS, SETUP_DOCS, SETUP_IDS, goalFor } from '../../tools/one-click/scenarios.mjs';
import { COMMIT, NOW, ROOT, config } from './helpers';
import { liveRecord } from './one-click-records';

const BENCH = join(ROOT, 'tools/one-click/bench.mjs');
const KEY_VAR = 'HOLDBACK_AGENT_ANTHROPIC_API_KEY';
const T = Date.parse('2026-11-14T10:00:00Z');
const MARK = T + 60_000; // the first deal starts one minute in
const ADDR = `0x${'5a'.repeat(20)}`;
const ID = `0x${'cd'.repeat(32)}`;
const prices = config('model-prices.json');
const at = (n: number) => T + n * 60_000;

// A setup run's call log: the guide, the setup's own steps, then the first deal.
const call = (s: number, method: string, origin: string, path: string, status = 200) => ({ via: 'fetch', at: T + s * 1000, method, origin, path, status });
const SETUP_CALLS = [
  call(1, 'GET', 'https://crow.direct', '/setup.txt'),
  call(2, 'GET', 'https://crow.direct', '/setup.mjs'),
  call(3, 'GET', 'https://crow.direct', '/ref/seller-adapter.txt'),
  call(4, 'GET', 'https://api.crow.direct', '/v1/discovery'), // a GET with no address names no one
  call(5, 'POST', 'https://ethereum-sepolia-rpc.publicnode.com', '/'), // not Crow-run, no address in the path
  call(6, 'GET', 'http://127.0.0.1:41000', '/api/v2/runs/41'), // the party's own job API
  call(70, 'POST', 'https://api.crow.direct', '/v1/faucet'), // after the marker: the first deal's own
  call(71, 'GET', 'https://api.crow.direct', `/v1/balances/${ADDR}`),
  call(72, 'GET', 'https://crow.direct', '/ref/checks.txt'),
];

// the first deal's own call, so a list of setup calls has one at or after the marker (or both counts read unknown)
const DEAL = call(90, 'POST', 'https://api.crow.direct', '/v1/commitments');

describe('the request rule, before the first deal', () => {
  it('counts nothing for a setup that sent nothing that names the party, and counts the guide files of the whole run', () => {
    expect(setupOf({ calls: SETUP_CALLS, firstDealAtMs: MARK })).toEqual({ markerSeen: true, requestsBeforeFirstDeal: { total: 0, byHost: {} }, guideFilesFetched: 3, unknownBecause: null });
  });

  it('counts a setup step that posts to the faucet before the marker as 1', () => {
    const calls = [...SETUP_CALLS, call(10, 'POST', 'https://api.crow.direct', '/v1/faucet')];
    expect(setupOf({ calls, firstDealAtMs: MARK }).requestsBeforeFirstDeal).toEqual({ total: 1, byHost: { 'https://api.crow.direct': 1 } });
  });

  it('counts any request whose path holds an address, to any host, and not a commitment ID', () => {
    const calls = [
      call(10, 'GET', 'https://api2.crow.direct', `/v1/balances/${ADDR}`),
      call(11, 'GET', 'https://sepolia.etherscan.io', `/address/${ADDR.toUpperCase().replace('0X', '0x')}`),
      call(12, 'GET', 'https://api.crow.direct', `/v1/commitments/${ID}`),
      call(13, 'HEAD', 'https://crow.direct', '/setup.txt'),
      DEAL,
    ];
    expect(setupOf({ calls, firstDealAtMs: MARK }).requestsBeforeFirstDeal).toEqual({ total: 3, byHost: { 'https://api2.crow.direct': 1, 'https://sepolia.etherscan.io': 1, 'https://crow.direct': 1 } });
  });

  it('counts a GET whose query holds an address (review, finding 1)', () => {
    const calls = [{ ...call(10, 'GET', 'https://api.crow.direct', '/v1/commitments'), queryHasAddress: true }, DEAL];
    expect(setupOf({ calls, firstDealAtMs: MARK }).requestsBeforeFirstDeal).toEqual({ total: 1, byHost: { 'https://api.crow.direct': 1 } });
  });

  it('takes the in-process world\'s own origins as Crow-run, and leaves the party\'s own API out', () => {
    const calls = [call(10, 'POST', 'http://127.0.0.1:40001', '/v1/faucet'), call(11, 'POST', 'http://127.0.0.1:41000', '/api/v2/estimates'), call(90, 'POST', 'http://127.0.0.1:40001', '/v1/commitments')];
    expect(setupOf({ calls, firstDealAtMs: MARK, crowOrigins: ['http://127.0.0.1:40001'] }).requestsBeforeFirstDeal).toEqual({ total: 1, byHost: { 'http://127.0.0.1:40001': 1 } });
  });

  it('counts a call with no time as before the marker, so an unknown order never hides a request', () => {
    const calls = [{ via: 'curl', at: null, method: 'POST', origin: 'https://api.crow.direct', path: '/v1/faucet', status: 200 }, DEAL];
    expect(setupOf({ calls, firstDealAtMs: MARK }).requestsBeforeFirstDeal?.total).toBe(1);
  });

  it('records both counts as unknown when no marker was seen, never as 0', () => {
    expect(setupOf({ calls: SETUP_CALLS, firstDealAtMs: null })).toMatchObject({ markerSeen: false, requestsBeforeFirstDeal: null, guideFilesFetched: null, unknownBecause: expect.stringMatching(/^No first-deal marker/) });
  });

  it('records both counts as unknown when no call was logged at or after the marker (review, finding 2)', () => {
    expect(setupOf({ calls: [], firstDealAtMs: MARK })).toMatchObject({ markerSeen: true, requestsBeforeFirstDeal: null, guideFilesFetched: null, unknownBecause: expect.stringMatching(/^The probes logged no call/) });
    expect(setupOf({ calls: SETUP_CALLS.slice(0, 6), firstDealAtMs: MARK }).requestsBeforeFirstDeal).toBe(null);
  });
});

describe('the probes see what names the party (review, finding 1)', () => {
  it.each([
    ['-sS -XPOST https://api.crow.direct/v1/faucet', 'POST'],
    ['-sS -X POST https://api.crow.direct/v1/faucet', 'POST'],
    ['--request=POST https://api.crow.direct/v1/faucet', 'POST'],
    ['--request PUT https://api.crow.direct/v1/faucet', 'PUT'],
    ['-d@body.json https://api.crow.direct/v1/faucet', 'POST'],
    ['-sd {} https://api.crow.direct/v1/faucet', 'POST'],
    ['-s --data-binary @b https://api.crow.direct/v1/faucet', 'POST'],
    ['--json {} https://api.crow.direct/v1/faucet', 'POST'],
    ['-F a=1 https://api.crow.direct/v1/faucet', 'POST'],
    ['-T file https://api.crow.direct/v1/faucet', 'POST'],
    ['-G -d a=1 https://api.crow.direct/v1/x', 'GET'],
    ['-I https://crow.direct/setup.txt', 'HEAD'],
    ['-fsSL https://crow.direct/setup.txt', 'GET'],
    ['-sS -o out.txt https://crow.direct/setup.txt', 'GET'],
    ['-H Accept:x/d https://crow.direct/setup.txt', 'GET'],
  ])('reads curl %s as %s', (argv, method) => expect(curlMethodOf(argv)).toBe(method));

  it('marks a curl call and a fetch call whose query holds an address, and keeps no query', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crow-query-'));
    try {
      writeFileSync(join(dir, 'curl.log'), `${Math.floor(MARK / 1000)}\t${join(dir, 'none.txt')}\t-sS https://api.crow.direct/v1/commitments?party=${ADDR} \n`);
      const [c] = readCalls({ curlLog: join(dir, 'curl.log') });
      expect(c).toMatchObject({ path: '/v1/commitments', queryHasAddress: true });
      expect(JSON.stringify(c)).not.toContain(ADDR);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("logs the fetch probe's query flag, and never the query", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crow-fetch-'));
    try {
      const probe = writeFetchProbe(dir);
      const r = spawnSync(process.execPath, [`--import=${probe.path}`, '--input-type=module', '-e', `await fetch('http://127.0.0.1:9/v1/commitments?party=${ADDR}').catch(() => {}); await fetch('http://127.0.0.1:9/v1/x?a=1').catch(() => {});`], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      const calls = readCalls({ fetchLog: probe.log });
      expect(calls.map((c) => c.queryHasAddress)).toEqual([true, false]);
      expect(readFileSync(probe.log, 'utf8')).not.toContain(ADDR);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("turns the agent's WebFetch requests into calls for the setup counts, with no query and no prompt", () => {
    const msg = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebFetch', input: { url: `https://crow.direct/setup.txt?for=${ADDR}`, prompt: 'read it' } }, { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } };
    expect(webFetchCallsOf(msg, MARK - 1)).toEqual([{ via: 'webfetch', at: MARK - 1, method: 'GET', origin: 'https://crow.direct', path: '/setup.txt', status: null, queryHasAddress: true }]);
    expect(webFetchCallsOf({ type: 'user', message: { content: [] } }, MARK)).toEqual([]);
  });

  it('counts a WebFetch guide file in a live setup record, and keeps it out of apiCalls', () => {
    const webCalls = [{ via: 'webfetch', at: T + 1000, method: 'GET', origin: 'https://crow.direct', path: '/setup.txt', status: null, queryHasAddress: false }];
    const r = liveRecord({ id: 's8', setup: { firstDealAtMs: MARK, webCalls }, calls: [DEAL] });
    expect(r.setup).toEqual({ markerSeen: true, requestsBeforeFirstDeal: { total: 0, byHost: {} }, guideFilesFetched: 1 });
    expect(r.apiCalls.total).toBe(1);
    expect(check('one-click', r)).toEqual({ ok: true, errors: [] });
  });
});

describe('the first-deal marker', () => {
  const line = (ms: number) => `crow-setup: first-deal started ${ms}`;
  it('takes the earliest marker line in any output, and ignores a line that is not one', () => {
    expect(firstDealAtOf([`setting up\n${line(MARK + 5)}\n`, `${line(MARK)}\nok`, 'crow-setup: first-deal started soon', `  ${line(1)}`])).toBe(MARK);
    expect(firstDealAtOf(['nothing here'])).toBe(null);
  });

  it('finds the marker in the agent\'s command output, and keeps only its time', () => {
    const msg = { type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: `{"ok":true}\n${line(MARK)}` }] }, { type: 'tool_result', content: 'no marker' }] } };
    expect(markerTimesOf(msg)).toEqual([MARK]);
    expect(markerTimesOf({ type: 'assistant', message: { content: [{ type: 'text', text: line(MARK) }] } })).toEqual([]); // the agent's own words are not the command's
  });

  it('finds the marker file in the setup folder under the run\'s folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crow-marker-'));
    try {
      mkdirSync(join(dir, 'crow', 'my-shop'), { recursive: true });
      writeFileSync(join(dir, 'crow', 'my-shop', 'first-deal.started'), `${line(MARK)}\n`);
      writeFileSync(join(dir, 'first-deal.started.bak'), `${line(1)}\n`);
      expect(firstDealAtOf(markerFilesUnder(dir))).toBe(MARK);
      expect(markerFilesUnder(join(dir, 'missing'))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads each call\'s time from the probes: milliseconds from fetch, seconds from curl', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crow-calls-'));
    try {
      writeFileSync(join(dir, 'fetch.jsonl'), `${JSON.stringify({ at: MARK, ms: 3, method: 'POST', origin: 'https://api.crow.direct', path: '/v1/faucet', status: 200 })}\n`);
      writeFileSync(join(dir, 'curl.log'), `${Math.floor(MARK / 1000)}\t${join(dir, 'none.txt')}\t-sS https://crow.direct/setup.txt \n`);
      expect(readCalls({ fetchLog: join(dir, 'fetch.jsonl'), curlLog: join(dir, 'curl.log') }).map((c) => c.at)).toEqual([MARK, Math.floor(MARK / 1000) * 1000]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the two setup scenarios', () => {
  it('adds s7 and s8 as setup scenarios beside the six deal scenarios', () => {
    expect(DEAL_IDS).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(SETUP_IDS).toEqual(['s7', 's8']);
    expect(SCENARIOS.s7).toMatchObject({ kind: 'setup', endState: 'Released', party: 'test-buyer', buyerMustBe: 'test-buyer' });
    expect(SCENARIOS.s8).toMatchObject({ kind: 'setup', endState: 'Released', party: 'test-seller' });
  });

  it('gives each goal every answer a person would give: s7 the job API, the price and the payout address; s8 the two limits', () => {
    const s7 = goalFor(SCENARIOS.s7, { jobApi: 'http://127.0.0.1:41000/api/v2/', payout: ADDR });
    expect(s7).toContain(SETUP_DOCS);
    expect(s7).toContain('http://127.0.0.1:41000/api/v2/');
    expect(s7).toContain(ADDR);
    expect(s7).toMatch(/20 tUSDC \(20000000 base units\)/);
    expect(s7).not.toMatch(/\{\w+\}/);
    const s8 = goalFor(SCENARIOS.s8, {});
    expect(s8).toContain(SETUP_DOCS);
    expect(s8).toMatch(/40 tUSDC \(40000000 base units\) per deal/);
    expect(s8).toMatch(/100 tUSDC \(100000000 base units\) per day/);
  });

  it('blocks each scripted run on the task that brings its setup command, and each live run too', () => {
    expect(SCENARIOS.s7.scripted).toEqual({ blockedBy: expect.stringMatching(/^T-483: /) });
    expect(SCENARIOS.s8.scripted).toEqual({ blockedBy: expect.stringMatching(/^T-475: /) });
    expect(SCENARIOS.s7.live?.blockedBy).toMatch(/^T-483 and T-482: /);
    expect(SCENARIOS.s8.live?.blockedBy).toMatch(/^T-475: /);
  });

  it.each(['s7', 's8'])('refuses a live run of %s while it is blocked, before the key check, and sends nothing', (id) => {
    const out = mkdtempSync(join(tmpdir(), 'crow-bench-setup-'));
    try {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string' && k !== KEY_VAR) env[k] = v;
      const r = spawnSync(process.execPath, [BENCH, '--scenario', id, '--live', '--out', out], { encoding: 'utf8', env });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`${id}'s live run waits for`);
      expect(r.stderr).toContain('nothing was sent');
      expect(readdirSync(out)).toEqual([]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe('s7 succeeds only with an outside buyer', () => {
  const released = { state: 'Released', commitmentId: ID, stoppedAt: null, errors: [] as string[] };
  const testBuyer = `0x${'7b'.repeat(20)}`;
  it('keeps a deal whose buyer is the test buyer, whatever the case of the hex', () => {
    expect(buyerCheck(released, { buyer: testBuyer.toUpperCase().replace('0X', '0x'), testBuyer })).toEqual(released);
  });
  it('records a deal the setup command bought itself as not successful', () => {
    const o = buyerCheck(released, { buyer: ADDR, testBuyer });
    expect(o).toMatchObject({ state: 'stopped', stoppedAt: "the buyer is not Crow's test buyer" });
    expect(o.errors).toEqual([`the buyer was ${ADDR}, not Crow's test buyer`]);
    expect(released.state).toBe('Released'); // the check returns a new outcome; it changes nothing it was given
    const record = buildBenchRecord({ ...recordInput('s7'), outcome: o });
    expect(record.outcome).toMatchObject({ success: false, state: 'stopped', stoppedAt: "the buyer is not Crow's test buyer" });
    expect(check('one-click', record)).toEqual({ ok: true, errors: [] });
  });
  it('records a buyer that could not be read as not successful', () => {
    expect(buyerCheck(released, { buyer: null, testBuyer })).toMatchObject({ state: 'stopped', stoppedAt: 'the buyer of the commitment could not be read' });
  });
  it('leaves a run that did not reach its end state as it was', () => {
    const stopped = { state: 'stopped', commitmentId: null, stoppedAt: 'no commitment', errors: [] };
    expect(buyerCheck(stopped, { buyer: null, testBuyer })).toEqual(stopped);
  });
});

describe("s7's scripted path, rehearsed in the in-process world", () => {
  // The harness's own scripted path with a stand-in for the setup command (fixtures/setup-rehearsal.ts) until T-483.
  const rehearse = async (args: string[]) => {
    const scenario = { id: 's7', ...SCENARIOS.s7, scripted: { script: 'tests/metrics/fixtures/setup-rehearsal.ts', args, needs: 'buyer' as const, jobApi: true } };
    const { run, outcome, calls, crowOrigins } = await playScripted(scenario, { payout: ADDR });
    const record = buildBenchRecord({ mode: 'scripted', scenario, world: { engine: 'local', docs: 'in-process' }, agent: { script: scenario.scripted.script }, outcome, book: { wallMs: run.wallMs, errors: outcome.errors, timedOut: run.timedOut }, calls, setup: { firstDealAtMs: run.firstDealAtMs, crowOrigins }, prices, startedAtMs: T, generatedAtMs: T + 1, commit: COMMIT });
    return { record, run, crowOrigins };
  };

  it('counts a faucet post before the marker as 1, and ends Released with the test buyer', async () => {
    const { record, run, crowOrigins } = await rehearse(['--faucet-first']);
    expect(record.outcome, run.out).toMatchObject({ success: true, state: 'Released' });
    const operator = crowOrigins[0];
    expect(record.setup).toEqual({ markerSeen: true, requestsBeforeFirstDeal: { total: 1, byHost: { [operator]: 1 } }, guideFilesFetched: 0 });
    // the job API was called before the marker and is the party's own, so it is not counted
    expect(Object.keys(record.apiCalls.byHost).filter((h) => !crowOrigins.includes(h))).toHaveLength(1);
    expect(check('one-click', record)).toEqual({ ok: true, errors: [] });
  }, 60_000);

  it('counts 0 for a setup that sends nothing naming the party before the first deal', async () => {
    const { record, run } = await rehearse([]);
    expect(record.outcome, run.out).toMatchObject({ success: true, state: 'Released' });
    expect(record.setup).toEqual({ markerSeen: true, requestsBeforeFirstDeal: { total: 0, byHost: {} }, guideFilesFetched: 0 });
  }, 60_000);
});

describe("s7's job API in the scripted world", () => {
  it('serves a job API of another shape on 127.0.0.1, which takes its own fresh key only', async () => {
    const api = await startJobApi();
    try {
      expect(api.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/v2\/$/);
      expect(api.key).toMatch(/^[0-9a-f]{32}$/);
      const ask = (key: string) => fetch(`${api.url}estimates`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key }, body: JSON.stringify({ target: 'example.org', depth: 1, client: 'bench' }) });
      expect((await ask(api.key)).status).toBe(200);
      expect((await ask('wrong')).status).toBe(401);
    } finally {
      await api.close();
    }
  });
});

function recordInput(id: string) {
  const s = { id, ...SCENARIOS[id as keyof typeof SCENARIOS] };
  return { mode: 'scripted' as const, scenario: s, world: { engine: 'local' as const, docs: 'in-process' }, agent: { script: 'tools/one-click/scripted/setup-seller.ts' }, outcome: { state: s.endState, commitmentId: ID }, book: { wallMs: 90_000 }, calls: SETUP_CALLS, prices, startedAtMs: T, generatedAtMs: T + 100_000, commit: COMMIT, setup: { firstDealAtMs: MARK } };
}

describe('the record, version 3', () => {
  it('writes a scripted setup record with the two new fields, and it validates', () => {
    const r = buildBenchRecord(recordInput('s7'));
    expect(r.schema).toBe('crow.metrics.one-click/3');
    expect(r.setup).toEqual({ markerSeen: true, requestsBeforeFirstDeal: { total: 0, byHost: {} }, guideFilesFetched: 3 });
    expect(check('one-click', r)).toEqual({ ok: true, errors: [] });
  });

  it('writes a setup record with no marker as unknown, with a gap line, and it validates', () => {
    const r = buildBenchRecord({ ...recordInput('s8'), setup: { firstDealAtMs: null } });
    expect(r.setup).toEqual({ markerSeen: false, requestsBeforeFirstDeal: null, guideFilesFetched: null });
    expect(r.gaps.some((g: string) => g.startsWith('No first-deal marker'))).toBe(true);
    expect(check('one-click', r)).toEqual({ ok: true, errors: [] });
  });

  it('keeps a deal scenario on version 2, with no setup block, so a reader of version 2 keeps reading it (review, finding 4)', () => {
    const r = liveRecord({ id: 's1' });
    expect(r.schema).toBe('crow.metrics.one-click/2');
    expect('setup' in r).toBe(false);
    expect(check('one-click', r)).toEqual({ ok: true, errors: [] });
  });

  it('refuses a setup block or a setup scenario in a version 2 record', () => {
    const v2 = liveRecord({ id: 's1' });
    expect(check('one-click', { ...v2, setup: null }).ok).toBe(false);
    expect(check('one-click', { ...v2, runId: '2026-11-14T10-00-00Z-s7', scenario: { ...v2.scenario, id: 's7' } }).ok).toBe(false);
  });

  it('refuses a version 3 record without its setup block, with a 0 written as a string, or with a deal or unknown scenario', () => {
    const r = buildBenchRecord(recordInput('s7'));
    const noSetup: Record<string, unknown> = { ...r };
    delete noSetup.setup;
    expect(check('one-click', noSetup).ok).toBe(false);
    expect(check('one-click', { ...r, setup: null }).ok).toBe(false);
    expect(check('one-click', { ...r, setup: { ...r.setup, guideFilesFetched: '0' } }).ok).toBe(false);
    expect(check('one-click', { ...r, runId: '2026-11-14T10-00-00Z-s9', scenario: { ...r.scenario, id: 's9' } }).ok).toBe(false);
    expect(check('one-click', { ...r, runId: '2026-11-14T10-00-00Z-s1', scenario: { ...r.scenario, id: 's1' } }).ok).toBe(false);
  });

  it('refuses counts that contradict unknown, never 0 (review, finding 3)', () => {
    const r = buildBenchRecord(recordInput('s7'));
    const bad = [
      { markerSeen: false, requestsBeforeFirstDeal: { total: 0, byHost: {} }, guideFilesFetched: 0 },
      { markerSeen: false, requestsBeforeFirstDeal: null, guideFilesFetched: 0 },
      { markerSeen: true, requestsBeforeFirstDeal: null, guideFilesFetched: 3 },
      { markerSeen: true, requestsBeforeFirstDeal: { total: 0, byHost: {} }, guideFilesFetched: null },
      { markerSeen: true, requestsBeforeFirstDeal: { total: 1, byHost: {} }, guideFilesFetched: 3 },
      { markerSeen: true, requestsBeforeFirstDeal: { total: 0, byHost: { 'https://api.crow.direct': 1 } }, guideFilesFetched: 3 },
    ];
    for (const setup of bad) expect(check('one-click', { ...r, setup }).ok, JSON.stringify(setup)).toBe(false);
    for (const setup of [
      { markerSeen: true, requestsBeforeFirstDeal: null, guideFilesFetched: null }, // a marker, but no call logged after it
      { markerSeen: true, requestsBeforeFirstDeal: { total: 2, byHost: { 'https://api.crow.direct': 2 } }, guideFilesFetched: 0 },
    ]) expect(check('one-click', { ...r, setup }), JSON.stringify(setup)).toEqual({ ok: true, errors: [] });
  });
});

describe('the summary keeps the setup scenarios apart', () => {
  const deals = () => [
    liveRecord({ id: 's1', approvals: 2, wallMs: 100_000, startedAtMs: at(1) }),
    liveRecord({ id: 's3', approvals: 4, wallMs: 300_000, startedAtMs: at(2) }),
    liveRecord({ id: 's4', approvals: 3, wallMs: 200_000, startedAtMs: at(3) }),
  ];
  const setups = () => [
    liveRecord({ id: 's7', approvals: 9, wallMs: 360_000, startedAtMs: at(4), setup: { firstDealAtMs: MARK }, calls: SETUP_CALLS }),
    liveRecord({ id: 's7', approvals: 11, wallMs: 400_000, startedAtMs: at(5), setup: { firstDealAtMs: MARK }, calls: [...SETUP_CALLS, call(10, 'POST', 'https://api.crow.direct', '/v1/faucet')] }),
    liveRecord({ id: 's7', approvals: 30, wallMs: 900_000, startedAtMs: at(6), setup: { firstDealAtMs: null }, calls: SETUP_CALLS }),
    liveRecord({ id: 's8', approvals: 1, wallMs: 60_000, startedAtMs: at(7), setup: { firstDealAtMs: MARK }, calls: [SETUP_CALLS[0], DEAL] }),
  ];

  it('moves no headline number when s7 and s8 records are added', () => {
    const without = buildSummary({ records: deals(), generatedAtMs: NOW, commit: COMMIT });
    const withSetup = buildSummary({ records: [...deals(), ...setups()], generatedAtMs: NOW, commit: COMMIT });
    expect(withSetup.headline).toEqual(without.headline);
    expect(withSetup.headline.approvalsPerDeal).toEqual({ state: 'measured', value: 3, deals: 3 });
    expect(Object.keys(withSetup.byScenario)).toEqual(DEAL_IDS);
    expect(check('one-click-summary', without)).toEqual({ ok: true, errors: [] });
    expect(check('one-click-summary', withSetup)).toEqual({ ok: true, errors: [] });
  });

  it('reports each setup scenario on its own, with the two counts', () => {
    const s = buildSummary({ records: [...deals(), ...setups()], generatedAtMs: NOW, commit: COMMIT });
    // s7: approvals 9, 11, 30 (median 11); requests before the first deal 0, 1 and one unknown (2 known, median 0);
    // guide files 3, 3 and one unknown.
    expect(s.setup.s7).toMatchObject({ live: 3, liveCompleted: 3, latestLive: { runId: '2026-11-14T10-06-00Z-s7', state: 'Released' } });
    expect(s.setup.s7.headline.approvalsPerDeal).toEqual({ state: 'measured', value: 11, deals: 3 });
    expect(s.setup.s7.headline.requestsBeforeFirstDeal).toEqual({ state: 'measured', value: 0, deals: 2 });
    expect(s.setup.s7.headline.guideFilesFetched).toEqual({ state: 'measured', value: 3, deals: 2 });
    expect(s.setup.s8.headline.approvalsPerDeal).toEqual({ state: 'measured', value: 1, deals: 1 });
    expect(s.setup.s8.headline.guideFilesFetched).toEqual({ state: 'measured', value: 1, deals: 1 });
    expect(s.setup.s8.sandboxAuto.approvalsPerDeal).toEqual({ state: 'missing', value: null, deals: 0 });
  });

  it('reads every setup number as missing with no setup record', () => {
    const s = buildSummary({ records: deals(), generatedAtMs: NOW, commit: COMMIT });
    expect(s.setup.s7).toMatchObject({ live: 0, liveCompleted: 0, latestLive: null, latestScripted: null });
    expect(s.setup.s7.headline.requestsBeforeFirstDeal).toEqual({ state: 'missing', value: null, deals: 0 });
  });

  it('reads version 2 and version 3 records from one folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crow-summary-v3-'));
    try {
      writeFileSync(join(dir, 'a.json'), JSON.stringify(liveRecord({ id: 's1', startedAtMs: at(1) })));
      writeFileSync(join(dir, 'b.json'), JSON.stringify(liveRecord({ id: 's3', startedAtMs: at(2) })));
      writeFileSync(join(dir, 'c.json'), JSON.stringify(setups()[0]));
      const read = readRecords([dir]);
      expect(read.invalid).toEqual([]);
      expect(read.records.map((r: { schema: string }) => r.schema).sort()).toEqual(['crow.metrics.one-click/2', 'crow.metrics.one-click/2', 'crow.metrics.one-click/3']);
      const s = buildSummary({ ...read, generatedAtMs: NOW, commit: COMMIT });
      expect(s.headline.approvalsPerDeal).toEqual({ state: 'measured', value: 3, deals: 2 });
      expect(s.setup.s7.live).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
