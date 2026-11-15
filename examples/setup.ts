// Setup: one party's Crow folder on its own machine, and its first deal (T-472). site/build.mjs bundles this file, and
// the tools it imports unchanged, into site/setup.mjs: one pinned file that runs with Node and nothing installed.
//
//   node setup.mjs seller --sample --payout <address or this-key>
//                               makes the folder: a signing key, the seller adapter's configuration, the sample's deal
//                               template and a draft card; then runs the check. It sends nothing. A missing answer
//                               prints one JSON object with each question and exits 3: it never prompts.
//   node setup.mjs check        the conformance check: one JSON line per check, exit 0 only when all pass. It sends nothing.
//   node setup.mjs first-deal --preview
//                               prints what first-deal will send, and to whom, and stops: no marker, nothing sent.
//   node setup.mjs first-deal   runs the check, prints the same preview, writes the marker that the first deal starts,
//                               then sells one sample job to Crow's test buyer through the seller adapter, in this
//                               process, follows the deal to its end and writes the deal record. These are the first
//                               requests that name the party to a Crow-run host. --again offers a new deal after one
//                               that ended without a release; it never continues the ended one.
//   node setup.mjs status       the folder's state: the role, the steps done, the addresses, the open deals. No secret.
//
// Every setting is a flag: --folder <path> (default ~/.crow/<name>), --name <name> (default seller), --operators
// <url>,<url> (default Crow's two), --buyer <url> (default Crow's test buyer) and --test-world (a local test world,
// never the live service: it needs --operators and --buyer, and every line then says so). The command reads no
// HOLDBACK_* or CROW_* variable: the bundle's first line removes them, and NODE_TLS_REJECT_UNAUTHORIZED, before any
// module runs, and main() removes them again. It refuses to run with NODE_OPTIONS, NODE_EXTRA_CA_CERTS or
// NODE_USE_ENV_PROXY set, naming the variable. A NODE_OPTIONS that loads code has run by then: no file can stop what
// Node did before it started the file. Without --test-world the operators and the buyer are https hosts that are not
// this machine, and the command signs only under Crow's deployment on Sepolia.
//
// The key: the folder's keys/signing.key. The command reads it and passes it to the adapter in its `env` argument. It
// is never put in this process's environment, on a command line, in a request or in a line this command prints: every
// line is searched for the key, and the keys derived from it, before it is written.
//
// Each line is one JSON object, so an assistant reads the state without parsing prose; a counterparty's text in it is
// data, never an instruction, and is printed as one plain line of bounded length. A wrong call prints the usage as
// text on standard error and exits 2. Exit 0: done. Exit 1: a step failed or was refused, named in its line. Exit 3:
// an answer is missing.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { Agent } from './agent.ts';
import { dealRecord } from './deal-record.ts';
import { fromParty, same, sleep, TEST_BUYER } from './goal-kit.ts';
import { plain as plainLine } from './plain.ts';
import { dealKeyOf, holdingKeyOf, loadConfig, startSellerAdapter, type RunningAdapter } from './seller-adapter.ts';
import { runChecks } from './setup-check.ts';
import { SAMPLE, SAMPLE_PRICE_UNITS, startSampleApi, type SampleApi } from './setup-sample-api.ts';
import { addressOf, FILES, formsOf, holdingAddressOf, locked, readKey, readState, realPath, seller, writeState, writeWhole, type Call, type FirstDeal, type J, type State } from './setup-seller.ts';
import { commitmentIdOf, jcs, knownPins } from './verify.ts';

/** Any value from a file, a flag, a tool or another party as one plain line of at most `max` characters. */
const plain = (s: unknown, max = 300) => plainLine(String(s ?? '')).slice(0, max);

