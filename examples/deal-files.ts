// The files a finished deal leaves on the buyer's machine (T-617): the deal record, and on a release the work. A
// buyer's agent then has both with no further command. They go in `<key store>-files/`, beside the key store and never
// in it: the work is the seller's data, and a folder a buyer passes on must hold no key. Nothing the seller wrote
// names a path: the file names are the commitment ID, and the work's ending comes from the closed list below. A file
// already there is never overwritten, and no link is written through.
//
// Saving never holds back or fails the deal's command. The work is written at once, from bytes already checked. The
// record is read from the operators only after every outcome is printed, one deal at a time, each read under a time
// limit, and the process then ends: an operator that never answers delays the exit by that limit and no more. A
// problem is told in this file's own words, never an error's: an operator's answer can reach an error's text, and an
// agent reads what the command prints. Not bounded here: the work of checking an operator's very large answers
// (dealRecord's own), which can delay the exit, though not the outcome.
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, normalize, resolve, sep } from 'node:path';

/** The work file's ending for the formats a plain text file may carry; any other format is saved as .txt. */
const ENDINGS: ReadonlyMap<unknown, string> = new Map([['text/csv', 'csv'], ['application/json', 'json'], ['text/markdown', 'md']]);
/** How long one deal's record may take to read before the command gives up on it. */
const RECORD_WITHIN_MS = 30_000;
/** The most records one deal keeps: each later run of resume or approve adds one. */
const MOST_RECORDS = 100;

export interface WorkSaved {
  /** The work's file, or null: nothing was released, or it was not saved (see `problems`). */
  work: string | null;
  problems?: string[];
}

export interface RecordSaved {
  commitmentId: string;
  /** The deal record's file, or null when it was not saved (see `problems`). */
  file: string | null;
  /** How the record's checks came out, and the sections the operators gave different answers for. */
  checks?: { passed: number; notRun: number; failed: number };
  disagreements?: string[];
  problems?: string[];
}

export interface Deal {
  /** The key store directory, as the command was given it. */
  store: string;
  commitmentId: string;
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

/** The folder for one deal's files, made if need be, and the deal's ID; or why nothing can be saved, in fixed words. */
function ready(d: Deal): { folder: string; id: string } | { problem: string } {
  const id = d.commitmentId.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(id)) return { problem: 'the commitment ID is not 0x and 64 hex digits' };
  const folder = folderFor(d.store);
  try {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    if (!lstatSync(folder).isDirectory()) return { problem: `${folder} is a link or a file, not a folder of its own` };
  } catch (e) { return { problem: `${folder} cannot be made${code(e)}` }; }
  return { folder, id };
}

/** A file system error's code, such as " (EACCES)", and nothing else of the error. */
const code = (e: unknown) => {
  const c = (e as NodeJS.ErrnoException)?.code;
  return typeof c === 'string' && /^E[A-Z]+$/.test(c) ? ` (${c})` : '';
};

/** Saves the work, when any was released. It never throws. `format` is the seller's own words: only looked up. */
export function saveWork(d: Deal & { work: string | null; format?: unknown }): WorkSaved {
  if (d.work === null) return { work: null };
  const no = (problem: string): WorkSaved => ({ work: null, problems: [`the work was not saved: ${problem}`] });
  try {
    const at = ready(d);
    if ('problem' in at) return no(at.problem);
    const path = join(at.folder, `${at.id}.work.${ENDINGS.get(d.format) ?? 'txt'}`);
    if (writeNew(path, d.work) || (lstatSync(path).isFile() && readFileSync(path, 'utf8') === d.work)) return { work: path };
    return no(`${path} already holds something else`);
  } catch (e) { return no(`its file cannot be written${code(e)}`); }
}

const LATE = Symbol('late');

/** What `read` gives, or LATE once `ms` have passed. The read goes on: only ending the process stops it. */
async function within<T>(read: Promise<T>, ms: number): Promise<T | typeof LATE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof LATE>((resolve) => { timer = setTimeout(() => resolve(LATE), ms); });
  try { return await Promise.race([read, late]); } finally { clearTimeout(timer); }
}

async function saveRecord(d: Deal & { record: () => Promise<unknown> }, ms: number): Promise<RecordSaved> {
  const commitmentId = d.commitmentId.toLowerCase();
  const no = (problem: string): RecordSaved => ({ commitmentId, file: null, problems: [`the record was not saved: ${problem}`] });
  let record: { checks?: Array<{ ok: boolean | null }>; disagreements?: Array<{ section: string }> };
  let text: string;
  try {
    const got = await within(d.record(), ms);
    if (got === LATE) return no(`not read within ${ms / 1000} s`);
    record = got as typeof record;
    text = `${JSON.stringify(record, null, 2)}\n`;
  } catch { return no("it could not be built from the operators' answers"); }
  try {
    const at = ready(d);
    if ('problem' in at) return no(at.problem);
    for (let n = 1; n <= MOST_RECORDS; n++) {
      const path = join(at.folder, `${at.id}.record${n === 1 ? '' : `-${n}`}.json`);
      if (!writeNew(path, text)) continue;
      const count = (ok: boolean | null) => (record.checks ?? []).filter((c) => c.ok === ok).length;
      return { commitmentId, file: path, checks: { passed: count(true), notRun: count(null), failed: count(false) }, disagreements: (record.disagreements ?? []).map((x) => x.section) };
    }
    return no(`${at.folder} holds ${MOST_RECORDS} records of this deal already`);
  } catch (e) { return no(`its file cannot be written${code(e)}`); }
}

/** Ends the process with the exit code already set, once what it printed has left it: a late read cannot keep it open. */
const endProcess = () => process.stdout.write('', () => process.stderr.write('', () => process.exit(process.exitCode ?? 0)));

/**
 * Saves each finished deal's record, one at a time, so the reads of several deals do not share the operators' rate
 * limits at once, says how each went as `{"record": ...}`, and then ends the process. With no deal, it does nothing.
 */
export async function saveRecords(deals: Array<Deal & { record: () => Promise<unknown> }>, say: (line: { record: RecordSaved }) => void, o: { withinMs?: number; end?: () => void } = {}): Promise<void> {
  if (deals.length === 0) return;
  for (const d of deals) say({ record: await saveRecord(d, o.withinMs ?? RECORD_WITHIN_MS) });
  (o.end ?? endProcess)();
}
