// The preflight (T-491): every check a first deal on the Crow demo depends on, in one run, before anything is signed.
// It only reads: two GETs per operator and one per test agent, no key made, nothing sent but those GETs, no file
// written. It runs every check even after one fails and prints one line per check, then a summary.
//
//   node preflight.mjs [--json]   the bundle at https://crow.direct/preflight.mjs
//   node examples/preflight.ts    from the repository
//
// Exit 0: nothing failed (warnings may remain). Exit 1: a check failed; its line says what to do. Exit 2: bad usage.
// It names environment variables, never their values, and prints from the operators only fields it parsed itself.
import { SEPOLIA } from './deployments.ts';
import { isMain } from './entry.ts';

export type Level = 'ok' | 'note' | 'warn' | 'fail';
export type Row = { level: Level; check: string; text: string };
export type Input = {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  now: () => number;
  node: string;
};

export const CROW_OPERATORS = ['https://api.crow.direct', 'https://api2.crow.direct'];
export const TEST_AGENTS = { 'test-seller': 'https://crow.direct/agents/test-seller/agent.json', 'test-buyer': 'https://crow.direct/agents/test-buyer/agent.json' };
/** The Node versions the pages ask for: the goal commands need 20, buy.mjs, the seller's tools and setup 22.18. */
export const NODE_MIN = { goals: [20, 0], all: [22, 18] } as const;
/**
 * buy.mjs refuses an offer whose createdAt is over 60 s ahead of this machine or over 600 s behind it. The offer
 * carries the operators' time, so a machine behind them by over 60 s fails, and one ahead by over 600 s fails.
 */
export const CLOCK = { behindFailSec: 60, aheadWarnSec: 60, aheadFailSec: 600 };
/** Variables that change where the tools sign or which operators they call. */
const REDIRECTS: Record<string, string> = {
  HOLDBACK_DEPLOYMENT: 'adds a deployment the tools accept',
  HOLDBACK_CHAIN_ID: "changes the chain of the tools' local pin",
  HOLDBACK_VERIFYING_CONTRACT: "changes the contract of the tools' local pin",
  HOLDBACK_SIM_URL: 'points the tools at a local SimChain',
};

/** What the guides pin, from the deployment file: the EIP-712 domain and the token. */
export function pinned(d = SEPOLIA) {
  if (!d) throw new Error('examples/deployments.ts pins no Sepolia deployment');
  return { domain: { name: 'Holdback', version: '0.8', chainId: d.chainId, verifyingContract: d.rules.toLowerCase() }, token: d.token.address.toLowerCase() };
}

const TIMEOUT_MS = 10_000;
const hex = (s: unknown) => (typeof s === 'string' && /^0x[0-9a-fA-F]{1,64}$/.test(s) ? s.toLowerCase() : null);
const word = (s: unknown, max = 40) => (typeof s === 'string' ? s.replace(/[^A-Za-z0-9._:/-]/g, '').slice(0, max) : '?');
/** An operator's URL as printed: no user or password part, only URL-safe characters. */
const shown = (u: string) => {
  try {
    const x = new URL(u);
    return word(`${x.protocol}//${x.host}${x.pathname === '/' ? '' : x.pathname}`, 80);
  } catch {
    return '(not a URL)';
  }
};
const int = (n: unknown) => (typeof n === 'number' && Number.isSafeInteger(n) ? n : null);
const atLeast = (v: string, [maj, min]: readonly [number, number]) => {
  const [a = 0, b = 0] = v.replace(/^v/, '').split('.').map(Number);
  return a > maj || (a === maj && b >= min);
};

type Got = { ok: true; ms: number; body: unknown } | { ok: false; why: string };
async function get(f: typeof fetch, now: () => number, url: string): Promise<Got> {
  const t = now();
  try {
    const r = await f(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) return { ok: false, why: `answered ${r.status}` };
    return { ok: true, ms: Math.max(0, Math.round(now() - t)), body: await r.json() };
  } catch (e) {
    const name = (e as Error)?.name;
    return { ok: false, why: name === 'TimeoutError' || name === 'AbortError' ? `no answer in ${TIMEOUT_MS / 1000} s` : 'does not answer (DNS, TLS or network)' };
  }
}

