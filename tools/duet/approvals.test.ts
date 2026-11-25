// T-571: the approvals runner's own parts, with no key and no network: the hard budget, the sell command's fence,
// and the count of approvals from a record.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { runAgent } from './loop.ts';
import { buyerBriefCold, BUYER_USAGE, scenario, START_AT_DOCS } from './scenarios.ts';
import { runDuet } from './run.ts';
import { anthropic, KEY_ENV, liveProvider, scripted, WORKSPACE_ENV, type ScriptStep } from './providers.ts';
import { Recorder, Secrets } from './record.ts';
import { Toolbox } from './tools.ts';
import { readFileSync } from 'node:fs';
import { Budget, BUDGET_STOP, dealIds, measureRun, parseRuns, sellBrief, trySell } from './approvals.ts';
import type { Provider } from './providers.ts';
import type { Event } from './record.ts';
import type { Fence } from './tools.ts';

const made: string[] = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

const fake = (usage = { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 }): Provider & { calls: number } => {
  const p = { vendor: 'anthropic' as const, model: 'claude-opus-5-5', calls: 0, ping: async () => undefined, turn: async () => { p.calls++; return { text: '', calls: [], usage, stop: 'end_turn' }; } };
  return p;
};

describe('the hard budget', () => {
  it('sends a turn that fits and adds its list-price cost', async () => {
    const b = new Budget(1_000_000); // USD 1
    const p = fake();
    await b.guard(p).turn('system', [{ role: 'user', text: 'brief' }], []);
    expect(p.calls).toBe(1);
    expect(b.spent).toBe(4000 + 2000); // 1,000 input at USD 4 and 100 output at USD 20 per million tokens, in micro-USD
  });

  it('sends no turn whose worst case could pass the budget', async () => {
    const b = new Budget(100_000); // USD 0.10: the output cap alone, 8,192 tokens at USD 20 per million, is USD 0.16
    const p = fake();
    await expect(b.guard(p).turn('system', [{ role: 'user', text: 'brief' }], [])).rejects.toThrow(/the budget/);
    expect(p.calls).toBe(0);
  });

  it('keeps the whole reservation when a turn fails, so a failed turn still counts', async () => {
    const b = new Budget(1_000_000);
    const p = fake();
    p.turn = async () => { p.calls++; throw new Error('HTTP 500'); };
    await expect(b.guard(p).turn('system', [{ role: 'user', text: 'brief' }], [])).rejects.toThrow(/500/);
    expect(b.spent).toBeGreaterThan(160_000); // at least the output cap, 8,192 tokens at USD 20 per million
    expect(b.stopped).toBe(false);
  });

  it('marks a turn it refuses, so the measures can tell a budget stop from a vendor refusal', async () => {
    const b = new Budget(10_000);
    await expect(b.guard(fake()).turn('s', [], [])).rejects.toThrow(BUDGET_STOP);
    expect(b.stopped).toBe(true);
  });

  it('counts a large history against the budget before sending', async () => {
    const b = new Budget(1_000_000);
    const p = fake();
    const big = 'x'.repeat(600_000); // about 200,000 tokens at three characters a token: USD 1 at the cache-write price
    await expect(b.guard(p).turn('system', [{ role: 'user', text: big }], [])).rejects.toThrow(/the budget/);
    expect(p.calls).toBe(0);
  });
});

describe("the sell command's fence", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 't571-')));
  made.push(dir);
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'data', 'readings.csv'), 'a\n');
  writeFileSync(join(dir, 'terms.json'), '{}');
  const fence: Fence = {
    url: (raw) => new URL(raw),
    file: (p) => { if (p.startsWith('-') || p.includes('..') || p.startsWith('/')) throw new Error(`${p} is outside your folder`); return join(dir, p); },
    approve: async () => undefined,
  };
  const check = (args: string[]) => trySell().commands['try-sell']!.check(args, fence);

  it('takes the seller\'s own work and terms, in either order, and --help', () => {
    expect(check(['--work', 'data/readings.csv', '--terms', 'terms.json'])).toEqual(['--work', 'data/readings.csv', '--terms', 'terms.json']);
    expect(check(['--terms', 'terms.json', '--work', 'data/readings.csv'])).toHaveLength(4);
    expect(check(['--help'])).toEqual(['--help']);
  });

  it('refuses a sample, another buyer, an outcome, a missing file and a file outside the folder', () => {
    expect(() => check(['--sample', 'robot-log'])).toThrow(/own work/);
    expect(() => check(['--work', 'data/readings.csv', '--terms', 'terms.json', '--buyer', 'https://evil.example'])).toThrow(/own work/);
    expect(() => check(['--work', 'data/readings.csv', '--terms', 'terms.json', '--outcome', 'refund'])).toThrow(/own work/);
    expect(() => check(['--work', 'data/readings.csv'])).toThrow(/usage/);
    expect(() => check(['--work', '../x', '--terms', 'terms.json'])).toThrow(/outside/);
    expect(() => check(['--work', 'data/readings.csv', '--work', 'data/readings.csv', '--terms', 'terms.json'])).toThrow(/once/);
  });
});

