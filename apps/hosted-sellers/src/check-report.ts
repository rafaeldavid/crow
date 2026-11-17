// The local report check (T-502): runs a finished job's answer through every step the hosted seller runs before it
// delivers, on this machine, before anything is submitted. It reads the seller's folder as the deploy does
// (readSellerFolder, checkBundle), answers the seller API's result call, and its artifacts or report call, from
// files with the API client's own code (sellerApiClient with a local fetch), and then calls the deal loop's own
// checkResult: the files, the report mapping, the salt, the adjudicator's intake and every agreed check. So it cannot
// disagree with the live preflight on the same answer, scope and terms.
//
// It sends nothing anywhere: the local fetch answers every request from the given files and refuses any other. No
// key is read and no credential is used; the credential variables the configuration names get a placeholder value
// that only the local fetch sees.
import { acceptanceFor, checkResult, resultRefusal, type FailedCheck } from '../../../examples/seller-adapter-core.ts';
import { pointerParts, sellerApiClient } from '../../../examples/seller-adapter-api.ts';
import { parseReportMapping } from '../../../examples/report-converter.ts';
import { reasonLine, reasonOf, type RefusalReason } from '../../../examples/seller-refusal.ts';
import { checkBundle } from './bundle.ts';
import { readSellerFolder } from './deploy-plan.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface CheckReportInput {
  /** A file of the seller's folder by name, or undefined: hosted.json, adapter.json and the files it names. */
  read: (name: string) => string | undefined;
  /** The result call's answer for the finished job, as the seller API sends it. */
  job: Uint8Array;
  /**
   * The second call's answer: the artifacts call (`sellerApi.result.merge`) or the report call. Left out with a merge
   * configured, the job's answer must already hold the artifacts at `merge.into`, as an export does: they are taken
   * out and served as the artifacts call's answer.
   */
  second?: Uint8Array;
  /** The deal's scope, as the buyer's quote named it. */
  scope: J;
  options?: J;
  /** The signed terms (GET /v1/commitments/<id>/terms). Left out, the acceptance a quote for the scope would sign. */
  terms?: J;
  /**
   * Whether the deal's report carries a salt. The live seller follows the deal, which keeps the salt it was offered
   * with (red team, M2); left out, the configuration's `reportSalt` decides, as for a deal offered under it today.
   */
  salt?: boolean;
}

export interface CheckVerdict {
  /** pass: the seller would deliver it. refused: the seller holds it, and says why on /health. not_finished: no result. */
  verdict: 'pass' | 'refused' | 'not_finished';
  /** What stage 1 decides: accept, panel (the judges decide next), reject or escalate; absent before the preflight. */
  result?: string;
  /** The reason as /health shows it; absent on a pass. */
  reason?: RefusalReason;
  /** Every agreed check: pass, fail, open, or not run when an earlier step refused the result. */
  checks: Array<{ checkId: string; required: boolean; outcome: 'pass' | 'fail' | 'open' | 'not run'; pointer?: string; message?: string; detail?: string }>;
  /** The steps that changed the bytes, and the bytes and SHA-256 checked. */
  steps: string[];
  bytes?: number;
  plaintextSha256?: string;
  /** The whole message of a refusal before an agreed check, for the seller's own eyes. */
  detail?: string;
}

