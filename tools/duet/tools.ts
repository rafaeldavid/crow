// What a duet agent can do (T-391): only its company's installed tools. Each tool is a fence, checked here, not a rule
// in a prompt:
//   fetch_url    GET only, to an allowlist of origins and paths (the world's operators, the docs, the seller's page,
//                the seller adapter's quote and defaults). No redirect is followed.
//   run_command  one of a fixed list of the repository's client commands, from this checkout, with its arguments
//                checked one by one: paths inside the agent's own folder, URLs on the allowlist, the buyer's key
//                store only by its one path. The child gets a minimal environment built here; no model key is in it.
//   read_file, write_file, list_files   inside the agent's own folder, never through a symbolic link.
//   wait, finish
// Keys live in files and environments the agent never reads: the buyer's key store sits outside its folder, the
// seller's key is the child's HOLDBACK_KEY. Every tool result passes through the run's secret list before a model or
// the record sees it. The buyer's approval stop is answered by the company's policy file, not by a person.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolSpec } from './providers.ts';
import type { Recorder, Role, Secrets } from './record.ts';
import { DEFAULTS } from '../../examples/seller-adapter-core.ts';
import { TEMPLATE } from './review.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** One allowlist entry: an origin, and the paths under it (a path ending in "/" is a prefix; none: any path). */
export interface Allow {
  origin: string;
  paths?: string[];
}

/** What the company pre-set for the buyer's approval stop. */
export interface Policy {
  /** The most the company pays for one deal, everything included, in base units. */
  budget: string;
  /** Check IDs every offer must carry as required checks. */
  requiredChecks: string[];
  /** The company's own copy of each required check, whole: an offer's check must equal it, not just share its ID. */
  checkBodies: Record<string, unknown>;
  /** The latest delivery the company accepts, as seconds from now: `deliverBy` may be no later. */
  latestDeliverySec: number;
  /** How long after that delivery date the judging may run: every other deadline must fall before both together. */
  decisionSlackSec: number;
  /** How far an offer's `createdAt` may lie from settlement time, either way. A postdated offer would move every window. */
  createdAtBandSec: number;
}

export interface ToolboxOptions {
  role: Exclude<Role, 'runner'>;
  /** The agent's own folder: absolute, and the one place its file tools reach. */
  work: string;
  /** The company's folder beside it, which no tool of the agent reaches: checked configuration copies live here. */
  owner: string;
  /** The repository checkout the client commands run from. */
  repo: string;
  /** The operators the client commands talk to. */
  operators: string[];
  allow: Allow[];
  secrets: Secrets;
  rec: Recorder;
  /** Buyer: the key store directory, outside `work`. */
  keyStore?: string;
  /** Buyer: the company's pre-set answer to the approval stop. */
  policy?: Policy;
  /** Seller: the signing key, passed to the seller's commands as HOLDBACK_KEY. */
  sellerKey?: string;
  /** Seller: the port the adapter must listen on. */
  adapterPort?: number;
  /** Seller: the job API's base URL, the one place the adapter's sellerApi may point. */
  jobApi?: string;
  /** Per-command time limits in ms. */
  timeoutMs?: { short: number; long: number };
  /** The most characters one tool result gives the model. */
  resultLimit?: number;
  /**
   * One origin answered from another: on a local run, https://crow.direct is answered from this machine's copy of
   * the site, so an agent finds the guides from the front door as a visitor would. The allowlist checks the address
   * the agent asked for; the record keeps both.
   */
  alias?: { from: string; to: string };
  /** Ends a running command when the run ends (SIGTERM, then SIGKILL after 3 s). */
  signal?: AbortSignal;
  /**
   * Commands the company installed from outside this checkout, beside the repository's own, and the environment they
   * need. Each command brings its own fence: `check` sees every argument and refuses what it does not accept. Its
   * environment is still built from nothing (`env()`), with `env` added: no model key reaches it unless put here.
   */
  installed?: Installed;
}

/** A command from outside this checkout, with its own argument fence. */
export interface InstalledCommand {
  /** The script's absolute path, run as `node <script> <args>` from the agent's folder. */
  script: string;
  /** One line for the run tool's description. */
  describe?: string;
  /** The arguments as the command will get them, or a throw whose message the agent reads as the refusal. */
  check(args: string[], fence: Fence): string[] | Promise<string[]>;
  /** Whether this call gets the long time limit. Default: the short one. */
  long?(args: string[]): boolean;
  /** Exit codes besides 0 that are not errors, such as a stop that waits for approval. */
  okExits?: number[];
}

export interface Installed {
  commands: Record<string, InstalledCommand>;
  /** Added to every command's environment, this role's own and the repository's alike: plain settings, shown as they are. */
  env?: Record<string, string>;
  /** Added like `env`, and each value put on the run's secret list, so it is scrubbed from every result and the record. */
  secretEnv?: Record<string, string>;
  /** The repository's own commands this company installed, a part of its role's list. Left out: all of them. */
  repository?: string[];
}

/** What an installed command's check may use: the toolbox's own fences. */
export interface Fence {
  /** The URL if it is on the allowlist; else a refusal. */
  url(raw: string): URL;
  /** The absolute path if it is inside the agent's folder; else a refusal. A file argument never starts with "-". */
  file(p: string, what: string, mustExist?: boolean): string;
  /** The company's pre-set approval policy, applied to `offer`; a refusal names every reason. */
  approve(commitmentId: string, max: string, offer: unknown): Promise<void>;
}

/** What a tool call returns to the loop: the text the model reads, and whether it failed. */
export interface ToolResult {
  content: string;
  isError: boolean;
  /** Set by `finish`. */
  finished?: { outcome: string; report: string };
}

