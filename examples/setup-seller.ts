// `node setup.mjs seller --sample --payout <address or this-key>` (T-472): the party's folder, made step by step.
// Each step looks before it writes, so the command run again after a stop makes no second key and keeps what is there.
// `seller --template <file> [--file <path>]` in place of `--sample` (T-543) makes a folder that sells the party's own
// work: the template says what is sold, the fixed price, the checks and when the work is due.
//
// The folder (default ~/.crow/<name>):
//   crow.json        the state: the role, the steps done, the addresses, the first deal. No secret.
//   .gitignore       covers keys/
//   keys/            mode 0700; keys/signing.key, mode 0600, is the only secret, and the command never prints it
//   adapter.json     the seller adapter's configuration: a fresh key for each deal, windows Crow's test buyer takes
//   template.json    the deal template: the sample's, or the deliverable and the checks of the party's own
//   work/            a folder that sells from a template: each deal's work, as work/<commitment ID>.<csv|json|txt|md>,
//                    and work/ready.<ext>, the finished work `--file` named, which every deal of the folder delivers
//   journal.json     the adapter's journal, once a deal starts
// The card goes to a folder of its own (default ~/.crow/<name>-card), so a folder that is served never holds keys/.
//
// The command makes a folder of its own and adopts nothing it did not make. It refuses a folder that holds files and
// no crow.json. It takes a key file only when its own state says it made one, and a configuration only when the file
// is the one it wrote. It follows no symbolic link at keys/ or at the key file, and never changes a link's target.
// One run works in a folder at a time: crow.lock names the process, and a run that finds a dead one takes over.
//
// It sends nothing: no request leaves this file.
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { getAddress, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { holdingKeyOf } from './seller-adapter.ts';
import { freePort, SAMPLE, SAMPLE_PRICE_UNITS, sampleAddresses } from './setup-sample-api.ts';
import { DELIVERY_LIMITS, readWorkFile, readWorkTemplate, readyPath, refuseEnvFile, TEMPLATE_EXAMPLE, WORK_DIR, workAddresses } from './setup-work-api.ts';

export type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The files of a party's folder, by their path inside it. */
export const FILES = { state: 'crow.json', lock: 'crow.lock', ignore: '.gitignore', keys: 'keys', key: join('keys', 'signing.key'), configuration: 'adapter.json', template: 'template.json', journal: 'journal.json', marker: 'first-deal.started', sampleTerms: join('sample', 'terms.json'), sampleResult: join('sample', 'result.csv'), sampleCut: join('sample', 'result-with-a-column-removed.csv'), deals: 'deals' };
/** The card's one file, in the card's own folder. */
export const CARD_FILE = 'agent.json';
/** Windows Crow's test buyer takes: 10 minutes to agree, 15 to fund, the work due within the hour, a minute per judging window, no appeal window. */
export const TIMING = { offerExpiresInSec: 600, fundWithinSec: 900, deliverWithinSec: 3600, judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 };
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;

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
  /**
   * Adds a secret to the ones no printed line may hold: each is cut out of every line before it is written. A key is
   * hidden in every form it could take (hex, base64); with `whole`, the value is hidden as it is given.
   */
  hide(value: string, whole?: boolean): void;
}

/** A first deal: one offer to the test buyer, from the marker to its end. */
export interface FirstDeal {
  startedAt: string;
  buyer?: string;
  /** The deals the adapter's journal held before this offer was asked for: a deal found there later is none of them. */
  journalBefore?: string[];
  commitmentId?: string;
  /** Set when the deal ended: a settlement state (Released, Refunded, Expired, ...) or why the command gave it up. */
  state?: string;
  detail?: string;
  record?: string;
  endedAt?: string;
}

export interface State {
  crow: 'setup/1';
  role: 'seller';
  /** What the folder sells: Crow's sample, or the party's own work from a template (T-543). */
  sells: 'sample' | 'template';
  /** A folder that sells from a template: the fixed price in base units, the delivery's format, and the seconds from an offer to its delivery deadline. */
  work?: { price: string; format: string; deliverWithinSec: number };
  name: string;
  createdAt: string;
  /** Set before the key is written, so a run that stopped in between knows the key file is its own. */
  keyStartedAt?: string;
  /** The standing key's address. With a fresh key for each deal it signs no deal. */
  address?: string;
  payout?: { address: string; thisKey: boolean };
  /** The card's folder. */
  card?: string;
  /** The SHA-256 of each file the setup wrote and takes back only unchanged. */
  files?: { configuration?: string };
  /** The steps done, each with its time. */
  steps: Record<string, string>;
  firstDeal?: FirstDeal;
  /** First deals that ended without a release and were set aside by `first-deal --again`. None is ever continued. */
  ended?: FirstDeal[];
  /** The listing step (T-486): what `list` sent, to whom, when and the answer's status; or that the person declined. No deal reads it. */
  listing?: Listing;
  /** The last `list` that the receiver refused or did not answer, with a reason from a fixed list and no word of the answer. It counts as neither a listing nor a skip. */
  listingFailed?: { website: string; to: string; at: string; status: number | null; reason: string };
}

