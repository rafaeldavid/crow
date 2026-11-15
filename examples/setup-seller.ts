// `node setup.mjs seller --sample --payout <address or this-key>` (T-472): the party's folder, made step by step.
// Each step looks before it writes, so the command run again after a stop makes no second key and keeps what is there.
//
// The folder (default ~/.crow/<name>):
//   crow.json        the state: the role, the steps done, the addresses, the first deal. No secret.
//   .gitignore       covers keys/
//   keys/            mode 0700; keys/signing.key, mode 0600, is the only secret, and the command never prints it
//   adapter.json     the seller adapter's configuration: a fresh key for each deal, windows Crow's test buyer takes
//   template.json    the sample's deal template
//   journal.json     the adapter's journal, once a deal starts
// The card goes to a folder of its own (default ~/.crow/<name>-card), so a folder that is served never holds keys/.
//
// It sends nothing: no request leaves this file.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { getAddress, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { holdingKeyOf } from './seller-adapter.ts';
import { freePort, SAMPLE, SAMPLE_PRICE_UNITS, sampleAddresses } from './setup-sample-api.ts';

export type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The files of a party's folder, by their path inside it. */
export const FILES = { state: 'crow.json', ignore: '.gitignore', keys: 'keys', key: join('keys', 'signing.key'), configuration: 'adapter.json', template: 'template.json', journal: 'journal.json', marker: 'first-deal.started', sampleTerms: join('sample', 'terms.json'), sampleResult: join('sample', 'result.csv'), sampleCut: join('sample', 'result-with-a-column-removed.csv'), deals: 'deals' };
/** The card's one file, in the card's own folder. */
export const CARD_FILE = 'agent.json';
/** Windows Crow's test buyer takes: 10 minutes to agree, 15 to fund, the work due within the hour, a minute per judging window, no appeal window. */
export const TIMING = { offerExpiresInSec: 600, fundWithinSec: 900, deliverWithinSec: 3600, judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 };

/** What one command gets: where it works, and how it prints. Every line is one JSON object. */
export interface Call {
  folder: string;
  operators: string[];
  testWorld: boolean;
  flags: Map<string, string>;
  /** One JSON line on standard output. */
  say(line: Record<string, unknown>): void;
  /** One JSON line on standard error: a tool's own log line, or the first deal's marker. */
  note(line: Record<string, unknown>): void;
  /** Adds a secret's value to the ones no printed line may hold: each is cut out of every line before it is written. */
  hide(key: string): void;
}

export interface State {
  crow: 'setup/1';
  role: 'seller';
  sells: 'sample';
  name: string;
  createdAt: string;
  /** The standing key's address. With a fresh key for each deal it signs no deal. */
  address?: string;
  payout?: { address: string; thisKey: boolean };
  /** The card's folder. */
  card?: string;
  /** The steps done, each with its time. */
  steps: Record<string, string>;
  firstDeal?: { startedAt: string; buyer?: string; commitmentId?: string; state?: string; record?: string; endedAt?: string };
}

export function readState(folder: string): State | undefined {
  let text: string;
  try {
    text = readFileSync(join(folder, FILES.state), 'utf8');
  } catch {
    return undefined;
  }
  const s = JSON.parse(text) as State;
  if (s?.crow !== 'setup/1' || typeof s.steps !== 'object' || s.steps === null) throw new Error(`${FILES.state} is not a setup/1 state file`);
  return s;
}

/** Writes a file whole, then renames it into place: a stop leaves the old file or the new one, never half of one. */
export function writeWhole(path: string, text: string, mode = 0o600): void {
  writeFileSync(`${path}.tmp`, text, { mode });
  renameSync(`${path}.tmp`, path);
}
export const writeState = (folder: string, s: State): void => writeWhole(join(folder, FILES.state), `${JSON.stringify(s, null, 2)}\n`);

/** The folder's signing key, read for this process only. Throws, without the file's content, when it is not one key. */
export function readKey(folder: string): Hex {
  let key: string;
  try {
    key = readFileSync(join(folder, FILES.key), 'utf8').trim();
  } catch {
    throw new Error(`the folder has no ${FILES.key}: run the seller command first`);
  }
  if (!/^0x[0-9a-f]{64}$/.test(key)) throw new Error(`${FILES.key} does not hold one key: 0x and 64 lowercase hex characters`);
  return key as Hex;
}
export const addressOf = (key: Hex): string => privateKeyToAccount(key).address.toLowerCase();
/** The one address every faucet grant of this folder names (seller-adapter-core.ts): public, and derived from the key. */
export const holdingAddressOf = (key: Hex): string => addressOf(holdingKeyOf(key));

