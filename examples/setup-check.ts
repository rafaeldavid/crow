// `node setup.mjs check` (T-472): the conformance check. One result per check; the setup is good only when all pass,
// and `first-deal` runs it first and refuses after a failure. It makes no request to an operator, the faucet, a test
// agent or crow.direct, and posts no terms anywhere: it reads the folder, and asks the folder's own sample API, on the
// loopback address inside this process, for one result.
//
//   folder          keys/ is mode 0700, the key file 0600, and .gitignore covers keys/
//   configuration   the seller adapter's own loader takes adapter.json, which names its own template
//   template        the template, filled with the sample scope and stand-in values for the club and the adjudicators,
//                   passes the bundled commitment schema: the terms are ones the operators will take
//   sample          a result the sample API gives passes the deal's checks, through the adjudicator's first stage
//   required-field  the same result with a field removed fails them: the checks are not empty
//   secrets         no key's value is in a file outside keys/, in the folder or in the card's folder
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTermsYaml } from '@holdback/testkit';
import { checkDelivery } from './check-delivery.ts';
import { plain as plainLine } from './plain.ts';
import type { Hex } from 'viem';
import { dealKeyOf, fill, holdingKeyOf, loadConfig, type SellerAdapterConfig } from './seller-adapter.ts';
import { SAMPLE, SAMPLE_PRICE_UNITS, sampleAddresses, startSampleApi } from './setup-sample-api.ts';
import { FILES, formsOf, modeProblem, readKey, readState, type J } from './setup-seller.ts';

/** The largest file the secrets check reads: 16 MiB. A key file is 67 bytes; a larger file is named, not read. */
const MAX_SCANNED_BYTES = 16 * 1024 * 1024;

export interface CheckResult {
  check: string;
  ok: boolean;
  detail: string;
}

const plain = (s: unknown, max = 600) => plainLine(String(s ?? '')).slice(0, max);
/** A stand-in for the settlement layer's token: the check posts nothing, so no operator names the real one. */
const STAND_IN_TOKEN = 'tUSD';
const NOT_RUN = 'not run: the configuration does not load';

/** The template's deliverable and acceptance for one scope, as an offer carries them. */
function filledTerms(config: SellerAdapterConfig, scope: J): { deliverable: J; acceptance: J; fee: J } {
  const template = JSON.parse(readFileSync(config.template, 'utf8')) as J;
  const filled = fill({ deliverable: template.deliverable, checks: template.checks, rubric: template.rubric ?? { criteria: [], passThreshold: 0 } }, scope);
  return { deliverable: filled.deliverable, acceptance: { deterministicChecks: filled.checks, rubric: filled.rubric }, fee: template.fee };
}

/** One result of the folder's sample API for `scope`, by the three calls the adapter makes. */
async function sampleResultOf(scope: J): Promise<Uint8Array> {
  const api = await startSampleApi(STAND_IN_TOKEN);
  try {
    const post = async (url: string, body: J, headers: Record<string, string> = {}) => {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
      const answer = (await res.json().catch(() => null)) as J;
      if (res.status !== 200) throw new Error(`the sample API answered ${res.status} to ${new URL(url).pathname}: ${plain(answer?.detail, 200)}`);
      return answer;
    };
    const quote = await post(api.api.quote, { scope });
    if (typeof quote?.price?.token !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(String(quote?.price?.amount))) throw new Error('the sample API quoted no price in base units');
    const job = await post(api.api.start, { commitmentId: `0x${'00'.repeat(32)}`, quoteId: quote.quoteId, scope }, { 'idempotency-key': 'setup-check' });
    const res = await fetch(api.api.result.replace('{jobId}', encodeURIComponent(String(job?.jobId))), { signal: AbortSignal.timeout(10_000) });
    if (res.status !== 200) throw new Error(`the sample API answered ${res.status} for the result`);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    await api.close();
  }
}