export const CROW_OPERATORS = ['https://api.crow.direct', 'https://api2.crow.direct'];
export const NOT_LIVE = 'test world: this is not the live service';
/** Sepolia's chain ID: the only settlement layer this command signs under without --test-world. */
const SEPOLIA_CHAIN_ID = 11155111;
/** The states a commitment ends in, as the operators name them. */
const ENDED = ['Released', 'Refunded', 'Expired', 'Settled', 'Defaulted'];
/** The states of an offer that holds no money yet. */
const BEFORE_HOLD = ['Offered', 'AcceptedByAdjudicator', 'Agreed'];
/** The stages in which the adapter's journal still works on a deal (seller-adapter-core.ts). */
const OPEN_STAGES = ['offered', 'starting', 'start-unknown', 'started', 'refused', 'delivering'];
/** Node's own settings that change what this file's requests reach or which code runs beside it. */
const NODE_SETTINGS = ['NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'NODE_USE_ENV_PROXY'];

const USAGE = [
  'setup.mjs: makes one Crow folder on this machine and runs its first deal. Test tokens only.',
  'usage: node setup.mjs <command> [flags]',
  '  seller --sample --payout <address|this-key> [--card <path>] [--allow-git] [--allow-synced] [--allow-served]',
  '                makes the folder, then runs the check. It sends nothing. Exit 3: an answer is missing, named in one JSON object.',
  '  check         runs the conformance check: one JSON line per check, exit 0 only when all pass. It sends nothing.',
  '  first-deal [--preview] [--again] [--buyer <url>]',
  "                prints what it sends and to whom, then sells one sample job to Crow's test buyer and follows it to its end.",
  '                --preview prints that and stops. --again offers a new deal after one that ended without a release.',
  "  status        prints the folder's state. It reads no key and sends nothing.",
  '  --folder      the party\'s folder. Default: ~/.crow/<name>.',
  '  --name        the party\'s name, in the folder\'s default path and on its card. Default: seller.',
  `  --operators   two or more operator URLs, comma-separated. Default: ${CROW_OPERATORS.join(',')}.`,
  "  --buyer       the test buyer's URL. Default: " + TEST_BUYER + '.',
  '  --test-world  a local test world, never the live service. It needs --operators, and first-deal needs --buyer; every line then says so.',
].join('\n');

/** Removes every HOLDBACK_* and CROW_* variable from `env`, and the switch that turns certificate checks off: the command takes its settings from flags only. */
export function clearAmbient(env: Record<string, string | undefined> = process.env): void {
  for (const name of Object.keys(env)) if (/^(HOLDBACK|CROW)_/.test(name) || name === 'NODE_TLS_REJECT_UNAUTHORIZED') delete env[name];
}

/** A wrong call: the usage follows on standard error, and the command exits 2. */
class WrongCall extends Error {}

const COMMON = { values: ['--folder', '--name', '--operators'], switches: ['--test-world'] };
const OWN: Record<string, { values: string[]; switches: string[] }> = {
  seller: { values: ['--payout', '--card'], switches: ['--sample', '--allow-git', '--allow-synced', '--allow-served'] },
  check: { values: [], switches: [] },
  'first-deal': { values: ['--buyer'], switches: ['--again', '--preview'] },
  status: { values: [], switches: [] },
};
function flagsOf(command: string, args: readonly string[]): Map<string, string> {
  const values = [...COMMON.values, ...OWN[command]!.values], switches = [...COMMON.switches, ...OWN[command]!.switches];
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (flags.has(a)) throw new WrongCall(`${plain(a, 40)} is given twice`);
    if (switches.includes(a)) flags.set(a, 'yes');
    else if (values.includes(a) && args[i + 1] !== undefined && !args[i + 1]!.startsWith('--')) flags.set(a, args[++i]!);
    else throw new WrongCall(values.includes(a) ? `${a} needs a value` : `${plain(a, 40)} is not an option of ${command}`);
  }
  return flags;
}

const isHttp = (u: string): boolean => {
  try {
    return ['http:', 'https:'].includes(new URL(u).protocol);
  } catch {
    return false;
  }
};
/** Whether `u` names this machine: localhost, a name under it, or a loopback or unspecified address. */
const isLocal = (u: string): boolean => {
  const host = new URL(u).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return host === 'localhost' || host.endsWith('.localhost') || /^127\./.test(host) || host === '::1' || host === '0.0.0.0' || host === '::' || /^::ffff:127\./.test(host);
};
/** Why `u` is not a host the live service's commands may call, or '' when it is: https, and not this machine. */
const notLiveHost = (u: string): string => (new URL(u).protocol !== 'https:' ? 'is not https' : isLocal(u) ? 'is this machine' : '');
function operatorsOf(text: string | undefined, testWorld: boolean): string[] {
  if (text === undefined) {
    if (testWorld) throw new WrongCall("--test-world needs --operators: the test world's own operator URLs. Nothing was sent");
    return CROW_OPERATORS;
  }
  const list = text.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  if (list.length < 2 || !list.every(isHttp)) throw new WrongCall('--operators takes two or more http or https URLs, comma-separated');
  // Two operators are a check on one another only when they are two hosts.
  const hosts = list.map((u) => new URL(u).host.toLowerCase());
  const twice = hosts.find((h, i) => hosts.indexOf(h) !== i);
  if (twice !== undefined) throw new WrongCall(`--operators names ${plain(twice, 80)} twice: each operator is a host of its own. Nothing was sent`);
  if (!testWorld) for (const u of list) if (notLiveHost(u)) throw new WrongCall(`--operators: ${plain(u, 120)} ${notLiveHost(u)}. Without --test-world an operator is an https host that is not this machine. Nothing was sent`);
  return list;
}

