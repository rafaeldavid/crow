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
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTermsYaml } from '@holdback/testkit';
import { checkDelivery } from './check-delivery.ts';
import { plain as plainLine } from './plain.ts';
import { fill, holdingKeyOf, loadConfig, type SellerAdapterConfig } from './seller-adapter.ts';
import { SAMPLE, SAMPLE_PRICE_UNITS, startSampleApi } from './setup-sample-api.ts';
import { FILES, formsOf, modeProblem, readKey, readState, type J } from './setup-seller.ts';

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

/** Every file under `dir`, by its full path, leaving the folder `skip` out wherever it is reached. */
function filesUnder(dir: string, skip: string): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (path === skip) continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) out.push(path);
    }
  };
  walk(dir);
  return out;
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
    if (typeof (JSON.parse(readFileSync(file, 'utf8')) as J).template !== 'string') throw new Error(`${FILES.configuration} names no template: this file carries none of its own, so name the folder's`);
    config = loaded;
    return `the adapter's own loader takes ${FILES.configuration}`;
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
    writeFileSync(join(folder, FILES.sampleTerms), `${JSON.stringify({ deliverable: t.deliverable, acceptance: t.acceptance }, null, 2)}\n`);
    writeFileSync(join(folder, FILES.sampleResult), bytes);
    const r = checkDelivery({ terms: join(folder, FILES.sampleTerms), file: join(folder, FILES.sampleResult) });
    if (r.exitCode !== 0) throw new Error(`the checks refuse the sample result. ${r.lines.filter((l) => /^Result|^ {2}FAIL|^ {2}OPEN/.test(l)).join(' ')}`);
    result = bytes;
    return `${bytes.length} bytes from the sample API. ${r.lines[0] ?? ''}`;
  });

  await run('required-field', () => {
    if (!result) throw new Error('not run: there is no sample result that passes');
    const cut = withoutAField(result, format);
    if (!cut) throw new Error(`a ${plain(format, 60)} result has no field this check can remove`);
    writeFileSync(join(folder, FILES.sampleCut), cut.bytes);
    const r = checkDelivery({ terms: join(folder, FILES.sampleTerms), file: join(folder, FILES.sampleCut) });
    if (r.exitCode !== 1) throw new Error(`the checks still pass the sample result with ${cut.what} removed: they do not check what the result holds`);
    return `the sample result with ${cut.what} removed fails the checks`;
  });

  await run('secrets', () => {
    const key = readKey(folder);
    const forms = [...formsOf(key), ...formsOf(holdingKeyOf(key))];
    // The folder and the card's folder, each file once; keys/ itself is left out wherever a walk reaches it.
    const files = new Set([folder, ...(state?.card && existsSync(state.card) ? [state.card] : [])].flatMap((dir) => filesUnder(dir, join(folder, FILES.keys))));
    for (const path of files) {
      if (statSync(path).size > 16 * 1024 * 1024) continue; // a key file is 67 bytes; a file this large is work, not a note
      const text = readFileSync(path, 'latin1');
      if (forms.some((f) => text.includes(f))) throw new Error(`${path} holds a key's value: a key belongs in ${FILES.keys}/ only. Remove it from that file`);
    }
    return `no key's value in the ${files.size} files outside ${FILES.keys}/`;
  });
  return results;
}