const JOB_ID = 'local-check-job';
const ZERO_ID = `0x${'0'.repeat(64)}`;
/** A made-up salt in the live salt's shape: the checks see the same fields, whatever the value. */
const LOCAL_SALT = `0x${'5a'.repeat(32)}`;
const isRecord = (v: J): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (b: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(b);

/** Splits an export that holds the artifacts at `into` into the job's answer and the artifacts call's answer. */
function splitExport(job: Uint8Array, into: string): { job: Uint8Array; second: Uint8Array } {
  const doc = JSON.parse(text(job));
  const parts = pointerParts('sellerApi.result.merge.into', into);
  let parent: J = doc;
  for (const k of parts.slice(0, -1)) parent = isRecord(parent) && Object.hasOwn(parent, k) ? parent[k] : undefined;
  const last = parts[parts.length - 1]!;
  if (!isRecord(parent) || !Object.hasOwn(parent, last)) throw new Error(`the job's answer has nothing at ${into} and no artifacts file is given: give the artifacts call's answer too`);
  const second = parent[last];
  delete parent[last];
  const enc = new TextEncoder();
  return { job: enc.encode(JSON.stringify(doc)), second: enc.encode(JSON.stringify(second)) };
}

export async function checkReport(input: CheckReportInput): Promise<CheckVerdict> {
  const seller = checkBundle(readSellerFolder(input.read));
  const c = seller.config;
  const api: J = c.sellerApi;
  if (!isRecord(api)) throw new Error("adapter.json has no sellerApi mapping: this check runs a seller API's answer");
  const template = JSON.parse(seller.files[c.template]!);
  const reportMapping = c.reportMapping === undefined ? undefined : parseReportMapping(JSON.parse(seller.files[c.reportMapping]!));
  // The signed terms when given; only then are the template and its rules skipped (red team, L2).
  const terms = input.terms ?? acceptanceFor(c, template, input.scope, input.options);
  if (!isRecord(terms?.deliverable) || !isRecord(terms?.acceptance)) throw new Error('the terms need deliverable and acceptance');

  const result: J = isRecord(api.result) ? api.result : {};
  // The command answers the result call and one second call, never the further files a result names: rather than a
  // verdict the live seller would not give, it gives none (review 6, red team M1).
  if (result.files !== undefined) throw new Error('this seller\'s result names further files (sellerApi.result.files), which the local check does not fetch: it cannot give the live verdict');
  const takesSecond = isRecord(result.merge) || isRecord(result.reportCall);
  if (input.second !== undefined && !takesSecond) throw new Error('an artifacts file is given, and this seller\'s configuration makes no artifacts or report call');
  let job = input.job;
  let second = input.second;
  if (second === undefined && isRecord(result.merge)) ({ job, second } = splitExport(job, result.merge.into));

  // Every request is answered from the files, in the client's own order: the job's answer, then the artifacts or the
  // report call's answer. A job read by HTTP status answers with the first status the configuration counts as done.
  const done = isRecord(result.status) && result.status.by === 'http' ? (Array.isArray(result.status.done) ? result.status.done[0] : undefined) ?? 200 : 200;
  const answers: Array<{ body: Uint8Array; status: number }> = [{ body: job, status: done }, ...(second === undefined ? [] : [{ body: second, status: 200 }])];
  const local = (async () => {
    const next = answers.shift();
    return next === undefined ? new Response(JSON.stringify({ detail: 'the local check has no answer for this request' }), { status: 404 }) : new Response(next.body, { status: next.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const env: Record<string, string> = {};
  for (const v of seller.credentialVars) env[v] = 'local-check-placeholder';
  const client = sellerApiClient(api, env, { scope: Object.keys(c.scope ?? {}), options: Object.keys(isRecord(c.options) ? c.options! : {}) }, local);
  const values = { commitmentId: ZERO_ID, jobId: JOB_ID, buyer: `0x${'0'.repeat(40)}`, scope: input.scope, options: input.options };

  const agreed: J[] = Array.isArray(terms.acceptance.deterministicChecks) ? terms.acceptance.deterministicChecks : [];
  const notRun = () => agreed.map((k) => ({ checkId: String(k.id), required: k.required === true, outcome: 'not run' as const }));
  let answer: Awaited<ReturnType<typeof client.result>>;
  try {
    answer = await client.result(values);
  } catch (e) {
    const r = resultRefusal(e);
    if (!r) throw e;
    return { verdict: 'refused', reason: reasonOf(r.detail, terms.acceptance), checks: notRun(), steps: [], detail: r.why };
  }
  if (answer.state !== 'done') return { verdict: 'not_finished', checks: notRun(), steps: [], detail: `the job is ${answer.state}${answer.status ? ` (${answer.status})` : ''}` };

  const checked = await checkResult(client, answer.bytes, values, { reportMapping, salt: (input.salt ?? c.reportSalt === true) ? LOCAL_SALT : undefined, terms });
  const failedOf = (list: FailedCheck[]) => new Map(list.map((f) => [f.checkId, f]));
  if (checked.refused) {
    const d = checked.detail;
    const reason = reasonOf(d, terms.acceptance);
    const ran = d['plaintextSha256'] !== undefined && !d.refused;
    const failed = failedOf(d.checks);
    const safe = new Map(reason.checks.map((r) => [r.checkId, r]));
    const checks = ran
      ? agreed.map((k) => {
          const f = failed.get(k.id);
          const s = safe.get(k.id);
          return f ? { checkId: String(k.id), required: k.required === true, outcome: f.outcome, ...(s?.pointer ? { pointer: s.pointer } : {}), message: s?.message ?? '', ...(f.detail === undefined ? {} : { detail: f.detail }) } : { checkId: String(k.id), required: k.required === true, outcome: 'pass' as const };
        })
      : notRun();
    return { verdict: 'refused', result: d.result, reason, checks, steps: checked.steps, ...(d['bytes'] === undefined ? {} : { bytes: Number(d['bytes']), plaintextSha256: String(d['plaintextSha256']) }), ...(ran ? {} : { detail: checked.why }) };
  }
  const failed = failedOf(checked.failed);
  return {
    verdict: 'pass',
    result: checked.pre.result,
    checks: agreed.map((k) => {
      const f = failed.get(k.id);
      return { checkId: String(k.id), required: k.required === true, outcome: f ? f.outcome : 'pass', ...(f?.detail === undefined ? {} : { detail: f.detail }) };
    }),
    steps: checked.steps,
    bytes: checked.pre.bytes,
    plaintextSha256: checked.pre.plaintextSha256,
  };
}

/** What the command prints: the verdict first, then one line per check. `detail`: also the checks' own messages. */
export function verdictLines(v: CheckVerdict, o: { detail?: boolean } = {}): string[] {
  const head =
    v.verdict === 'pass'
      ? `PASS: the seller would deliver this report (stage 1: ${v.result === 'panel' ? 'panel, the judges decide next' : v.result})`
      : v.verdict === 'not_finished'
        ? `NOT FINISHED: ${v.detail}`
        : `REFUSED at ${reasonLine(v.reason!)}`;
  const lines = [head];
  if (v.bytes !== undefined) lines.push(`  checked ${v.bytes} bytes, sha256 ${v.plaintextSha256}`);
  for (const k of v.checks) {
    const word = k.outcome === 'not run' ? 'NOT RUN' : k.outcome.toUpperCase();
    lines.push(`  ${word} ${k.checkId} (${k.required ? 'required' : 'optional'})${k.pointer ? ` ${k.pointer}` : ''}${k.message ? `: ${k.message}` : ''}`);
    if (o.detail && k.detail !== undefined) lines.push(`      the check's own message: ${k.detail}`);
  }
  if (o.detail && v.detail !== undefined && v.verdict === 'refused') lines.push(`  the step's own message: ${v.detail}`);
  return lines;
}