function status(c: Call): number {
  const state = readState(c.folder);
  if (!state) {
    c.say({ step: 'status', folder: c.folder, exists: existsSync(c.folder) });
    return 0;
  }
  // The adapter's journal names each deal and its stage. `status` opens no file under keys/.
  let open: Array<{ commitmentId: string; stage: string }> = [];
  try {
    const journal = JSON.parse(readFileSync(join(c.folder, FILES.journal), 'utf8')) as { deals?: Record<string, { stage?: string }> };
    open = Object.entries(journal.deals ?? {}).filter(([, d]) => OPEN_STAGES.includes(String(d.stage))).map(([id, d]) => ({ commitmentId: plain(id, 80), stage: plain(d.stage, 40) }));
  } catch {
    // no journal yet: no deal has started
  }
  const deal = (d: FirstDeal | undefined) => (d === undefined ? null : Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'journalBefore').map(([k, v]) => [k, plain(v, 300)])));
  c.say({ step: 'status', folder: c.folder, exists: true, role: plain(state.role, 20), sells: plain(state.sells, 20), name: plain(state.name, 40), steps: Object.keys(state.steps).map((s) => plain(s, 40)), address: state.address === undefined ? null : plain(state.address, 42), payout: state.payout ? { address: plain(state.payout.address, 42), thisKey: state.payout.thisKey === true } : null, card: state.card === undefined ? null : plain(state.card, 300), firstDeal: deal(state.firstDeal), ended: (state.ended ?? []).map(deal), openDeals: open });
  return 0;
}

async function check(c: Call): Promise<number> {
  const results = await runChecks(c.folder);
  for (const r of results) c.say({ step: 'check', ...r });
  return results.every((r) => r.ok) ? 0 : 1;
}

/** A party's URL as one plain line: parsed, written back by the URL parser, and at most 200 characters. */
const urlLine = (u: string): string => plain(new URL(u).href, 200);

