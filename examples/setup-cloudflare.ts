// `node setup.mjs cloudflare` (T-478): a seller's own Worker on the party's own Cloudflare account, for work whose
// terms name the buyer's own input, so a program must answer each buyer's quote with a signed offer (D82). A fixed
// file or job needs no program: `publish` makes a standing offer for it (T-552). The Worker is the seller adapter's
// core in its own shell (apps/own-seller); it starts each job at the party's own API over HTTPS and delivers the
// result itself. Crow runs nothing of it, and no step needs a Crow account.
//
//   cloudflare --config <file> --account <ID> --at <address> (--quote-credential | --open) --quotes-per-day <n>
//                prepares the deploy in <folder>/cloudflare: wrangler.json for the account and the address the
//                person named, worker.mjs (site/seller-worker.mjs, checked by its SHA-256) and seller-bundle.txt, the
//                seller's bundle with no secret. It writes the card's quote entry into the card's folder. A missing
//                answer prints its question and exits 3; nothing is inferred. It sends nothing to the account.
//   cloudflare --key
//                after the person's first deploy: makes the Worker's own signing key in memory and pipes it to the
//                account's secret store on standard input (`wrangler secret bulk`). It checks first: a key it set is
//                kept, and a key it did not set is refused. The key is never printed, never an argument, never a file.
//
// The person runs the login and the deploy, and types the API key and the quote credentials at Wrangler's own hidden
// prompt: the commands are printed. Every Wrangler run is one pinned version, and the command refuses to run while
// an account's token or ID is in the environment, which would choose the account without a word on the command line.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { configFrom } from './seller-adapter-core.ts';
import { plain as plainLine } from './plain.ts';
import { holdingKeyOf } from './seller-adapter.ts';
import { SELLER_WORKER_SHA256 } from './seller-worker-pin.ts';
import { CARD_FILE, FILES, readState, writeState, writeWhole, type Call, type J, type State } from './setup-seller.ts';
import { refuseEnvFile } from './setup-work-api.ts';
import { jcs } from './verify.ts';

const plain = (s: unknown, max = 300) => plainLine(String(s ?? '')).slice(0, max);

/** The one Wrangler version every run uses: the repository's pin, since the key travels through it to the secret store. */
export const WRANGLER_VERSION = '4.151.3';
// No --yes, and npm_config_yes=false in the child's environment: npx runs a Wrangler the person installed and never
// resolves or installs a package at run time (Decision 8, as the journeys session adopted it on 2026-11-25).
export const WRANGLER = [`wrangler@${WRANGLER_VERSION}`];
/** How a printed command runs Wrangler: the pinned version, through npx. */
export const WRANGLER_LINE = `npx ${WRANGLER.join(' ')}`;
/** How the person installs the pinned Wrangler once, before the first command that runs it. */
export const WRANGLER_INSTALL = `npx --yes wrangler@${WRANGLER_VERSION} --version`;
/** The file the person's deploy writes Wrangler's output to, in the deploy folder: the deployed addresses. */
export const DEPLOY_OUTPUT = 'deploy-output.ndjson';
/** Where the prebuilt Worker is published; the command takes its bytes only with the SHA-256 setup.mjs carries. */
export const SELLER_WORKER_URL = 'https://crow.direct/seller-worker.mjs';
/** The folder's directory for the deploy, and its three files. */
export const CF_DIR = 'cloudflare';
export const CF_FILES = { worker: 'worker.mjs', bundle: 'seller-bundle.txt', config: 'wrangler.json' } as const;
/** The Worker secret that holds the quote credentials, when the person chose one. */
export const QUOTE_ENV = 'QUOTE_CREDENTIALS';
/** Variables that pick a Cloudflare account, or carry its credential, without a word on the command line. */
export const ACCOUNT_VARIABLES: readonly string[] = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL', 'CLOUDFLARE_ACCOUNT_ID', 'CF_API_TOKEN', 'CF_API_KEY', 'CF_EMAIL', 'CF_ACCOUNT_ID',
  // and, for the person's own Wrangler runs the command prints, the ones that send its requests elsewhere or log them whole (red team, T-478)
  'CLOUDFLARE_API_BASE_URL', 'CF_API_BASE_URL', 'WRANGLER_LOG_SANITIZE', 'WRANGLER_LOG_PATH', 'WRANGLER_LOG'];
/**
 * The only variables a Wrangler run the command starts gets from this process: what npx and Wrangler need to find
 * themselves, the npm cache and the person's login. Anything else, such as a variable that names another API host,
 * stays out (red team, T-478).
 */
