// Setup: one party's Crow folder on its own machine (T-472). site/build.mjs bundles this file, and the tools it
// imports unchanged, into site/setup.mjs: one pinned file that runs with Node and nothing installed.
//
//   node setup.mjs status       the folder's state. It reads no key and sends nothing.
//   node setup.mjs check        the conformance check: one JSON line per check, exit 0 only when all pass. It sends nothing.
//   node setup.mjs first-deal   starts the seller adapter from the folder. The offer to Crow's test buyer is the next
//                               commit; until then this command runs only with --test-world.
//
// Every setting is a flag: --folder <path> (default ~/.crow/seller), --operators <url>,<url> (default Crow's two) and
// --test-world (a local test world, never the live service; it needs --operators, and every line then says so). The
// command reads no HOLDBACK_* or CROW_* variable: the bundle's first line removes them before any module runs, and
// main() removes them again, so a variable left in a shell cannot point a seller at other operators.
//
// The key: the folder's keys/signing.key, read here and passed to the adapter in its `env` argument. It is never put
// in this process's environment, on a command line or in a line this command prints.
//
// Each line this command prints is one JSON object, so an assistant reads the state without parsing prose. A wrong
// call prints the usage as text on standard error and exits 2. Exit 0: done. Exit 1: a step failed, named in its line.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkDelivery } from './check-delivery.ts';
import { plain as plainLine } from './plain.ts';
import { loadConfig, startSellerAdapter, type RunningAdapter } from './seller-adapter.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Any value from a file, a flag or a tool as one plain line of at most `max` characters. */
const plain = (s: unknown, max = 300) => plainLine(String(s ?? '')).slice(0, max);

export const CROW_OPERATORS = ['https://api.crow.direct', 'https://api2.crow.direct'];
export const NOT_LIVE = 'test world: this is not the live service';
/** The files of a party's folder. Only this command writes them; `keys/` holds every secret. */
export const FILES = { key: join('keys', 'signing.key'), configuration: 'adapter.json', template: 'template.json', journal: 'journal.json', sampleTerms: join('sample', 'terms.json'), sampleResult: join('sample', 'result') };

const USAGE = [
  'setup.mjs: keeps one Crow folder on this machine and runs its first deal. Test tokens only.',
  'usage: node setup.mjs <command> [--folder <path>] [--operators <url>,<url>] [--test-world]',
  '  status        prints the folder\'s state. It reads no key and sends nothing.',
  '  check         runs the conformance check: one JSON line per check, exit 0 only when all pass. It sends nothing.',
  '  first-deal    starts the seller adapter from the folder. It runs only with --test-world for now.',
  '  --folder      the party\'s folder. Default: ~/.crow/seller.',
  `  --operators   two or more operator URLs, comma-separated. Default: ${CROW_OPERATORS.join(',')}.`,
  '  --test-world  a local test world, never the live service. It needs --operators, and every line then says so.',
].join('\n');

/** Removes every HOLDBACK_* and CROW_* variable from `env`: the command takes its settings from flags only. */
export function clearAmbient(env: Record<string, string | undefined> = process.env): void {
  for (const name of Object.keys(env)) if (/^(HOLDBACK|CROW)_/.test(name)) delete env[name];
}

interface Call {
  folder: string;
  operators: string[];
  testWorld: boolean;
  /** One JSON line on standard output. */
  say(line: Record<string, unknown>): void;
  /** One JSON line on standard error: a tool's own log line, kept apart from the command's results. */
  note(line: Record<string, unknown>): void;
}

/** A wrong call: the usage follows on standard error, and the command exits 2. */
class WrongCall extends Error {}

const SWITCHES = ['--test-world'];
const VALUES = ['--folder', '--operators'];
function flagsOf(args: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (flags.has(a)) throw new WrongCall(`${plain(a, 40)} is given twice`);
    if (SWITCHES.includes(a)) flags.set(a, 'yes');
    else if (VALUES.includes(a) && args[i + 1] !== undefined && !args[i + 1]!.startsWith('--')) flags.set(a, args[++i]!);
    else throw new WrongCall(VALUES.includes(a) ? `${a} needs a value` : `${plain(a, 40)} is not an option of this command`);
  }
  return flags;
}

function operatorsOf(text: string | undefined, testWorld: boolean): string[] {
  if (text === undefined) {
    if (testWorld) throw new WrongCall("--test-world needs --operators: the test world's own operator URLs. Nothing was sent");
    return CROW_OPERATORS;
  }
  const list = text.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  const ok = (u: string) => {
    try {
      return ['http:', 'https:'].includes(new URL(u).protocol);
    } catch {
      return false;
    }
  };
  if (list.length < 2 || !list.every(ok)) throw new WrongCall('--operators takes two or more http or https URLs, comma-separated');
  return list;
}

/** `text` with every form of `key` taken out, so a tool's error can never carry the key into a printed line. */
function scrub(text: string, key: string): string {
  const hex = key.replace(/^0x/, '');
  const bytes = Buffer.from(hex, 'hex');
  let out = text;
  for (const form of [hex, hex.toUpperCase(), bytes.toString('base64'), bytes.toString('base64url')]) out = out.split(form).join('[the signing key]');
  return out;
}