describe('the measures of a run', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 10, 19, 20, 0, s)).toISOString();
  const ev = (role: Event['role'], kind: string, s: number, extra: Record<string, unknown> = {}): Event => ({ role, kind, at: at(s), ...extra } as Event);
  const id = `0x${'ab'.repeat(32)}`;
  const events: Event[] = [
    ev('seller', 'agent.start', 0, { vendor: 'anthropic', model: 'claude-opus-5-5' }),
    ev('seller', 'model.turn', 1, { tokensIn: 1000, tokensOut: 100, cacheRead: 0, cacheWrite: 0 }),
    ev('seller', 'tool', 2, { turn: 1, name: 'fetch_url', input: { url: 'https://crow.direct/llms.txt' }, isError: false }),
    ev('seller', 'tool', 3, { turn: 1, name: 'read_file', input: { path: 'data/readings.csv' }, isError: false }),
    ev('seller', 'tool', 4, { turn: 2, name: 'write_file', input: { path: 'terms.json' }, isError: false }),
    ev('seller', 'tool', 5, { turn: 2, name: 'run_command', input: { command: 'try-sell' }, isError: false }),
    ev('seller', 'tool', 6, { turn: 3, name: 'wait', input: { seconds: 5 }, isError: false }),
    ev('seller', 'tool', 7, { turn: 3, name: 'finish', input: {}, isError: false }),
    ev('seller', 'agent.end', 8, { status: 'finished', outcome: 'Released' }),
    ev('runner', 'chain.state', 9, { commitmentId: id, operator: 'https://api.crow.direct', escrowState: 'Released' }),
    ev('runner', 'chain.state', 9, { commitmentId: id, operator: 'https://api2.crow.direct', escrowState: 'Released' }),
    ev('runner', 'chain.event', 9, { commitmentId: id, type: 'Released', at: at(50) }),
  ];

  it('counts each web read, command and file write as one approval, and nothing else', () => {
    const m = measureRun(events, 'seller', 'sell', 'r');
    expect(m.approvals).toBe(3);
    expect(m.approvals_by_step.map((s) => s.tool)).toEqual(['fetch_url', 'write_file', 'run_command']);
  });

  it('takes the final state from both operators and the seconds from the first call to the final event', () => {
    const m = measureRun(events, 'seller', 'sell', 'r');
    expect([m.final_state, m.final_state_op2, m.commitment_id, m.seconds]).toEqual(['Released', 'Released', id, 50]);
    expect([m.tokens_in, m.tokens_out, m.turns, m.cost_usd]).toEqual([1000, 100, 1, 0.006]);
  });

  it('counts no call the loop did not run, and tells granted policy approvals from refused ones', () => {
    const more = [...events,
      ev('seller', 'tool', 7, { turn: 3, name: 'run_command', input: {}, isError: true, result: 'Not run: you finished in this turn.' }),
      ev('seller', 'approval', 7, { granted: true }), ev('seller', 'approval', 7, { granted: false })];
    const m = measureRun(more, 'seller', 'sell', 'r');
    expect(m.approvals).toBe(3);
    expect(m.policy_approvals).toEqual({ granted: 1, refused: 1 });
  });

  it("finds a deal only in the commands' own API calls, Refunded or not, never in the agent's words", () => {
    const fakeId = `0x${'cd'.repeat(32)}`;
    const mixed: Event[] = [
      ev('seller', 'tool', 1, { name: 'run_command', result: `offered commitment ${fakeId}` }),
      ev('seller', 'api', 2, { via: 'command', method: 'GET', url: `https://api.crow.direct/v1/commitments/${id.toUpperCase().replace('0X', '0x')}` }),
      ev('seller', 'api', 3, { via: 'command', method: 'GET', url: `https://api2.crow.direct/v1/commitments/${id}/events` }),
    ];
    expect(dealIds(mixed)).toEqual([id]);
  });

  it('says a run the budget stopped was stopped by the budget', () => {
    const stopped = events.map((e) => (e.kind === 'agent.end' ? { ...e, status: 'error', outcome: `the anthropic API refused: ${BUDGET_STOP} USD 1.90 spent` } : e)) as Event[];
    expect(measureRun(stopped, 'seller', 'sell', 'r').agent_end).toMatch(/^stopped by the budget: USD 1.90/);
  });

  it('reads runs as <model>:<direction>', () => {
    expect(parseRuns('claude:buy,deepseek:sell')).toEqual([{ model: 'claude', direction: 'buy' }, { model: 'deepseek', direction: 'sell' }]);
    expect(() => parseRuns('gpt:buy')).toThrow();
  });
});

