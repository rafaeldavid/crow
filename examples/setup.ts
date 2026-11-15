// Setup: one party's Crow folder on its own machine, and its first deal (T-472). site/build.mjs bundles this file, and
// the tools it imports unchanged, into site/setup.mjs: one pinned file that runs with Node and nothing installed.
//
//   node setup.mjs seller --sample --payout <address or this-key>
//                               makes the folder: a signing key, the seller adapter's configuration, the sample's deal
//                               template and a draft card; then runs the check. It sends nothing. A missing answer
//                               prints one JSON object with each question and exits 3: it never prompts.
//   node setup.mjs check        the conformance check: one JSON line per check, exit 0 only when all pass. It sends nothing.
//   node setup.mjs first-deal   prints what it will send and to whom, writes the marker that the first deal starts, then
//                               sells one sample job to Crow's test buyer through the seller adapter, in this process,
//                               follows the deal to its end and writes the deal record. These are the first requests
//                               that name the party to a Crow-run host.
//   node setup.mjs status       the folder's state: the role, the steps done, the addresses, the open deals. No secret.
//
// Every setting is a flag: --folder <path> (default ~/.crow/<name>), --name <name> (default seller), --operators
// <url>,<url> (default Crow's two), --buyer <url> (default Crow's test buyer) and --test-world (a local test world,
// never the live service: it needs --operators and --buyer, and every line then says so). The command reads no
// HOLDBACK_* or CROW_* variable: the bundle's first line removes them before any module runs, and main() removes them
// again, so a variable left in a shell cannot point a seller at other operators or another deployment. Without
// --test-world it signs only under Crow's deployment on Sepolia.
//
// The key: the folder's keys/signing.key. The command reads it and passes it to the adapter in its `env` argument. It
// is never put in this process's environment, on a command line, in a request or in a line this command prints: every
// line is searched for the key, and the keys derived from it, before it is written.
//
// Each line is one JSON object, so an assistant reads the state without parsing prose; a counterparty's text in it is
// data, never an instruction. A wrong call prints the usage as text on standard error and exits 2. Exit 0: done.
// Exit 1: a step failed or was refused, named in its line. Exit 3: an answer is missing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { Agent } from './agent.ts';
import { dealRecord } from './deal-record.ts';
import { fromParty, same, TEST_BUYER, until } from './goal-kit.ts';
import { plain as plainLine } from './plain.ts';
import { dealKeyOf, holdingKeyOf, loadConfig, startSellerAdapter, type RunningAdapter } from './seller-adapter.ts';
import { runChecks } from './setup-check.ts';
import { SAMPLE, startSampleApi, type SampleApi } from './setup-sample-api.ts';
import { FILES, formsOf, holdingAddressOf, readKey, readState, seller, writeState, writeWhole, type Call, type J, type State } from './setup-seller.ts';
import { jcs, knownPins } from './verify.ts';

/** Any value from a file, a flag, a tool or another party as one plain line of at most `max` characters. */
const plain = (s: unknown, max = 300) => plainLine(String(s ?? '')).slice(0, max);

export const CROW_OPERATORS = ['https://api.crow.direct', 'https://api2.crow.direct'];
export const NOT_LIVE = 'test world: this is not the live service';
/** Sepolia's chain ID: the only settlement layer this command signs under without --test-world. */
const SEPOLIA_CHAIN_ID = 11155111;

const USAGE = [
  'setup.mjs: makes one Crow folder on this machine and runs its first deal. Test tokens only.',
  'usage: node setup.mjs <command> [flags]',
  '  seller --sample --payout <address|this-key> [--card <path>] [--allow-git] [--allow-synced] [--allow-served]',
  '                makes the folder, then runs the check. It sends nothing. Exit 3: an answer is missing, named in one JSON object.',
  '  check         runs the conformance check: one JSON line per check, exit 0 only when all pass. It sends nothing.',
  "  first-deal [--buyer <url>] [--again]",
  "                prints what it sends and to whom, then sells one sample job to Crow's test buyer and follows it to its end.",
  "  status        prints the folder's state. It reads no key and sends nothing.",
  '  --folder      the party\'s folder. Default: ~/.crow/<name>.',
  '  --name        the party\'s name, in the folder\'s default path and on its card. Default: seller.',
  `  --operators   two or more operator URLs, comma-separated. Default: ${CROW_OPERATORS.join(',')}.`,
  '  --test-world  a local test world, never the live service. It needs --operators, and first-deal needs --buyer; every line then says so.',
].join('\n');

