// T-571: the approvals runner's own parts, with no key and no network: the hard budget, the sell command's fence,
// and the count of approvals from a record.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { runAgent } from './loop.ts';
import { BUDGET, buyerBriefCold, BUYER_USAGE, scenario, SCOPE, START_AT_DOCS } from './scenarios.ts';
import { REPO, runDuet } from './run.ts';
import { saveWork } from '../../examples/deal-files.ts';
import { anthropic, KEY_ENV, liveProvider, scripted, WORKSPACE_ENV, type ScriptContext, type ScriptStep } from './providers.ts';
import { Recorder, Secrets } from './record.ts';
import { Toolbox } from './tools.ts';
import { readFileSync } from 'node:fs';
import { Budget, BUDGET_STOP, dealIds, draftPages, frontPage, measureRun, parseRuns, sellBrief, trySell } from './approvals.ts';
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

describe('a draft front page (P-15)', () => {
  it('answers /llms.txt with the draft and passes every other GET to the upstream, even a "//host" path', async () => {
    const seen: string[] = [];
    const upstream = createServer((q, s) => { seen.push(q.url ?? ''); s.writeHead(200, { 'content-type': 'text/plain' }).end('the live page'); });
    await new Promise<void>((ok) => upstream.listen(0, '127.0.0.1', ok));
    const draft = await frontPage('a draft front page', `http://127.0.0.1:${(upstream.address() as { port: number }).port}`);
    try {
      expect(await (await fetch(`${draft.url}/llms.txt`)).text()).toBe('a draft front page');
      expect(await (await fetch(`${draft.url}/sell.txt?x=1`)).text()).toBe('the live page');
      expect(await (await fetch(`${draft.url}//other.invalid/p`)).text()).toBe('the live page');
      expect(seen).toEqual(['/sell.txt?x=1', '//other.invalid/p']);
      expect((await fetch(`${draft.url}/llms.txt`, { method: 'POST' })).status).toBe(405);
    } finally { await draft.close(); upstream.close(); }
  });
});