const HOOK = fileURLToPath(new URL('./fetch-log.mjs', import.meta.url));
const node = (script: string, args: string[]) => ['--import', HOOK, script, ...args];
const SCRIPTS: Record<string, string> = {
  'buy-with-signer': 'examples/buy-with-signer.ts',
  'seller-adapter': 'examples/seller-adapter.ts',
  'check-delivery': 'examples/check-delivery.ts',
  seal: 'examples/seal.ts',
  'deal-record': 'examples/deal-record.ts',
};
const COMMANDS: Record<'buyer' | 'seller', string[]> = {
  buyer: ['buy-with-signer', 'check-delivery', 'deal-record'],
  seller: ['seller-adapter', 'adapter-log', 'check-delivery', 'seal', 'deal-record'],
};
const ID = /^0x[0-9a-fA-F]{64}$/;
/** JSON with sorted keys, so two checks compare by content alone. */
const canonical = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v ?? null));
const DEC = /^[0-9]{1,30}$/;

/** A refusal of a call, with the reason the agent reads. Recorded as `refused`. */
class Refused extends Error {}

export class Toolbox {
  private adapter: { child: ChildProcess; log: string[]; read: number; exited: number | null } | undefined;
  /** Where the commands' preloaded fetch hook writes one line per HTTP call, and how far the record has read it. */
  private get fetchLog(): string { return join(this.o.owner, 'fetches.jsonl'); }
  private fetchRead = 0;
  readonly specs: ToolSpec[];

  readonly o: ToolboxOptions;

  constructor(o: ToolboxOptions) {
    this.o = o;
    if (o.installed) checkInstalled(o.installed, o.role as 'buyer' | 'seller', o.work);
    // A secret the company hands a command in its environment is scrubbed like every other.
    for (const v of Object.values(o.installed?.secretEnv ?? {})) o.secrets.add(v);
    this.specs = specs(o.role, Object.entries(o.installed?.commands ?? {}), this.repositoryCommands);
  }

  /** The installed command of that name, an own key only; undefined for every other name. */
  private installedCommand(command: string): InstalledCommand | undefined {
    const c = this.o.installed?.commands;
    return c && Object.hasOwn(c, command) ? c[command] : undefined;
  }

  /** The repository's commands this company installed: its role's list, or the part of it `installed.repository` names. */
  private get repositoryCommands(): string[] {
    const all = COMMANDS[this.o.role as 'buyer' | 'seller'];
    const only = this.o.installed?.repository;
    return only ? all.filter((c) => only.includes(c)) : all;
  }

  /** The commands this agent may run: the repository's, then the installed ones. */
  private get commands(): string[] {
    return [...this.repositoryCommands, ...Object.keys(this.o.installed?.commands ?? {})];
  }

  /** The fences an installed command's check may use. */
  private fence(command: string): Fence {
    return {
      url: (raw) => this.allowed(raw),
      file: (p, what, mustExist = true) => {
        if (!p) throw new Refused(`${command} needs ${what}`);
        if (p.startsWith('-')) throw new Refused(`${what} is a file name, and a file name here does not start with "-": rename it`);
        return this.inside(p, { mustExist });
      },
      // The offer must come from where the agent cannot write it, such as the key store's shown offer.
      approve: (id, max, offer) => {
        if (!ID.test(id)) throw new Refused('the commitment ID is 0x and 64 hex digits');
        if (!DEC.test(max)) throw new Refused('the most you pay is base units as a decimal string');
        return this.approval(id.toLowerCase(), max, offer);
      },
    };
  }

  /** Runs one tool call. A refusal or an error is a result the model reads, never a throw. */
  async call(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const limit = this.o.resultLimit ?? 60_000;
    try {
      const r = await this.dispatch(name, input);
      const content = this.o.secrets.scrub(r.content);
      return { ...r, content: content.length > limit ? `${content.slice(0, limit)}\n[… ${content.length - limit} more characters not shown]` : content };
    } catch (e) {
      const refused = e instanceof Refused;
      const text = this.o.secrets.scrub((e as Error).message);
      if (refused) this.o.rec.add(this.o.role, 'refused', { tool: name, reason: text });
      return { content: refused ? `Refused: ${text}` : `Error: ${text}`, isError: true };
    }
  }

  private async dispatch(name: string, input: J): Promise<ToolResult> {
    switch (name) {
      case 'fetch_url': return this.fetchUrl(String(input?.url ?? ''), Number(input?.offset ?? 0));
      case 'run_command': return this.run(String(input?.command ?? ''), Array.isArray(input?.args) ? input.args.map(String) : []);
      case 'read_file': return this.readFile(String(input?.path ?? ''), Number(input?.offset ?? 0));
      case 'write_file': return this.writeFile(String(input?.path ?? ''), typeof input?.content === 'string' ? input.content : JSON.stringify(input?.content ?? ''));
      case 'list_files': return this.listFiles(String(input?.path ?? '.'));
      case 'wait': {
        const s = Math.min(30, Math.max(1, Math.floor(Number(input?.seconds ?? 5)) || 5));
        await new Promise((r) => setTimeout(r, s * 1000));
        return { content: `Waited ${s} s.`, isError: false };
      }
      case 'finish': return { content: 'Finished.', isError: false, finished: { outcome: String(input?.outcome ?? ''), report: String(input?.report ?? '') } };
      default: throw new Refused(`there is no tool ${JSON.stringify(name).slice(0, 80)}: the tools are ${this.specs.map((s) => s.name).join(', ')}`);
    }
  }

