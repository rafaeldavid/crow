// The files a finished deal leaves on the buyer's machine (T-617): the deal record, and on a release the work. A
// buyer's agent then has both with no further command. They go in `<key store>-files/`, beside the key store and never
// in it: the work is the seller's data, and a folder a buyer passes on must hold no key. So a folder that holds a key
// store's files is refused, and so is one that another user owns, or may enter where they may not enter the key store.
// Nothing the seller wrote names a path: the file names are the commitment ID, and the work's ending comes from the
// closed list below. A file already there is never overwritten, no link is written through, and a file appears
// whole or not at all.
//
// Saving never holds back the outcome. The work is written at once, from bytes already checked. A deal's record is read
// from the operators after its outcome is printed, under a time limit, and the process ends once every record is done:
// an operator that never answers delays the exit by that limit after the last outcome, and no more. A problem is told
// in this file's own words, never an error's: an operator's answer can reach an error's text, and an agent reads what
// the command prints. Not bounded here: how much memory and time checking an operator's very large answers takes
// (dealRecord's own), which can delay the exit or crash it, though not before the outcome is printed.
import { closeSync, constants, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The work file's ending for the formats a plain text file may carry; any other format is saved as .txt. */
const ENDINGS: ReadonlyMap<unknown, string> = new Map([['text/csv', 'csv'], ['application/json', 'json'], ['text/markdown', 'md']]);
/** How long one deal's record may take to read before the command gives up on it. */
const RECORD_WITHIN_MS = 30_000;
/** The most records one deal keeps: each later run of resume or approve adds one. */
const MOST_RECORDS = 100;
/** A file only a key store holds: a key, or what the signer writes beside it, each named by the signing address. */
const KEY_STORE_FILE = /^0x[0-9a-f]{40}(\.[a-z-]+)*\.json(\.tmp)?$/;
/** What a file system with no hard links answers, such as a FAT-formatted drive. */
const NO_HARD_LINKS: ReadonlySet<unknown> = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV']);

export interface WorkSaved {
  /** The work's file, or null: nothing was released, or it was not saved (see `problems`). */
  work: string | null;
  problems?: string[];
}

export interface RecordSaved {
  commitmentId: string;
  /** The deal record's file, or null when it was not saved (see `problems`). */
  file: string | null;
  /** How many of the record's checks passed, and the names of those that failed and those it could not run. */
  checks?: { passed: number; failed: string[]; notRun: string[] };
  /** The sections the operators gave different answers for. */
  disagreements?: string[];
  problems?: string[];
}

export interface Deal {
  /** The key store directory, as the command was given it. */
  store: string;
  commitmentId: string;
}

/** A file system error's code, such as "EACCES", or null. Nothing else of an error is ever told. */
const codeOf = (e: unknown) => {
  const c = (e as NodeJS.ErrnoException)?.code;
  return typeof c === 'string' && /^E[A-Z]+$/.test(c) ? c : null;
};
const coded = (e: unknown) => (codeOf(e) ? ` (${codeOf(e)})` : '');

/** The folder for one deal's files, `<key store>-files` by its full path, made if need be; or why none will do. */
function ready(d: Deal): { folder: string; id: string } | { problem: string } {
  const id = d.commitmentId.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(id)) return { problem: 'the commitment ID is not 0x and 64 hex digits' };
  const folder = `${resolve(d.store)}-files`;
  try {
    const store = statSync(d.store);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const at = lstatSync(folder);
    if (!at.isDirectory()) return { problem: `${folder} is a link or a file, not a folder of its own` };
    // The key store is the buyer's own: its owner and its mode are the measure, on any file system.
    if (at.uid !== store.uid || (at.mode & ~store.mode & 0o077) !== 0) return { problem: `${folder} is another user's, or open to other users where the key store is not: set its mode to 700 if it is yours, or move it away` };
    if (readdirSync(folder).some((name) => KEY_STORE_FILE.test(name))) return { problem: `${folder} holds a key store's files: give this deal a key store of another name` };
  } catch (e) { return { problem: `${folder} cannot be used${coded(e)}` }; }
  return { folder, id };
}

/** Writes a new file in place, mode 0600. False when something is there already; a write cut short leaves nothing. */
function writeInPlace(path: string, text: string): boolean {
  try {
    writeFileSync(path, text, { flag: 'wx', mode: 0o600 }); // wx: the open fails on any file or link at this path
    return true;
  } catch (e) {
    if (codeOf(e) === 'EEXIST') return false;
    rmSync(path, { force: true });
    throw e;
  }
}

/** Writes a new file, whole or not at all: beside it first, then linked to its name, which never replaces. */
function writeNew(path: string, text: string): boolean {
  const part = `${path}.part-${Math.random().toString(36).slice(2, 10)}`;
  try {
    if (!writeInPlace(part, text)) throw new Error('a part file of that name is there');
    try {
      linkSync(part, path);
      return true;
    } catch (e) {
      if (codeOf(e) === 'EEXIST') return false;
      if (!NO_HARD_LINKS.has(codeOf(e))) throw e;
      return writeInPlace(path, text);
    }
  } finally { rmSync(part, { force: true }); }
}

