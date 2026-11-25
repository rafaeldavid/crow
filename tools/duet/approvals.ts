#!/usr/bin/env node
// Approvals per deal (T-571): one outside model as a cold agent, with only Crow's public docs, completes one deal on
// the live test service (Sepolia, test tokens only), as a buyer that starts the deal or as a seller that starts one.
// It counts the approvals a person in the agent's seat would give, from the run's record, never from the agent's own
// report, and reads every final state from both operators.
//
//   node tools/duet/approvals.ts plan [--runs <list>] [--budget-usd <n>]       the runs, the caps and the budget; sends nothing
//   node tools/duet/approvals.ts run --runs claude:buy,deepseek:sell --budget-usd 2 [--out <dir>]
//   node tools/duet/approvals.ts run --runs scripted:sell                       the seller's path with a script: no key, no model
//
// A run is <model>:<direction>. buy (N215): the agent starts from crow.direct with the usage line of each command once in its brief, never --help, so it must read buy.txt to know the steps; it buys a security review from a seller that the duet's scripted seller
// plays on this machine against the live operators, so no run uses the test seller's rate-limited quote route. sell:
// the agent sells its company's own data file to Crow's test buyer through the front door's sell command, run as
// `node examples/try-sell.ts`, with --work and --terms only.
//
// The budget is hard and covers every run of one invocation. Before each model turn the runner reserves an estimate of
// the most that turn can cost, with a margin: the whole request at two characters a token plus 1,000 tokens for the
// vendor's own tool prompt, every token at the dearest input price, plus the output cap. It sends no turn whose
// reservation would pass the budget, settles the reservation to the turn's list-price cost when it is back, and keeps
// the whole reservation when the turn fails. Not counted: a request the vendor billed and the client retried (the
// providers retry on network errors, 429 and 5xx), guessed to be rare. Keys: HOLDBACK_AGENT_ANTHROPIC_API_KEY for claude (and, for a key scoped to a workspace, HOLDBACK_AGENT_ANTHROPIC_WORKSPACE_ID: an ID, sent as `anthropic-workspace-id`); HOLDBACK_AGENT_OPENAI_COMPATIBLE_API_KEY
// and HOLDBACK_AGENT_OPENAI_COMPATIBLE_BASE_URL (https) for deepseek. They are scrubbed from everything written.
import { appendFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { masterPrompt, runAgent, type Caps } from './loop.ts';
import { inputPrice, priceOf } from './measures.ts';
import { JUDGE_KEY_ENV, KEY_ENV, liveProvider, MAX_OUTPUT_TOKENS, pinnedModel, scripted, type Provider, type ScriptStep } from './providers.ts';
import { Recorder, Secrets, type Event } from './record.ts';
import { CROW_SITE, REPO, runDuet } from './run.ts';
import { START_AT_DOCS } from './scenarios.ts';
import { Toolbox, type Allow, type Installed } from './tools.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const OPERATORS = ['https://api.crow.direct', 'https://api2.crow.direct'];
export const CAPS: Caps = { turns: 40, tokens: 2_000_000 };
/** The tools a person in the agent's seat would be asked to allow: the 2026-11-14 definition, mapped to the duet's tools (T-571 README). */
export const ASKS: Record<string, string> = { fetch_url: 'a web read (curl or WebFetch)', run_command: 'a command (Bash)', write_file: 'a file write (Write)' };

export type Direction = 'buy' | 'sell';
export type Model = 'claude' | 'deepseek' | 'scripted';
export interface RunSpec { model: Model; direction: Direction }

export function parseRuns(list: string): RunSpec[] {
  return list.split(',').filter(Boolean).map((r) => {
    const [model, direction] = r.split(':');
    if (!['claude', 'deepseek', 'scripted'].includes(model ?? '') || !['buy', 'sell'].includes(direction ?? '')) throw new Error(`${r} is not <claude|deepseek|scripted>:<buy|sell>`);
    return { model: model as Model, direction: direction as Direction };
  });
}

/** The hard budget, in micro-USD, shared by every run of one invocation. */
export class Budget {
  spent = 0;
  /** Whether the budget refused a turn. */
  stopped = false;
  readonly limit: number;
  constructor(limit: number) { this.limit = limit; }
  /** A provider that refuses a turn that could pass the budget, and adds each turn's list-price cost once it is back. */
  guard(p: Provider): Provider {
    const prices = inputPrice(p.model);
    if (p.vendor !== 'scripted' && !prices) throw new Error(`${p.model} has no price in config/model-prices.json, so its turns cannot be budgeted`);
    return {
      vendor: p.vendor,
      model: p.model,
      ping: (s) => p.ping(s),
      turn: async (system, history, tools, signal) => {
        if (!prices) return p.turn(system, history, tools, signal);
        const input = Math.ceil((system.length + JSON.stringify(history).length + JSON.stringify(tools).length) / 2) + 1000;
        const worst = Math.ceil((input * prices.input + MAX_OUTPUT_TOKENS * prices.output) / 1_000_000);
        if (this.spent + worst > this.limit) { this.stopped = true; throw new Error(`${BUDGET_STOP} USD ${usd(this.spent)} spent, this turn could cost up to USD ${usd(worst)}, the budget is USD ${usd(this.limit)}`); }
        this.spent += worst; // reserved; a failed turn keeps the reservation
        const a = await p.turn(system, history, tools, signal);
        this.spent += (priceOf(p.model, a.usage) ?? worst) - worst;
        return a;
      },
    };
  }
}
/** How a turn the budget refused begins: the loop records it as the vendor's refusal, so the measures look for it. */
export const BUDGET_STOP = 'stopped by the budget:';
const usd = (micro: number) => (micro / 1_000_000).toFixed(2);

/** The most one run can cost at its caps: every token at the dearest input price, plus every turn's output cap. */
export function ceilingOf(model: Model): number {
  if (model === 'scripted') return 0;
  const p = inputPrice(pinnedModel(model === 'claude' ? 'anthropic' : 'deepseek', undefined).id)!;
  return Math.ceil((CAPS.tokens * p.input + CAPS.turns * MAX_OUTPUT_TOKENS * p.output) / 1_000_000);
}

/** What the two sides' runs share and where they still differ, printed with every plan and run (N215). */
export const LIKE_FOR_LIKE = [
  'Both briefs give the same starting instruction (crow.direct/llms.txt), and one function counts both sides.',
  "They still differ: the buyer's brief gives each command's usage and --help is refused; the seller gets try-sell's usage in the tool list, and --help runs.",
];

// ---- The seller's run: its own data file, sold to Crow's test buyer ----

/** What the seller's company sells: 12 rows of a warehouse's sensor readings, priced at 5 tUSDC. */
export const DATA = ['reading_id,sensor,celsius', ...Array.from({ length: 12 }, (_, i) => `r${String(i + 1).padStart(3, '0')},${['dock', 'aisle', 'cold-room'][i % 3]},${(4 + (i % 5) * 1.5).toFixed(1)}`)].join('\n') + '\n';
export const PRICE = '5000000';

export function sellBrief(): string {
  return [
    'You work for our company. We sell small datasets to other agents through crow.direct.',
    'Today we sell one file: data/readings.csv in your folder, 12 sensor readings from our warehouse with the columns reading_id, sensor and celsius, one row per reading, each reading_id once.',
    START_AT_DOCS,
    `Sell it to Crow's test buyer, on our terms: a price of ${PRICE} base units of the test token (5.00 test tokens), and checks the buyer can run that state what the file is: exactly those three columns, exactly 12 rows, and reading_id unique. Each of those three checks is required.`,
    'This is a test, with test money: nothing is real money. Our approval policy is preset: the commands your company installed may run without asking us, and we have approved this sale on these terms.',
    'When the deal ends, call finish with the outcome, the commitment ID and what we were paid.',
  ].join('\n\n');
}

/** The front door's sell command, run from this checkout with the seller's own work and terms only. */
export function trySell(): Installed {
  return {
    repository: ['check-delivery', 'deal-record'],
    commands: {
      'try-sell': {
        script: join(REPO, 'examples', 'try-sell.ts'),
        describe: "the front door's sell command: sells work to Crow's test buyer; your company installed it for --work <file> --terms <file>",
        check(args, fence) {
          if (args.length === 1 && ['--help', '-h'].includes(args[0]!)) return args;
          const seen: Record<string, string> = {};
          for (let i = 0; i < args.length; i += 2) {
            const flag = args[i]!;
            if (flag !== '--work' && flag !== '--terms') throw new Error(`your company installed try-sell for its own work: --work <file> --terms <file>, not ${JSON.stringify(flag).slice(0, 40)}`);
            if (seen[flag]) throw new Error(`try-sell takes ${flag} once`);
            seen[flag] = args[i + 1] ?? '';
            fence.file(seen[flag]!, `the file after ${flag}`);
          }
          if (!seen['--work'] || !seen['--terms']) throw new Error('usage: try-sell --work <file> --terms <file>');
          return args;
        },
        long: () => true,
      },
    },
  };
}

/** The scripted seller: proves the runner's seller path on the live service, with no model. */
export function sellScript(): ScriptStep[] {
  const terms = { price: PRICE, deliverable: { kind: 'dataset', description: 'readings.csv, 12 warehouse sensor readings', format: 'text/csv' }, checks: [
    { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['reading_id', 'sensor', 'celsius'] },
    { id: 'rows', type: 'row_count_range', required: true, min: 12, max: 12 },
    { id: 'uniq', type: 'unique_key', required: true, columns: ['reading_id'] },
  ] };
  const c = (name: string, input: Record<string, unknown>) => ({ calls: [{ name, input }] });
  return [
    () => c('fetch_url', { url: `${CROW_SITE}/llms.txt` }),
    () => c('write_file', { path: 'terms.json', content: JSON.stringify(terms, null, 2) }),
    () => c('run_command', { command: 'try-sell', args: ['--work', 'data/readings.csv', '--terms', 'terms.json'] }),
    (x) => ({ calls: [{ name: 'finish', input: { outcome: x.find(/done\s+commitment\s+0x[0-9a-f]{64}\s+(\w+)/) ?? 'unknown', report: 'scripted' } }] }),
  ];
}

async function sellRun(dir: string, provider: Provider, secrets: Secrets): Promise<Event[]> {
  const work = join(dir, 'seller', 'work'), owner = join(dir, 'seller', 'company');
  for (const p of [work, owner, join(work, 'data')]) mkdirSync(p, { recursive: true, mode: 0o700 });
  writeFileSync(join(work, 'data', 'readings.csv'), DATA);
  const rec = new Recorder(join(dir, 'record.jsonl'), secrets);
  rec.add('runner', 'run.start', { task: 'T-571', direction: 'sell', seller: { vendor: provider.vendor, model: provider.model }, caps: CAPS, world: 'running', operators: OPERATORS, counterparty: `${CROW_SITE}/agents/test-buyer`, brief: 'direct' });
  const allow: Allow[] = [...OPERATORS.map((u) => ({ origin: new URL(u).origin })), { origin: CROW_SITE }];
  const stop = new AbortController();
  const whole = setTimeout(() => stop.abort('the run limit of 1,800 s'), 1_800_000);
  const tools = new Toolbox({ signal: stop.signal, role: 'seller', work: realpathSync(work), owner: realpathSync(owner), repo: REPO, operators: OPERATORS, allow, secrets, rec, installed: trySell(), timeoutMs: { short: 180_000, long: 900_000 } });
  try {
    await runAgent({ role: 'seller', provider, brief: sellBrief(), system: masterPrompt('seller', 'Enterprise Sales Agent'), tools, caps: CAPS, rec, signal: stop.signal });
  } finally { clearTimeout(whole); stop.abort('the run ended'); await tools.close(); }
  // The deals are those the sell command itself called the operators about (the fetch hook's record of the command's
  // own HTTP calls, which the agent cannot write), kept only when their terms name Crow's test buyer.
  const ids = dealIds(rec.events);
  let buyer: string | null = null;
  try { buyer = String(((await (await fetch(`${CROW_SITE}/agents/test-buyer/agent.json`, { signal: AbortSignal.timeout(15_000) })).json()) as J)?.buyer ?? '').toLowerCase() || null; } catch (e) { rec.add('runner', 'chain.error', { error: `the test buyer's card: ${(e as Error).message}` }); }
  await chainAccount(rec, ids, buyer);
  rec.add('runner', 'run.end', {});
  return rec.events;
}

/** The commitment IDs the agent's commands called the operators about, from the fetch hook's record of their own calls. */
export function dealIds(events: readonly Event[]): string[] {
  const ids = new Set<string>();
  for (const e of events) if (e.kind === 'api' && e['via'] === 'command') { const m = /\/v1\/commitments\/(0x[0-9a-fA-F]{64})/.exec(String(e['url'] ?? '')); if (m) ids.add(m[1]!.toLowerCase()); }
  return [...ids];
}

async function chainAccount(rec: Recorder, ids: string[], buyer: string | null): Promise<void> {
  for (const id of ids) for (const op of OPERATORS) {
    try {
      if (op === OPERATORS[0]) {
        const tr: J = await (await fetch(`${op}/v1/commitments/${id}/terms`, { signal: AbortSignal.timeout(30_000) })).json().catch(() => ({}));
        const named = String((tr?.terms ?? tr)?.buyer?.address ?? (tr?.terms ?? tr)?.buyer ?? '').toLowerCase();
        if (!buyer || named !== buyer) { rec.add('runner', 'chain.skipped', { commitmentId: id, reason: "its terms do not name Crow's test buyer" }); break; }
      }
      const st: J = await (await fetch(`${op}/v1/commitments/${id}`, { signal: AbortSignal.timeout(30_000) })).json();
      rec.add('runner', 'chain.state', { commitmentId: id, operator: op, escrowState: st?.escrowState ?? null, finalAt: st?.finalAt ?? null });
      if (op !== OPERATORS[0]) continue;
      const ev: J = await (await fetch(`${op}/v1/commitments/${id}/events?limit=200`, { signal: AbortSignal.timeout(30_000) })).json();
      for (const e of (Array.isArray(ev?.items) ? ev.items : []).sort((a: J, b: J) => a.seq - b.seq)) rec.add('runner', 'chain.event', { commitmentId: id, seq: e.seq, type: e.type, at: e.at, actor: e.actor ?? null, tx: e.payload?.tx ?? null });
    } catch (e) { rec.add('runner', 'chain.error', { commitmentId: id, operator: op, error: (e as Error).message }); }
  }
}

// ---- The measures ----

export interface Result {
  model: string; vendor: string; direction: Direction; approvals: number; approvals_by_step: Array<{ turn: number; tool: string; what: string }>;
  policy_approvals: { granted: number; refused: number }; turns: number; tokens_in: number; tokens_out: number; cache_read: number; cost_usd: number; seconds: number | null;
  help_probes: number; guide_reads: string[];
  final_state: string | null; final_state_op2: string | null; commitment_id: string | null; agent_end: string; refusals: number; failed_calls: number; date: string; run: string;
}

const short = (v: unknown) => JSON.stringify(v).slice(0, 160);

/** The measures of one run, from its record alone. `role` is the outside agent's side. */
export function measureRun(events: readonly Event[], role: 'buyer' | 'seller', direction: Direction, run: string): Result {
  const mine = events.filter((e) => e.role === role);
  const turns = mine.filter((e) => e.kind === 'model.turn');
  const tools = mine.filter((e) => e.kind === 'tool');
  const asks = tools.filter((e) => ASKS[String(e['name'])] && !String(e['result'] ?? '').startsWith('Not run:'));
  const model = String(mine.find((e) => e.kind === 'agent.start')?.['model'] ?? 'unknown');
  const cost = turns.reduce((s, t) => s + (priceOf(model, { input: Number(t['tokensIn']), output: Number(t['tokensOut']), cacheRead: Number(t['cacheRead'] ?? 0), cacheWrite: Number(t['cacheWrite'] ?? 0) }) ?? 0), 0);
  const states = events.filter((e) => e.kind === 'chain.state');
  // The deal that reached furthest: a final state first, then any funded one.
  const rank = (s: unknown) => (['Released', 'Refunded'].includes(String(s)) ? 3 : s === 'Held' ? 2 : s ? 1 : 0);
  const id = [...new Set(states.map((s) => String(s['commitmentId'])))].sort((a, b) => Math.max(...states.filter((s) => s['commitmentId'] === b).map((s) => rank(s['escrowState']))) - Math.max(...states.filter((s) => s['commitmentId'] === a).map((s) => rank(s['escrowState']))))[0] ?? null;
  const stateAt = (op: string) => (states.find((s) => s['commitmentId'] === id && String(s['operator']).startsWith(op))?.['escrowState'] as string | undefined) ?? null;
  const first = Date.parse(String(mine.find((e) => e.kind === 'agent.start')?.at ?? ''));
  const finalEvent = events.filter((e) => e.kind === 'chain.event' && e['commitmentId'] === id && /releas|refund/i.test(String(e['type']))).map((e) => Date.parse(String(e['at']))).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const end = mine.find((e) => e.kind === 'agent.end');
  return {
    model, vendor: String(mine.find((e) => e.kind === 'agent.start')?.['vendor'] ?? 'unknown'), direction,
    approvals: asks.length,
    approvals_by_step: asks.map((e) => ({ turn: Number(e['turn']), tool: String(e['name']), what: short(e['input']) })),
    policy_approvals: { granted: events.filter((e) => e.kind === 'approval' && e['granted'] === true).length, refused: events.filter((e) => e.kind === 'approval' && e['granted'] !== true).length },
    turns: turns.length,
    tokens_in: turns.reduce((s, t) => s + Number(t['tokensIn']), 0),
    tokens_out: turns.reduce((s, t) => s + Number(t['tokensOut']), 0),
    cache_read: turns.reduce((s, t) => s + Number(t['cacheRead'] ?? 0), 0),
    cost_usd: Math.round(cost) / 1_000_000,
    seconds: Number.isFinite(first) && finalEvent !== undefined ? Math.round((finalEvent - first) / 1000) : null,
    // Calls that asked a command how to use it (no arguments, or --help or -h alone), and the Crow guide pages read.
    help_probes: tools.filter((e) => e['name'] === 'run_command' && ((e['input'] as J)?.args?.length ?? 0) <= 1 && (((e['input'] as J)?.args ?? []).length === 0 || ['--help', '-h'].includes(String((e['input'] as J).args[0])))).length,
    guide_reads: [...new Set(tools.filter((e) => e['name'] === 'fetch_url').map((e) => { try { const u = new URL(String((e['input'] as J)?.url)); return u.origin === CROW_SITE ? u.pathname : ''; } catch { return ''; } }).filter((p) => /\.txt$|^\/ref\//.test(p)))],
    final_state: stateAt(OPERATORS[0]!), final_state_op2: stateAt(OPERATORS[1]!), commitment_id: id,
    agent_end: String(end?.['outcome'] ?? '').includes(BUDGET_STOP) ? `stopped by the budget: ${String(end?.['outcome']).split(BUDGET_STOP)[1]!.trim().slice(0, 200)}` : `${String(end?.['status'] ?? 'none')}: ${String(end?.['outcome'] ?? '').slice(0, 200)}`,
    refusals: mine.filter((e) => e.kind === 'refused').length,
    failed_calls: tools.filter((e) => e['isError']).length,
    date: new Date().toISOString().slice(0, 10),
    run,
  };
}

// ---- The command line ----

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
  const fail = (line: string): never => { console.error(`approvals: ${line}`); process.exit(2); };
  const cmd = argv[0];
  if (cmd !== 'plan' && cmd !== 'run') fail('usage: approvals.ts plan|run --runs <model>:<buy|sell>,... --budget-usd <n> [--out <dir>]');
  let runs: RunSpec[] = [];
  try { runs = parseRuns(flag('runs', 'claude:buy,deepseek:buy,claude:sell,deepseek:sell')!); } catch (e) { fail((e as Error).message); }
  const budgetUsd = Number(flag('budget-usd', '0'));
  const live = runs.some((r) => r.model !== 'scripted');
  if (cmd === 'run' && live && !(budgetUsd > 0 && budgetUsd <= 20)) fail('a live run needs --budget-usd between 0 and 20');
  const budget = new Budget(Math.round(budgetUsd * 1_000_000));
  console.log(`T-571, approvals per deal: ${runs.length} run(s) on Sepolia against ${OPERATORS.join(', ')}; test tokens only.`);
  for (const r of runs) console.log(`  ${r.model}:${r.direction}  caps ${CAPS.turns} turns, ${CAPS.tokens.toLocaleString('en')} tokens; at most USD ${usd(ceilingOf(r.model))} at its caps`);
  for (const line of LIKE_FOR_LIKE) console.log(`  ${line}`);
  console.log(`  hard budget for all of them: USD ${budgetUsd.toFixed(2)}, checked before every model turn`);
  if (cmd === 'plan') return;

  const env = process.env as Record<string, string | undefined>;
  const secrets = new Secrets();
  const modelSecrets: string[] = [];
  for (const k of [...Object.values(KEY_ENV), ...JUDGE_KEY_ENV, 'HOLDBACK_AGENT_OPENAI_COMPATIBLE_BASE_URL']) if (env[k]) { secrets.add(env[k]!); modelSecrets.push(env[k]!); }
  const providers: Record<string, Provider> = {};
  for (const m of new Set(runs.map((r) => r.model))) {
    if (m === 'scripted') continue;
    const vendor = m === 'claude' ? 'anthropic' : 'deepseek';
    const p = liveProvider(vendor, pinnedModel(vendor, undefined).id, env);
    if (typeof p === 'string') fail(p);
    providers[m] = p as Provider;
  }
  if (live) { console.log('Starting in 10 s (Ctrl-C stops it).'); await new Promise((r) => setTimeout(r, 10_000)); }
  const out = resolve(flag('out', join(REPO, 'reports', 'scratch', 't571'))!);
  mkdirSync(out, { recursive: true });
  const results: Result[] = [];
  for (const r of runs) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = join(out, `${stamp}-${r.model}-${r.direction}`);
    mkdirSync(dir, { recursive: true });
    console.log(`\n${r.model}:${r.direction} -> ${dir}`);
    let events: readonly Event[];
    if (r.direction === 'sell') {
      const p = r.model === 'scripted' ? scripted(sellScript()) : budget.guard(providers[r.model]!);
      events = await sellRun(dir, p, secrets);
    } else {
      const buyer = r.model === 'scripted' ? 'scripted' as const : budget.guard(providers[r.model]!);
      const done = await runDuet({ scenario: 'paid', buyer, seller: 'scripted', brief: 'direct', coldBuyer: true, world: OPERATORS, out: dir, caps: CAPS, timeoutSec: 1800, secrets: modelSecrets, log: (l) => console.log(`  ${l}`) });
      events = readFileSync(done.record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Event);
    }
    const m = measureRun(events, r.direction === 'buy' ? 'buyer' : 'seller', r.direction, dir);
    writeFileSync(join(dir, 'approvals.json'), `${JSON.stringify(m, null, 2)}\n`);
    appendFileSync(join(out, 'results.jsonl'), `${JSON.stringify(m)}\n`);
    results.push(m);
    console.log(`  approvals ${m.approvals}, turns ${m.turns}, tokens ${m.tokens_in}/${m.tokens_out}, USD ${m.cost_usd.toFixed(2)}, ${m.seconds ?? '-'} s, ${m.final_state ?? 'no deal'} / ${m.final_state_op2 ?? 'no deal'}; spent so far USD ${usd(budget.spent)}`);
  }
  console.log(`\nDone: ${results.length} run(s), USD ${usd(budget.spent)} of USD ${budgetUsd.toFixed(2)}. Results: ${join(out, 'results.jsonl')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(`approvals: ${(e as Error).message}`); process.exit(1); });