/** Every form a key could take in a line or a file: hex in both cases, and base64 in both alphabets. */
export function formsOf(key: string): string[] {
  const hex = key.replace(/^0x/, '').toLowerCase();
  const bytes = Buffer.from(hex, 'hex');
  return [hex, hex.toUpperCase(), bytes.toString('base64'), bytes.toString('base64url'), bytes.toString('base64').replace(/=+$/, '')];
}

/** The nearest folder above `path`, or `path` itself, that exists. */
function existing(path: string): string {
  let at = path;
  while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
  return at;
}
const inside = (child: string, parent: string): boolean => {
  const r = relative(parent, child);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
};
/** Folder names a sync service keeps: a key in one is copied to every machine the account reaches. */
const SYNCED = [/^Dropbox/i, /^OneDrive/i, /^Google ?Drive/i, /^iCloud ?Drive/i, /^Mobile Documents$/, /^CloudStorage$/, /^Nextcloud/i, /^pCloud ?Drive/i, /^Syncthing$/i];

/**
 * Why the folder may not live at `folder`, each with the flag that overrides it; empty when it may. A git work tree
 * could commit the key, a synced folder copies it to other machines, and the card's folder is served to anyone.
 */
export function placeProblems(folder: string, card: string): Array<{ flag: string; detail: string }> {
  const out: Array<{ flag: string; detail: string }> = [];
  for (let at = existing(folder); ; at = dirname(at)) {
    if (existsSync(join(at, '.git'))) {
      out.push({ flag: '--allow-git', detail: `${folder} is inside the git work tree at ${at}: a commit there could carry the key. Choose a folder outside it with --folder, or pass --allow-git to keep this one (its .gitignore covers keys/).` });
      break;
    }
    if (dirname(at) === at) break;
  }
  const synced = folder.split(sep).find((part) => SYNCED.some((re) => re.test(part)));
  if (synced) out.push({ flag: '--allow-synced', detail: `${folder} is under ${synced}, a folder a sync service copies to other machines: the key would go with it. Choose another folder with --folder, or pass --allow-synced to keep this one.` });
  if (inside(folder, card) || inside(card, folder)) out.push({ flag: '--allow-served', detail: `${folder} and the card's folder ${card} hold one another: a folder that is served would hold keys/. Choose a card folder outside it with --card, or pass --allow-served to keep both.` });
  return out;
}

const QUESTIONS = {
  '--sample': "This version sells Crow's sample product only: pass --sample to sell it. Your own API comes with a later version.",
  '--payout': 'Where are you paid? Give an address whose key is not on this machine (--payout 0x...), or answer this-key (--payout this-key) to be paid at this folder\'s own standing address.',
};