describe("the toolbox's alias (P-15's draft front page)", () => {
  it('keeps a "//host" path on the alias, never on the named host', async () => {
    const seen: string[] = [];
    const to = createServer((q, s) => { seen.push(q.url ?? ''); s.end('from the alias'); });
    await new Promise<void>((ok) => to.listen(0, '127.0.0.1', ok));
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'approvals-alias-')));
    made.push(dir);
    const secrets = new Secrets();
    const tools = new Toolbox({ role: 'seller', work: dir, owner: dir, repo: dir, operators: ['http://127.0.0.1:1'], allow: [{ origin: 'https://crow.direct' }], secrets, rec: new Recorder(join(dir, 'r.jsonl'), secrets), alias: { from: 'https://crow.direct', to: `http://127.0.0.1:${(to.address() as { port: number }).port}` } });
    try {
      expect((await tools.call('fetch_url', { url: 'https://crow.direct//other.invalid/p?q=1' })).content).toContain('from the alias');
      expect(seen).toEqual(['//other.invalid/p?q=1']);
    } finally { to.close(); await tools.close(); }
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

  it('counts every read of crow.direct as one approval when they are allowed once, and other origins each (P-15)', () => {
    const more = [...events,
      ev('seller', 'tool', 6, { turn: 3, name: 'fetch_url', input: { url: 'https://crow.direct/ref/intake.txt' }, isError: false }),
      ev('seller', 'tool', 6, { turn: 3, name: 'fetch_url', input: { url: 'https://crow.direct/sell.txt' }, isError: false }),
      ev('seller', 'tool', 6, { turn: 3, name: 'fetch_url', input: { url: 'https://api.crow.direct/.well-known/holdback.json' }, isError: false }),
      ev('seller', 'tool', 6, { turn: 3, name: 'fetch_url', input: { url: 'https://crow.direct.evil.example/llms.txt' }, isError: true })];
    const m = measureRun(more, 'seller', 'sell', 'r');
    expect([m.approvals, m.site_reads, m.approvals_reads_once]).toEqual([7, 3, 5]);
    const none = measureRun(events.filter((e) => e['name'] !== 'fetch_url'), 'seller', 'sell', 'r');
    expect([none.approvals, none.site_reads, none.approvals_reads_once]).toEqual([2, 0, 2]);
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

describe("the buyer's NAME=value settings before a command (P-16, T-611's CROW_SELLER)", () => {
  const SELLER = `0x${'ab'.repeat(20)}`;
  const OPERATORS = ['http://127.0.0.1:1', 'http://127.0.0.1:2'];
  /** A buyer's toolbox whose buy command is a stand-in that prints what reached it. */
  function buyer() {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'p16-settings-')));
    made.push(base);
    const [repo, work, owner] = ['repo', 'work', 'owner'].map((n) => { const p = join(base, n); mkdirSync(p); return p; }) as [string, string, string];
    mkdirSync(join(repo, 'examples'));
    for (const c of ['buy-with-signer', 'deal-record']) writeFileSync(join(repo, 'examples', `${c}.ts`), "console.log(JSON.stringify({ argv: process.argv.slice(2), seller: process.env.CROW_SELLER ?? null, operators: process.env.HOLDBACK_OPERATORS }));\n");
    const rec = new Recorder(join(base, 'record.jsonl'), new Secrets());
    const keyStore = join(owner, 'keys');
    const tools = new Toolbox({ role: 'buyer', work, owner, repo, operators: OPERATORS, allow: [{ origin: 'https://seller.example' }], secrets: new Secrets(), rec, keyStore, usage: BUYER_USAGE });
    const quote = ['https://seller.example/quote', keyStore, '{"rows":5}', '5000000'];
    const buy = (args: string[], command = 'buy-with-signer') => tools.call('run_command', { command, args });
    const ran = () => rec.events.filter((e) => e.kind === 'command');
    return { tools, rec, quote, buy, ran, keyStore };
  }
  const printed = (content: string) => JSON.parse(content.split('--- stdout\n')[1]!.split('\n')[0]!) as { argv: string[]; seller: string | null; operators: string };

  it("hands CROW_SELLER to the command's environment, not its arguments, and records it", async () => {
    const b = buyer();
    const r = await b.buy([`CROW_SELLER=${SELLER}`, ...b.quote]);
    expect(r.isError).toBe(false);
    expect(printed(r.content)).toEqual({ argv: b.quote, seller: SELLER, operators: OPERATORS.join(',') });
    expect(b.ran()[0]!['settings']).toEqual({ CROW_SELLER: SELLER });
  });

  it('sets no seller when the agent gives none', async () => {
    const b = buyer();
    expect(printed((await b.buy(b.quote)).content).seller).toBeNull();
    expect(b.ran()[0]).not.toHaveProperty('settings');
  });

  it("takes the docs' HOLDBACK_OPERATORS prefix as already set, and changes nothing", async () => {
    for (const value of ['$OP1,$OP2', OPERATORS.join(',')]) {
      const b = buyer();
      const r = await b.buy([`HOLDBACK_OPERATORS=${value}`, `CROW_SELLER=${SELLER}`, ...b.quote]);
      expect(printed(r.content)).toEqual({ argv: b.quote, seller: SELLER, operators: OPERATORS.join(',') });
    }
  });

  it('refuses every other setting and every bad value, and runs nothing', async () => {
    for (const settings of [
      [`CROW_PAYMENT_ADDRESS=${SELLER}`], ['CROW_QUOTE_CREDENTIAL=x'], ['CROW_EXPECT={}'], ['NODE_OPTIONS=--require /tmp/x.js'], ['PATH=/tmp'],
      ['HOLDBACK_OPERATORS=https://elsewhere.example'], ['CROW_SELLER=0x12'], [`CROW_SELLER=${SELLER} `], [`CROW_SELLER=${SELLER}\nPATH=/tmp`], ['CROW_SELLER='],
      [`CROW_SELLER=${SELLER}`, `CROW_SELLER=${SELLER}`],
    ]) {
      const b = buyer();
      const r = await b.buy([...settings, ...b.quote]);
      expect(r.content, settings.join(' ')).toMatch(/^Refused: /);
      expect(b.ran()).toHaveLength(0);
    }
  });

  it("keeps the other fences: the usage rule, the approval policy, and another command's arguments", async () => {
    const b = buyer();
    expect((await b.buy([`CROW_SELLER=${SELLER}`, '--help'])).content).toMatch(/does not answer --help/);
    expect((await b.buy([`CROW_SELLER=${SELLER}`])).content).toMatch(/does not answer --help or an empty call/);
    expect((await b.buy([`CROW_SELLER=${SELLER}`, 'approve', b.keyStore, `0x${'1'.repeat(64)}`, '5000000'])).content).toMatch(/no approval policy/);
    expect((await b.buy([`CROW_SELLER=${SELLER}`, `0x${'1'.repeat(64)}`, '--as', 'buyer'], 'deal-record')).content).toMatch(/^Refused: /);
    expect(b.ran()).toHaveLength(0);
  });

  it("tells the buyer how to pass a setting without naming one, and tells the seller nothing new", () => {
    const said = buyer().tools.specs.find((s) => s.name === 'run_command')!.description;
    expect(said).toMatch(/NAME=value/);
    expect(said).not.toMatch(/CROW_SELLER/);
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'p16-seller-')));
    made.push(base);
    const seller = new Toolbox({ role: 'seller', work: base, owner: base, repo: base, operators: OPERATORS, allow: [], secrets: new Secrets(), rec: new Recorder(join(base, 'record.jsonl'), new Secrets()) });
    expect(seller.specs.find((s) => s.name === 'run_command')!.description).not.toMatch(/NAME=value/);
  });

  it('counts a command with a setting as one approval and says which seller the buyer named', () => {
    const at = '2026-11-25T00:00:00Z';
    const events = [
      { at, role: 'buyer', kind: 'agent.start', model: 'scripted', vendor: 'scripted' },
      { at, role: 'buyer', kind: 'command', command: 'buy-with-signer', settings: { CROW_SELLER: SELLER } },
      { at, role: 'buyer', kind: 'tool', name: 'run_command', turn: 1, input: { command: 'buy-with-signer', args: [`CROW_SELLER=${SELLER}`] }, result: 'exit 3' },
    ] as unknown as Event[];
    const m = measureRun(events, 'buyer', 'buy', 'x');
    expect(m.approvals).toBe(1);
    expect(m.seller_named).toBe(SELLER);
    expect(measureRun(events.filter((e) => e.kind !== 'command'), 'buyer', 'buy', 'x').seller_named).toBeNull();
  });
});