/** Every check, in order. Never throws: a check that cannot run is a row that says so. */
export async function preflight(input: Input): Promise<Row[]> {
  const rows: Row[] = [];
  const add = (level: Level, check: string, text: string) => rows.push({ level, check, text });
  const { env } = input;

  // Node.
  const v = input.node;
  if (!atLeast(v, NODE_MIN.goals)) add('fail', 'node', `${v}: every command needs Node 20 or later; buy.mjs, the seller's tools and setup need 22.18. Install Node 22.18 or later`);
  else if (!atLeast(v, NODE_MIN.all)) add('warn', 'node', `${v}: the try commands run; buy.mjs, the seller's tools and setup need 22.18 or later`);
  else add('ok', 'node', `${v}: every command runs`);

  // The shell's variables, by name only.
  const set = Object.keys(env).filter((k) => /^(HOLDBACK|CROW)_/.test(k) && env[k] !== undefined && env[k] !== '').sort();
  const listed = env['HOLDBACK_OPERATORS'];
  const operators = (listed || CROW_OPERATORS.join(',')).split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  const crowOnly = operators.length === CROW_OPERATORS.length && CROW_OPERATORS.every((o) => operators.includes(o));
  for (const k of set) {
    if (k === 'HOLDBACK_OPERATORS') add(crowOnly ? 'ok' : 'warn', 'env', crowOnly ? 'HOLDBACK_OPERATORS names Crow\'s two operators' : `HOLDBACK_OPERATORS names other operators than Crow's (${CROW_OPERATORS.join(', ')}): checked below as set; unset it to use Crow's`);
    else if (REDIRECTS[k]) add('warn', 'env', `${k} is set: it ${REDIRECTS[k]}. Unset it unless you mean it`);
    else add('note', 'env', `${k} is set (value not shown)`);
  }
  if (set.length === 0) add('ok', 'env', 'no HOLDBACK_ or CROW_ variable set');

  // The operators: reachable, pinned, in agreement, on time.
  const pin = pinned();
  const got = await Promise.all(operators.map((o) => get(input.fetch, input.now, `${o}/.well-known/holdback.json`)));
  const seen: Array<{ op: string; d: any }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  got.forEach((g, i) => {
    const op = shown(operators[i]!);
    if (!g.ok) return add('fail', 'operator', `${op} ${g.why}. Check your network; if it persists, the operator is down: wait and run again`);
    const d = g.body as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    seen.push({ op, d });
    add('ok', 'operator', `${op} answers in ${g.ms} ms (schema ${word(d?.schemaVersion, 8)}, build ${word(d?.build?.commit ?? d?.demo?.build?.commit, 12)})`);
    const dom = d?.domain ?? {};
    const sameDomain = dom.name === pin.domain.name && dom.version === pin.domain.version && int(dom.chainId) === pin.domain.chainId && hex(dom.verifyingContract) === pin.domain.verifyingContract;
    const token = hex(d?.token?.id ?? d?.demo?.token?.id);
    if (sameDomain && token === pin.token) add('ok', 'pins', `${op} serves the pinned domain (chain ${pin.domain.chainId}, rules ${pin.domain.verifyingContract}) and token`);
    else add('fail', 'pins', `${op} serves ${sameDomain ? 'another token' : 'another EIP-712 domain'} than llms.txt pins. Do not sign; check OP1 and OP2 against https://crow.direct/llms.txt`);
    const at = Date.parse(typeof d?.settlementTime === 'string' ? d.settlementTime : '');
    if (Number.isNaN(at)) add('warn', 'clock', `${op} sent no settlementTime: clock not checked`);
    else {
      const skew = Math.round((input.now() - at) / 1000); // > 0: this machine is ahead
      const s = `this machine is ${Math.abs(skew)} s ${skew >= 0 ? 'ahead of' : 'behind'} ${op}`;
      const level: Level = -skew > CLOCK.behindFailSec || skew > CLOCK.aheadFailSec ? 'fail' : skew > CLOCK.aheadWarnSec ? 'warn' : 'ok';
      add(level, 'clock', level === 'ok' ? s : `${s}: buy.mjs refuses offers ${level === 'fail' ? 'now' : 'past 600 s'}. Sync this machine's clock`);
    }
  });
  if (seen.length > 1) {
    const key = (x: { d: any }) => JSON.stringify([hex(x.d?.domain?.verifyingContract), x.d?.domain?.chainId, x.d?.schemaVersion]); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (seen.every((x) => key(x) === key(seen[0]!))) add('ok', 'agree', `${seen.length} operators serve the same domain and schema`);
    else add('fail', 'agree', 'the operators serve different domains or schemas. Do not sign; tell your principal');
  }
  const first = seen[0]?.d;
  const listedOps = Array.isArray(first?.demo?.operators) ? first.demo.operators.map((o: unknown) => word(o, 80)) : null;
  if (listedOps && !operators.every((o) => listedOps.includes(o))) add('warn', 'operator', `discovery lists ${listedOps.join(', ')}; you use ${operators.map(shown).join(', ')}`);

  // The faucet and the report route, as discovery states them.
  const fc = first?.demo?.faucet;
  if (!first) add('warn', 'faucet', 'not checked: no operator answered');
  else if (!fc) add('warn', 'faucet', 'these operators publish no faucet: fund your address yourself');
  else add('ok', 'faucet', `one grant per address every ${int(fc.perAddressEverySec) ?? '?'} s, ${int(fc.perClientPerWindow) ?? '?'} addresses per client, ${int(fc.mintsPerDay) ?? '?'} grants a day for everyone; a refusal names its wait`);
  if (first) add('note', 'report', first.feedback?.path === '/v1/feedback' ? 'reports taken: POST /v1/feedback (ref/limits.txt)' : 'these operators take no reports: tell your principal what went wrong instead');

  // Crow's test agents.
  const agents = Object.entries(TEST_AGENTS);
  const cards = await Promise.all(agents.map(([, url]) => get(input.fetch, input.now, url)));
  cards.forEach((c, i) => {
    const [name, url] = agents[i]!;
    add(c.ok ? 'ok' : 'warn', name, c.ok ? `card answers in ${c.ms} ms` : `${url} ${c.why}: the try commands that use it will fail; run again later`);
  });
  return rows;
}