/** Whether `path` is a plain file holding exactly these bytes. It follows no link and waits on no pipe. */
function holds(path: string, bytes: Buffer): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const at = fstatSync(fd); // the file that was opened, whatever is at the path by now
    return at.isFile() && at.size === bytes.length && readFileSync(fd).equals(bytes);
  } catch { return false; } finally { if (fd !== undefined) closeSync(fd); }
}

/** A text's hash as a signed delivery writes its plaintextSha256. */
const sha256 = async (text: string) => `sha256:${Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('hex')}`;

/**
 * Saves the work, when any was released. It never throws. `format` is the seller's own words: only looked up.
 * `signedSha256`, for late work, is the hash the seller signed: the decoder that read that work drops a leading byte
 * order mark, so the file gets it back, and no file is saved that would not hash to the signed one.
 */
export async function saveWork(d: Deal & { work: string | null; format?: unknown; signedSha256?: unknown }): Promise<WorkSaved> {
  if (d.work === null) return { work: null };
  const no = (problem: string): WorkSaved => ({ work: null, problems: [`the work was not saved: ${problem}`] });
  try {
    let text = d.work;
    if (d.signedSha256 !== undefined) {
      const signed = String(d.signedSha256);
      if ((await sha256(text)) !== signed) {
        text = `﻿${d.work}`;
        if ((await sha256(text)) !== signed) return no("its text does not hash to the signed delivery's hash");
      }
    }
    const at = ready(d);
    if ('problem' in at) return no(at.problem);
    const path = join(at.folder, `${at.id}.work.${ENDINGS.get(d.format) ?? 'txt'}`);
    if (writeNew(path, text) || holds(path, Buffer.from(text, 'utf8'))) return { work: path };
    return no(`${path} already holds something else`);
  } catch (e) { return no(`its file cannot be written${coded(e)}`); }
}

const LATE = Symbol('late');

/** What `read` gives, or LATE once `ms` have passed. The read goes on: only ending the process stops it. */
async function within<T>(read: Promise<T>, ms: number): Promise<T | typeof LATE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof LATE>((done) => { timer = setTimeout(() => done(LATE), ms); });
  try { return await Promise.race([read, late]); } finally { clearTimeout(timer); }
}

type Summary = Required<Pick<RecordSaved, 'checks' | 'disagreements'>>;

/** The record's checks by name. The names are dealRecord's own words; each check's reason stays in the file. */
function summary(record: { checks: Array<{ check: string; ok: boolean | null }>; disagreements: Array<{ section: string }> }): Summary {
  const names = (ok: false | null) => [...new Set(record.checks.filter((c) => c.ok === ok).map((c) => c.check))];
  return { checks: { passed: record.checks.filter((c) => c.ok === true).length, failed: names(false), notRun: names(null) }, disagreements: record.disagreements.map((x) => x.section) };
}

async function saveRecord(d: Deal & { record: () => Promise<unknown> }, ms: number): Promise<RecordSaved> {
  const commitmentId = d.commitmentId.toLowerCase();
  const no = (problem: string): RecordSaved => ({ commitmentId, file: null, problems: [`the record was not saved: ${problem}`] });
  let told: Summary;
  let text: string;
  try {
    const got = await within(d.record(), ms);
    if (got === LATE) return no(`not read within ${ms / 1000} s`);
    told = summary(got as Parameters<typeof summary>[0]);
    text = `${JSON.stringify(got, null, 2)}\n`;
  } catch { return no("it could not be built from the operators' answers"); }
  try {
    const at = ready(d);
    if ('problem' in at) return no(at.problem);
    for (let n = 1; n <= MOST_RECORDS; n++) {
      const path = join(at.folder, `${at.id}.record${n === 1 ? '' : `-${n}`}.json`);
      if (writeNew(path, text)) return { commitmentId, file: path, ...told };
    }
    return no(`${at.folder} holds ${MOST_RECORDS} records of this deal already`);
  } catch (e) { return no(`its file cannot be written${coded(e)}`); }
}

/** Ends the process with the exit code already set, once what it printed has left it: a late read cannot keep it open. */
const endProcess = () => process.stdout.write('', () => process.stderr.write('', () => process.exit(process.exitCode ?? 0)));

/**
 * Each finished deal's record. `add`, once a deal's outcome is printed: its record is read and saved then, while any
 * other deal is still followed, and told as `{"record": ...}`. `end`, once no deal is followed any more: it waits for
 * the records and then ends the process. With no deal added, it does nothing.
 */
export function keepRecords(say: (line: { record: RecordSaved }) => void, o: { withinMs?: number; end?: () => void } = {}) {
  const saving: Array<Promise<void>> = [];
  return {
    add(d: Deal & { record: () => Promise<unknown> }): void {
      saving.push(saveRecord(d, o.withinMs ?? RECORD_WITHIN_MS).then((record) => say({ record })));
    },
    async end(): Promise<void> {
      if (saving.length === 0) return;
      await Promise.all(saving);
      (o.end ?? endProcess)();
    },
  };
}
