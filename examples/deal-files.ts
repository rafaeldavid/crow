// The files a finished deal leaves on the buyer's machine (T-617): the deal record, and on a release the work. A
// buyer's agent then has both with no further command. They go in `<key store>-files/`, beside the key store and never
// in it: the work is the seller's data, and a folder a buyer passes on must hold no key. Nothing the seller wrote
// names a path: the file names are the commitment ID, and the work's ending comes from the closed list below. A file
// already there is never overwritten, and no link is written through. Saving never fails the deal's command: the
// outcome is settled before this runs, so what could not be saved is only reported.
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, normalize, resolve, sep } from 'node:path';

/** The work file's ending for the formats a plain text file may carry; any other format is saved as .txt. */
const ENDINGS: ReadonlyMap<unknown, string> = new Map([['text/csv', 'csv'], ['application/json', 'json'], ['text/markdown', 'md']]);
/** How long the record's reads may take before the outcome is reported without it. */
const RECORD_WITHIN_MS = 30_000;
/** The most records one deal keeps: each later run of resume or approve adds one. */
const MOST_RECORDS = 100;

export interface SavedFiles {
  /** The work's file, or null: nothing was released, or it was not saved (see `problems`). */
  work: string | null;
  /** The deal record's file, or null when it was not saved. */
  record: string | null;
  /** How the record's checks came out, and the sections the operators gave different answers for. */
  checks?: { passed: number; notRun: number; failed: number };
  disagreements?: string[];
  problems?: string[];
}

export interface DealFiles {
  /** The key store directory, as the command was given it. */
  store: string;
  commitmentId: string;
  /** The work's text, or null when none was released. */
  work: string | null;
  /** The format the terms name for the deliverable: the seller's own words, so only looked up, never used. */
  format?: unknown;
  /** Reads the deal record from the operators. */
  record: () => Promise<unknown>;
  recordWithinMs?: number;
}

/** `<key store>-files`, beside the store; a store named "." or ".." is resolved first. */
function folderFor(store: string): string {
  let s = normalize(store);
  while (s.length > 1 && s.endsWith(sep)) s = s.slice(0, -1);
  if (['', '.', '..'].includes(basename(s))) s = resolve(store);
  return join(dirname(s), `${basename(s)}-files`);
}

/** Writes a new file, mode 0600. False when something, a link included, is there already. */
function writeNew(path: string, text: string): boolean {
  try {
    writeFileSync(path, text, { flag: 'wx', mode: 0o600 }); // wx: the open fails on any file or link at this path
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw e;
  }
}

const why = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

/** The record, or a throw once `ms` have passed. */
async function within<T>(read: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`not read within ${ms / 1000} s`)), ms); });
  try { return await Promise.race([read, late]); } finally { clearTimeout(timer); }
}

/** Saves what one finished deal leaves. It never throws: what failed is named in `problems`. */
export async function saveDealFiles(d: DealFiles): Promise<SavedFiles> {
  const saved: SavedFiles = { work: null, record: null };
  const problems: string[] = [];
  const done = () => (problems.length ? { ...saved, problems } : saved);
  const id = d.commitmentId.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(id)) { problems.push('nothing was saved: the commitment ID is not 0x and 64 hex digits'); return done(); }
  let folder: string;
  try {
    folder = folderFor(d.store);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    if (!lstatSync(folder).isDirectory()) throw new Error(`${folder} is a link or a file, not a folder of its own`);
  } catch (e) {
    problems.push(`nothing was saved: ${why(e)}`);
    return done();
  }
  if (d.work !== null) {
    const path = join(folder, `${id}.work.${ENDINGS.get(d.format) ?? 'txt'}`);
    try {
      if (writeNew(path, d.work) || (lstatSync(path).isFile() && readFileSync(path, 'utf8') === d.work)) saved.work = path;
      else problems.push(`the work was not saved: ${path} already holds something else`);
    } catch (e) { problems.push(`the work was not saved: ${why(e)}`); }
  }
  try {
    const record = (await within(d.record(), d.recordWithinMs ?? RECORD_WITHIN_MS)) as { checks?: Array<{ ok: boolean | null }>; disagreements?: Array<{ section: string }> };
    const text = `${JSON.stringify(record, null, 2)}\n`;
    for (let n = 1; n <= MOST_RECORDS && saved.record === null; n++) {
      const path = join(folder, `${id}.record${n === 1 ? '' : `-${n}`}.json`);
      if (writeNew(path, text)) saved.record = path;
    }
    if (saved.record === null) problems.push(`the record was not saved: ${folder} holds ${MOST_RECORDS} records of this deal already`);
    else {
      const count = (ok: boolean | null) => (record.checks ?? []).filter((c) => c.ok === ok).length;
      saved.checks = { passed: count(true), notRun: count(null), failed: count(false) };
      saved.disagreements = (record.disagreements ?? []).map((x) => x.section);
    }
  } catch (e) { problems.push(`the record was not saved: ${why(e)}`); }
  return done();
}