/** `result` with one field removed, and what was removed: the last column of a CSV, or the first field of a JSON object. */
function withoutAField(result: Uint8Array, format: string): { bytes: Uint8Array; what: string } | null {
  const text = new TextDecoder().decode(result);
  if (format === 'text/csv') {
    const lines = text.split('\n');
    const header = (lines[0] ?? '').split(',');
    if (header.length < 2) return null;
    return { bytes: new TextEncoder().encode(lines.map((l) => (l === '' ? l : l.split(',').slice(0, -1).join(','))).join('\n')), what: `its last column, ${plain(header.at(-1), 60)},` };
  }
  if (format === 'application/json') {
    const value = JSON.parse(text) as J;
    const key = value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value)[0] : undefined;
    if (key === undefined) return null;
    delete value[key];
    return { bytes: new TextEncoder().encode(JSON.stringify(value)), what: `its first field, ${plain(key, 60)},` };
  }
  return null;
}

/** True when `e` says the path is not there: another run removed it after it was listed (T-486, the CI race). */
const gone = (e: unknown): boolean => (e as NodeJS.ErrnoException)?.code === 'ENOENT';

/** Every file under `dir`, by its full path, leaving the folder `skip` out wherever it is reached. A link is listed, never followed. */
function filesUnder(dir: string, skip: string): { files: string[]; links: string[] } {
  const files: string[] = [], links: string[] = [];
  const walk = (at: string) => {
    let entries;
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch (e) {
      if (gone(e) && at !== dir) return; // a folder another run removed after it was listed: nothing in it to read
      throw e;
    }
    for (const entry of entries) {
      const path = join(at, entry.name);
      if (path === skip) continue;
      if (entry.isSymbolicLink()) links.push(path);
      else if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  walk(dir);
  return { files, links };
}

/** What writeWhole needs of the file system; the test passes its own to see the order of the two steps. */
export interface WriteIo {
  write(path: string, data: string | Uint8Array): void;
  rename(from: string, to: string): void;
}
const WRITE_FILE_SYSTEM: WriteIo = { write: (p, d) => writeFileSync(p, d), rename: (a, b) => renameSync(a, b) };

/**
 * Writes `data` to `path` whole: to a temporary name of its own beside it, then renamed into place. Another run that
 * reads `path` at the same moment sees the file it had or the new one, never a half-written file (T-486: CI caught one
 * run's check reading sample/terms.json while another run was writing it).
 */
export function writeWhole(path: string, data: string | Uint8Array, io: WriteIo = WRITE_FILE_SYSTEM): void {
  const part = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.part`;
  io.write(part, data);
  io.rename(part, path);
}

/** What the secrets check needs of the file system; the test passes its own to make a file vanish between two steps. */
export interface ScanIo {
  size(path: string): number;
  read(path: string): string;
}
const FILE_SYSTEM: ScanIo = { size: (p) => statSync(p).size, read: (p) => readFileSync(p, 'latin1') };

/**
 * Reads each listed file and fails on the first that holds one of `forms`, a key's value. A file that is gone when it is
 * read was removed after it was listed, by another run working in the same folder (its `crow.lock`, a temporary file):
 * it holds nothing now, so it is passed over and counted, not a finding. Any other error still fails the check. Every
 * file is read, `crow.lock` included: leaving one name out would make a place a key could sit unseen.
 */
export function scanFiles(files: Iterable<string>, forms: string[], io: ScanIo = FILE_SYSTEM): { read: number; large: string[]; gone: number } {
  let read = 0, vanished = 0;
  const large: string[] = [];
  for (const path of files) {
    let text: string;
    try {
      if (io.size(path) > MAX_SCANNED_BYTES) {
        large.push(path);
        continue;
      }
      text = io.read(path);
    } catch (e) {
      if (!gone(e)) throw e;
      vanished += 1;
      continue;
    }
    if (forms.some((f) => text.includes(f))) throw new Error(`${path} holds a key's value: a key belongs in ${FILES.keys}/ only. Remove it from that file`);
    read += 1;
  }
  return { read, large, gone: vanished };
}

/** The key of each deal the folder's journal holds: each is derived from the signing key and the deal's own nonce. */
function dealKeysOf(folder: string, key: Hex): Hex[] {
  let deals: J[] = [];
  try {
    deals = Object.values((JSON.parse(readFileSync(join(folder, FILES.journal), 'utf8')) as J).deals ?? {});
  } catch {
    return []; // no journal yet: no deal, no deal key
  }
  return deals.map((d) => d?.terms?.nonce).filter((n): n is Hex => typeof n === 'string' && /^0x[0-9a-f]{64}$/.test(n)).map((n) => dealKeyOf(key, n));
}

/** Runs every check on the folder and returns the results in order. Writes only under the folder's sample/. */
export async function runChecks(folder: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const run = async (check: string, body: () => string | Promise<string>) => {
    try {
      results.push({ check, ok: true, detail: await body() });
    } catch (e) {
      results.push({ check, ok: false, detail: plain((e as Error).message) });
    }
  };
  const state = readState(folder);

  await run('folder', () => {
    if (!state) throw new Error(`${folder} has no ${FILES.state}: run the seller command first`);
    const wrong = modeProblem(folder);
    if (wrong) throw new Error(`${wrong}: another account on this machine could read the key`);
    const ignore = existsSync(join(folder, FILES.ignore)) ? readFileSync(join(folder, FILES.ignore), 'utf8').split('\n').map((l) => l.trim()) : [];
    if (!ignore.includes('keys/')) throw new Error(`${FILES.ignore} does not cover keys/`);
    return 'keys/ is mode 700, the key file 600, and .gitignore covers keys/';
  });

  let config: SellerAdapterConfig | undefined;
  await run('configuration', () => {
    const file = join(folder, FILES.configuration);
    const loaded = loadConfig(file);
    const written = JSON.parse(readFileSync(file, 'utf8')) as J;
    if (typeof written.template !== 'string') throw new Error(`${FILES.configuration} names no template: this file carries none of its own, so name the folder's`);
    // The payout address the person gave is the one every offer will name: the adapter reads it from this file only.
    const pays = typeof written.payoutAddress === 'string' ? written.payoutAddress.toLowerCase() : undefined;
    if (!state?.payout || pays !== state.payout.address) throw new Error(`${FILES.configuration} pays ${plain(pays ?? 'the signing key, as it names no payoutAddress', 80)}, and the answer in ${FILES.state} is ${plain(state?.payout?.address ?? 'missing', 80)}: every offer would name the first. To change where you are paid, run the seller command with --payout`);
    if (state.sells === 'sample') {
      // A folder that sells the sample calls nothing but the sample API on the loopback address, at its one port.
      const api = written.sellerApi as J;
      const port = typeof api?.quote === 'string' && URL.canParse(api.quote) ? Number(new URL(api.quote).port) : 0;
      const own = sampleAddresses(port);
      if (!(port > 0) || Object.keys(api ?? {}).sort().join() !== 'quote,result,start' || api.quote !== own.quote || api.start !== own.start || api.result !== own.result) throw new Error(`${FILES.configuration} does not name the sample API at one port on the loopback address for all three calls, as the seller command wrote it: a job would start somewhere else`);
      for (const field of ['alerts', 'quoteAuth', 'redelivery', 'reportMapping', 'mandate', 'clubId', 'adjudicators']) if (written[field] !== undefined) throw new Error(`${FILES.configuration} sets ${field}, which a folder that sells the sample does not use: remove it`);
    }
    config = loaded;
    return `the adapter's own loader takes ${FILES.configuration}, which pays ${state.payout.address}`;
  });

  const scope = SAMPLE.firstScope;
  await run('template', () => {
    if (!config) throw new Error(NOT_RUN);
    const t = filledTerms(config, scope);
    const money = (amount: string) => ({ token: STAND_IN_TOKEN, amount });
    const terms = {
      schemaVersion: '0.8', clubId: 'stand-in-club', deliverable: t.deliverable, acceptance: t.acceptance, price: money(SAMPLE_PRICE_UNITS),
      adjudication: { policyId: 'stand-in-policy', fee: money(typeof t.fee?.amount === 'string' ? t.fee.amount : '1000000') },
      timing: { ...config.timing, maxSubmissions: 1 }, settlement: { mode: 'guaranteed_on_decision', token: STAND_IN_TOKEN }, remedy: { onReject: 'full_refund' }, disclosure: { level: 'public' },
    };
    // JSON is YAML: the testkit's loader builds a whole commitment from it with stand-in parties and runs the bundled schema.
    parseTermsYaml(JSON.stringify(terms), FILES.template);
    return 'the template, filled with the sample scope, passes the bundled commitment schema';
  });

  let result: Uint8Array | undefined;
  let format = '';
  await run('sample', async () => {
    if (!config) throw new Error(NOT_RUN);
    const t = filledTerms(config, scope);
    format = String(t.deliverable?.format);
    const bytes = await sampleResultOf(scope);
    mkdirSync(join(folder, 'sample'), { recursive: true });
    writeWhole(join(folder, FILES.sampleTerms), `${JSON.stringify({ deliverable: t.deliverable, acceptance: t.acceptance }, null, 2)}\n`);
    writeWhole(join(folder, FILES.sampleResult), bytes);
    const r = checkDelivery({ terms: join(folder, FILES.sampleTerms), file: join(folder, FILES.sampleResult) });
    if (r.exitCode !== 0) throw new Error(`the checks refuse the sample result. ${r.lines.filter((l) => /^Result|^ {2}FAIL|^ {2}OPEN/.test(l)).join(' ')}`);
    result = bytes;
    return `${bytes.length} bytes from the sample API. ${r.lines[0] ?? ''}`;
  });

  await run('required-field', () => {
    if (!result) throw new Error('not run: there is no sample result that passes');
    const cut = withoutAField(result, format);
    if (!cut) throw new Error(`a ${plain(format, 60)} result has no field this check can remove`);
    writeWhole(join(folder, FILES.sampleCut), cut.bytes);
    const r = checkDelivery({ terms: join(folder, FILES.sampleTerms), file: join(folder, FILES.sampleCut) });
    if (r.exitCode !== 1) throw new Error(`the checks still pass the sample result with ${cut.what} removed: they do not check what the result holds`);
    return `the sample result with ${cut.what} removed fails the checks`;
  });

  await run('secrets', () => {
    const key = readKey(folder);
    // The signing key, the faucet holding key it derives, and the key of each deal in the journal.
    const forms = [key, holdingKeyOf(key), ...dealKeysOf(folder, key)].flatMap(formsOf);
    // The folder and the card's folder, each file once; keys/ itself is left out wherever a walk reaches it.
    const found = [folder, ...(state?.card && existsSync(state.card) ? [state.card] : [])].map((dir) => filesUnder(dir, join(folder, FILES.keys)));
    const files = new Set(found.flatMap((f) => f.files)), links = [...new Set(found.flatMap((f) => f.links))];
    const { read, large, gone: vanished } = scanFiles(files, forms);
    return `no key's value in the ${read} files read outside ${FILES.keys}/`
      + (vanished ? `; ${vanished} listed file${vanished === 1 ? ' was' : 's were'} gone when read, removed by another run in this folder` : '')
      + (large.length ? `; not read, as each is over ${MAX_SCANNED_BYTES} bytes: ${large.map((p) => plain(p, 200)).join(', ')}` : '')
      + (links.length ? `; not followed, as each is a symbolic link: ${links.map((p) => plain(p, 200)).join(', ')}` : '');
  });
  return results;
}
