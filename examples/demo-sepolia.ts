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
// Like round 1, it refuses to play the release beat again once a live panel has rejected its honest work on the same
// rules contract (no re-rolls), unless --rerun-after names the fix.
//
//   pnpm demo:sepolia [--beat release|reject|escalate] [--out <dir>] [--dry-run] [--rerun-after <the fix>]
//   HOLDBACK_OPERATORS=<url>,<url>   other operators (the tests: the demo's own world on SimChain)
//   SEPOLIA_RPC_URL=<url>            another Sepolia node for the chain reads (default a public node)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generatePrivateKey } from 'viem/accounts';
import { reason, Round, Run, short, sleep } from './e2e-run.ts';
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

const USAGE = 'usage: pnpm demo:sepolia [--beat release|reject|escalate] [--out <dir>] [--dry-run] [--rerun-after <the fix>]';

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
/**
 * A scripted seat: its model ID starts "placeholder-", the mark since ADR-0050 (a coded verdict has no rationale to
 * mark). A prose record written before it, whose scripted seats could name the live models, marks the rationale
 * "[fake judge, no model ran]" instead, so both are read.
 */
const marked = (m: J) => String(m.model).startsWith('placeholder-') || String(m.verdict?.rationale ?? '').startsWith('[fake judge');
const scripted = (j: J | null) => (j?.panel?.members ?? []).some(marked);
/** One panel's kind: live when no seat is marked, scripted when any is (a mixed panel is not live), none when no panel ran. */
export function panelKind(j: J | null): { role: string; kind: 'live' | 'scripted' | 'none'; seats: number; marked: number } {
  const members: J[] = j?.panel?.members ?? [];
  const n = members.filter(marked).length;
  return { role: String(j?.role ?? 'unknown'), kind: members.length === 0 ? 'none' : n > 0 ? 'scripted' : 'live', seats: members.length, marked: n };
}
const kindLine = (panels: J[]) => panels.map((j) => {
  const k = panelKind(j);
  return `${k.role} panel ${k.kind === 'scripted' ? `scripted (${k.marked} of ${k.seats} seats marked)` : k.kind === 'live' ? `live (${k.seats} seats)` : 'none ran'}`;
}).join('; ') || 'no judgment record seen';

interface Played { beat: Beat; result: J; state: string; judgment: J | null; panels: J[]; seconds: number }

/**
 * One beat: its own round with its own seed, the scenario, then the deal's state and judgment record. It never throws:
 * a beat that cannot even open its round is recorded as stopped, so the other beats still finish and are written.
 */
async function play(beat: Beat, seed: string, ops: string[], log: (l: string) => void, save: (p: Played) => void): Promise<Played> {
  const started = Date.now();
  const [scenario] = pick([beat.scenario]);
  let played: Played;
  try {
    const round = await Round.open({ operators: ops, seed, rpcUrl: process.env['SEPOLIA_RPC_URL'] || PUBLIC_RPC, homepage: false, log });
    const r = new Run(round, beat.scenario, scenario!.title);
    const buyer = round.agent('buyer');
    // The operators serve only a deal's latest judgment record, so after an escalation the primary's is gone. A light
    // watch, one read every 3 s while the beat runs, keeps each role's record so every panel can be labelled.
    const records = new Map<string, J>();
    const readRecord = async () => {
      const id = r.deals[0]?.id;
      const j = id ? await buyer.call('GET', `/v1/commitments/${id}/judgment`).catch(() => null) : null;
      if (j?.role) records.set(String(j.role), j);
      return j;
    };
    let running = true;
    const watch = (async () => {
      while (running) {
        await readRecord();
        await sleep(3000);
      }
    })();
    try {
      await scenario!.run(r);
    } catch (e) {
      r.error = reason(e);
      r.say(`stopped at ${r.step}: ${r.error}`);
    } finally {
      running = false;
      await watch;
    }
    const ended = new Date().toISOString();
    const id = r.deals[0]?.id;
    const view = id ? await buyer.call('GET', `/v1/commitments/${id}`).catch(() => null) : null;
    const judgment = await readRecord();
    const panels = ['primary', 'fallback', 'appeal'].map((role) => records.get(role)).filter((j): j is J => j !== undefined);
    // Live judges are the point of the Sepolia demo: any marked seat in any panel fails the beat. Scenario 1 checks its
    // own deciding panel; this check covers every panel seen, the escalation's primary panel included.
    if (round.pin.domain.chainId === SEPOLIA_CHAIN_ID && beat.calls > 0) {
      const ran = panels.filter((j) => panelKind(j).kind !== 'none');
      const missed = beat.name === 'escalate' && !records.has('primary') ? "; the primary's record was not seen before the appeal replaced it" : '';
      r.check('every panel that ran was live (no seat marked "[fake judge, no model ran]")', ran.length > 0 && ran.every((j) => !scripted(j)) && !missed, `${kindLine(panels)}${missed}`);
    }
    // A stopped deal that still holds the buyer's money closes by its timeouts, which the operators send themselves.
    if (view && !['Released', 'Refunded'].includes(view.escrowState)) r.say(`the deal is still ${view.escrowState}; the operators send its timeout when it falls due (deadlines ${JSON.stringify(view.deadlines ?? {})})`);
    played = { beat, result: r.result(ended), state: view?.escrowState ?? 'none', judgment, panels, seconds: Math.round((Date.now() - started) / 1000) };
  } catch (e) {
    log(`[${beat.scenario}] start     stopped before the first deal: ${reason(e)}`);
    const at = new Date().toISOString();
    played = { beat, result: { scenario: beat.scenario, title: scenario!.title, status: 'error', startedAt: new Date(started).toISOString(), endedAt: at, stoppedAt: 'start', error: reason(e), checks: [], deals: [], notes: [] }, state: 'none', judgment: null, panels: [], seconds: Math.round((Date.now() - started) / 1000) };
  }
  save(played);
  return played;
}