/** The listing step's record: a website sent to the list, or a skip. */
export type Listing = { website: string; to: string; at: string; status: number } | { skipped: true; at: string };

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

/**
 * Writes a file whole under a name of its own, then renames it into place: a stop leaves the old file or the new one,
 * never half of one, and two runs at once never share a temporary file.
 */
export function writeWhole(path: string, text: string | Uint8Array, mode = 0o600): void {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  writeFileSync(tmp, text, { mode, flag: 'wx' });
  chmodSync(tmp, mode); // the mode asked for, whatever the process's umask
  renameSync(tmp, path);
}
export const writeState = (folder: string, s: State): void => writeWhole(join(folder, FILES.state), `${JSON.stringify(s, null, 2)}\n`);
const sha256 = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');

/** What is at `path` without following a link, or undefined when nothing is. */
const at = (path: string) => {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
};
/** Why keys/ or the key file is not what the setup made, or '' when each is a plain folder and a plain file. No link is followed. */
export function keyPlaceProblem(folder: string): string {
  const keys = at(join(folder, FILES.keys)), key = at(join(folder, FILES.key));
  if (keys && (keys.isSymbolicLink() || !keys.isDirectory())) return `${FILES.keys}/ is ${keys.isSymbolicLink() ? 'a symbolic link' : 'not a folder'}: the key would be written, or read, somewhere else. Remove it; the setup makes ${FILES.keys}/ itself`;
  if (key && (key.isSymbolicLink() || !key.isFile())) return `${FILES.key} is ${key.isSymbolicLink() ? 'a symbolic link' : 'not a plain file'}: the setup reads no key through a link. Remove it`;
  return '';
}

/** The folder's signing key, read for this process only. Throws, without the file's content, when it is not one key. */
export function readKey(folder: string): Hex {
  const wrong = keyPlaceProblem(folder);
  if (wrong) throw new Error(wrong);
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

/** `path` with every symbolic link in it followed, as far as the path exists; the part that does not exist yet is kept as written. */
export function realPath(path: string): string {
  let existing = resolve(path);
  const rest: string[] = [];
  while (!existsSync(existing) && dirname(existing) !== existing) {
    rest.unshift(basename(existing));
    existing = dirname(existing);
  }
  return join(realpathSync(existing), ...rest);
}
const inside = (child: string, parent: string): boolean => {
  const r = relative(parent, child);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
};
/** Folder names a sync service keeps: a key in one is copied to every machine the account reaches. Common names only. */
const SYNCED = [/^Dropbox/i, /^OneDrive/i, /^Google ?Drive/i, /^iCloud ?Drive/i, /^Mobile Documents$/i, /^CloudStorage$/i, /^Nextcloud/i, /^pCloud ?Drive/i, /^Syncthing$/i, /^Box( Sync)?$/i];

/**
 * Why the folder may not live at `folder`, each with the flag that overrides it; empty when it may. A git work tree
 * could commit the key, a synced folder copies it to other machines, and the card's folder is served to anyone. Each
 * test reads the real path, with every link followed, and ignores the case of letters. It knows common names only: a
 * sync service under another name, or a work tree whose .git is elsewhere, passes.
 */
export function placeProblems(folder: string, card: string): Array<{ flag: string; detail: string }> {
  const out: Array<{ flag: string; detail: string }> = [];
  const real = realPath(folder), realCard = realPath(card);
  for (let dir = real; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) {
      out.push({ flag: '--allow-git', detail: `${real} is inside the git work tree at ${dir}: a commit there could carry the key. Choose a folder outside it with --folder, or pass --allow-git to keep this one (its .gitignore covers keys/).` });
      break;
    }
    if (dirname(dir) === dir) break;
  }
  const synced = real.split(sep).find((part) => SYNCED.some((re) => re.test(part)));
  // macOS: iCloud copies a person's Desktop and Documents folders when its "Desktop & Documents" option is on.
  const icloud = process.platform === 'darwin' ? ['Desktop', 'Documents'].find((name) => inside(real.toLowerCase(), realPath(join(homedir(), name)).toLowerCase())) : undefined;
  if (synced) out.push({ flag: '--allow-synced', detail: `${real} is under ${synced}, a folder a sync service copies to other machines: the key would go with it. Choose another folder with --folder, or pass --allow-synced to keep this one.` });
  else if (icloud) out.push({ flag: '--allow-synced', detail: `${real} is under your ${icloud} folder, which iCloud copies to other machines when its Desktop and Documents option is on: the key would go with it. Choose another folder with --folder, or pass --allow-synced to keep this one.` });
  if (inside(real.toLowerCase(), realCard.toLowerCase()) || inside(realCard.toLowerCase(), real.toLowerCase())) out.push({ flag: '--allow-served', detail: `${real} and the card's folder ${realCard} hold one another: a folder that is served would hold keys/. Choose a card folder outside it with --card, or pass --allow-served to keep both.` });
  return out;
}