function status(c: Call): number {
  const exists = existsSync(c.folder);
  const has = (file: string) => existsSync(join(c.folder, file));
  // Only whether each file is there: `status` opens none of them, and never one under keys/.
  c.say({ step: 'status', folder: c.folder, exists, ...(exists ? { has: { signingKey: has(FILES.key), configuration: has(FILES.configuration), template: has(FILES.template), journal: has(FILES.journal) } } : {}) });
  return 0;
}

/** The conformance check's first two checks; each is one line, and the command exits 0 only when both pass. */
function check(c: Call): number {
  const results: Array<{ check: string; ok: boolean; detail: string }> = [];
  const run = (name: string, body: () => string) => {
    try {
      results.push({ check: name, ok: true, detail: body() });
    } catch (e) {
      results.push({ check: name, ok: false, detail: plain((e as Error).message, 600) });
    }
  };
  run('configuration', () => {
    loadConfig(join(c.folder, FILES.configuration));
    return "the adapter's own loader takes adapter.json";
  });
  run('sample', () => {
    const r = checkDelivery({ terms: join(c.folder, FILES.sampleTerms), file: join(c.folder, FILES.sampleResult) });
    if (r.exitCode !== 0) throw new Error(r.lines[0] ?? 'the checks refuse the sample result');
    return r.lines[0] ?? 'the checks take the sample result';
  });
  for (const r of results) c.say({ step: 'check', ...r });
  return results.every((r) => r.ok) ? 0 : 1;
}

async function firstDeal(c: Call): Promise<number> {
  if (!c.testWorld) {
    c.say({ step: 'first-deal', ok: false, detail: 'This file runs first-deal only with --test-world for now: nothing was sent.' });
    return 1;
  }
  let key = '';
  let adapter: RunningAdapter | undefined;
  try {
    try {
      key = readFileSync(join(c.folder, FILES.key), 'utf8').trim();
    } catch {
      throw new Error(`the folder has no ${FILES.key}`);
    }
    if (!/^0x[0-9a-f]{64}$/.test(key)) throw new Error(`${FILES.key} does not hold one key: 0x and 64 lowercase hex characters`);
    const secret = key;
    const config = { ...loadConfig(join(c.folder, FILES.configuration)), journal: join(c.folder, FILES.journal), log: (line: string) => c.note({ step: 'adapter', log: scrub(line, secret) }) };
    // The key goes to the adapter in this object only: not into process.env, a command line or a file.
    adapter = await startSellerAdapter(config, { HOLDBACK_KEY: key, HOLDBACK_OPERATORS: c.operators.join(',') });
    const answer = await fetch(`${adapter.url}/defaults`, { signal: AbortSignal.timeout(10_000) });
    const defaults = (await answer.json()) as J;
    c.say({ step: 'adapter', ok: true, quote: `${adapter.url}/quote`, defaults: { status: answer.status, checks: (defaults?.checks ?? []).map((x: J) => plain(x?.id, 60)), deliverWithinSec: defaults?.timing?.deliverWithinSec } });
  } catch (e) {
    const why = (e as Error).message;
    c.say({ step: 'adapter', ok: false, detail: plain(/^0x[0-9a-f]{64}$/.test(key) ? scrub(why, key) : why, 600) });
    return 1;
  } finally {
    await adapter?.close();
  }
  c.say({ step: 'first-deal', ok: false, detail: "This file's first-deal stops after the adapter's start: the offer to Crow's test buyer is not built yet. Nothing was offered." });
  return 1;
}

const COMMANDS: Record<string, (c: Call) => number | Promise<number>> = { status, check, 'first-deal': firstDeal };

/** Runs one command and returns its exit status. It never calls process.exit, so every line is written first. */
export async function main(argv: readonly string[]): Promise<number> {
  clearAmbient();
  const [command, ...rest] = argv;
  // The test-world notice goes on every line, the usage and a wrong call's included.
  const testWorld = rest.includes('--test-world') || command === '--test-world';
  const text = (s: string) => s.split('\n').map((l) => (testWorld ? `[${NOT_LIVE}] ${l}` : l)).join('\n');
  const json = (line: Record<string, unknown>) => JSON.stringify(testWorld ? { ...line, notLive: NOT_LIVE } : line);
  if (command === '--help' || command === '-h') {
    console.log(text(USAGE));
    return 0;
  }
  try {
    const run = command === undefined || !Object.hasOwn(COMMANDS, command) ? undefined : COMMANDS[command];
    if (!run) throw new WrongCall(command === undefined ? 'name a command' : `${plain(command, 40)} is not a command of this file`);
    const flags = flagsOf(rest);
    const operators = operatorsOf(flags.get('--operators'), testWorld);
    const folder = resolve(flags.get('--folder') ?? join(homedir(), '.crow', 'seller'));
    return await run({ folder, operators, testWorld, say: (line) => console.log(json(line)), note: (line) => console.error(json(line)) });
  } catch (e) {
    if (!(e instanceof WrongCall)) throw e;
    console.error(`setup.mjs: ${text(`${e.message}.`)}\n${text(USAGE)}`);
    return 2;
  }
}