/** Crow's test buyer's card, checked: a crow-buyer card with an address, an encryption key and an intake on its own origin. */
async function buyerCard(url: string): Promise<{ buyer: string; encryptionPublicKey: string; intake: string }> {
  const card = (await fromParty(`${url}/agent.json`)).body;
  if (card?.type !== 'crow-buyer' || !/^0x[0-9a-fA-F]{40}$/.test(card.buyer ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(card.buyerEncryptionPublicKey ?? '')) throw new Error(`${urlLine(url)}/agent.json is not a crow-buyer card with an address and an encryption key`);
  if (typeof card.intake?.api !== 'string' || !isHttp(card.intake.api) || new URL(card.intake.api).origin !== new URL(url).origin) throw new Error(`the card's intake is not on ${new URL(url).origin}`);
  // Only what was checked leaves this function: an address, a key of 43 characters, and the intake as the URL parser writes it.
  return { buyer: String(card.buyer).toLowerCase(), encryptionPublicKey: card.buyerEncryptionPublicKey, intake: new URL(card.intake.api).href };
}

/** What `first-deal` sends, and to whom: one line, printed before anything is sent, and alone by `first-deal --preview`. */
function previewLine(c: Call, state: State, key: Hex, buyerUrl: string): Record<string, unknown> {
  const payout = state.payout!;
  return {
    step: 'preview',
    sends: [
      { to: c.operators, what: 'reads only, as the deal goes: the discovery document, the club, the adjudicators, the settlement time and the deal by its commitment ID.' },
      { to: c.operators[0], what: `the faucet grant for this deal: the deal's fresh address, and ${holdingAddressOf(key)}, the one holding address every grant of this folder names.` },
      { to: c.operators, what: `the signed offer. The whole terms become public: the description, every check, the price, the deadlines, the adjudicators, the buyer's address, the deal's fresh address and the payout address ${payout.address}.` },
      { to: urlLine(buyerUrl), what: 'a read of its card, then the commitment ID.' },
      { to: c.operators, what: "the delivery: the encrypted work and its sealed keys. Its size, its time and its SHA-256 become public; its content does not." },
    ],
    payout: payout.thisKey
      ? `The payout address is this folder's standing address ${payout.address}. Every deal names it in its public terms, which links this folder's deals to one another, and its key is on this machine.`
      : `The payout address ${payout.address} is in the public terms of every deal, which links this folder's deals to one another.`,
    money: 'Test tokens only: nothing here is real money.',
  };
}

async function firstDeal(c: Call): Promise<number> {
  const state = readState(c.folder);
  if (!state || !state.payout || !state.address) {
    c.say({ step: 'first-deal', ok: false, detail: `${c.folder} has no finished ${FILES.state}: run the seller command first. Nothing was sent.` });
    return 1;
  }
  const again = c.flags.has('--again');
  // The buyer is the one the person names, or the default. A state file names it only for a deal this folder itself
  // offered and has not ended: that deal is continued with the buyer it was offered to.
  const continued = !again && state.firstDeal?.commitmentId !== undefined && state.firstDeal.state === undefined ? state.firstDeal : undefined;
  const given = c.flags.get('--buyer')?.replace(/\/+$/, '');
  if (given !== undefined && !isHttp(given)) throw new WrongCall("--buyer takes the test buyer's URL, such as https://crow.direct/agents/test-buyer");
  if (continued && (continued.buyer === undefined || !isHttp(continued.buyer))) throw new Error(`${FILES.state} names no buyer for the deal it holds. Run first-deal --again to offer a new one. Nothing was sent`);
  if (continued && given !== undefined && new URL(given).href !== new URL(continued.buyer!).href) throw new WrongCall(`this folder's open deal was offered to ${urlLine(continued.buyer!)}: run first-deal without --buyer to continue it, or with --again to offer a new one. Nothing was sent`);
  const buyerUrl = continued?.buyer ?? given ?? (c.testWorld ? undefined : TEST_BUYER);
  if (buyerUrl === undefined) throw new WrongCall("--test-world needs --buyer: the test world's own test buyer. Nothing was sent");
  if (!c.testWorld && notLiveHost(buyerUrl)) throw new WrongCall(`--buyer: ${urlLine(buyerUrl)} ${notLiveHost(buyerUrl)}. Without --test-world the buyer is an https host that is not this machine. Nothing was sent`);

  if (c.flags.has('--preview')) {
    c.say({ ...previewLine(c, state, readKey(c.folder), buyerUrl), sent: 'nothing: this is the preview only. Run first-deal without --preview to send it.' });
    return 0;
  }
  return locked(c.folder, 0, () => runFirstDeal(c, state, buyerUrl, again));
}

/**
 * The deal record of a released first deal: read from every operator with GET requests only, written under deals/,
 * and the last line of `first-deal`. The operators may show the release a moment before its payment: the record is
 * read again, for up to a minute on the live service, until it names who was paid.
 */
async function writeRecord(c: Call, state: State, id: Hex, started: number): Promise<number> {
  const payout = state.payout!;
  let record = await dealRecord(id, { operators: c.operators, party: 'seller' });
  const count = (ok: boolean | null) => record.checks.filter((x) => x.ok === ok).length;
  for (let i = 0; i < 10 && (record.row.paidTo === null || count(false) > 0 || record.disagreements.length > 0); i++) {
    await sleep(c.testWorld ? 300 : 6000);
    record = await dealRecord(id, { operators: c.operators, party: 'seller' });
  }
  mkdirSync(join(c.folder, FILES.deals), { recursive: true });
  const file = join(c.folder, FILES.deals, `${id}.json`);
  writeWhole(file, `${JSON.stringify(record, null, 2)}\n`);
  const sound = count(false) === 0 && record.disagreements.length === 0;
  // Who was paid is what the record says, read from the operators, not what this folder's state expects.
  const paidTo = record.row.paidTo;
  const asAnswered = paidTo === payout.address;
  state.firstDeal = { ...state.firstDeal!, ...(sound && asAnswered ? { record: file } : {}) };
  writeState(c.folder, state);
  c.say({ step: 'record', ok: sound, file, checks: { passed: count(true), failed: count(false), notRun: count(null) }, operatorsAgree: record.disagreements.length === 0 });
  c.say({ step: 'first-deal', ok: sound && asAnswered, state: 'Released', commitmentId: id, buyer: plain(record.row.buyer, 42), paidTo: paidTo === null ? null : plain(paidTo, 42), ...(asAnswered ? {} : { detail: paidTo === null ? 'The deal is released, and the operators do not show its payment yet. Run the same command again to read the record anew.' : `The deal paid ${plain(paidTo, 42)}, not the payout address ${payout.address} this folder was given.` }), price: record.row.price, transactions: (record.row.transactions ?? []).map((t) => plain(t, 200)), record: file, seconds: Math.round((Date.now() - started) / 1000) });
  return sound && asAnswered ? 0 : 1;
}

async function runFirstDeal(c: Call, state: State, buyerUrl: string, again: boolean): Promise<number> {
  const started = Date.now();
  const save = (change: Partial<FirstDeal>) => {
    state.firstDeal = { startedAt: new Date().toISOString(), ...state.firstDeal, ...change };
    writeState(c.folder, state);
  };
  /** The first deal ended without a release: the state keeps how, and the line says what to run. */
  const giveUp = (how: string, detail: string, extra: Record<string, unknown> = {}): number => {
    save({ state: how, detail: plain(detail, 600), endedAt: new Date().toISOString() });
    c.say({ step: 'first-deal', ok: false, state: how, commitmentId: state.firstDeal?.commitmentId ?? null, ...extra, detail: `${plain(detail, 600)} Run first-deal --again to offer a new one.` });
    return 1;
  };
  const before = state.firstDeal;
  if (before?.state === 'Released') {
    // A release whose record was not written whole yet: the record is read again, with GET requests only.
    if (before.record === undefined && /^0x[0-9a-f]{64}$/.test(String(before.commitmentId))) return writeRecord(c, state, before.commitmentId as Hex, started);
    c.say({ step: 'first-deal', ok: true, state: 'Released', commitmentId: before.commitmentId, record: before.record ?? null, detail: 'The first deal is done. Nothing was sent now.' });
    return 0;
  }
  if (before !== undefined && (before.state !== undefined || again)) {
    if (!again) {
      c.say({ step: 'first-deal', ok: false, state: plain(before.state, 40), commitmentId: before.commitmentId ?? null, detail: `The first deal ended without a release${before.detail ? `: ${plain(before.detail, 400)}` : '.'} Run first-deal --again to offer a new one. Nothing was sent now.` });
      return 1;
    }
    // --again: the deal that did not end in a release is set aside, by its commitment ID, and never continued.
    state.ended = [...(state.ended ?? []), { ...before, state: before.state ?? 'SetAside', endedAt: before.endedAt ?? new Date().toISOString() }];
    delete state.firstDeal;
    writeState(c.folder, state);
  }

  // 1. The check, first: a setup that fails it sends nothing.
  const results = await runChecks(c.folder);
  const failed = results.filter((r) => !r.ok);
  for (const r of failed) c.say({ step: 'check', ...r });
  if (failed.length) {
    c.say({ step: 'first-deal', ok: false, detail: `The check fails (${failed.map((r) => r.check).join(', ')}): fix it, then run check. Nothing was sent.` });
    return 1;
  }
  c.say({ step: 'check', ok: true, checks: results.map((r) => r.check) });

  const key = readKey(c.folder);
  const payout = state.payout!;
  // 2. What the command is about to send, and to whom, before it sends anything.
  c.say(previewLine(c, state, key, buyerUrl));

  // 3. The marker: from here on the command sends requests that name this folder's addresses.
  const marker = join(c.folder, FILES.marker);
  if (!existsSync(marker)) writeFileSync(marker, `${JSON.stringify({ startedAt: new Date().toISOString(), operators: c.operators, buyer: buyerUrl })}\n`);
  c.note({ step: 'marker', file: marker, detail: 'The first deal starts: the next requests are the first that name this folder to the operators and the test buyer.' });
  save({ buyer: buyerUrl });

  let api: SampleApi | undefined;
  let adapter: RunningAdapter | undefined;
  try {
    // 4. The settlement layer, as every operator serves it, against the ones this file pins. Never the operator's word.
    const reads = () => new Agent(c.operators, generatePrivateKey(), crypto.getRandomValues(new Uint8Array(32)));
    const found = await reads().trusted('/.well-known/holdback.json', (x: J) => ({ domain: x.domain, token: x.demo?.token?.id }));
    const pin = knownPins().find((p) => same(p.domain, found.domain));
    const sepolia = pin !== undefined && pin.domain.chainId === SEPOLIA_CHAIN_ID && pin.chain !== undefined;
    if (!c.testWorld && !sepolia) throw new Error(`these operators serve the EIP-712 domain ${plain(jcs(found.domain), 300)}, not Crow's deployment on Sepolia (chain ${SEPOLIA_CHAIN_ID}). Nothing was signed or offered`);
    if (c.testWorld && (pin === undefined || sepolia)) throw new Error(`--test-world takes a local test world, and these operators serve the EIP-712 domain ${plain(jcs(found.domain), 300)}. Nothing was signed or offered`);
    if (found.token !== pin!.token.id) throw new Error(`these operators run no ${pin!.token.symbol} demo. Nothing was signed or offered`);
    const reader = new Agent(c.operators, generatePrivateKey(), crypto.getRandomValues(new Uint8Array(32)), pin!.domain, pin!.chain);
    c.say({ step: 'discovery', ok: true, chainId: pin!.domain.chainId, token: pin!.token.symbol });

    // 5. The sample API on the loopback address, priced in the settlement layer's token, and the adapter beside it.
    //    The adapter takes a quote only with a credential made for this run, so no other program on this machine can
    //    have it sign an offer while it listens.
    const credential = randomBytes(24).toString('base64url');
    c.hide(credential, true);
    const config = { ...loadConfig(join(c.folder, FILES.configuration)), journal: join(c.folder, FILES.journal), quoteAuth: { kind: 'bearer' as const, env: 'CROW_SETUP_QUOTE' }, log: (line: string) => c.note({ step: 'adapter', log: line }) };
    api = await startSampleApi(pin!.token.id, Number(new URL(String(config.sellerApi.quote)).port)); // the check held the address to the sample's
    // The key goes to the adapter in this object only: not into process.env, a command line or a file.
    adapter = await startSellerAdapter(config, { HOLDBACK_KEY: key, HOLDBACK_OPERATORS: c.operators.join(','), CROW_SETUP_QUOTE: credential });
    c.say({ step: 'adapter', ok: true, quote: `${adapter.url}/quote`, sells: state.sells });

    // 6. The offer: one for the first deal. The folder continues a deal only by its own commitment ID: the one in its
    //    state, or the one deal its journal gained since the offer was asked for (a run that stopped in between).
    const card = await buyerCard(buyerUrl);
    const journal = () => adapter!.deals();
    const setAside = new Set((state.ended ?? []).map((e) => e.commitmentId));
    let id = state.firstDeal?.commitmentId as Hex | undefined;
    if (id === undefined && state.firstDeal?.journalBefore !== undefined) {
      const known = new Set(state.firstDeal.journalBefore);
      const gained = journal().filter((d) => !known.has(d.id) && !setAside.has(d.id) && OPEN_STAGES.includes(d.stage));
      if (gained.length === 1) id = gained[0]!.id;
    }
    const resumed = id !== undefined;
    if (id === undefined) {
      save({ journalBefore: journal().map((d) => d.id) });
      const answer = await fetch(`${adapter.url}/quote`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: JSON.stringify({ buyer: card.buyer, buyerEncryptionPublicKey: card.encryptionPublicKey, scope: SAMPLE.firstScope }), signal: AbortSignal.timeout(300_000) });
      const quote = (await answer.json().catch(() => null)) as J;
      if (answer.status !== 200 || !/^0x[0-9a-f]{64}$/.test(String(quote?.commitmentId))) throw new Error(`the adapter made no offer (status ${answer.status}): ${plain(quote?.detail ?? quote?.type, 400)}`);
      id = quote.commitmentId as Hex;
      save({ commitmentId: id });
      c.say({ step: 'offer', ok: true, commitmentId: id, price: { token: plain(quote.price?.token, 80), amount: plain(quote.price?.amount, 80) }, expiresAt: plain(quote.expiresAt, 40), buyer: card.buyer });
    } else {
      save({ commitmentId: id });
      c.say({ step: 'offer', ok: true, commitmentId: id, resumed: true, detail: 'This deal was offered by an earlier run: no second offer is made.' });
    }
    const deal = journal().find((d) => d.id === id);
    if (/^0x[0-9a-f]{64}$/.test(String(deal?.terms?.nonce))) c.hide(dealKeyOf(key, deal!.terms.nonce as Hex));

    // 7. Where the deal stands on the operators. A deal they do not know, one that ended, or one this folder's journal
    //    no longer works on is not continued: the state says how it ended.
    //    The operators keep an offer nobody funded as Offered: the command reads its end from the offer's own windows
    //    and settlement time.
    let clock: { settlement: number; readAt: number } | undefined;
    const standing = async (): Promise<{ states: string[]; ended: string | undefined }> => {
      const states = await Promise.all(reader.sources().map((op) => reader.call('GET', `/v1/commitments/${id}`, undefined, op).then((s: J) => String(s.escrowState))));
      if (states.every((s) => s === states[0]) && ENDED.includes(states[0]!)) return { states, ended: states[0]! };
      const timing = deal?.terms?.timing;
      if (timing && states.every((s) => BEFORE_HOLD.includes(s))) {
        // Settlement time, read again at most every 30 s on the live service and counted on from the last reading.
        if (clock === undefined || c.testWorld || Date.now() - clock.readAt > 30_000) clock = { settlement: await reader.settlementNow(), readAt: Date.now() };
        const time = clock.settlement + (Date.now() - clock.readAt);
        if (time > Date.parse(timing.fundBy) || (states.some((s) => s !== 'Agreed') && time > Date.parse(timing.offerExpiresAt))) return { states, ended: 'Expired' };
      }
      return { states, ended: undefined };
    };
    let now: string[], ended: string | undefined;
    try {
      ({ states: now, ended } = await standing());
    } catch (e) {
      if (!resumed) throw e;
      return giveUp('Unknown', `The operators do not serve the deal this folder recorded (${plain((e as Error).message, 200)}).`);
    }
    if (ended === undefined && (deal === undefined || (!OPEN_STAGES.includes(deal.stage) && deal.stage !== 'delivered'))) {
      return giveUp('SetAside', deal === undefined ? "This folder's journal does not hold the deal, so the adapter cannot deliver it." : `The adapter closed the deal${deal.note ? `: ${plain(deal.note, 300)}` : ''}.`);
    }

    if (ended === undefined && now.every((s) => ['Offered', 'AcceptedByAdjudicator'].includes(s))) {
      // 8. Before the commitment ID goes to the buyer: the terms every operator serves are the ones this folder meant
      //    to sign. The payout address is the person's answer, the seller is this deal's own key, the buyer is the card's.
      const served = await reader.trusted<J>(`/v1/commitments/${id}/terms`);
      const servedId = served.id;
      const terms = Object.fromEntries(Object.entries(served).filter(([k]) => k !== 'id' && k !== 'signatures')) as J;
      const lc = (v: unknown) => String(v).toLowerCase();
      const expected: Array<[string, unknown, unknown]> = [
        ['commitment ID', commitmentIdOf(terms), id], ['served ID', lc(servedId), id],
        ['payout address', lc(terms.sellerPayoutAddress), payout.address],
        ['seller', lc(terms.seller), addressOf(dealKeyOf(key, terms.nonce as Hex))],
        ['buyer', lc(terms.buyer), card.buyer], ['buyer payment address', lc(terms.buyerPaymentAddress), card.buyer], ['buyer encryption key', terms.buyerEncryptionPublicKey, card.encryptionPublicKey],
        ['price', jcs({ token: lc(terms.price?.token), amount: terms.price?.amount }), jcs({ token: lc(pin!.token.id), amount: SAMPLE_PRICE_UNITS })],
      ];
      const wrong = expected.find(([, got, want]) => got !== want);
      if (wrong) return giveUp('Withheld', `The signed offer's ${wrong[0]} is ${plain(wrong[1], 120)}, not ${plain(wrong[2], 120)}: the commitment ID was not sent to the buyer, and the offer expires by itself. Run check first.`);
      c.say({ step: 'terms', ok: true, payout: payout.address, seller: lc(terms.seller), buyer: card.buyer, detail: 'The offer every operator serves names the payout address you gave, this deal\'s own key as the seller, and the buyer\'s card.' });

      // 9. The commitment ID to the test buyer. One ID is one deal there: a second post of it changes nothing.
      const posted = await fetch(card.intake, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commitmentId: id }), signal: AbortSignal.timeout(30_000) });
      const taken = (await posted.json().catch(() => null)) as J;
      const why = `${plain(taken?.error ?? taken?.detail, 300)}${taken?.rule ? ` (rule ${plain(taken.rule, 60)})` : ''}`;
      if (posted.status === 422 || posted.status === 400 || posted.status === 409) return giveUp('RefusedByBuyer', `The test buyer refused the offer (status ${posted.status}): ${why}. The offer expires by itself.`);
      if (posted.status !== 202 && posted.status !== 200) throw new Error(`the test buyer answered ${posted.status}: ${why}${Number.isSafeInteger(taken?.retryAfterSec) ? `; it asks to wait ${taken.retryAfterSec} s` : ''}`);
      c.say({ step: 'post', ok: true, to: urlLine(card.intake), detail: 'The test buyer took the offer: it agrees and funds once the adjudicator accepts.' });
    }

    // 10. The adapter starts the job once every operator shows the hold, checks the result and delivers. Follow to the end.
    let end = ended;
    for (const stop = Date.now() + (c.testWorld ? 120_000 : 1_200_000); end === undefined; await sleep(c.testWorld ? 250 : 3000)) {
      ({ states: now, ended: end } = await standing());
      if (end === undefined && Date.now() > stop) throw new Error(`the deal is still ${now.map((s) => plain(s, 40)).join(' / ')} after ${c.testWorld ? 120 : 1200} s`);
    }
    await adapter.close(); // the step in progress finishes; the journal keeps the deal as delivered
    adapter = undefined;
    if (end !== 'Released') {
      return giveUp(plain(end, 40), end === 'Expired' ? 'The offer expired before the buyer funded it.' : end === 'Refunded' ? 'The deal ended in a refund: the buyer has its money back.' : `The deal ended ${plain(end, 40)}.`);
    }
    save({ state: 'Released', endedAt: new Date().toISOString() });
    return await writeRecord(c, state, id, started);
  } catch (e) {
    // "Run it again" is true only for a deal this folder recorded: without a commitment ID a rerun starts anew.
    const offered = state.firstDeal?.commitmentId !== undefined;
    c.say({ step: 'first-deal', ok: false, commitmentId: state.firstDeal?.commitmentId ?? null, detail: `${plain((e as Error).message, 900)}. ${offered ? 'Run the same command again: it continues this deal and makes no second offer.' : 'No offer was made. Fix what this line names, then run the same command again.'}` });
    return 1;
  } finally {
    await adapter?.close().catch(() => undefined);
    await api?.close().catch(() => undefined);
  }
}