/** One beat's record file: the beat, its state, its time, the judgment in short, and the scenario's full result. */
const beatRecord = (p: Played) => ({
  beat: p.beat.name, scenario: p.beat.scenario, state: p.state, seconds: p.seconds,
  judgment: p.judgment ? { role: p.judgment.role, decision: p.judgment.aggregate?.decision, reasons: p.judgment.aggregate?.reasons ?? [], panel: (p.judgment.panel?.members ?? []).map((m: J) => ({ model: m.model, overall: m.verdict?.overall ?? m.status })) } : null,
  panels: p.panels.map((j) => ({ ...panelKind(j), decision: j.aggregate?.decision ?? null, members: (j.panel?.members ?? []).map((m: J) => ({ model: m.model, family: m.family ?? null, overall: m.verdict?.overall ?? m.status, marked: marked(m) })) })),
  live: p.panels.some((j) => panelKind(j).kind !== 'none') ? p.panels.every((j) => panelKind(j).kind !== 'scripted') : null,
  result: p.result,
});

/**
 * No re-rolls (CLAUDE.md, as round 1's rerollGuard): once a live panel has rejected the release beat's honest work on
 * this rules contract, another run to get a pass is a re-roll. Returns the earlier record that shows it, or null.
 */
export function rejectedRelease(root: string, rules: string): string | null {
  if (!existsSync(root)) return null;
  for (const dir of readdirSync(root).sort()) {
    const file = join(root, dir, 'release.json');
    if (!existsSync(file)) continue;
    let rec: J;
    try {
      rec = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const checks: J[] = rec?.result?.checks ?? [];
    const rejected = checks.some((c) => c.name === 'the deal ends Released' && !c.ok) && checks.some((c) => c.name === 'a live panel judged' && c.ok);
    if (rejected && String(rec.result?.domain?.verifyingContract ?? '').toLowerCase() === rules.toLowerCase()) return file;
  }
  return null;
}

async function main(args: string[]): Promise<number> {
  const option = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') continue;
    if (['--beat', '--out', '--rerun-after'].includes(args[i]!) && args[i + 1] !== undefined) {
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
  const rerunAfter = option('--rerun-after');
  const root = option('--out') ?? OUT;

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

  const read = async (): Promise<J> => {
    const url = `${ops[0]}/.well-known/holdback.json`;
    const res = await fetch(url).catch((e: Error) => {
      throw new Error(`${url} did not answer (${e.message})`);
    });
    const body: J = res.ok ? await res.json().catch(() => null) : null;
    if (!body?.domain?.chainId || !body.domain.verifyingContract) throw new Error(`${url} answered ${res.status} with no discovery document (domain.chainId and domain.verifyingContract)`);
    return body;
  };
  const discovery: J = await read();
  const chainId = Number(discovery.domain.chainId);
  const rules = String(discovery.domain.verifyingContract);
  const onSepolia = chainId === SEPOLIA_CHAIN_ID;
  const need = beats.reduce((s, b) => s + b.calls, 0);
  const left = judgeCallsLeft(discovery?.demo);
  say(`Crow demo on ${onSepolia ? 'Ethereum Sepolia' : `chain ${chainId}`} through ${ops.join(' and ')}: test tokens only, nothing here is real money`);
  say(`rules contract ${discovery?.domain?.verifyingContract}; demo club ${discovery?.demo?.clubId}; adjudicators ${(discovery?.demo?.adjudicators ?? []).map((a: J) => `${a.role} ${short(a.address)}`).join(', ')}`);
  say(`judges: ${discovery?.demo?.judges?.panel ?? 'unknown'} panel, ${(discovery?.demo?.judges?.models ?? []).join(', ') || 'models not listed'}; ${left} live calls left today (UTC); this run needs about ${need}`);
  say('beats, played at once, each with its own fresh buyer and seller:');
  for (const b of beats) say(`  ${b.name.padEnd(8)}  round scenario ${b.scenario}: ${b.says}`);
  if (given) say('the seeds come from DEMO_SEPOLIA_SEEDS (for the tests only): these keys are not fresh');
  const earlier = beats.some((b) => b.name === 'release') ? rejectedRelease(root, rules) : null;
  if (earlier && !rerunAfter) {
    throw new Refusal(`refusing to start: a live panel rejected the release beat's honest work on this rules contract (${earlier}). A panel verdict is never re-rolled; record it as a finding. After a fix, run again with --rerun-after "<the fix>"`);
  }
  if (earlier) say(`run again after: ${rerunAfter} (an earlier live reject: ${earlier})`);
  if (args.includes('--dry-run')) {
    say('dry run: no deal opened, nothing signed');
    return 0;
  }
  if (onSepolia && left < need) {
    throw new Refusal(`refusing to start: the demo has ${left} live judge calls left today and this run needs about ${need}; past the budget its panels are scripted. Run after 00:00 UTC, or one beat with --beat`);
  }

  const folder = join(root, new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, ''));
  mkdirSync(folder, { recursive: true });
  say('');
  const save = (p: Played) => writeFileSync(join(folder, `${p.beat.name}.json`), `${JSON.stringify(beatRecord(p), null, 2)}\n`);
  const played = await Promise.all(beats.map((b) => play(b, seeds[BEATS.indexOf(b)]!, ops, log, save)));
  const total = Math.round((Date.now() - t0) / 1000);

  say('');
  say('beat      state      time   checks');
  for (const p of played) {
    const held = p.result.checks.filter((c: J) => c.ok).length;
    say(`${p.beat.name.padEnd(8)}  ${p.state.padEnd(9)}  ${String(p.seconds).padStart(3)} s  ${held} of ${p.result.checks.length} checks held${p.result.error ? `; stopped: ${p.result.error}` : ''}`);
    say(`          ${p.result.deals[0] ? `deal ${p.result.deals[0].id}; ` : ''}${panelLine(p.judgment)}`);
    if (p.beat.calls > 0) say(`          judges: ${kindLine(p.panels)}`);
  }
  say(`${beats.length === BEATS.length ? 'all three beats' : `the ${beats[0]!.name} beat`}: ${total} s from the start of the command to the last beat's end, ${total <= LIMIT_SEC ? 'within' : 'over'} the ${LIMIT_SEC} s limit`);
  const after: J = await read().catch(() => null);
  if (onSepolia && after) say(`live judge calls today (UTC): ${discovery.demo?.judges?.liveCallsToday} before, ${after.demo?.judges?.liveCallsToday} after; other deals in the same minutes count too`);
  say(`timeline and records: ${folder}`);

  writeFileSync(join(folder, 'run.json'), `${JSON.stringify({ startedAt: new Date(t0).toISOString(), seconds: total, limitSec: LIMIT_SEC, operators: ops, chainId, rules, ...(rerunAfter ? { rerunAfter } : {}), judgeCalls: { before: discovery?.demo?.judges?.liveCallsToday ?? null, after: after?.demo?.judges?.liveCallsToday ?? null }, beats: played.map((p) => ({ name: p.beat.name, scenario: p.beat.scenario, state: p.state, seconds: p.seconds, status: p.result.status, panels: p.panels.map((j) => panelKind(j)), deal: p.result.deals[0]?.id ?? null })) }, null, 2)}\n`);
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