  /** Whether a URL is on this agent's allowlist: http or https, no user info, an exact origin, an allowed path. */
  allowed(raw: string): URL {
    let u: URL;
    try { u = new URL(raw); } catch { throw new Refused(`${JSON.stringify(raw).slice(0, 200)} is not a URL`); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Refused(`only http and https URLs are fetched, not ${u.protocol}`);
    if (u.username || u.password) throw new Refused('a URL with a user name or password is not fetched');
    const hit = this.o.allow.find((a) => a.origin === u.origin && (!a.paths || a.paths.some((p) => (p.endsWith('/') ? u.pathname.startsWith(p) : u.pathname === p))));
    if (!hit) throw new Refused(`${u.origin}${u.pathname} is not on your company's allowlist. You may fetch: ${this.o.allow.map((a) => (a.paths ? a.paths.map((p) => `${a.origin}${p}${p.endsWith('/') ? '…' : ''}`).join(', ') : `${a.origin}/…`)).join('; ')}`);
    if (u.pathname.split('/').some((s) => s === '..' || decodeURIComponent(s) === '..')) throw new Refused('a URL with a ".." segment is not fetched');
    return u;
  }

  private async fetchUrl(raw: string, offset: number): Promise<ToolResult> {
    const u = this.allowed(raw);
    const started = Date.now();
    const alias = this.o.alias && u.origin === this.o.alias.from ? new URL(`${u.pathname}${u.search}`, this.o.alias.to) : null;
    let res: Response;
    try {
      res = await fetch(alias ?? u, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      this.o.rec.add(this.o.role, 'http', { via: 'fetch_url', method: 'GET', url: u.href, status: 0, ms: Date.now() - started, error: (e as Error).name });
      return { content: `GET ${u.href} failed: ${(e as Error).name === 'TimeoutError' ? 'no answer in 30 s' : 'could not connect'}`, isError: true };
    }
    const text = await res.text();
    const body = this.o.rec.body(text);
    this.o.rec.add(this.o.role, 'http', { via: 'fetch_url', method: 'GET', url: u.href, ...(alias ? { servedBy: 'this machine\'s copy of the site' } : {}), status: res.status, ms: Date.now() - started, bytes: body.bytes, body: body.text, trimmed: body.trimmed });
    const from = Number.isSafeInteger(offset) && offset > 0 ? offset : 0;
    const page = 60_000;
    const slice = text.slice(from, from + page);
    const more = from + page < text.length ? `\n[… ${text.length - from - page} more characters: fetch again with offset ${from + page}]` : '';
    const location = res.headers.get('location');
    return { content: `HTTP ${res.status} ${res.headers.get('content-type') ?? ''}${location ? `\nLocation (not followed): ${location}` : ''}\n\n${slice}${more}`, isError: res.status >= 400 };
  }

  /** A path inside the agent's folder, with no symbolic link on the way: or a refusal. */
  private inside(p: string, o: { mustExist?: boolean } = {}): string {
    if (p.includes('\0')) throw new Refused('a path with a NUL character is refused');
    const full = resolve(this.o.work, p);
    if (full !== this.o.work && !full.startsWith(this.o.work + sep)) throw new Refused(`${JSON.stringify(p).slice(0, 200)} is outside your folder; your tools reach only paths inside it`);
    let at = this.o.work;
    for (const part of relative(this.o.work, full).split(sep).filter(Boolean)) {
      at = join(at, part);
      if (!existsSync(at)) break;
      if (lstatSync(at).isSymbolicLink()) throw new Refused(`${relative(this.o.work, at)} is a symbolic link: your tools do not follow links`);
    }
    if (o.mustExist && !existsSync(full)) throw new Refused(`${relative(this.o.work, full) || '.'} does not exist in your folder`);
    return full;
  }

  private readFile(p: string, offset: number): ToolResult {
    const f = this.inside(p, { mustExist: true });
    if (!lstatSync(f).isFile()) throw new Refused(`${p} is not a file`);
    if (lstatSync(f).size > 4_000_000) throw new Refused(`${p} is larger than 4 MB`);
    const text = readFileSync(f, 'utf8');
    const from = Number.isSafeInteger(offset) && offset > 0 ? offset : 0;
    const slice = text.slice(from, from + 60_000);
    this.o.rec.add(this.o.role, 'file', { op: 'read', path: relative(this.o.work, f), bytes: Buffer.byteLength(text) });
    return { content: `${slice}${from + 60_000 < text.length ? `\n[… more: read again with offset ${from + 60_000}]` : ''}`, isError: false };
  }

  private writeFile(p: string, content: string): ToolResult {
    const f = this.inside(p);
    if (f === this.o.work) throw new Refused('name a file, not your folder');
    if (Buffer.byteLength(content) > 1_000_000) throw new Refused('a file is at most 1 MB');
    if (existsSync(f) && !lstatSync(f).isFile()) throw new Refused(`${p} is not a file`);
    mkdirSync(dirname(f), { recursive: true });
    this.inside(relative(this.o.work, dirname(f))); // the folders just made are plain folders
    writeFileSync(f, content);
    const body = this.o.rec.body(content);
    this.o.rec.add(this.o.role, 'file', { op: 'write', path: relative(this.o.work, f), bytes: body.bytes, body: body.text, trimmed: body.trimmed });
    return { content: `Wrote ${Buffer.byteLength(content)} bytes to ${relative(this.o.work, f)}.`, isError: false };
  }

  private listFiles(p: string): ToolResult {
    const d = this.inside(p, { mustExist: true });
    if (!lstatSync(d).isDirectory()) throw new Refused(`${p} is not a folder`);
    const items = readdirSync(d, { withFileTypes: true }).map((e) => `${e.name}${e.isDirectory() ? '/' : e.isSymbolicLink() ? ' (link)' : ''}`);
    return { content: items.length ? items.join('\n') : '(empty)', isError: false };
  }

  // ---- The client commands ----

  private async run(command: string, args: string[]): Promise<ToolResult> {
    const commands = this.commands;
    if (!commands.includes(command)) throw new Refused(`${JSON.stringify(command).slice(0, 80)} is not one of your company's installed commands: ${commands.join(', ')}`);
    if (args.length > 12 || args.some((a) => a.length > 20_000)) throw new Refused('at most 12 arguments of at most 20,000 characters each');
    if (args.some((a) => a.includes('\0'))) throw new Refused('an argument with a NUL character is refused');
    // An installed command's check sees every call, a usage question included: nothing reaches its script unchecked.
    const extra = this.installedCommand(command);
    if (extra) {
      let checked: string[];
      let long = false;
      try {
        checked = await extra.check(args, this.fence(command));
        long = extra.long?.(checked) ?? false;
      } catch (e) { throw e instanceof Refused ? e : new Refused((e as Error).message); }
      return this.exec(command, checked, long ? 'long' : 'short');
    }
    // An agent that asks a command for its usage gets the command's own answer: each client command answers --help
    // itself (T-397), so the runner keeps no second copy of its usage. adapter-log is the runner's own tool.
    if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
      if (command === 'adapter-log') return { content: 'adapter-log: the seller adapter\'s latest output lines. It takes no arguments.', isError: false };
      return this.exec(command, ['--help'], 'short');
    }
    if (command === 'adapter-log') return this.adapterLog();
    const checked = await this.check(command, args);
    if (command === 'seller-adapter') return this.startAdapter(checked);
    return this.exec(command, checked, command === 'buy-with-signer' && ['approve', 'resume'].includes(args[0] ?? '') ? 'long' : 'short');
  }

  /** The arguments as the command will get them, each one checked; or a refusal naming the one at fault. */
  private async check(command: string, args: string[]): Promise<string[]> {
    // A file argument never starts with "-": a script that reads flags wherever they appear would take it as one,
    // and the next argument would shift into the file's place (the red team's argument shift, T-391).
    const file = (a: string | undefined, what: string, mustExist = true) => {
      if (!a) throw new Refused(`${command} needs ${what}`);
      if (a.startsWith('-')) throw new Refused(`${what} is a file name, and a file name here does not start with "-": rename it`);
      this.inside(a, { mustExist });
      return a;
    };
    const once = (list: string[], names: string[]) => { for (const n of names) if (list.filter((a) => a === n).length > 1) throw new Refused(`${command} takes ${n} once`); };
    const flags = (rest: string[], allowed: Record<string, 'file' | 'value' | 'bare'>) => {
      for (let i = 0; i < rest.length; i++) {
        const kind = allowed[rest[i]!];
        if (!kind) throw new Refused(`${command} does not take ${JSON.stringify(rest[i]).slice(0, 80)} here; it takes ${Object.keys(allowed).join(', ') || 'no flags'}`);
        if (kind === 'file') file(rest[++i], `a file after ${rest[i - 1]}`);
        if (kind === 'value' && !/^[\w./+-]{1,100}$/.test(rest[++i] ?? '')) throw new Refused(`${rest[i - 1]} takes a plain value`);
      }
    };
    if (command === 'buy-with-signer') {
      if (args.includes('--expect-terms')) throw new Refused('your company keeps the approval: run the command without --expect-terms, and answer its stop with the approve line it prints');
      const store = (a: string | undefined) => {
        if (a !== this.o.keyStore) throw new Refused(`the key store is ${this.o.keyStore}: your company keeps your keys there, and the command takes no other directory`);
        return a;
      };
      const rest = args.filter((a) => a !== '--stop-after-funding');
      const [first] = rest;
      if (first === 'approve') {
        if (rest.length !== 4) throw new Refused('usage: approve <key store directory> <commitment ID> <the most you pay, base units>');
        store(rest[1]);
        if (!ID.test(rest[2]!)) throw new Refused('the commitment ID is 0x and 64 hex digits');
        if (!DEC.test(rest[3]!)) throw new Refused('the most you pay is base units as a decimal string');
        await this.approval(rest[2]!.toLowerCase(), rest[3]!);
        return args;
      }
      if (first === 'resume') {
        if (rest.length < 2 || rest.length > 3) throw new Refused('usage: resume <key store directory> [<commitment ID>]');
        store(rest[1]);
        if (rest[2] !== undefined && !ID.test(rest[2])) throw new Refused('the commitment ID is 0x and 64 hex digits');
        return args;
      }
      if (rest.length < 4 || rest.length > 6) throw new Refused('usage: <quote URL> <key store directory> <scope, as JSON> <the most you pay, base units> [<defaults URL> [<options, as JSON>]]');
      this.allowed(first!);
      store(rest[1]);
      for (const [i, what] of [[2, 'the scope'], [5, 'the options']] as const) {
        if (rest[i] === undefined) continue;
        try { const v = JSON.parse(rest[i]!); if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error(); } catch { throw new Refused(`${what} must be a JSON object`); }
      }
      if (!DEC.test(rest[3]!)) throw new Refused('the most you pay is base units as a decimal string');
      if (this.o.policy && BigInt(rest[3]!) > BigInt(this.o.policy.budget)) throw new Refused(`your company's budget is ${this.o.policy.budget} base units, everything included: the most you pay cannot be more`);
      if (rest[4] !== undefined) this.allowed(rest[4]);
      return args;
    }
    if (command === 'check-delivery') {
      // The same reading as the script's own parseArgs: flags anywhere, everything else a file, exactly two files.
      once(args, ['--mime', '--json']);
      const positional: string[] = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i]!;
        if (a === '--json') continue;
        if (a === '--reference') file(args[++i], 'the file after --reference');
        else if (a === '--mime') { if (!/^[a-z]+\/[a-z0-9.+-]{1,80}$/.test(args[++i] ?? '')) throw new Refused('--mime takes a media type, such as application/json'); }
        else if (a.startsWith('-')) throw new Refused(`check-delivery does not take ${JSON.stringify(a).slice(0, 80)}; it takes --reference, --mime and --json`);
        else positional.push(file(a, 'each file'));
      }
      if (positional.length !== 2) throw new Refused('usage: check-delivery <terms.json> <file> [--reference <file>]... [--mime <type>] [--json]');
      return args;
    }
    if (command === 'deal-record') {
      if (!ID.test(args[0] ?? '')) throw new Refused('usage: deal-record <commitmentId> --as buyer|seller [--delivery <file>] [--settlement <file>] [--out <file>]');
      const rest = args.slice(1);
      once(rest, ['--as', '--out', '--delivery', '--settlement']); // the script reads each flag's first occurrence
      const as = rest.indexOf('--as');
      if (rest[as + 1] !== this.o.role) throw new Refused(`you are the ${this.o.role}: --as ${this.o.role}`);
      const out = rest.indexOf('--out');
      if (out >= 0) file(rest[out + 1], 'a file after --out', false);
      flags(rest.filter((_, i) => i !== as && i !== as + 1 && (out < 0 || (i !== out && i !== out + 1))), { '--delivery': 'file', '--settlement': 'file' });
      return args;
    }
    if (command === 'seal') {
      if (args.length !== 3) throw new Refused('usage: seal <journal.json> <file> <commitmentId>');
      file(args[0], '<journal.json>');
      file(args[1], '<file>');
      if (!ID.test(args[2]!)) throw new Refused('the commitment ID is 0x and 64 hex digits');
      return args;
    }
    if (command === 'seller-adapter') {
      const rest = args.filter((a) => a !== '--sim');
      if (rest.length !== 1) throw new Refused('usage: seller-adapter <config.json>; your company has set HOLDBACK_KEY and HOLDBACK_OPERATORS, so --sim is not needed');
      return [this.adapterConfig(rest[0]!)];
    }
    throw new Refused(`${command} takes no arguments here`);
  }

  /**
   * Settlement time from every operator and the local clock, in Unix seconds, and how far apart they are. One
   * operator's clock never decides alone: the caller refuses when they spread wider than the band.
   */
  private async settlementNow(): Promise<{ now: number; spread: number; clocks: string[] }> {
    const local = Math.floor(Date.now() / 1000);
    const times = [local];
    const clocks = [`this machine ${new Date(local * 1000).toISOString()}`];
    for (const op of this.o.operators) {
      try {
        const d = await (await fetch(`${op}/.well-known/holdback.json`, { signal: AbortSignal.timeout(10_000) })).json() as J;
        const t = Date.parse(String(d?.settlementTime ?? ''));
        if (Number.isFinite(t)) { times.push(Math.floor(t / 1000)); clocks.push(`${new URL(op).host} ${new Date(t).toISOString()}`); }
      } catch { /* an operator that does not answer has no say */ }
    }
    return { now: local, spread: Math.max(...times) - Math.min(...times), clocks };
  }

  /**
   * The company's pre-set answer to the approval stop, read from the offer the stop showed with this key store: the
   * budget, the required checks, a delivery no later than the company accepts, every other deadline within the judging
   * slack after it, and a createdAt inside the band around settlement time.
   */
  private async approval(id: string, max: string, offer?: unknown): Promise<void> {
    const policy = this.o.policy;
    if (!policy) throw new Refused('your company has set no approval policy: nothing is approved');
    const shown = offer ?? this.shownOffer(id);
    const why: string[] = [];
    if (!shown) why.push(`no stop showed ${id} with a key in your key store`);
    else {
      const total = String(shown.fees?.total?.amount ?? '');
      if (!DEC.test(total) || BigInt(total) > BigInt(policy.budget)) why.push(`the offer costs ${total || 'an unknown amount'} base units, above the company's budget of ${policy.budget}`);
      if (BigInt(max) > BigInt(policy.budget)) why.push(`the most you pay, ${max}, is above the company's budget of ${policy.budget}`);
      const checks: J[] = Array.isArray(shown.checks) ? shown.checks : [];
      for (const c of policy.requiredChecks) {
        const k = checks.find((x) => x?.id === c);
        if (!k || k.required !== true) why.push(`the offer has no required check "${c}", which the company requires`);
        else if (canonical(k) !== canonical(policy.checkBodies[c])) why.push(`the offer's check "${c}" is not the check the company requires: same name, different content`);
      }
      const clock = await this.settlementNow();
      if (clock.spread > policy.createdAtBandSec) why.push(`the clocks disagree by ${clock.spread} s, more than ${policy.createdAtBandSec} s (${clock.clocks.join('; ')}), so no date can be checked`);
      const now = clock.now;
      const iso = (t: number) => new Date(t * 1000).toISOString().replace('.000Z', 'Z');
      const at = (v: unknown) => (typeof v === 'string' ? Date.parse(v) / 1000 : NaN);
      const created = at(shown.createdAt);
      if (!Number.isFinite(created) || Math.abs(created - now) > policy.createdAtBandSec) why.push(`the offer says it was made at ${String(shown.createdAt)}, outside ${policy.createdAtBandSec} s of settlement time ${iso(now)}`);
      const deliverBy = at(shown.deadlines?.deliverBy);
      const latest = now + policy.latestDeliverySec;
      if (!Number.isFinite(deliverBy) || deliverBy > latest) why.push(`delivery is due by ${String(shown.deadlines?.deliverBy)}, after the latest the company accepts, ${iso(latest)}`);
      for (const [k, v] of Object.entries(shown.deadlines ?? {})) {
        const t = at(v);
        if (typeof v === 'string' && Number.isFinite(t) && t > latest + policy.decisionSlackSec) why.push(`${k} is ${v}, after ${iso(latest + policy.decisionSlackSec)}, the company's latest delivery plus its judging slack`);
        if (typeof v === 'number' && /Sec$/.test(k) && v > policy.decisionSlackSec) why.push(`${k} is ${v} s, longer than the company's judging slack of ${policy.decisionSlackSec} s`);
      }
    }
    this.o.rec.add(this.o.role, 'approval', { commitmentId: id, granted: why.length === 0, by: 'company policy (pre-set)', reasons: why, policy });
    if (why.length) throw new Refused(`your company's pre-set policy does not approve this offer: ${why.join('; ')}. Nothing was signed or paid.`);
  }

  /** The offer the signer's stop showed for this ID, from the key store, which only the company's tools read. */
  private shownOffer(id: string): J {
    const store = this.o.keyStore;
    if (!store || !existsSync(store)) return undefined;
    for (const name of readdirSync(store)) {
      if (!/^0x[0-9a-f]{40}\.json$/.test(name)) continue;
      try {
        const s = JSON.parse(readFileSync(join(store, name), 'utf8'));
        if (String(s?.shown?.commitmentId ?? '').toLowerCase() === id) return s.shown.offer;
      } catch { /* a file mid-write: skip it */ }
    }
    return undefined;
  }

  /** Learns the key store's secrets, so they are scrubbed from every output: run after each buyer command. */
  learnKeys(): void {
    const store = this.o.keyStore;
    if (!store || !existsSync(store)) return;
    for (const name of readdirSync(store)) {
      if (!/^0x[0-9a-f]{40}\.json$/.test(name)) continue;
      try {
        const s = JSON.parse(readFileSync(join(store, name), 'utf8'));
        this.o.secrets.add(s?.privateKey);
        this.o.secrets.add(s?.encryptionSecretKey);
      } catch { /* a file mid-write: the next call learns it */ }
    }
  }

  /**
   * The seller adapter's configuration, checked and copied where the agent cannot change it after the check: the port
   * its company gave it, a sellerApi under the company's job API only, no credential or callback setting, no other URL,
   * and the journal inside the agent's folder. The adapter runs the copy.
   */
  private adapterConfig(p: string): string {
    const f = this.inside(p, { mustExist: true });
    let c: J;
    try { c = JSON.parse(readFileSync(f, 'utf8')); } catch { throw new Refused(`${p} is not JSON`); }
    if (c === null || typeof c !== 'object' || Array.isArray(c)) throw new Refused(`${p} is not a JSON object`);
    const allowedKeys = ['port', 'sellerApi', 'scope', 'options', 'termsRules', 'payoutAddress', 'clubId', 'adjudicators', 'mandate', 'timing', 'journal', 'pollMs', 'quoteRateLimit', 'redelivery'];
    const bad = Object.keys(c).filter((k) => !allowedKeys.includes(k));
    if (bad.length) throw new Refused(`your company's adapter takes no ${bad.map((b) => JSON.stringify(b).slice(0, 40)).join(', ')} setting here (no template, mapping, credential or callback settings); it takes ${allowedKeys.join(', ')}`);
    if (c.port !== this.o.adapterPort) throw new Refused(`the adapter listens on port ${this.o.adapterPort}, the one your company opened: set "port": ${this.o.adapterPort}`);
    const api = c.sellerApi;
    if (api === null || typeof api !== 'object' || Array.isArray(api)) throw new Refused('sellerApi must be an object naming your company\'s job API');
    if ('auth' in api) throw new Refused('sellerApi.auth is not needed: your company\'s job API takes no credential');
    const base = this.o.jobApi!;
    const urls: string[] = [];
    const walk = (v: J, at: string, ok: (s: string) => boolean): void => {
      if (typeof v === 'string' && /[a-z][a-z0-9+.-]*:\/\/|^\/\//i.test(v) && !ok(v)) urls.push(at);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`, ok);
    };
    // Every URL in sellerApi starts at the company's job API; a call in the object form names a path the adapter keeps
    // under baseUrl, so baseUrl itself must be the job API. Anywhere else, nothing that looks like a URL.
    const underBase = (s: string) => s === base || s.startsWith(`${base}/`);
    if (api.baseUrl !== undefined && !(typeof api.baseUrl === 'string' && underBase(api.baseUrl))) throw new Refused(`sellerApi.baseUrl must be your company's job API, ${base}`);
    for (const k of ['quote', 'start', 'result'] as const) {
      const v = api[k];
      if (typeof v === 'string' && !underBase(v)) throw new Refused(`sellerApi.${k} must be under your company's job API, ${base}`);
      if (v !== undefined && typeof v !== 'string' && api.baseUrl === undefined) throw new Refused(`sellerApi.${k} in the object form needs sellerApi.baseUrl, your company's job API`);
    }
    walk(api, 'sellerApi', underBase);
    for (const [k, v] of Object.entries(c)) if (k !== 'sellerApi') walk(v, k, () => false);
    if (urls.length) throw new Refused(`${urls.join(', ')}: only sellerApi may name a URL`);
    if (c.redelivery !== undefined && (typeof c.redelivery !== 'object' || Object.keys(c.redelivery ?? {}).some((k) => k !== 'refetchEverySec'))) throw new Refused('redelivery takes only refetchEverySec here');
    if (c.mandate !== undefined && (typeof c.mandate !== 'object' || Object.keys(c.mandate ?? {}).some((k) => !['fromFaucet', 'renewBeforeSec'].includes(k)))) throw new Refused('mandate takes only fromFaucet and renewBeforeSec');
    const journal = c.journal === undefined ? 'seller-adapter.journal.json' : c.journal;
    if (typeof journal !== 'string') throw new Refused('journal must be a file path inside your folder');
    c.journal = this.inside(journal);
    // The demo's form, version 1 (review.ts, TEMPLATE), with what the shipped template brings by default: the scope
    // rules, the buyer's options and the rules that act on them, and the salt (T-534). A template of one's own would
    // otherwise drop the default options, and a quote asking for a panel would be refused.
    c.template = fileURLToPath(TEMPLATE);
    c.scope ??= DEFAULTS.scope;
    c.options ??= DEFAULTS.options;
    c.termsRules ??= DEFAULTS.termsRules;
    c.reportSalt = true;
    const copy = join(this.o.owner, `adapter-config-${Date.now()}.json`);
    writeFileSync(copy, JSON.stringify(c, null, 2));
    return copy;
  }

  /** The child's environment: built here from nothing, so no model key, no login and no shell setting reaches it. */
  env(): Record<string, string> {
    const env: Record<string, string> = { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: this.o.work, TMPDIR: join(this.o.work, '.tmp'), HOLDBACK_OPERATORS: this.o.operators.join(','), NO_COLOR: '1', DUET_FETCH_LOG: this.fetchLog };
    mkdirSync(env['TMPDIR']!, { recursive: true });
    if (this.o.role === 'seller' && this.o.sellerKey) env['HOLDBACK_KEY'] = this.o.sellerKey;
    Object.assign(env, this.o.installed?.env ?? {}, this.o.installed?.secretEnv ?? {});
    return env;
  }

  private exec(command: string, args: string[], kind: 'short' | 'long'): Promise<ToolResult> {
    const timeout = (this.o.timeoutMs ?? { short: 180_000, long: 1_200_000 })[kind];
    const extra = this.installedCommand(command);
    const script = extra ? extra.script : join(this.o.repo, SCRIPTS[command]!);
    const started = Date.now();
    return new Promise((done) => {
      const child = spawn(process.execPath, node(script, args), { cwd: this.o.work, env: this.env(), stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      const cap = (s: string, d: Buffer) => (s.length < 2_000_000 ? s + d.toString('utf8') : s);
      child.stdout!.on('data', (d: Buffer) => void (out = cap(out, d)));
      child.stderr!.on('data', (d: Buffer) => void (err = cap(err, d)));
      const stop = () => { child.kill('SIGTERM'); setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 3000).unref(); };
      const timer = setTimeout(stop, timeout);
      const onAbort = () => stop();
      this.o.signal?.addEventListener('abort', onAbort, { once: true });
      if (this.o.signal?.aborted) stop();
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        this.o.signal?.removeEventListener('abort', onAbort);
        if (this.o.role === 'buyer') this.learnKeys(); // before any of the output is scrubbed or recorded
        this.ingestFetches();
        const so = this.o.rec.body(out), se = this.o.rec.body(err);
        this.o.rec.add(this.o.role, 'command', { command, args: args.map((a) => this.o.secrets.scrub(a)), exit: code, signal, ms: Date.now() - started, stdout: so.text, stderr: se.text, stdoutBytes: so.bytes, stderrBytes: se.bytes });
        if (command === 'buy-with-signer') {
          // The signer's own last word on a deal: the outcome, and whether it opened the work (its size, never its text).
          for (const line of out.split('\n')) {
            let j: J;
            try { j = JSON.parse(line); } catch { continue; }
            if (j && typeof j === 'object' && typeof j.outcome === 'string') this.o.rec.add('buyer', 'signer.outcome', { commitmentId: j.commitmentId, outcome: j.outcome, paid: j.paid ?? null, opened: typeof j.work === 'string' && j.work.length > 0, workBytes: typeof j.work === 'string' ? Buffer.byteLength(j.work) : 0, transactions: Array.isArray(j.transactions) ? j.transactions.length : 0 });
            if (j && typeof j === 'object' && j.approval === 'needed') this.o.rec.add('buyer', 'signer.stop', { commitmentId: j.commitmentId, total: j.fees?.total?.amount, checks: Array.isArray(j.checks) ? j.checks.map((k: J) => ({ id: k?.id, required: k?.required })) : [], differences: Array.isArray(j.differences) ? j.differences.map((d: J) => d?.field) : [] });
          }
        }
        const timedOut = signal === 'SIGTERM' && Date.now() - started >= timeout;
        done({ content: `exit ${code ?? signal}${timedOut ? ` (stopped after ${Math.round(timeout / 1000)} s)` : ''}\n--- stdout\n${out}\n--- stderr\n${err}`, isError: code !== 0 && !(command === 'buy-with-signer' && code === 3) && !(code !== null && extra?.okExits?.includes(code)) });
      });
    });
  }

  /** Starts the seller adapter in the background and returns its first lines, or its error if it stopped. */
  private startAdapter([config]: string[]): Promise<ToolResult> {
    if (this.adapter && this.adapter.exited === null) throw new Refused('the adapter is already running: read its log with adapter-log');
    const child = spawn(process.execPath, node(join(this.o.repo, SCRIPTS['seller-adapter']!), [config!]), { cwd: this.o.work, env: this.env(), stdio: ['ignore', 'pipe', 'pipe'] });
    const a = { child, log: [] as string[], read: 0, exited: null as number | null };
    this.adapter = a;
    // Whole lines only: a line split across two chunks is joined before it is kept, so the secret list sees it whole.
    let partial = '';
    const line = (d: Buffer) => { const parts = (partial + d.toString('utf8')).split('\n'); partial = parts.pop() ?? ''; if (partial.length > 100_000) { a.log.push(partial); partial = ''; } for (const l of parts) if (l.trim()) a.log.push(l); };
    child.stdout!.on('data', line);
    child.stderr!.on('data', line);
    this.o.rec.add('seller', 'command', { command: 'seller-adapter', args: ['<checked copy of the config>'], background: true });
    return new Promise((done) => {
      const finish = () => {
        clearInterval(poll);
        const lines = a.log.slice(0, 40);
        a.read = lines.length;
        this.o.rec.add('seller', 'adapter.start', { running: a.exited === null, exit: a.exited, lines: lines.map((l) => this.o.rec.body(l).text) });
        done({ content: `${a.exited === null ? 'The adapter is running in the background. Read new log lines with adapter-log.' : `The adapter stopped with exit ${a.exited}.`}\n${lines.join('\n')}`, isError: a.exited !== null });
      };
      child.on('exit', (code) => { a.exited = code ?? -1; });
      const started = Date.now();
      const poll = setInterval(() => { if (a.exited !== null || a.log.length >= 4 || Date.now() - started > 15_000) finish(); }, 200);
    });
  }

  /** Moves the commands' HTTP calls into the record as `api` events, each at the time it was made. */
  ingestFetches(): void {
    if (!existsSync(this.fetchLog)) return;
    const text = readFileSync(this.fetchLog, 'utf8');
    const fresh = text.slice(this.fetchRead);
    const upTo = fresh.lastIndexOf('\n') + 1;
    this.fetchRead += upTo;
    for (const line of fresh.slice(0, upTo).split('\n').filter(Boolean)) {
      try {
        const f = JSON.parse(line);
        this.o.rec.add(this.o.role, 'api', { via: 'command', method: String(f.method), url: String(f.url), status: Number(f.status), ms: Number(f.ms) }, Number(f.at));
      } catch { /* a torn line: skip it */ }
    }
  }

  private adapterLog(): ToolResult {
    this.ingestFetches();
    const a = this.adapter;
    if (!a) throw new Refused('the adapter is not running: start it with seller-adapter <config.json>');
    const fresh = a.log.slice(a.read, a.read + 200);
    a.read += fresh.length;
    this.o.rec.add('seller', 'adapter.log', { lines: fresh.map((l) => this.o.rec.body(l).text), running: a.exited === null });
    return { content: `${a.exited === null ? 'running' : `stopped (exit ${a.exited})`}; ${fresh.length} new lines\n${fresh.join('\n')}`, isError: false };
  }

  /** Stops the adapter: the run is over. */
  async close(): Promise<void> {
    const a = this.adapter;
    if (a && a.exited === null) {
      a.child.kill('SIGTERM');
      await new Promise((r) => { a.child.once('exit', r); setTimeout(r, 3000); });
      if (a.exited === null && a.child.exitCode === null) {
        a.child.kill('SIGKILL');
        await new Promise((r) => { a.child.once('exit', r); setTimeout(r, 2000); });
      }
    }
    this.ingestFetches();
  }
}

