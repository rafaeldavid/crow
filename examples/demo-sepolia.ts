// The Crow demo on Sepolia in one command (T-569). Test tokens only: nothing here is real money.
//
// It plays three deals at once against the two live operators, each between a buyer and a seller with fresh keys that
// exist only in this process's memory, funded by the operators' faucet. Each beat is a scenario of the first EVM
// end-to-end round (e2e-scenarios*.ts), run as round 1 runs it, with checks on every state, balance and log:
//
//   release   round scenario 1:  a faithful translation; the live panel of two model families accepts; Released
//   reject    round scenario 2:  a dataset with a row missing; a deterministic check fails it; Refunded
//   escalate  round scenario 5b: soft hyphens in the translation; the screen flags them, the primary escalates, and
//                                the appeal adjudicator's five-seat panel decides; Released or Refunded by its decision
//
// The appeal beat is not here: the phase-one contracts have no party appeal (ADR-0031). Round 1's appeal group plays
// it on SimChain (e2e-scenarios-appeal.ts: 3c, 6 and 7). The judges are the operators' own demo adjudicators, whose model keys live with the operators; this
// command needs no secret. On Sepolia it refuses to start when the demo's live judge budget for the day (UTC,
// discovery's demo.judges) cannot cover a run, so no run ends with scripted judges standing in for live ones.
//
// It prints a timeline (the seconds since the start, the beat, the step, what happened, with Etherscan links once a
// deal settles), then one line per beat, and writes the same with one JSON record per beat to
// demo/out/sepolia/<UTC time>/ (or --out <dir>). Exit 0 when every beat's checks held, 3 when it refuses, 1 otherwise.
//
//   pnpm demo:sepolia [--beat release|reject|escalate] [--out <dir>] [--dry-run]
//   HOLDBACK_OPERATORS=<url>,<url>   other operators (the tests: the demo's own world on SimChain)
//   SEPOLIA_RPC_URL=<url>            another Sepolia node for the chain reads (default a public node)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generatePrivateKey } from 'viem/accounts';
import { reason, Round, Run, short } from './e2e-run.ts';
import { pick } from './e2e-scenarios.ts';
import { Refusal } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const LIVE_OPERATORS = ['https://api.crow.direct', 'https://api2.crow.direct'];
const PUBLIC_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const SEPOLIA_CHAIN_ID = 11155111;
const OUT = fileURLToPath(new URL('../demo/out/sepolia', import.meta.url));
/** The bar's limit for the three beats together (the roadmap's stage 2). */
const LIMIT_SEC = 300;

export const BEATS = [
  { name: 'release', scenario: '1', calls: 3, says: 'a faithful translation; the live panel of two model families accepts it, and the price goes to the seller' },
  { name: 'reject', scenario: '2', calls: 0, says: 'a dataset with a row missing; a deterministic check fails it, and the price returns to the buyer' },
  { name: 'escalate', scenario: '5b', calls: 8, says: "soft hyphens in a translation; the screen flags them, the primary escalates, and the appeal adjudicator's five-seat panel decides" },
] as const;
type Beat = (typeof BEATS)[number];

const USAGE = 'usage: pnpm demo:sepolia [--beat release|reject|escalate] [--out <dir>] [--dry-run]';

/** Live judge calls the demo has left today (UTC), from discovery's demo.judges; 0 when its panel is not live. */
export function judgeCallsLeft(demo: J): number {
  const j = demo?.judges;
  if (j?.panel !== 'live' || !Number.isSafeInteger(j.liveCallsPerDay) || !Number.isSafeInteger(j.liveCallsToday)) return 0;
  return Math.max(0, j.liveCallsPerDay - j.liveCallsToday);
}

/** A scenario's line `[id] step text` as a timeline line: the seconds since the start, the beat's name, then the rest. */
export function timelineLine(line: string, elapsedMs: number): string {
  const m = /^\[(\w+)\] (.*)$/s.exec(line);
  const beat = m ? (BEATS.find((b) => b.scenario === m[1])?.name ?? m[1]!) : '';
  return `${String(Math.round(elapsedMs / 1000)).padStart(4)} s  ${beat.padEnd(8)}  ${m ? m[2] : line}`;
}