const PASSED = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'npm_config_cache', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'SystemRoot'];
/** Crow's own zones: no address, route or zone the command writes is under one. */
export const CROW_ZONES: readonly string[] = ['crow.direct', 'escrow.stream'];
/** The configuration fields the Node adapter uses and the Worker has no use for: it opens no port and keeps no file. */
const NODE_ONLY = ['port', 'journal', 'events'];
/** The largest configuration, template or mapping file the command reads, and the largest Worker file it takes. */
const MAX_FILE_BYTES = 262_144;
const MAX_WORKER_BYTES = 16 * 1024 * 1024;
/** One label of a host name. */
const LABEL = '[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?';
const WORKERS_DEV = new RegExp(`^(${LABEL})\\.(${LABEL})\\.workers\\.dev$`);
const HOST = new RegExp(`^(${LABEL}\\.)+[a-z]{2,63}$`);
/** The windows of a Cloudflare compatibility date this Worker is tested with. */
const COMPATIBILITY = { compatibility_date: '2025-09-15', compatibility_flags: ['nodejs_compat', 'nodejs_compat_do_not_populate_process_env', 'disallow_importable_env'] };

/** What the folder records of its Worker, in crow.json under `cloudflare`. No secret. */
export interface CloudflareRecord {
  config: string;
  account: string;
  at: string;
  name: string;
  workersDev: boolean;
  access: 'credential' | 'open';
  quotesPerDay: number;
  offerId: string;
  preparedAt: string;
  /** Set before the key is made, so a run that stopped after the secret store took it knows the key is its own. */
  keyStartedAt?: string;
  keySetAt?: string;
  /** The Worker's own key's address, public: `check --published` checks the Worker's signature against it. */
  workerAddress?: string;
  leftAt?: string;
}
type WithCloudflare = State & { cloudflare?: CloudflareRecord };
export const recordOf = (state: State | undefined): CloudflareRecord | undefined => (state as WithCloudflare | undefined)?.cloudflare;

/** One run of the pinned Wrangler. `input` goes to its standard input and nowhere else. */
export type Tool = (args: string[], o?: { input?: string }) => Promise<{ code: number; stdout: string; stderr: string }>;
/**
 * Wrangler through npx, with this process's environment (main() has removed every HOLDBACK_* and CROW_* variable), run
 * in `cwd`, the folder's deploy directory: Wrangler loads a .env file from the directory it starts in, and one in the
 * person's current folder could carry an account token past the environment check (T-478 review).
 */