/** The variables every command's environment sets, and those that would change how Node runs: no installed env sets them. */
const BASE_ENV = ['PATH', 'HOME', 'TMPDIR', 'HOLDBACK_OPERATORS', 'NO_COLOR', 'DUET_FETCH_LOG', 'HOLDBACK_KEY'];
const NODE_ENV = /^NODE_|^npm_|^DYLD_|^LD_/i;

/**
 * The company's installed commands, checked once when the toolbox is made: each script an absolute path to a file
 * outside the agent's folder (the agent writes there), no name that is one of the role's own commands, and an
 * environment that leaves the base variables and Node's own settings alone. A mistake here is the runner's: it throws.
 */
function checkInstalled(i: Installed, role: 'buyer' | 'seller', work: string): void {
  const own = [...COMMANDS[role], 'adapter-log'];
  for (const [name, c] of Object.entries(i.commands)) {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(name)) throw new Error(`installed command name ${JSON.stringify(name).slice(0, 60)} is not lowercase letters, digits and dashes`);
    if (own.includes(name)) throw new Error(`installed command ${name} has the name of one of the ${role}'s own commands`);
    if (!isAbsolute(c.script) || !existsSync(c.script)) throw new Error(`installed command ${name}: its script must be an absolute path to a file`);
    if (lstatSync(c.script).isSymbolicLink() || !lstatSync(c.script).isFile()) throw new Error(`installed command ${name}: its script must be a plain file, not a link or a folder`);
    const real = realpathSync(c.script), home = realpathSync(work);
    if (real === home || real.startsWith(home + sep)) throw new Error(`installed command ${name}: its script is inside the agent's folder, which the agent can write`);
  }
  // The secret list ignores values under 12 characters, so a shorter secret would not be scrubbed.
  for (const [k, v] of Object.entries(i.secretEnv ?? {})) if (String(v).length < 12) throw new Error(`installed secretEnv ${k} is under 12 characters: the run cannot scrub a value that short`);
  for (const k of [...Object.keys(i.env ?? {}), ...Object.keys(i.secretEnv ?? {})]) if (BASE_ENV.includes(k) || NODE_ENV.test(k)) throw new Error(`installed env may not set ${k}: the toolbox sets it, or it changes how Node runs`);
  for (const r of i.repository ?? []) if (!COMMANDS[role].includes(r)) throw new Error(`installed.repository names ${r}, which is not one of the ${role}'s own commands`);
}