/** The judgment record's panel as one line: role, decision, and each seat's pinned model and verdict. */
function panelLine(j: J | null): string {
  if (!j) return 'no judgment record served';
  const members: J[] = j.panel?.members ?? [];
  const seats = members.map((m) => `${m.model} ${m.verdict?.overall ?? m.status}`).join(', ');
  return `${j.role} adjudicator decided ${j.aggregate?.decision ?? 'unknown'}${members.length ? `; panel of ${members.length}: ${seats}` : '; no panel ran'}`;
}
const scripted = (j: J | null) => (j?.panel?.members ?? []).some((m: J) => String(m.model).startsWith('placeholder-') || String(m.verdict?.rationale ?? '').startsWith('[fake judge'));

interface Played { beat: Beat; result: J; state: string; judgment: J | null; seconds: number }

async function play(beat: Beat, seed: string, ops: string[], log: (l: string) => void): Promise<Played> {
  const started = Date.now();
  const round = await Round.open({ operators: ops, seed, rpcUrl: process.env['SEPOLIA_RPC_URL'] || PUBLIC_RPC, homepage: false, log });
  const [scenario] = pick([beat.scenario]);
  const r = new Run(round, beat.scenario, scenario!.title);
  try {
    await scenario!.run(r);
  } catch (e) {
    r.error = reason(e);
    r.say(`stopped at ${r.step}: ${r.error}`);
  }
  const ended = new Date().toISOString();
  const id = r.deals[0]?.id;
  const buyer = round.agent('buyer');
  const view = id ? await buyer.call('GET', `/v1/commitments/${id}`).catch(() => null) : null;
  const judgment = id ? await buyer.call('GET', `/v1/commitments/${id}/judgment`).catch(() => null) : null;
  // Live judges are the point of the Sepolia demo: a scripted panel there fails the beat. Scenario 1 checks its own
  // panel; 5b only notes whether its appeal panel ran live, so the escalation's check is added here.
  if (round.pin.domain.chainId === SEPOLIA_CHAIN_ID && beat.name === 'escalate') r.check('a live panel of pinned models judged', judgment !== null && !scripted(judgment), panelLine(judgment));
  return { beat, result: r.result(ended), state: view?.escrowState ?? 'none', judgment, seconds: Math.round((Date.now() - started) / 1000) };
}