/** Another live run holds the folder's lock; `pid` is its process number, or NaN when the lock does not name one. */
export class LockHeld extends Error {
  readonly pid: number;
  constructor(message: string, pid: number) {
    super(message);
    this.pid = pid;
  }
}

/**
 * Runs `body` as the one run working in `folder`: crow.lock names this process. A run that finds the lock of a live
 * process waits up to `waitMs` (0: not at all) and then says so; the lock of a process that is gone is taken over.
 */
export async function locked<T>(folder: string, waitMs: number, body: () => T | Promise<T>): Promise<T> {
  const lock = join(folder, FILES.lock);
  for (const end = Date.now() + waitMs; ; await new Promise((r) => setTimeout(r, 100))) {
    try {
      writeFileSync(lock, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    let pid = NaN;
    try {
      pid = Number(readFileSync(lock, 'utf8').trim());
    } catch {
      continue; // released between the two calls
    }
    let gone = pid === process.pid; // a lock a stopped run left, whose process number this one now has
    if (!gone && Number.isSafeInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0); // signal 0: asks only whether the process is there
      } catch (e) {
        gone = (e as NodeJS.ErrnoException).code === 'ESRCH';
      }
    }
    if (gone) rmSync(lock, { force: true });
    else if (Date.now() >= end) throw new LockHeld(`another run of this command${Number.isSafeInteger(pid) ? ` (process ${pid})` : ''} is working in ${folder}: wait for it to end. If none is, delete ${FILES.lock}`, pid);
  }
  try {
    return await body();
  } finally {
    rmSync(lock, { force: true });
  }
}

const QUESTIONS = {
  '--sample': `What do you sell? Pass --sample for Crow's sample product. For your own work pass --template <file>, a JSON file such as ${TEMPLATE_EXAMPLE}: price is base units of the test token (5000000 is 5.00 tUSDC), checks are the declarative checks of the commitment schema, ${DELIVERY_LIMITS}, and deliverWithinSec, the seconds from the offer to the delivery deadline, may be left out. Add --file <path> when the work is finished: every deal then delivers it once it is funded.`,
  '--payout': 'Where are you paid? Give an address whose key is not on this machine (--payout 0x...), or answer this-key (--payout this-key) to be paid at this folder\'s own standing address.',
};

/** A refusal with its own line: the folder is not one the setup may make or continue. */
class Refused extends Error {}