const COMMANDS: Record<string, (c: Call) => number | Promise<number>> = {
  seller: async (c) => {
    const made = await seller(c);
    return made === 0 ? check(c) : made;
  },
  check,
  'first-deal': firstDeal,
  status,
};

/** Runs one command and returns its exit status. It never calls process.exit, so every line is written first. */
export async function main(argv: readonly string[]): Promise<number> {
  clearAmbient();
  const [command, ...rest] = argv;
  // The test-world notice goes on every line, the usage and a wrong call's included.
  const testWorld = rest.includes('--test-world') || command === '--test-world';
  const text = (s: string) => s.split('\n').map((l) => (testWorld ? `[${NOT_LIVE}] ${l}` : l)).join('\n');
  // No printed line may hold a key: each form of each key the command reads or derives is cut out before a line is written.
  const hidden = new Set<string>();
  const json = (line: Record<string, unknown>) => {
    let out = JSON.stringify(testWorld ? { ...line, notLive: NOT_LIVE } : line);
    for (const form of hidden) out = out.split(form).join('[a secret, removed]');
    return out;
  };
  const say: Call['say'] = (line) => console.log(json(line));
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18)) {
    console.error(text(`setup.mjs: this needs Node 22.18 or later; this is Node ${process.versions.node}. Nothing was made or sent.`));
    return 2;
  }
  // Node's own settings: each changes which code runs beside this file or where its requests go, and no flag shows it.
  const set = NODE_SETTINGS.find((name) => process.env[name]);
  if (set !== undefined) {
    console.error(text(`setup.mjs: ${set} is set in the environment. It changes how Node runs this file: it can load other code, trust another certificate authority, or send requests through a proxy. Run the command again without it, for example with: env -u ${set} node setup.mjs ... Nothing was made or sent.`));
    return 2;
  }
  if (command === '--help' || command === '-h') {
    console.log(text(USAGE));
    return 0;
  }
  try {
    if (command === undefined || !Object.hasOwn(COMMANDS, command)) throw new WrongCall(command === undefined ? 'name a command' : `${plain(command, 40)} is not a command of this file`);
    const flags = flagsOf(command, rest);
    const operators = operatorsOf(flags.get('--operators'), testWorld);
    const name = flags.get('--name') ?? 'seller';
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) throw new WrongCall('--name takes 1 to 40 lowercase letters, digits and hyphens');
    // The folder by its real path, every link followed: what the command checks is where it writes.
    const folder = realPath(resolve(flags.get('--folder') ?? join(homedir(), '.crow', name)));
    const hide: Call['hide'] = (value, whole = false) => {
      for (const form of whole ? [value] : formsOf(value)) hidden.add(form);
    };
    // The folder's key, when there is one, is hidden from the first line on. `status` reads no key.
    if (command !== 'status' && existsSync(join(folder, FILES.key))) {
      try {
        const key = readKey(folder);
        hide(key);
        hide(holdingKeyOf(key));
      } catch {
        // the command that needs the key says what is wrong with the file
      }
    }
    return await COMMANDS[command]!({ folder, operators, testWorld, flags, say, note: (line) => console.error(json(line)), hide });
  } catch (e) {
    if (e instanceof WrongCall) {
      console.error(`setup.mjs: ${text(`${e.message}.`)}\n${text(USAGE)}`);
      return 2;
    }
    say({ step: plain(command, 40), ok: false, detail: plain((e as Error).message, 900) });
    return 1;
  }
}