export function summary(rows: Row[]) {
  const n = (l: Level) => rows.filter((r) => r.level === l).length;
  return { ok: n('ok'), note: n('note'), warn: n('warn'), fail: n('fail') };
}

const USAGE = [
  'preflight: checks what a first deal on the Crow demo needs, in one run, before anything is signed. Reads only.',
  'usage: node preflight.mjs [--json]',
  'exit: 0 nothing failed; 1 a check failed (its line says what to do); 2 bad usage',
];

if (isMain(import.meta.url, 'preflight')) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE.join('\n'));
    process.exit(0);
  }
  if (args.some((a) => a !== '--json')) {
    console.error(`unknown argument\n${USAGE.join('\n')}`);
    process.exit(2);
  }
  const rows = await preflight({ env: process.env, fetch, now: Date.now, node: process.versions.node });
  const s = summary(rows);
  if (args.includes('--json')) console.log(JSON.stringify({ rows, ...s }));
  else {
    for (const r of rows) console.log(`${r.level.padEnd(5)} ${r.check.padEnd(11)} ${r.text}`);
    console.log(`done  preflight   ${s.ok} ok, ${s.note} note, ${s.warn} warn, ${s.fail} fail`);
  }
  process.exit(s.fail > 0 ? 1 : 0);
}