export const npxWrangler = (cwd: string): Tool => (args, o = {}) =>
  new Promise((done) => {
    const dotenv = readdirSync(cwd).find((n) => /^\.env/.test(n) || n === '.dev.vars' || n === '.npmrc');
    if (dotenv) return done({ code: 2, stdout: '', stderr: `${join(cwd, dotenv)} is there, and ${dotenv === '.npmrc' ? 'npx' : 'Wrangler'} would load it: remove it` });
    // Wrangler logs each request whole to a file unless it sanitizes its log: it sanitizes, and logs into a folder of
    // this run's own that is removed when the run ends, so no request body that carries a secret stays on disk.
    const logs = mkdtempSync(join(tmpdir(), 'crow-wrangler-'));
    const env: Record<string, string> = { WRANGLER_LOG_SANITIZE: 'true', WRANGLER_LOG_PATH: logs, WRANGLER_SEND_METRICS: 'false', npm_config_yes: 'false' };
    for (const name of PASSED) if (process.env[name] !== undefined) env[name] = process.env[name]!;
    const child = spawn('npx', [...WRANGLER, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    child.on('close', () => rmSync(logs, { recursive: true, force: true }));
    let stdout = '', stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', (e) => done({ code: 127, stdout, stderr: `${stderr}${e.message}` }));
    child.on('close', (code) => done({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(o.input ?? '');
  });

/** Why the environment may choose an account by itself, or '' when it cannot. */
export function accountVariableSet(env: Record<string, string | undefined> = process.env): string {
  return ACCOUNT_VARIABLES.find((name) => env[name] !== undefined && env[name] !== '') ?? '';
}
const isCrowHost = (host: string) => CROW_ZONES.some((z) => host === z || host.endsWith(`.${z}`));

/** The address the person named: a workers.dev name, a host on the party's own zone, or this machine under --test-world. */
export function addressOf(at: string, testWorld: boolean): { url: string; host: string; name: string; workersDev: boolean; local: boolean } {
  const text = at.trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/$/, '');
  if (testWorld && /^(127\.0\.0\.1|localhost):\d{1,5}$/.test(text)) return { url: `http://${text}/`, host: text, name: 'crow-seller-local', workersDev: false, local: true };
  if (isCrowHost(text)) throw new Error(`--at ${plain(text, 120)} is on Crow's zone: a party's own Worker takes an address of the party's own`);
  const dev = WORKERS_DEV.exec(text);
  if (dev) return { url: `https://${text}/`, host: text, name: dev[1]!, workersDev: true, local: false };
  if (!HOST.test(text) || text.length > 253 || text.endsWith('.workers.dev')) throw new Error('--at takes <name>.<subdomain>.workers.dev, or a host name on a zone your account has, such as crow.example.com: lowercase letters, digits, hyphens and dots, with no path');
  return { url: `https://${text}/`, host: text, name: `crow-seller-${createHash('sha256').update(text).digest('hex').slice(0, 12)}`, workersDev: false, local: false };
}

const QUESTIONS: Record<string, string> = {
  '--config': "Which program answers the quotes? Give the seller adapter's configuration for your own API (https://crow.direct/ref/seller-adapter.txt, \"Your API's shape\"): a JSON file with sellerApi over https, scope and template, the template file beside it. The Worker starts each job there and delivers the result.",
  '--account': `Which Cloudflare account? Its account ID, 32 hex characters. The person logs in first (${WRANGLER_LINE} login); then ${WRANGLER_LINE} whoami lists the accounts the login reaches. Never pick one for the person.`,
  '--at': 'At which address? <name>.<subdomain>.workers.dev, where <subdomain> is the account\'s workers.dev subdomain (the dashboard: Workers & Pages, then the subdomain; an account with none sets one there first), or a host on a zone the account has, such as crow.example.com. The deploy replaces a Worker of the same name on that account: choose a name no Worker of the account has yet.',
  '--quote-credential': `Who may ask for a quote? Pass --quote-credential: buyers then need a credential you hand them yourself, typed into the Worker's secret ${QUOTE_ENV}. Or pass --open: anyone who reaches the address may ask; each quote asks your API for a price and spends a faucet grant, and each funded deal starts a job at your API.`,
  '--quotes-per-day': 'How many offers a day may the Worker make, over all callers? A whole number, such as 100. The Worker counts them in its storage for each UTC day; past it, it answers 429 until the next day.',
};

/** Reads a file the person named, up to MAX_FILE_BYTES: never an environment file. */
function readNamed(path: string, flag: string): string {
  refuseEnvFile(path, flag);
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    throw new Error(`${flag}: ${plain(path, 200)} is not there`);
  }
  if (size > MAX_FILE_BYTES) throw new Error(`${flag}: ${plain(path, 200)} is ${size} bytes; the command reads files of at most ${MAX_FILE_BYTES} bytes`);
  return readFileSync(path, 'utf8');
}

const isHttpsHost = (v: unknown): boolean => {
  try {
    const u = new URL(String(v));
    return u.protocol === 'https:' && !/^(localhost|127\.|\[|0\.0\.0\.0)/.test(u.hostname) && u.username === '' && u.password === '';
  } catch {
    return false;
  }
};

/**
 * The seller's bundle from the person's configuration: the Node-only fields dropped, the payout address the folder's,
 * the quote access the person's answers. Throws, naming the field, on anything the Worker would refuse.
 */
export function bundleFrom(configPath: string, o: { name: string; offerId: string; owner: string; payout: string; access: 'credential' | 'open'; quotesPerDay: number; keyFile?: string }): { bundle: { owner: string; seller: J }; dropped: string[]; credentialVars: string[]; configSha256: string } {
  let c: J;
  try {
    c = JSON.parse(readNamed(configPath, '--config'));
  } catch (e) {
    throw new Error((e as Error) instanceof SyntaxError ? '--config is not one JSON object' : (e as Error).message);
  }
  if (c === null || typeof c !== 'object' || Array.isArray(c)) throw new Error('--config must hold one JSON object: the adapter configuration');
  const dropped = NODE_ONLY.filter((k) => c[k] !== undefined);
  for (const k of dropped) delete c[k];
  for (const k of ['quoteAuth', 'quoteRateLimit']) if (c[k] !== undefined) throw new Error(`--config sets ${k}: the command writes it from your answers (--quote-credential or --open, and --quotes-per-day). Remove the field`);
  if (c.payoutAddress !== undefined && String(c.payoutAddress).toLowerCase() !== o.payout) throw new Error(`--config pays ${plain(c.payoutAddress, 42)}, and this folder's payout address is ${o.payout}: remove payoutAddress, or make the folder with that --payout`);
  c.payoutAddress = o.payout;
  c.signingKey ??= 'per-deal';
  if (o.access === 'credential') c.quoteAuth = { kind: 'bearer', env: QUOTE_ENV };
  c.quoteRateLimit = { overall: { requests: o.quotesPerDay, windowSec: 86_400 } };
  // The Worker sends the party's API key to these addresses: https, and not this machine.
  const api = c.sellerApi;
  if (api === null || typeof api !== 'object') throw new Error("--config: sellerApi is required: your API's quote, start and result calls");
  for (const k of ['quote', 'start', 'result']) if (typeof api[k] === 'string' && !isHttpsHost(api[k])) throw new Error(`--config: sellerApi.${k} must be an https address that is not this machine: the Worker calls it from Cloudflare`);
  if (api.baseUrl !== undefined && !isHttpsHost(api.baseUrl)) throw new Error('--config: sellerApi.baseUrl must be an https address that is not this machine: the Worker calls it from Cloudflare');
  if (c.alerts?.callback !== undefined && !isHttpsHost(c.alerts.callback)) throw new Error('--config: alerts.callback must be an https address that is not this machine');
  // The files the configuration names, read beside it, under the names it gives them.
  const files: Record<string, string> = {};
  const here = dirname(resolve(configPath));
  for (const field of ['template', 'reportMapping']) {
    const name = c[field];
    if (name === undefined) continue;
    // A name of a file beside the configuration, never a path out of it: the file is uploaded with the Worker.
    if (typeof name !== 'string' || !/^[A-Za-z0-9._-]{1,120}$/.test(name) || name.startsWith('.') || isAbsolute(name)) throw new Error(`--config: ${field} must name a file beside the configuration, with no folder in the name`);
    const path = join(here, name);
    if (o.keyFile !== undefined && existsSync(path) && existsSync(o.keyFile) && statSync(path).ino === statSync(o.keyFile).ino && statSync(path).dev === statSync(o.keyFile).dev) throw new Error(`--config: ${field} names the folder's signing key: a key is never uploaded`);
    const text = readNamed(path, `--config's ${field}`);
    try {
      JSON.parse(text);
    } catch {
      throw new Error(`--config: ${field} ${plain(name, 80)} is not JSON`);
    }
    files[name] = text;
  }
  const seller = { slug: o.name, card: { name: o.name, item: o.offerId }, config: c, files };
  return { bundle: { owner: o.owner, seller }, dropped, credentialVars: checkSeller(seller), configSha256: sellerSha256(seller) };
}

/**
 * The seller's configuration through the adapter's own loader, with the files beside it, as the Worker loads it at
 * start (apps/hosted-sellers/src/bundle.ts, checkBundle, which the Worker runs and a test runs on this output).
 * Returns the variables it names for its credentials. Throws, naming the field, on anything malformed.
 */
export function checkSeller(seller: { slug: string; config: J; files: Record<string, string> }): string[] {
  const has = (name: string) => Object.hasOwn(seller.files, name);
  configFrom(seller.config, '--config', {
    beside: (name) => {
      if (!has(name)) throw new Error(`--config names ${plain(name, 80)}, and no such file is beside it`);
      return name;
    },
    readText: (name) => {
      if (!has(name)) throw Object.assign(new Error(`no file ${plain(name, 80)}`), { code: 'ENOENT' });
      return seller.files[name]!;
    },
    shippedTemplate: '',
  });
  if (seller.config.template === undefined) throw new Error('--config: template is required: the deal template, in a file beside the configuration');
  if (seller.slug.length > 40 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(seller.slug) || ['test-seller', 'test-buyer'].some((r) => seller.slug.startsWith(r))) {
    throw new Error(`the folder's name ${plain(seller.slug, 40)} is not one the Worker takes: 1 to 40 lowercase letters and digits in words joined by single hyphens, not starting test-seller or test-buyer. Make the folder with another --name`);
  }
  const c = seller.config;
  const vars = [c.sellerApi?.auth?.env, c.quoteAuth?.env, c.alerts?.secretEnv, c.redelivery?.readyAuth?.env].filter((v): v is string => typeof v === 'string');
  for (const v of vars) if (v.startsWith('HOLDBACK_') || ['SELLER', 'OPERATOR_URLS', 'SELLER_URL'].includes(v)) throw new Error(`--config names ${plain(v, 60)} for a credential, which the Worker keeps for itself: name a variable of its own`);
  if (new Set(vars).size !== vars.length) throw new Error('--config names one variable for two credentials: each needs its own');
  return vars;
}
/** The SHA-256 the Worker shows on its card and /health: the bundle's seller in canonical JSON, as bundleSha256 hashes it. */
export const sellerSha256 = (s: { slug: string; card: unknown; config: unknown; files: unknown }): string => createHash('sha256').update(jcs({ slug: s.slug, card: s.card, config: s.config, files: s.files }), 'utf8').digest('hex');

/** The deploy configuration: the account and the address the person named, the Worker's one object, no secret. */
export function wranglerConfigFor(o: { name: string; account: string; url: string; host: string; workersDev: boolean; local: boolean; operators: string[] }): Record<string, unknown> {
  return {
    name: o.name,
    account_id: o.account,
    main: CF_FILES.worker,
    // The pinned bytes are uploaded as they are, with the bundle beside them as a text module: Wrangler bundles nothing.
    no_bundle: true,
    rules: [{ type: 'Text', globs: ['**/*.txt'], fallthrough: false }],
    ...COMPATIBILITY,
    workers_dev: o.workersDev,
    preview_urls: false,
    ...(o.workersDev || o.local ? {} : { routes: [{ pattern: o.host, custom_domain: true }] }),
    vars: { OPERATOR_URLS: o.operators.join(','), SELLER_URL: o.url },
    durable_objects: { bindings: [{ name: 'SELLER', class_name: 'OwnSeller' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['OwnSeller'] }],
    observability: { enabled: true, logs: { invocation_logs: false } },
  };
}

/** The prebuilt Worker's bytes: from --worker-file, or from crow.direct, and only with the SHA-256 setup.mjs carries. */
async function workerBytes(c: Call): Promise<Buffer> {
  const file = c.flags.get('--worker-file');
  let bytes: Buffer;
  if (file !== undefined) {
    refuseEnvFile(file, '--worker-file');
    if (!existsSync(file) || statSync(file).size > MAX_WORKER_BYTES) throw new Error(`--worker-file: ${plain(file, 200)} is not there, or is over ${MAX_WORKER_BYTES} bytes`);
    bytes = readFileSync(file);
  } else {
    if (c.testWorld) throw new Error('--test-world needs --worker-file: the local build of site/seller-worker.mjs');
    const res = await fetch(SELLER_WORKER_URL, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
    if (res.status !== 200) throw new Error(`${SELLER_WORKER_URL} answered ${res.status}: give the file with --worker-file`);
    bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_WORKER_BYTES) throw new Error(`${SELLER_WORKER_URL} is over ${MAX_WORKER_BYTES} bytes`);
  }
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== SELLER_WORKER_SHA256) throw new Error(`the Worker file's SHA-256 is ${sha}, not ${SELLER_WORKER_SHA256}, the one this setup.mjs carries: it is not the Worker this version writes`);
  return bytes;
}

/** The card's quote entry in the card's folder: other offers kept, the draft's marks dropped. */
function writeCard(state: State, offerId: string, base: string, configSha256: string): string {
  const card = state.card!;
  mkdirSync(card, { recursive: true });
  let was: J = {};
  try {
    was = JSON.parse(readFileSync(join(card, CARD_FILE), 'utf8'));
  } catch {
    // no card yet, or one that is not JSON: written anew
  }
  const { status: _s, sells: _sells, ...rest } = was && typeof was === 'object' && !Array.isArray(was) ? was : ({} as J); // eslint-disable-line @typescript-eslint/no-unused-vars
  const kept = Array.isArray(rest.offers) ? rest.offers.filter((o: J) => o?.id !== offerId) : [];
  const next = { ...rest, type: 'crow-agent', name: rest.name ?? state.name, offers: [...kept, { id: offerId, pricing: { kind: 'quoted', quote: `${base}quote`, defaults: `${base}defaults` } }], health: `${base}health`, configSha256, testTokensOnly: true };
  const file = join(card, CARD_FILE);
  writeWhole(file, `${JSON.stringify(next, null, 2)}\n`, 0o644);
  return file;
}

/** `cloudflare` and `cloudflare --key`. */
export async function cloudflare(c: Call, tool: Tool = npxWrangler(join(c.folder, CF_DIR))): Promise<number> {
  const state = readState(c.folder) as WithCloudflare | undefined;
  if (!state || !state.payout || !state.address) {
    c.say({ step: 'cloudflare', ok: false, detail: `${c.folder} has no finished ${FILES.state}: run the seller command first. Nothing was sent.` });
    return 1;
  }
  const set = accountVariableSet();
  if (set) {
    c.say({ step: 'cloudflare', ok: false, detail: `${set} is set in the environment. It chooses a Cloudflare account, carries its credential, or changes where Wrangler sends or logs its requests, without a word on the command line. Run the command again without it, for example with: env -u ${set} node setup.mjs cloudflare ... Nothing was sent.` });
    return 1;
  }
  return c.flags.has('--key') ? setKey(c, state, tool) : prepare(c, state);
}

async function prepare(c: Call, state: WithCloudflare): Promise<number> {
  const was = state.cloudflare;
  const flags = c.flags;
  if (flags.has('--quote-credential') && flags.has('--open')) throw new Error('give --quote-credential or --open, not both. Nothing was written');
  const config = flags.get('--config') !== undefined ? resolve(flags.get('--config')!) : was?.config;
  const account = flags.get('--account') ?? was?.account;
  const at = flags.get('--at') ?? was?.at;
  const access = flags.has('--quote-credential') ? 'credential' : flags.has('--open') ? 'open' : was?.access;
  const perDayText = flags.get('--quotes-per-day') ?? (was ? String(was.quotesPerDay) : undefined);
  const missing = [
    ...(config === undefined ? ['--config'] : []),
    ...(account === undefined ? ['--account'] : []),
    ...(at === undefined ? ['--at'] : []),
    ...(access === undefined ? ['--quote-credential'] : []),
    ...(perDayText === undefined ? ['--quotes-per-day'] : []),
  ];
  if (missing.length) {
    c.say({ step: 'cloudflare', ok: false, exit: 3, missing: missing.map((flag) => ({ flag, question: QUESTIONS[flag] })), next: 'Ask the person each question, then run the same command again with each flag. Nothing was written or sent.' });
    return 3;
  }
  if (!/^[0-9a-f]{32}$/.test(account!)) throw new Error('--account takes the account ID: 32 lowercase hex characters, as wrangler whoami lists it. Nothing was written');
  const perDay = Number(perDayText);
  if (!Number.isSafeInteger(perDay) || perDay < 1) throw new Error('--quotes-per-day takes a whole number of 1 or more. Nothing was written');
  const where = addressOf(at!, c.testWorld);
  if (was?.keyStartedAt !== undefined && !was.leftAt && (was.account !== account || was.name !== where.name)) {
    throw new Error(`this folder's Worker is ${was.name} on account ${was.account}, and its key is set there: run leave first to move it. Nothing was written`);
  }
  const offerId = flags.get('--offer-id') ?? was?.offerId ?? state.name;
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(offerId)) throw new Error("--offer-id takes 1 to 80 letters, digits, dots, hyphens and underscores: the card's offer ID. Nothing was written");
  const made = bundleFrom(config!, { name: state.name, offerId, owner: state.address!, payout: state.payout!.address, access: access as 'credential' | 'open', quotesPerDay: perDay, keyFile: join(c.folder, FILES.key) });
  const worker = await workerBytes(c);

  // The deploy folder: each file written whole, and only when its bytes change.
  const dir = join(c.folder, CF_DIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const files: Array<[string, string | Buffer]> = [
    [CF_FILES.worker, worker],
    [CF_FILES.bundle, `${JSON.stringify(made.bundle, null, 2)}\n`],
    [CF_FILES.config, `${JSON.stringify(wranglerConfigFor({ ...where, account: account!, operators: c.operators }), null, 2)}\n`],
  ];
  const changed: string[] = [];
  for (const [name, bytes] of files) {
    const path = join(dir, name);
    if (existsSync(path) && Buffer.compare(readFileSync(path), Buffer.from(bytes)) === 0) continue;
    writeWhole(path, bytes, 0o600);
    changed.push(name);
  }
  state.cloudflare = { ...(was?.leftAt ? {} : was), config: config!, account: account!, at: where.host, name: where.name, workersDev: where.workersDev, access: access as 'credential' | 'open', quotesPerDay: perDay, offerId, preparedAt: new Date().toISOString() };
  if (was?.leftAt) delete state.cloudflare.leftAt;
  writeState(c.folder, state);

  const secrets = made.credentialVars.filter((v) => v !== QUOTE_ENV);
  c.say({
    step: 'cloudflare', ok: true, dir, written: changed, address: where.url, worker: where.name, account: account!,
    ...(made.dropped.length ? { dropped: made.dropped.map((k) => `${k}: the Worker keeps its journal in its Durable Object and opens no port`) } : {}),
    quotes: access === 'open'
      ? `Open: anyone who reaches ${where.url}quote may ask. Each quote asks your API for a price and spends one of the Worker's faucet grants, so one caller can use them up, and each funded deal starts a job at your API, paid with test tokens. At most ${perDay} offers a UTC day over all callers, counted in the Worker's storage.`
      : `Credential: a buyer sends Authorization: Bearer <credential>. You choose the credentials and hand each to a buyer yourself, never through this chat. At most ${perDay} offers a UTC day over all callers, counted in the Worker's storage.`,
    binding: where.workersDev
      ? `A workers.dev address proves a Cloudflare account, not your domain. A buyer that starts from the card on your own site has your domain's word for the address: cloudflare --key writes its quote entry into ${join(state.card!, CARD_FILE)} once the deploy shows the address, and you publish that file there, beside the page.`
      : `TLS at ${where.host} binds the quote address to your domain.`,
    sent: 'nothing to the account: the person runs the login and the deploy.',
    next: [
      `The person installs the pinned Wrangler once, if it is not installed: ${WRANGLER_INSTALL}`,
      `The person, in a terminal: ${WRANGLER_LINE} login`,
      `The person: cd ${dir} && WRANGLER_OUTPUT_FILE_PATH=${DEPLOY_OUTPUT} ${WRANGLER_LINE} deploy --config ${CF_FILES.config}`,
      `Then: node ~/.crow/setup.mjs cloudflare --key${c.folder.endsWith('/.crow/seller') ? '' : ` --folder ${c.folder}`}`,
      ...secrets.map((v) => `The person types the value of ${v} at Wrangler's hidden prompt: cd ${dir} && ${WRANGLER_LINE} secret put ${v} --config ${CF_FILES.config}`),
      ...(access === 'credential' ? [`The person types the quote credentials, comma-separated, at Wrangler's hidden prompt: cd ${dir} && ${WRANGLER_LINE} secret put ${QUOTE_ENV} --config ${CF_FILES.config}`] : []),
      `Then: node ~/.crow/setup.mjs check --published ${where.url}`,
      `When an assistant shares this machine: ${WRANGLER_LINE} logout`,
    ],
  });
  return 0;
}

async function setKey(c: Call, state: WithCloudflare, tool: Tool): Promise<number> {
  const rec = state.cloudflare;
  const cfg = join(c.folder, CF_DIR, CF_FILES.config);
  if (!rec || rec.leftAt || !existsSync(cfg)) {
    c.say({ step: 'cloudflare-key', ok: false, detail: 'this folder has no prepared Worker: run cloudflare first. Nothing was sent.' });
    return 1;
  }
  // The deploy's own record of where it put the Worker: the address the person typed must be one of its targets.
  const deployed = deployedAt(join(c.folder, CF_DIR, DEPLOY_OUTPUT), rec);
  if (deployed) {
    c.say({ step: 'cloudflare-key', ok: false, detail: `${deployed} The person deploys with: cd ${dirname(cfg)} && WRANGLER_OUTPUT_FILE_PATH=${DEPLOY_OUTPUT} ${WRANGLER_LINE} deploy --config ${CF_FILES.config}. Nothing was set.` });
    return 1;
  }
  // Check before create: the account's secret store, by name only (Wrangler shows no value).
  const list = await tool(['secret', 'list', '--config', cfg, '--format', 'json']);
  if (list.code !== 0) {
    c.say({ step: 'cloudflare-key', ok: false, detail: `${WRANGLER_LINE} secret list exited with ${list.code}: ${plain(list.stderr, 300)}. The person installs the pinned Wrangler if it is missing (${WRANGLER_INSTALL}), logs in (${WRANGLER_LINE} login) and deploys first. Nothing was set.` });
    return 1;
  }
  let names: string[];
  try {
    const parsed = JSON.parse(list.stdout) as Array<{ name?: unknown }>;
    names = parsed.map((s) => String(s?.name));
  } catch {
    c.say({ step: 'cloudflare-key', ok: false, detail: `${WRANGLER_LINE} secret list did not answer JSON. Nothing was set.` });
    return 1;
  }
  const missing = (bundleVars(c.folder) ?? []).filter((v) => !names.includes(v));
  const remaining = missing.map((v) => `The person types the value of ${v} at Wrangler's hidden prompt: cd ${dirname(cfg)} && ${WRANGLER_LINE} secret put ${v} --config ${CF_FILES.config}`);
  if (names.includes('HOLDBACK_KEY')) {
    if (rec.keyStartedAt === undefined) {
      c.say({ step: 'cloudflare-key', ok: false, detail: `The Worker ${rec.name} already has a HOLDBACK_KEY that this folder did not set: it is another program's Worker, or another folder's. Choose another address with cloudflare --at. Nothing was set.` });
      return 1;
    }
    rec.keySetAt ??= new Date().toISOString();
    writeState(c.folder, state);
    const card = cardOf(c.folder, state, rec);
    c.say({ step: 'cloudflare-key', ok: true, set: false, card, detail: `The Worker's key is set already; no second key was made.`, next: [...remaining, `Then: node ~/.crow/setup.mjs check --published https://${rec.at}/`] });
    return 0;
  }
  const strange = names.filter((n) => n !== 'HOLDBACK_KEY' && !(bundleVars(c.folder) ?? []).includes(n));
  if (strange.length) {
    c.say({ step: 'cloudflare-key', ok: false, detail: `The Worker ${rec.name} holds secrets this folder's bundle does not name (${strange.slice(0, 5).map((n) => plain(n, 40)).join(', ')}): it is another program's Worker, which the deploy replaced. Choose another address with cloudflare --at. Nothing was set.` });
    return 1;
  }
  const key = generatePrivateKey();
  c.hide(key);
  c.hide(holdingKeyOf(key));
  rec.keyStartedAt = new Date().toISOString();
  // The key's address is public: `check --published` asks the Worker to sign with the key and checks it against this.
  rec.workerAddress = privateKeyToAccount(key).address.toLowerCase();
  writeState(c.folder, state); // first: a stop after the store took the key leaves a folder that knows the key is its own
  const put = await tool(['secret', 'bulk', '--config', cfg], { input: JSON.stringify({ HOLDBACK_KEY: key }) });
  if (put.code !== 0) {
    c.say({ step: 'cloudflare-key', ok: false, detail: `${WRANGLER_LINE} secret bulk exited with ${put.code}: ${plain(put.stderr, 300)}. Run the same command again: it checks the store first.` });
    return 1;
  }
  rec.keySetAt = new Date().toISOString();
  writeState(c.folder, state);
  const card = cardOf(c.folder, state, rec);
  c.say({
    step: 'cloudflare-key', ok: true, set: true, card,
    detail: "The Worker's own signing key is in the account's secret store, piped on standard input. Nobody is shown it again. Whoever holds the account's login can replace it, or deploy code that reads it. This folder never held it.",
    next: [...remaining, `Then: node ~/.crow/setup.mjs check --published https://${rec.at}/`, `When an assistant shares this machine: ${WRANGLER_LINE} logout`],
  });
  return 0;
}

/**
 * Why the deploy's output does not show the Worker at the address the person typed, or '' when it does. The deploy
 * writes one JSON line per event to WRANGLER_OUTPUT_FILE_PATH; a `deploy` line names the Worker and its targets, the
 * workers.dev address as https://<host> and a custom domain as "<host> (custom domain)".
 */
export function deployedAt(file: string, rec: CloudflareRecord): string {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return `The deploy's output, ${file}, is not there: run the deploy with WRANGLER_OUTPUT_FILE_PATH, so the address it used can be checked before the key is made.`;
  }
  const hosts = new Set<string>();
  for (const line of text.split('\n')) {
    let e: { type?: unknown; worker_name?: unknown; targets?: unknown };
    try {
      e = JSON.parse(line) as typeof e;
    } catch {
      continue;
    }
    if (e?.type !== 'deploy' || e.worker_name !== rec.name || !Array.isArray(e.targets)) continue;
    for (const t of e.targets) hosts.add(String(t).trim().split(/\s/)[0]!.replace(/^https:\/\//, '').replace(/\/$/, '').toLowerCase());
  }
  if (hosts.has(rec.at)) return '';
  return hosts.size === 0 ? `The deploy's output names no deploy of the Worker ${rec.name}.` : `The deploy put the Worker ${rec.name} at ${[...hosts].slice(0, 3).map((h) => plain(h, 120)).join(', ')}, not at ${rec.at}, the address this folder was given: check the account's workers.dev subdomain, then run cloudflare --at with the address the deploy shows.`;
}

/** The card's quote entry, written once the deploy shows the address: from the folder's bundle, whose SHA-256 the Worker shows. */
function cardOf(folder: string, state: State, rec: CloudflareRecord): string {
  const b = JSON.parse(readFileSync(join(folder, CF_DIR, CF_FILES.bundle), 'utf8')) as { seller: { slug: string; card: unknown; config: unknown; files: unknown } };
  return writeCard(state, rec.offerId, `https://${rec.at}/`, sellerSha256(b.seller));
}

/** The credential variables the prepared bundle names, or undefined when there is no bundle. */
function bundleVars(folder: string): string[] | undefined {
  try {
    const b = JSON.parse(readFileSync(join(folder, CF_DIR, CF_FILES.bundle), 'utf8')) as { seller: { slug: string; config: J; files: Record<string, string> } };
    return checkSeller(b.seller);
  } catch {
    return undefined;
  }
}