describe('the files the buying command saves beside the key store (T-617, T-623)', () => {
  const ID = `0x${'ab'.repeat(32)}`;
  /** A buyer's company as a run lays it out, with the two files the shipped saver writes for one finished deal. */
  async function company(role: 'buyer' | 'seller' = 'buyer') {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 't623-')));
    made.push(base);
    const [work, owner] = ['work', 'company'].map((n) => { const p = join(base, n); mkdirSync(p, { mode: 0o700 }); return p; }) as [string, string];
    const keyStore = join(owner, 'keys');
    mkdirSync(keyStore, { mode: 0o700 });
    const keyFile = join(keyStore, `0x${'12'.repeat(20)}.json`);
    writeFileSync(keyFile, '{"privateKey":"the buyer\'s key"}', { mode: 0o600 });
    writeFileSync(join(owner, 'policy.json'), 'the company\'s own file');
    const saved = (await saveWork({ store: keyStore, commitmentId: ID, work: 'n,square\n1,1\n', format: 'text/csv' })).work!;
    const rec = new Recorder(join(base, 'record.jsonl'), new Secrets());
    const tools = new Toolbox({ role, work, owner, repo: REPO, operators: ['http://127.0.0.1:1'], allow: [], secrets: new Secrets(), rec, ...(role === 'buyer' ? { keyStore, usage: BUYER_USAGE } : {}) });
    const files = `${keyStore}-files`;
    const read = (path: string) => tools.call('read_file', { path });
    return { base, work, owner, keyStore, keyFile, files, saved, tools, rec, read };
  }

  it('lets the buyer read and list them, by the path the command names', async () => {
    const c = await company();
    expect(c.saved).toBe(join(c.files, `${ID}.work.csv`));
    expect((await c.read(c.saved)).content).toContain('n,square');
    expect((await c.tools.call('list_files', { path: c.files })).content).toBe(`${ID}.work.csv`);
    expect(c.rec.events.filter((e) => e.kind === 'file').at(-1)).toMatchObject({ op: 'read', saved: true });
  });

  it('keeps the key store and everything else of the company out of reach', async () => {
    const c = await company();
    for (const path of [c.keyFile, c.keyStore, c.owner, join(c.owner, 'policy.json'), `${c.files}/../keys/0x${'12'.repeat(20)}.json`, `${c.files}/../policy.json`, `${c.files}-other/x`, `${c.keyStore.toUpperCase()}-FILES`, '../company/keys']) {
      for (const tool of ['read_file', 'list_files']) {
        const r = await c.tools.call(tool, { path });
        expect(r.isError, `${tool} ${path}`).toBe(true);
        expect(r.content).not.toContain("the buyer's key");
        expect(r.content).not.toContain("the company's own file");
      }
    }
  });

  it('follows no link out of the saved files, planted in the folder or standing in its place', async () => {
    const c = await company();
    symlinkSync(c.keyFile, join(c.files, 'a-key'));
    symlinkSync(c.keyStore, join(c.files, 'a-store'));
    for (const path of [join(c.files, 'a-key'), join(c.files, 'a-store', `0x${'12'.repeat(20)}.json`)]) {
      const r = await c.read(path);
      expect(r.content, path).toMatch(/symbolic link/);
      expect(r.content).not.toContain("the buyer's key");
    }
    rmSync(c.files, { recursive: true, force: true });
    symlinkSync(c.keyStore, c.files);
    for (const r of [await c.read(join(c.files, `0x${'12'.repeat(20)}.json`)), await c.tools.call('list_files', { path: c.files })]) {
      expect(r.content).toMatch(/symbolic link/);
      expect(r.content).not.toContain("the buyer's key");
    }
  });

  it('is read-only: the buyer writes nothing there, with a tool or through a command', async () => {
    const c = await company();
    expect((await c.tools.call('write_file', { path: c.saved, content: 'other work' })).content).toMatch(/outside your folder/);
    expect((await c.tools.call('write_file', { path: join(c.files, 'new.txt'), content: 'x' })).content).toMatch(/outside your folder/);
    expect((await c.tools.call('run_command', { command: 'deal-record', args: [ID, '--as', 'buyer', '--out', join(c.files, 'out.json')] })).content).toMatch(/outside your folder/);
    expect(readFileSync(c.saved, 'utf8')).toBe('n,square\n1,1\n');
  });

  it('hands a saved file to a command that reads one, and still refuses the key file there', async () => {
    const c = await company();
    writeFileSync(join(c.work, 'terms.json'), '{}');
    const ran = await c.tools.call('run_command', { command: 'check-delivery', args: ['terms.json', c.saved] });
    expect(ran.content).toMatch(/^exit /); // the command ran: it was given the saved file
    expect((await c.tools.call('run_command', { command: 'check-delivery', args: ['terms.json', c.keyFile] })).content).toMatch(/^Refused: /);
  });

  it('says so in the buyer\'s tools, and gives a seller no such reach', async () => {
    const buyer = await company();
    const seller = await company('seller');
    const said = (t: Toolbox, name: string) => t.specs.find((s) => s.name === name)!.description;
    for (const name of ['read_file', 'list_files']) {
      expect(said(buyer.tools, name)).toMatch(/saved/);
      expect(said(seller.tools, name)).not.toMatch(/saved/);
    }
    expect((await seller.read(seller.saved)).content).toMatch(/outside your folder/);
  });
});