describe("the buyer's run (N215): the usage line once, no probe, the guide read", () => {
  const facts = { docs: { guide: 'http://x/llms.txt', sell: 'http://x/sell.txt', buy: 'http://x/buy.txt' }, sellerPage: 'http://x/sellers/a/', jobApi: { quote: 'http://j/q', start: 'http://j/s', result: 'http://j/r' }, adapterPort: 4567, keyStore: '/k', token: 'tUSD', local: true };

  it("gives each command's usage line once in the brief, and points only at the front door", () => {
    const b = buyerBriefCold(scenario('paid'), facts);
    for (const [c, u] of Object.entries(BUYER_USAGE)) expect(b).toContain(`- ${c} ${u}`);
    expect(b.match(/- buy-with-signer /g)).toHaveLength(1);
    expect(b).toContain('https://crow.direct/llms.txt');
    expect(b).not.toMatch(/buy\.txt/);
  });

  it('refuses --help and an empty call with the usage line, and runs a call with arguments', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'approvals-usage-')));
    made.push(dir);
    const [work, owner] = [join(dir, 'work'), join(dir, 'owner')];
    for (const p of [work, owner]) mkdirSync(p);
    const secrets = new Secrets();
    const tools = new Toolbox({ role: 'buyer', work, owner, repo: dir, operators: ['http://127.0.0.1:1'], allow: [], secrets, rec: new Recorder(join(owner, 'r.jsonl'), secrets), usage: BUYER_USAGE });
    for (const args of [[], ['--help'], ['-h']]) {
      const r = await tools.call('run_command', { command: 'buy-with-signer', args });
      expect(r.isError).toBe(true);
      expect(r.content).toMatch(/does not answer --help.*<quote URL> <key store>/);
    }
    // A call with arguments reaches the command's own fence, not the usage refusal.
    expect((await tools.call('run_command', { command: 'buy-with-signer', args: ['approve'] })).content).not.toMatch(/does not answer --help/);
  });

  it('sends the workspace ID header only when it is set', async () => {
    const seen: Array<Record<string, string>> = [];
    const made_up = 'x'.repeat(16); // stands in for a key: nothing is sent
    const f = (async (_u: unknown, init: { headers: Record<string, string> }) => { seen.push(init.headers); return new Response(JSON.stringify({ content: [], usage: {} }), { status: 200 }); }) as unknown as typeof fetch;
    await anthropic('claude-opus-5-5', made_up, f).ping();
    await anthropic('claude-opus-5-5', made_up, f, 'wrkspc_1').ping();
    expect(seen[0]).not.toHaveProperty('anthropic-workspace-id');
    expect(seen[1]!['anthropic-workspace-id']).toBe('wrkspc_1');
    expect(liveProvider('anthropic', 'claude-opus-5-5', { [KEY_ENV.anthropic]: made_up, [WORKSPACE_ENV]: 'w' })).toMatchObject({ vendor: 'anthropic' });
  });

  it('runs the scripted buyer from crow.direct on the local world, reads buy.txt, probes nothing, and is measured like a seller', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'approvals-buyer-')));
    made.push(dir);
    const r = await runDuet({ scenario: 'paid', buyer: 'scripted', seller: 'scripted', brief: 'direct', coldBuyer: true, out: join(dir, 'run'), caps: { turns: 400, tokens: 50_000_000 }, graceSec: 30, timeoutSec: 180, limits: { workTokensPerAgent: 5_000_000 } });
    const events = readFileSync(r.record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Event);
    expect(events.find((e) => e.kind === 'run.start')?.['coldBuyer']).toBe(true);
    expect(String(events.find((e) => e.role === 'buyer' && e.kind === 'agent.start')?.['brief'])).toContain('- buy-with-signer <quote URL>');
    const m = measureRun(events, 'buyer', 'buy', 'r');
    expect(m.guide_reads).toContain('/buy.txt');
    expect(m.help_probes).toBe(0);
    // One count for both sides: each web read, command and file write is one approval, from the record alone.
    expect(m.approvals).toBe(m.approvals_by_step.length);
    expect(m.approvals_by_step.map((s) => s.tool).every((t) => ['fetch_url', 'run_command', 'write_file'].includes(t))).toBe(true);
    expect(m.approvals).toBeGreaterThanOrEqual(5);
  }, 240_000);
});