async function main(args: string[]): Promise<number> {
  const option = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') continue;
    if ((args[i] === '--beat' || args[i] === '--out') && args[i + 1] !== undefined) {
      i++;
      continue;
    }
    console.error(`${args[i]} is not an option here, or has no value\n${USAGE}`);
    return 2;
  }
  const only = option('--beat');
  if (only && !BEATS.some((b) => b.name === only)) {
    console.error(`no beat ${only}; the beats are ${BEATS.map((b) => b.name).join(', ')}\n${USAGE}`);
    return 2;
  }
  const beats = BEATS.filter((b) => !only || b.name === only);
  const ops = (process.env['HOLDBACK_OPERATORS'] ? process.env['HOLDBACK_OPERATORS'].split(',') : LIVE_OPERATORS).map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  // The tests name the seeds so they can look for them in the output; a person's run makes them fresh, in memory only.
  const given = process.env['DEMO_SEPOLIA_SEEDS']?.split(',');
  const seeds = BEATS.map((_, i) => given?.[i] ?? generatePrivateKey());

  const t0 = Date.now();
  const lines: string[] = [];
  const say = (l: string) => {
    lines.push(l);
    console.log(l);
  };
  // Passed checks go to the records; the timeline keeps the steps, the states, the links, each deal's end and any
  // failed check.
  const log = (l: string) => {
    if (!/^\[\w+\] \S+ +ok {2}/.test(l) || /^\[\w+\] \S+ +ok +the deal (ends|is Escalated)/.test(l)) say(timelineLine(l, Date.now() - t0));
  };

  const discovery: J = await fetch(`${ops[0]}/.well-known/holdback.json`).then((r) => r.json());
  const chainId = Number(discovery?.domain?.chainId);
  const onSepolia = chainId === SEPOLIA_CHAIN_ID;
  const need = beats.reduce((s, b) => s + b.calls, 0);
  const left = judgeCallsLeft(discovery?.demo);
  say(`Crow demo on ${onSepolia ? 'Ethereum Sepolia' : `chain ${chainId}`} through ${ops.join(' and ')}: test tokens only, nothing here is real money`);
  say(`rules contract ${discovery?.domain?.verifyingContract}; demo club ${discovery?.demo?.clubId}; adjudicators ${(discovery?.demo?.adjudicators ?? []).map((a: J) => `${a.role} ${short(a.address)}`).join(', ')}`);
  say(`judges: ${discovery?.demo?.judges?.panel ?? 'unknown'} panel, ${(discovery?.demo?.judges?.models ?? []).join(', ') || 'models not listed'}; ${left} live calls left today (UTC); this run needs about ${need}`);
  say('beats, played at once, each with its own fresh buyer and seller:');
  for (const b of beats) say(`  ${b.name.padEnd(8)}  round scenario ${b.scenario}: ${b.says}`);
  if (args.includes('--dry-run')) {
    say('dry run: no deal opened, nothing signed');
    return 0;
  }
  if (onSepolia && left < need) {
    throw new Refusal(`refusing to start: the demo has ${left} live judge calls left today and this run needs about ${need}; past the budget its panels are scripted. Run after 00:00 UTC, or one beat with --beat`);
  }

  const folder = join(option('--out') ?? OUT, new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, ''));
  mkdirSync(folder, { recursive: true });
  say('');
  const played = await Promise.all(beats.map((b) => play(b, seeds[BEATS.indexOf(b)]!, ops, log)));
  const total = Math.round((Date.now() - t0) / 1000);

  say('');
  say('beat      state      time   checks');
  for (const p of played) {
    const held = p.result.checks.filter((c: J) => c.ok).length;
    say(`${p.beat.name.padEnd(8)}  ${p.state.padEnd(9)}  ${String(p.seconds).padStart(3)} s  ${held} of ${p.result.checks.length} checks held${p.result.error ? `; stopped: ${p.result.error}` : ''}`);
    say(`          ${p.result.deals[0] ? `deal ${p.result.deals[0].id}; ` : ''}${panelLine(p.judgment)}`);
  }
  say(`${beats.length === BEATS.length ? 'all three beats' : `the ${beats[0]!.name} beat`}: ${total} s from the first offer to the last settlement, ${total <= LIMIT_SEC ? 'within' : 'over'} the ${LIMIT_SEC} s limit`);
  const after: J = await fetch(`${ops[0]}/.well-known/holdback.json`).then((r) => r.json()).catch(() => null);
  if (onSepolia && after) say(`live judge calls today (UTC): ${discovery.demo.judges.liveCallsToday} before, ${after.demo?.judges?.liveCallsToday} after; other deals in the same minutes count too`);
  say(`timeline and records: ${folder}`);

  for (const p of played) writeFileSync(join(folder, `${p.beat.name}.json`), `${JSON.stringify({ beat: p.beat.name, scenario: p.beat.scenario, state: p.state, seconds: p.seconds, judgment: p.judgment ? { role: p.judgment.role, decision: p.judgment.aggregate?.decision, reasons: p.judgment.aggregate?.reasons ?? [], panel: (p.judgment.panel?.members ?? []).map((m: J) => ({ model: m.model, overall: m.verdict?.overall ?? m.status })) } : null, result: p.result }, null, 2)}\n`);
  writeFileSync(join(folder, 'run.json'), `${JSON.stringify({ startedAt: new Date(t0).toISOString(), seconds: total, limitSec: LIMIT_SEC, operators: ops, chainId, judgeCalls: { before: discovery?.demo?.judges?.liveCallsToday ?? null, after: after?.demo?.judges?.liveCallsToday ?? null }, beats: played.map((p) => ({ name: p.beat.name, scenario: p.beat.scenario, state: p.state, seconds: p.seconds, status: p.result.status, deal: p.result.deals[0]?.id ?? null })) }, null, 2)}\n`);
  writeFileSync(join(folder, 'timeline.md'), `# Crow demo, ${new Date(t0).toISOString().slice(0, 19)}Z\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
  return played.every((p) => p.result.status === 'pass') ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`demo-sepolia: plays release, reject and an escalation on Crow's Sepolia demo with fresh keys and live judges, test tokens only.\n${USAGE}`);
  } else {
    try {
      process.exitCode = await main(args);
    } catch (e) {
      console.error(`${e instanceof Refusal ? 'refused' : 'stopped'}: ${reason(e)}`);
      process.exitCode = e instanceof Refusal ? 3 : 1;
    }
  }
}