describe('a draft buy.txt (T-623)', () => {
  it('answers /buy.txt with the draft and passes the front page and the rest to the upstream', async () => {
    const seen: string[] = [];
    const upstream = createServer((q, s) => { seen.push(q.url ?? ''); s.writeHead(200, { 'content-type': 'text/plain' }).end('the live page'); });
    await new Promise<void>((ok) => upstream.listen(0, '127.0.0.1', ok));
    const draft = await draftPages({ '/buy.txt': 'a draft buyer page' }, `http://127.0.0.1:${(upstream.address() as { port: number }).port}`);
    try {
      expect(await (await fetch(`${draft.url}/buy.txt`)).text()).toBe('a draft buyer page');
      expect(await (await fetch(`${draft.url}/buy.txt?x=1`)).text()).toBe('a draft buyer page');
      expect(await (await fetch(`${draft.url}/llms.txt`)).text()).toBe('the live page');
      expect(await (await fetch(`${draft.url}/agents/test-seller`)).text()).toBe('the live page');
      expect(seen).toEqual(['/llms.txt', '/agents/test-seller']);
    } finally { await draft.close(); upstream.close(); }
  });

  it('is taken only with buy runs from the test seller, and needs a file', () => {
    const run = (...args: string[]) => spawnSync(process.execPath, [join(REPO, 'tools', 'duet', 'approvals.ts'), 'plan', ...args], { encoding: 'utf8' });
    expect(run('--runs', 'claude:buy', '--test-seller', '--buy-page', join(REPO, 'site', 'buy.txt')).status).toBe(0);
    for (const args of [['--runs', 'claude:buy', '--buy-page', 'x'], ['--runs', 'claude:sell', '--buy-page', 'x'], ['--runs', 'claude:buy', '--test-seller', '--buy-page']]) {
      const r = run(...args);
      expect(r.status, args.join(' ')).toBe(2);
      expect(r.stderr).toMatch(/--buy-page takes a file, and only buy runs with --test-seller/);
    }
  });
});