describe('a scripted run with a known number of approvals', () => {
  /** Plays the calls through the real loop, fences and record, then measures the record alone. */
  async function measured(role: 'buyer' | 'seller', calls: (url: string) => Array<{ name: string; input: Record<string, unknown> }>) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'approvals-count-')));
    made.push(dir);
    const [work, owner] = [join(dir, 'work'), join(dir, 'owner')];
    for (const p of [work, owner]) mkdirSync(p);
    writeFileSync(join(work, 'note.txt'), 'a note');
    const server = createServer((_q, s) => s.end('a guide'));
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const secrets = new Secrets();
      const rec = new Recorder(join(owner, 'r.jsonl'), secrets);
      const tools = new Toolbox({ role, work, owner, repo: dir, operators: [origin], allow: [{ origin }], secrets, rec });
      const steps: ScriptStep[] = calls(origin).map((c) => () => ({ calls: [c] }));
      const end = await runAgent({ role, provider: scripted(steps), brief: 'brief', tools, caps: { turns: 20, tokens: 1_000_000 }, rec, signal: new AbortController().signal });
      expect(end.status).toBe('finished');
      return measureRun(rec.events, role, role === 'buyer' ? 'buy' : 'sell', 'r');
    } finally { server.close(); }
  }
  const finish = { name: 'finish', input: { outcome: 'done', report: 'done' } };
  const free = [{ name: 'list_files', input: {} }, { name: 'read_file', input: { path: 'note.txt' } }, { name: 'wait', input: { seconds: 1 } }];

  for (const role of ['buyer', 'seller'] as const) {
    it(`reports exactly 2 for a ${role} with one web read and one file write among free calls`, async () => {
      const m = await measured(role, (url) => [{ name: 'fetch_url', input: { url: `${url}/a` } }, ...free, { name: 'write_file', input: { path: 'terms.json', content: '{}' } }, finish]);
      expect(m.approvals).toBe(2);
      expect(m.approvals_by_step.map((s) => s.tool)).toEqual(['fetch_url', 'write_file']);
    });

    it(`reports exactly 0 for a ${role} that only reads its folder and waits`, async () => {
      const m = await measured(role, () => [...free, finish]);
      expect(m.approvals).toBe(0);
      expect(m.approvals_by_step).toEqual([]);
    });
  }

  it('starts both sides with the same instruction', () => {
    const facts = { docs: { guide: 'http://x/g', sell: 'http://x/s', buy: 'http://x/b' }, sellerPage: 'http://x/sellers/a/', jobApi: { quote: 'http://j/q', start: 'http://j/s', result: 'http://j/r' }, adapterPort: 4567, keyStore: '/k', token: 'tUSD', local: true };
    expect(sellBrief()).toContain(START_AT_DOCS);
    expect(buyerBriefCold(scenario('paid'), facts)).toContain(START_AT_DOCS);
  });
});