/** Removes every HOLDBACK_* and CROW_* variable from `env`: the command takes its settings from flags only. */
export function clearAmbient(env: Record<string, string | undefined> = process.env): void {
  for (const name of Object.keys(env)) if (/^(HOLDBACK|CROW)_/.test(name)) delete env[name];
}

/** A wrong call: the usage follows on standard error, and the command exits 2. */
class WrongCall extends Error {}

const COMMON = { values: ['--folder', '--name', '--operators'], switches: ['--test-world'] };
const OWN: Record<string, { values: string[]; switches: string[] }> = {
  seller: { values: ['--payout', '--card'], switches: ['--sample', '--allow-git', '--allow-synced', '--allow-served'] },
  check: { values: [], switches: [] },
  'first-deal': { values: ['--buyer'], switches: ['--again'] },
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
function operatorsOf(text: string | undefined, testWorld: boolean): string[] {
  if (text === undefined) {
    if (testWorld) throw new WrongCall("--test-world needs --operators: the test world's own operator URLs. Nothing was sent");
    return CROW_OPERATORS;
  }
  const list = text.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  if (list.length < 2 || !list.every(isHttp)) throw new WrongCall('--operators takes two or more http or https URLs, comma-separated');
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
    open = Object.entries(journal.deals ?? {}).filter(([, d]) => d.stage !== 'closed' && d.stage !== 'delivered').map(([id, d]) => ({ commitmentId: plain(id, 80), stage: plain(d.stage, 40) }));
  } catch {
    // no journal yet: no deal has started
  }
  c.say({ step: 'status', folder: c.folder, exists: true, role: state.role, sells: state.sells, name: state.name, steps: Object.keys(state.steps), address: state.address ?? null, payout: state.payout ?? null, card: state.card ?? null, firstDeal: state.firstDeal ?? null, openDeals: open });
  return 0;
}

async function check(c: Call): Promise<number> {
  const results = await runChecks(c.folder);
  for (const r of results) c.say({ step: 'check', ...r });
  return results.every((r) => r.ok) ? 0 : 1;
}