describe("what a run did with the record and with files (T-623's pass rule)", () => {
  it('counts the record command, and names the files the agent wrote and the saved files it read', () => {
    const at = '2026-11-26T00:00:00Z';
    const tool = (name: string, input: Record<string, unknown>) => ({ at, role: 'buyer', kind: 'tool', name, turn: 1, input, result: 'ok' });
    const events = [
      { at, role: 'buyer', kind: 'agent.start', model: 'scripted', vendor: 'scripted' },
      tool('run_command', { command: 'deal-record', args: [] }), tool('run_command', { command: 'buy-with-signer', args: [] }),
      tool('write_file', { path: 'squares.csv', content: 'x' }), { ...tool('write_file', { path: 'no.txt', content: 'x' }), isError: true },
      { at, role: 'buyer', kind: 'file', op: 'read', path: '../company/keys-files/a.work.csv', saved: true },
      { at, role: 'buyer', kind: 'file', op: 'read', path: 'notes.txt' },
    ] as unknown as Event[];
    expect(measureRun(events, 'buyer', 'buy', 'x')).toMatchObject({ record_calls: 1, files_written: ['squares.csv'], saved_files_read: ['../company/keys-files/a.work.csv'] });
  });
});

describe('a whole local deal with the shipped buy command (T-623)', () => {
  it('saves the work and the record beside the key store, and the agent reads both by the paths the command prints', async () => {
    const out = realpathSync(mkdtempSync(join(tmpdir(), 't623-run-')));
    made.push(out);
    let store = '';
    let quote = '';
    let id = '';
    const read: string[] = [];
    const call = (name: string, input: Record<string, unknown>) => ({ calls: [{ name, input }] });
    const last = (c: ScriptContext) => c.results().at(-1) ?? '';
    const steps: ScriptStep[] = [
      (c) => {
        const brief = String((c.history[0] as { text: string }).text);
        store = /Your key store is (\S+):/.exec(brief)![1]!;
        return call('fetch_url', { url: /A seller we found: (\S+?)\.\n/.exec(brief)![1]! });
      },
      (c) => { quote = /"quote":\s*"([^"]+)"/.exec(last(c))![1]!; return call('run_command', { command: 'buy-with-signer', args: [quote, store, JSON.stringify(SCOPE), BUDGET] }); },
      (c) => { id = /"commitmentId":\s*"(0x[0-9a-f]{64})"/.exec(last(c))![1]!; return call('run_command', { command: 'buy-with-signer', args: ['approve', store, id, BUDGET] }); },
      (c) => call('read_file', { path: /"saved":\{"work":"([^"]+)"\}/.exec(last(c))![1]! }),
      (c) => { read.push(last(c)); const ran = c.results().at(-2)!; return call('read_file', { path: /\{"record":\{"commitmentId":"0x[0-9a-f]{64}","file":"([^"]+)"/.exec(ran)![1]! }); },
      (c) => { read.push(last(c)); return call('finish', { outcome: 'read both', report: id }); },
    ];
    const done = await runDuet({ scenario: 'paid', buyer: scripted(steps), seller: 'scripted', brief: 'direct', coldBuyer: true, out, caps: { turns: 40, tokens: 2_000_000 }, timeoutSec: 300, graceSec: 5 });
    expect(done.ends.find((e) => e.role === 'buyer')).toMatchObject({ status: 'finished', outcome: 'read both' });
    expect(read[0]).toContain('"findings"');
    expect(read[1]).toContain('"holdback-deal-record/1"');
    const events = readFileSync(done.record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Event);
    const m = measureRun(events, 'buyer', 'buy', out);
    expect(m).toMatchObject({ record_calls: 0, files_written: [] });
    expect(m.saved_files_read.map((p) => p.replace(/^.*keys-files\//, '').replace(/^0x[0-9a-f]{64}\./, ''))).toEqual(['work.json', 'record.json']);
    for (const text of read) expect(done.leaks(text)).toBe(false);
  }, 180_000);
});