/** The tools as each model is told about them. The run tool's list is the company's installed commands. */
function specs(role: 'buyer' | 'seller', installed: Array<[string, InstalledCommand]> = [], repository: string[] = COMMANDS[role]): ToolSpec[] {
  const commands = [...repository, ...installed.map(([n]) => n)];
  const said = (c: string) => installed.find(([n]) => n === c)?.[1].describe;
  const from = installed.length === 0
    ? 'from Crow\'s public repository, as `node examples/<command>.ts <args>`'
    : `${repository.length ? `from Crow's public repository (${repository.join(', ')}, as \`node examples/<command>.ts <args>\`) and ` : ''}from elsewhere (${installed.map(([n]) => n).join(', ')})`;
  return [
    { name: 'fetch_url', description: 'GET a URL and read the answer: status, content type and body (up to 60,000 characters; pass offset to read further). Only URLs on your company\'s allowlist; redirects are not followed. GET only: anything that changes state goes through your company\'s commands.', input: { type: 'object', properties: { url: { type: 'string' }, offset: { type: 'integer', minimum: 0 } }, required: ['url'] } },
    { name: 'run_command', description: `Run one of the client commands your company installed ${from}, from your folder, and read its exit code, stdout and stderr. Installed: ${commands.map((c) => (said(c) ? `${c} (${said(c)})` : c === 'adapter-log' ? 'adapter-log (the new lines the background seller adapter has logged)' : c === 'seller-adapter' ? 'seller-adapter (starts in the background)' : c)).join(', ')}. Pass the arguments as the docs give them, one per array item, with no shell quoting. Your company has set the environment these commands need (HOLDBACK_OPERATORS${role === 'seller' ? ', and HOLDBACK_KEY with your signing key' : ''}); you never see a key.`, input: { type: 'object', properties: { command: { type: 'string', enum: commands }, args: { type: 'array', items: { type: 'string' } } }, required: ['command', 'args'] } },
    { name: 'read_file', description: 'Read a text file in your folder (up to 60,000 characters; pass offset to read further).', input: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', minimum: 0 } }, required: ['path'] } },
    { name: 'write_file', description: 'Write a text file in your folder (at most 1 MB), making folders as needed.', input: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
    { name: 'list_files', description: 'List a folder inside your folder.', input: { type: 'object', properties: { path: { type: 'string' } } } },
    { name: 'wait', description: 'Wait 1 to 30 seconds, for example while the other side acts.', input: { type: 'object', properties: { seconds: { type: 'integer', minimum: 1, maximum: 30 } }, required: ['seconds'] } },
    { name: 'finish', description: 'End your work and report to your company: the outcome in a few words, and a short report.', input: { type: 'object', properties: { outcome: { type: 'string' }, report: { type: 'string' } }, required: ['outcome', 'report'] } },
  ];
}