/** Makes the folder, or finishes one a stopped run left. Returns the exit status: 0 made, 1 refused, 3 an answer is missing. */
export async function seller(c: Call): Promise<number> {
  const folder = c.folder;
  let state = readState(folder);
  const name = c.flags.get('--name') ?? state?.name ?? 'seller';
  const card = resolve(c.flags.get('--card') ?? state?.card ?? `${folder}-card`);

  // The answers: asked once, kept in crow.json, and never given a default.
  const payoutGiven = c.flags.get('--payout');
  const missing = [...(c.flags.has('--sample') || state?.sells === 'sample' ? [] : ['--sample' as const]), ...(payoutGiven !== undefined || state?.payout ? [] : ['--payout' as const])];
  if (missing.length) {
    c.say({ step: 'seller', ok: false, exit: 3, missing: missing.map((flag) => ({ flag, question: QUESTIONS[flag] })), next: 'Ask the person each question, then run the same command again with each flag. Nothing was made or sent.' });
    return 3;
  }
  if (payoutGiven !== undefined && payoutGiven !== 'this-key') {
    let ok = /^0x[0-9a-fA-F]{40}$/.test(payoutGiven);
    if (ok && payoutGiven !== payoutGiven.toLowerCase() && payoutGiven.slice(2) !== payoutGiven.slice(2).toUpperCase()) {
      try {
        ok = getAddress(payoutGiven) === payoutGiven;
      } catch {
        ok = false;
      }
    }
    if (!ok) throw new Error('--payout takes this-key, or an address: 0x and 40 hex characters, with a valid checksum if in mixed case');
  }

  const problems = placeProblems(folder, card).filter((p) => !c.flags.has(p.flag));
  if (problems.length) {
    for (const p of problems) c.say({ step: 'folder', ok: false, flag: p.flag, detail: p.detail });
    return 1;
  }

  const done = (step: string) => {
    state!.steps[step] ??= new Date().toISOString();
    writeState(folder, state!);
  };
  // Step 1: the folder, its .gitignore and keys/.
  mkdirSync(join(folder, FILES.keys), { recursive: true, mode: 0o700 });
  chmodSync(folder, 0o700);
  chmodSync(join(folder, FILES.keys), 0o700);
  if (!existsSync(join(folder, FILES.ignore))) writeFileSync(join(folder, FILES.ignore), '# Written by setup.mjs: the keys never go into a repository.\nkeys/\n');
  state ??= { crow: 'setup/1', role: 'seller', sells: 'sample', name, createdAt: new Date().toISOString(), steps: {} };
  state.card = card;
  done('folder');

  // Step 2: the signing key. An exclusive write: a key that is there is never replaced.
  const keyFile = join(folder, FILES.key);
  if (!existsSync(keyFile)) writeFileSync(keyFile, `${generatePrivateKey()}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(keyFile, 0o600);
  const key = readKey(folder);
  c.hide(key);
  c.hide(holdingKeyOf(key));
  const address = addressOf(key);
  if (state.address !== undefined && state.address !== address) throw new Error(`${FILES.key} is not the key ${FILES.state} names (${state.address}): this folder was changed by hand`);
  state.address = address;
  done('key');

  // Step 3: the payout address. Changing it later is an edit of adapter.json the person makes, not a default.
  const payout = payoutGiven === undefined ? state.payout! : payoutGiven === 'this-key' ? { address, thisKey: true } : { address: payoutGiven.toLowerCase(), thisKey: payoutGiven.toLowerCase() === address };
  if (state.payout && state.payout.address !== payout.address) throw new Error(`this folder already pays to ${state.payout.address}: to change it, edit payoutAddress in ${FILES.configuration} and payout in ${FILES.state}`);
  state.payout = payout;
  done('payout');

  // Step 4: the adapter's configuration and the sample's deal template.
  if (!existsSync(join(folder, FILES.template))) writeWhole(join(folder, FILES.template), `${JSON.stringify(SAMPLE.template, null, 2)}\n`);
  done('template');
  if (!existsSync(join(folder, FILES.configuration))) {
    // The sample API keeps one port on the loopback address, free now and written here: the adapter starts a job only
    // at the address its offer was priced at, so a run that continues a deal must serve the API where the first did.
    // The adapter's own port is 0: the system picks one each run, and only this command asks it for a quote.
    writeWhole(join(folder, FILES.configuration), `${JSON.stringify({ port: 0, sellerApi: sampleAddresses(await freePort()), template: FILES.template, scope: SAMPLE.scope, signingKey: 'per-deal', payoutAddress: payout.address, timing: TIMING, pollMs: 2000 }, null, 2)}\n`);
  }
  done('configuration');

  // Step 5: the card, in a folder of its own. A draft: it names no address and no quote address until the party publishes one.
  mkdirSync(card, { recursive: true });
  if (!existsSync(join(card, CARD_FILE))) {
    writeWhole(join(card, CARD_FILE), `${JSON.stringify({ type: 'crow-agent', status: 'draft: not published, and no quote address yet', name, sells: [{ deliverable: SAMPLE.template.deliverable, price: { amount: SAMPLE_PRICE_UNITS, unit: "base units of the settlement layer's test token" }, scope: SAMPLE.scope }] }, null, 2)}\n`, 0o644);
  }
  done('card');

  c.say({
    step: 'seller', ok: true, folder, card, address, payout: payout.address,
    keys: `${FILES.key} holds the signing key, mode 0600, on this machine only. Never read, print or copy it.`,
    ...(payout.thisKey ? { payoutNote: `Every deal names this folder's standing address ${address} as its payout address in its public terms, which links this folder's deals to one another. Its key is on this machine, in ${FILES.key}.` } : { payoutNote: `Every deal names ${payout.address} as its payout address in its public terms, which links this folder's deals to one another.` }),
    sent: 'nothing',
  });
  return 0;
}

/** Whether the folder's own files have the modes the setup gave them, as text for the check; '' when they do. */
export function modeProblem(folder: string): string {
  if (process.platform === 'win32') return '';
  const mode = (p: string) => statSync(join(folder, p)).mode & 0o777;
  if (mode(FILES.keys) !== 0o700) return `${FILES.keys}/ has mode ${mode(FILES.keys).toString(8)}, not 700`;
  if (mode(FILES.key) !== 0o600) return `${FILES.key} has mode ${mode(FILES.key).toString(8)}, not 600`;
  return '';
}