/** Makes the folder, or finishes one a stopped run left. Returns the exit status: 0 made, 1 refused, 3 an answer is missing. */
export async function seller(c: Call): Promise<number> {
  const folder = c.folder;
  const before = readState(folder);
  // The folder's own earlier answers count only when the setup itself finished asking: a state file that names a
  // payout address and no key step was not written by a run that got that far.
  const kept = before !== undefined && before.steps['payout'] !== undefined && before.steps['key'] !== undefined && before.address !== undefined && before.payout !== undefined && at(join(folder, FILES.key))?.isFile() === true;
  const name = c.flags.get('--name') ?? (kept ? before.name : undefined) ?? 'seller';
  // What the folder sells: asked once, like the payout address. A folder sells one kind for good.
  const templateGiven = c.flags.get('--template'), fileGiven = c.flags.get('--file');
  if (templateGiven !== undefined && c.flags.has('--sample')) throw new Error('give --sample or --template, not both. Nothing was made or sent');
  const sells: State['sells'] | undefined = templateGiven !== undefined ? 'template' : c.flags.has('--sample') ? 'sample' : kept ? before.sells : undefined;
  if (fileGiven !== undefined && sells !== 'template') throw new Error('--file names finished work for a folder that sells from a template: give --template <file> with it. Nothing was made or sent');
  const card = realPath(c.flags.get('--card') ?? (kept ? before.card : undefined) ?? `${folder}-card`);

  // The answers: asked once, kept in crow.json, and never given a default.
  const payoutGiven = c.flags.get('--payout');
  const missing = [...(sells !== undefined ? [] : ['--sample' as const]), ...(payoutGiven !== undefined || kept ? [] : ['--payout' as const])];
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
    if (payoutGiven.toLowerCase() === ZERO_ADDRESS) throw new Error(`--payout ${ZERO_ADDRESS} is the zero address, which nobody holds: a payment there is lost. Give an address whose key the person holds, or this-key`);
  }

  // The template and the finished work, read before anything is made: a file the setup cannot take makes no folder.
  const template = templateGiven === undefined ? undefined : readWorkTemplate(templateGiven);
  const format = template?.deliverable.format ?? (kept ? before.work?.format : undefined);
  let finished: Uint8Array | undefined;
  if (fileGiven !== undefined) {
    refuseEnvFile(fileGiven, '--file');
    if (inside(realPath(fileGiven), join(folder, FILES.keys))) throw new Error(`--file names a file under ${FILES.keys}/: a key is never work. Nothing was made or sent`);
    const read = readWorkFile(fileGiven, true); // the person named this path, so a link there is followed
    if (!read?.bytes) throw new Error(`--file: ${realPath(fileGiven)} ${read?.problem ?? 'is not there'}. Nothing was made or sent`);
    if (format === undefined) throw new Error('--file needs the template that says what format the work has: give --template <file> with it. Nothing was made or sent');
    finished = read.bytes;
  }

  const problems = placeProblems(folder, card).filter((p) => !c.flags.has(p.flag));
  if (problems.length) {
    for (const p of problems) c.say({ step: 'folder', ok: false, flag: p.flag, detail: p.detail });
    return 1;
  }

  mkdirSync(folder, { recursive: true, mode: 0o700 });
  try {
    return await locked(folder, 30_000, async () => {
      // Step 1: the folder is the setup's own. One with files in it and no state is someone else's, or another program's.
      let state = readState(folder);
      const others = readdirSync(folder).filter((n) => n !== FILES.lock && !/^\.crow\.json\..*\.tmp$/.test(n));
      if (!state && others.length) throw new Refused(`${folder} is not empty and has no ${FILES.state}: the setup makes a folder of its own and adopts nothing that was put there (it holds ${others.slice(0, 5).join(', ')}). Choose an empty folder with --folder, or move those away`);
      const linked = keyPlaceProblem(folder);
      if (linked) throw new Refused(linked);
      chmodSync(folder, 0o700);
      if (state && state.sells !== sells) throw new Refused(`${folder} sells ${state.sells === 'sample' ? "Crow's sample" : 'work from a template'}, and a folder sells one kind for good. Make another folder for ${sells === 'sample' ? 'the sample' : 'your own work'} with --folder or --name`);
      if (template && state?.firstDeal?.commitmentId !== undefined && state.firstDeal.state === undefined) throw new Refused(`this folder's open deal ${state.firstDeal.commitmentId} was offered from the template it has: run first-deal to finish it, then give a new template`);
      state ??= { crow: 'setup/1', role: 'seller', sells: sells!, name, createdAt: new Date().toISOString(), steps: {} };
      state.card = card;
      const done = (step: string) => {
        state.steps[step] ??= new Date().toISOString();
        writeState(folder, state);
      };
      writeState(folder, state); // first of all: a stop after this line leaves a folder the next run continues
      if (!existsSync(join(folder, FILES.ignore))) writeFileSync(join(folder, FILES.ignore), '# Written by setup.mjs: the keys never go into a repository.\nkeys/\n');
      done('folder');

      // Step 2: the signing key. The setup takes a key file only when its own state says it made one.
      const keysDir = join(folder, FILES.keys), keyFile = join(folder, FILES.key);
      if (!at(keysDir)) mkdirSync(keysDir, { mode: 0o700 });
      chmodSync(keysDir, 0o700); // a plain folder: keyPlaceProblem refused a link above
      for (const n of readdirSync(keysDir)) if (/^\.signing\.key\..*\.tmp$/.test(n)) rmSync(join(keysDir, n), { force: true }); // a stopped run's unfinished key
      if (at(keyFile)) {
        if (state.steps['key'] === undefined && state.keyStartedAt === undefined) throw new Refused(`${FILES.key} is in the folder, and ${FILES.state} does not say this setup made it: the setup adopts no key it did not make. Move that file away, then run the same command again`);
      } else {
        if (state.steps['key'] !== undefined) throw new Refused(`${FILES.state} says this setup made the key of ${state.address}, and ${FILES.key} is gone. Put the file back. To start over with a new key, use an empty folder (--folder)`);
        state.keyStartedAt = new Date().toISOString();
        writeState(folder, state);
        writeWhole(keyFile, `${generatePrivateKey()}\n`, 0o600); // whole, under a name of its own in keys/, then renamed
      }
      chmodSync(keyFile, 0o600);
      const key = readKey(folder);
      c.hide(key);
      c.hide(holdingKeyOf(key));
      const address = addressOf(key);
      if (state.address !== undefined && state.address !== address) throw new Refused(`${FILES.key} is not the key ${FILES.state} names (${state.address}): this folder was changed by hand. Put the right file back, or use an empty folder (--folder)`);
      state.address = address;
      done('key');

      // Step 3: the payout address. Before the first deal starts, the same command with another --payout changes it.
      const earlier = kept ? state.payout : undefined;
      const payout = payoutGiven === undefined ? earlier! : payoutGiven === 'this-key' ? { address, thisKey: true } : { address: payoutGiven.toLowerCase(), thisKey: payoutGiven.toLowerCase() === address };
      const changed = earlier !== undefined && earlier.address !== payout.address;
      if (changed && existsSync(join(folder, FILES.marker))) throw new Refused(`this folder's first deal started, and its offer names ${earlier.address} as the payout address. For another payout address, make a new folder (--folder)`);
      state.payout = payout;
      done('payout');

      // Step 4: the deal template, and the adapter's configuration. The setup keeps a configuration only when the
      // file is the one it wrote: its SHA-256 is in crow.json. A folder that sells from a template keeps the template's
      // deliverable and checks as the adapter's deal template, and its price, format and window in crow.json; the same
      // command with another --template replaces them while no deal is open.
      if (sells === 'sample') {
        if (!existsSync(join(folder, FILES.template))) writeWhole(join(folder, FILES.template), `${JSON.stringify(SAMPLE.template, null, 2)}\n`);
      } else if (template) {
        writeWhole(join(folder, FILES.template), `${JSON.stringify({ deliverable: template.deliverable, checks: template.checks }, null, 2)}\n`);
        state.work = { price: template.price, format: template.deliverable.format, deliverWithinSec: template.deliverWithinSec };
        writeState(folder, state);
      } else if (!state.work || !existsSync(join(folder, FILES.template))) {
        throw new Refused(`${folder} sells from a template, and ${FILES.template} or its price in ${FILES.state} is gone: run the seller command with --template <file> again`);
      }
      done('template');
      if (finished) {
        // The finished work, copied into the folder: every deal delivers it once it is funded, after the checks pass.
        const dir = join(folder, WORK_DIR);
        if (at(dir)?.isSymbolicLink() || (at(dir) && !at(dir)!.isDirectory())) throw new Refused(`${WORK_DIR}/ is not a plain folder: the setup writes no work through a link. Remove it; the setup makes ${WORK_DIR}/ itself`);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        writeWhole(readyPath(folder, state.work!.format), finished);
      }
      const configFile = join(folder, FILES.configuration);
      const there = existsSync(configFile) ? readFileSync(configFile) : undefined;
      if (there && sha256(there) !== state.files?.configuration) throw new Refused(`${FILES.configuration} is not the file this setup wrote: it was changed, or another program put it there. The seller command keeps no configuration it did not write. Move that file away, then run the same command again to have it written anew`);
      if (!there || changed || template) {
        // The sample API keeps one port on the loopback address, free now and written here: the adapter starts a job
        // only at the address its offer was priced at, so a run that continues a deal must serve the API where the
        // first did. The adapter's own port is 0: the system picks one each run, and only this command asks it for a quote.
        const port = there ? Number(new URL((JSON.parse(there.toString('utf8')) as J).sellerApi.quote).port) : await freePort();
        // A folder that sells from a template takes no scope, has the work due when its template says, and looks at a
        // refused work file again at every poll, so a corrected file is delivered by the next run.
        const own = sells === 'template' ? { sellerApi: workAddresses(port), scope: {}, timing: { ...TIMING, deliverWithinSec: state.work!.deliverWithinSec }, redelivery: { refetchEverySec: 0 } } : { sellerApi: sampleAddresses(port), scope: SAMPLE.scope, timing: TIMING };
        const text = `${JSON.stringify({ port: 0, sellerApi: own.sellerApi, template: FILES.template, scope: own.scope, signingKey: 'per-deal', payoutAddress: payout.address, timing: own.timing, pollMs: 3000, ...('redelivery' in own ? { redelivery: own.redelivery } : {}) }, null, 2)}\n`;
        state.files = { ...state.files, configuration: sha256(text) };
        writeState(folder, state); // the hash first: a stop before the file is written leaves no file to refuse
        writeWhole(configFile, text);
      }
      done('configuration');

      // Step 5: the card, in a folder of its own. A draft: it names no address and no quote address until the party publishes one.
      mkdirSync(card, { recursive: true });
      const draft = (): boolean => {
        try {
          return String((JSON.parse(readFileSync(join(card, CARD_FILE), 'utf8')) as J).status).startsWith('draft');
        } catch {
          return false;
        }
      };
      // A new template rewrites the card only while it is still the setup's own draft.
      if (!existsSync(join(card, CARD_FILE)) || (template && draft())) {
        const sold = sells === 'template' ? { deliverable: (JSON.parse(readFileSync(join(folder, FILES.template), 'utf8')) as J).deliverable, amount: state.work!.price, scope: {} } : { deliverable: SAMPLE.template.deliverable, amount: SAMPLE_PRICE_UNITS, scope: SAMPLE.scope };
        writeWhole(join(card, CARD_FILE), `${JSON.stringify({ type: 'crow-agent', status: 'draft: not published, and no quote address yet', name, sells: [{ deliverable: sold.deliverable, price: { amount: sold.amount, unit: "base units of the settlement layer's test token" }, scope: sold.scope }] }, null, 2)}\n`, 0o644);
      }
      done('card');

      c.say({
        step: 'seller', ok: true, folder, card, address, payout: payout.address,
        keys: `${FILES.key} holds the signing key, mode 0600, on this machine only. Never read, print or copy it.`,
        ...(payout.thisKey ? { payoutNote: `Every deal names this folder's standing address ${address} as its payout address in its public terms, which links this folder's deals to one another. Its key is on this machine, in ${FILES.key}.` } : { payoutNote: `Every deal names ${payout.address} as its payout address in its public terms, which links this folder's deals to one another.` }),
        ...(sells === 'template' ? { sells: 'template', work: { ...state.work!, ready: existsSync(readyPath(folder, state.work!.format)) ? readyPath(folder, state.work!.format) : null }, workNote: existsSync(readyPath(folder, state.work!.format)) ? `Every deal of this folder delivers ${readyPath(folder, state.work!.format)} once it is funded and the file passes the deal's checks.` : `No work is finished yet: first-deal stops once the deal is funded and prints where the work goes and when it is due. To test the checks first, run check --work <a sample of the work>.` } : {}),
        sent: 'nothing',
        next: "Next, the listing step: list --website <https URL> sends your website to Crow's list of who uses it, and list --skip declines. No deal depends on it. Then first-deal.",
      });
      return 0;
    });
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    c.say({ step: 'folder', ok: false, detail: `${e.message}. Nothing was sent.` });
    return 1;
  }
}

/** Whether the folder's own files have the modes the setup gave them, as text for the check; '' when they do. */
export function modeProblem(folder: string): string {
  const linked = keyPlaceProblem(folder);
  if (linked) return linked;
  if (process.platform === 'win32') return '';
  const mode = (p: string) => statSync(join(folder, p)).mode & 0o777;
  if (mode(FILES.keys) !== 0o700) return `${FILES.keys}/ has mode ${mode(FILES.keys).toString(8)}, not 700`;
  if (mode(FILES.key) !== 0o600) return `${FILES.key} has mode ${mode(FILES.key).toString(8)}, not 600`;
  return '';
}