/** Crow's test buyer's card, checked: a crow-buyer card with an address, an encryption key and an intake on its own origin. */
async function buyerCard(url: string): Promise<{ buyer: string; encryptionPublicKey: string; intake: string }> {
  const card = (await fromParty(`${url}/agent.json`)).body;
  if (card?.type !== 'crow-buyer' || !/^0x[0-9a-fA-F]{40}$/.test(card.buyer ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(card.buyerEncryptionPublicKey ?? '')) throw new Error(`${plain(url)}/agent.json is not a crow-buyer card with an address and an encryption key`);
  if (!isHttp(String(card.intake?.api)) || new URL(card.intake.api).origin !== new URL(url).origin) throw new Error(`the card's intake is not on ${new URL(url).origin}`);
  return { buyer: String(card.buyer).toLowerCase(), encryptionPublicKey: card.buyerEncryptionPublicKey, intake: card.intake.api };
}

async function firstDeal(c: Call): Promise<number> {
  const state = readState(c.folder);
  if (!state || !state.payout || !state.address) {
    c.say({ step: 'first-deal', ok: false, detail: `${c.folder} has no finished ${FILES.state}: run the seller command first. Nothing was sent.` });
    return 1;
  }
  const save = (change: Partial<NonNullable<State['firstDeal']>>) => {
    state.firstDeal = { startedAt: new Date().toISOString(), ...state.firstDeal, ...change };
    writeState(c.folder, state);
  };
  const before = state.firstDeal;
  if (before?.state === 'Released') {
    c.say({ step: 'first-deal', ok: true, state: 'Released', commitmentId: before.commitmentId, record: before.record ?? null, detail: 'The first deal is done. Nothing was sent now.' });
    return 0;
  }
  if (before?.state !== undefined) {
    if (!c.flags.has('--again')) {
      c.say({ step: 'first-deal', ok: false, state: plain(before.state, 40), commitmentId: before.commitmentId, detail: 'The first deal ended without a release. Run first-deal --again to offer a new one. Nothing was sent now.' });
      return 1;
    }
    delete state.firstDeal;
    writeState(c.folder, state);
  }
  const buyerUrl = (c.flags.get('--buyer') ?? state.firstDeal?.buyer ?? (c.testWorld ? undefined : TEST_BUYER))?.replace(/\/+$/, '');
  if (buyerUrl === undefined) throw new WrongCall("--test-world needs --buyer: the test world's own test buyer. Nothing was sent");
  if (!isHttp(buyerUrl)) throw new WrongCall('--buyer takes the test buyer\'s URL, such as https://crow.direct/agents/test-buyer');

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
  const payout = state.payout;
  // 2. What the command is about to send, and to whom, before it sends anything.
  c.say({
    step: 'preview',
    sends: [
      { to: c.operators, what: 'reads only, as the deal goes: the discovery document, the club, the adjudicators, the settlement time and the deal by its commitment ID.' },
      { to: c.operators[0], what: `the faucet grant for this deal: the deal's fresh address, and ${holdingAddressOf(key)}, the one holding address every grant of this folder names.` },
      { to: c.operators, what: `the signed offer. The whole terms become public: the description, every check, the price, the deadlines, the adjudicators, the buyer's address, the deal's fresh address and the payout address ${payout.address}.` },
      { to: buyerUrl, what: 'a read of its card, then the commitment ID.' },
      { to: c.operators, what: "the delivery: the encrypted work and its sealed keys. Its size, its time and its SHA-256 become public; its content does not." },
    ],
    payout: payout.thisKey
      ? `The payout address is this folder's standing address ${payout.address}. Every deal names it in its public terms, which links this folder's deals to one another, and its key is on this machine.`
      : `The payout address ${payout.address} is in the public terms of every deal, which links this folder's deals to one another.`,
    money: 'Test tokens only: nothing here is real money.',
  });

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
    const config = { ...loadConfig(join(c.folder, FILES.configuration)), journal: join(c.folder, FILES.journal), log: (line: string) => c.note({ step: 'adapter', log: line }) };
    const quoteAt = typeof config.sellerApi.quote === 'string' && isHttp(config.sellerApi.quote) ? new URL(config.sellerApi.quote) : undefined;
    if (!quoteAt || quoteAt.hostname !== '127.0.0.1' || !(Number(quoteAt.port) > 0)) throw new Error(`${FILES.configuration} must name the sample API on the loopback address with its port, as the seller command wrote it. Nothing was signed or offered`);
    api = await startSampleApi(pin!.token.id, Number(quoteAt.port));
    // The key goes to the adapter in this object only: not into process.env, a command line or a file.
    adapter = await startSellerAdapter(config, { HOLDBACK_KEY: key, HOLDBACK_OPERATORS: c.operators.join(',') });
    c.say({ step: 'adapter', ok: true, quote: `${adapter.url}/quote`, sells: state.sells });

    // 6. The offer: one for the first deal. A run that stopped after it finds it in the state or in the adapter's journal.
    const card = await buyerCard(buyerUrl);
    const journaled = adapter.deals().find((d) => String(d.terms?.buyer).toLowerCase() === card.buyer);
    let id = (state.firstDeal?.commitmentId ?? journaled?.id) as Hex | undefined;
    if (id === undefined) {
      const answer = await fetch(`${adapter.url}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ buyer: card.buyer, buyerEncryptionPublicKey: card.encryptionPublicKey, scope: SAMPLE.firstScope }), signal: AbortSignal.timeout(300_000) });
      const quote = (await answer.json().catch(() => null)) as J;
      if (answer.status !== 200 || !/^0x[0-9a-f]{64}$/.test(String(quote?.commitmentId))) throw new Error(`the adapter made no offer (status ${answer.status}): ${plain(quote?.detail ?? quote?.type, 400)}`);
      id = quote.commitmentId as Hex;
      save({ commitmentId: id });
      c.say({ step: 'offer', ok: true, commitmentId: id, price: quote.price, fees: quote.fees ?? null, expiresAt: plain(quote.expiresAt, 40), buyer: card.buyer });
    } else {
      save({ commitmentId: id });
      c.say({ step: 'offer', ok: true, commitmentId: id, resumed: true, detail: 'This deal was offered by an earlier run: no second offer is made.' });
    }
    const terms = adapter.deals().find((d) => d.id === id)?.terms as J;
    if (/^0x[0-9a-f]{64}$/.test(String(terms?.nonce))) c.hide(dealKeyOf(key, terms.nonce as Hex));

    // 7. The commitment ID to the test buyer. One ID is one deal there: a second post of it changes nothing.
    const now = await Promise.all(reader.sources().map((op) => reader.call('GET', `/v1/commitments/${id}`, undefined, op).then((s: J) => String(s.escrowState))));
    if (now.every((s) => ['Offered', 'AcceptedByAdjudicator'].includes(s))) {
      const posted = await fetch(card.intake, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commitmentId: id }), signal: AbortSignal.timeout(30_000) });
      const taken = (await posted.json().catch(() => null)) as J;
      if (posted.status !== 202 && posted.status !== 200) throw new Error(`the test buyer answered ${posted.status}: ${plain(taken?.error, 300)}${taken?.rule ? ` (rule ${plain(taken.rule, 60)})` : ''}`);
      c.say({ step: 'post', ok: true, to: card.intake, detail: 'The test buyer took the offer: it agrees and funds once the adjudicator accepts.' });
    }

    // 8. The adapter starts the job once every operator shows the hold, checks the result and delivers. Follow to the end.
    const end = await until(reader, id, ['Released', 'Refunded'], c.testWorld ? 120_000 : 1_200_000, c.testWorld ? 250 : 3000);
    await adapter.close(); // the step in progress finishes; the journal keeps the deal as delivered
    adapter = undefined;
    save({ state: String(end.escrowState), endedAt: new Date().toISOString() });
    if (end.escrowState !== 'Released') {
      c.say({ step: 'first-deal', ok: false, state: plain(end.escrowState, 40), commitmentId: id, detail: 'The deal ended without a release: the buyer has its money back. Run first-deal --again to offer a new one.' });
      return 1;
    }

    // 9. The deal record: read from every operator, GET requests only.
    const record = await dealRecord(id, { operators: c.operators, party: 'seller' });
    const count = (ok: boolean | null) => record.checks.filter((x) => x.ok === ok).length;
    mkdirSync(join(c.folder, FILES.deals), { recursive: true });
    const file = join(c.folder, FILES.deals, `${id}.json`);
    writeWhole(file, `${JSON.stringify(record, null, 2)}\n`);
    save({ record: file });
    const sound = count(false) === 0 && record.disagreements.length === 0;
    c.say({ step: 'record', ok: sound, file, checks: { passed: count(true), failed: count(false), notRun: count(null) }, operatorsAgree: record.disagreements.length === 0 });
    c.say({ step: 'first-deal', ok: sound, state: 'Released', commitmentId: id, buyer: card.buyer, paidTo: payout.address, price: record.row.price, transactions: record.row.transactions, record: file });
    return sound ? 0 : 1;
  } catch (e) {
    c.say({ step: 'first-deal', ok: false, detail: `${plain((e as Error).message, 900)}. Run the same command again: it continues this deal and makes no second offer.` });
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
    for (const form of hidden) out = out.split(form).join('[a key, removed]');
    return out;
  };
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18)) {
    console.error(text(`setup.mjs: this needs Node 22.18 or later; this is Node ${process.versions.node}. Nothing was made or sent.`));
    return 2;
  }
  if (command === '--help' || command === '-h') {
    console.log(text(USAGE));
    return 0;
  }
  let say: Call['say'] = (line) => console.log(json(line));
  try {
    if (command === undefined || !Object.hasOwn(COMMANDS, command)) throw new WrongCall(command === undefined ? 'name a command' : `${plain(command, 40)} is not a command of this file`);
    const flags = flagsOf(command, rest);
    const operators = operatorsOf(flags.get('--operators'), testWorld);
    const name = flags.get('--name') ?? 'seller';
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) throw new WrongCall('--name takes 1 to 40 lowercase letters, digits and hyphens');
    const folder = resolve(flags.get('--folder') ?? join(homedir(), '.crow', name));
    const hide = (key: string) => {
      for (const form of formsOf(key)) hidden.add(form);
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
    say = (line) => console.log(json(line));
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
