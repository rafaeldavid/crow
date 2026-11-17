// Why a seller refused to deliver a result, in a form safe to show anyone (T-502). The seller adapter holds a delivery
// that would fail: the job ran in another account, asked for another scope, its files could not be added, the report
// mapping could not convert it, or intake or an agreed check would refuse it. The reason goes on the seller's public
// /health page and its deal route, so it must say which step and which check refused it, and where, without one
// byte of the report.
//
// Nothing here copies a message. Each one is rebuilt from known parts: the check's ID from the signed terms, the
// names the check's own schema declares, the schema validator's and the converter's fixed phrases, and numbers. Any
// pointer segment that is not an array index or a name the schema declares becomes `*`; any message that is not one
// of the known phrases becomes a fixed sentence. So a report key, a value, a finding or a file name cannot reach the
// page, whatever the report holds.
type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The step that refused the result, in the order the adapter runs them. */
export type RefusalStage = 'wrong_workspace' | 'wrong_scope' | 'files_not_added' | 'not_converted' | 'not_salted' | 'intake' | 'checks';

/** One agreed check that fails, or cannot be decided (`open`). */
export interface CheckReason {
  checkId: string;
  required: boolean;
  outcome: 'fail' | 'open';
  /** A JSON pointer into the delivered report, when the check names one, such as `/artifacts/9`. */
  pointer?: string;
  message: string;
}

export interface RefusalReason {
  stage: RefusalStage;
  /** Stage `intake`: the intake rule's code, such as `payload_too_large`. */
  code?: string;
  /** Stage `not_converted`: the template field the mapping could not fill. Stage `wrong_scope`: the scope field. */
  field?: string;
  message: string;
  /** Stage `checks`: the checks that fail or are open, in the terms' order. */
  checks: CheckReason[];
}

/** What the adapter records for a refused result (seller-adapter-core.ts, `refuse`). */
export interface RefusalDetail {
  result: string;
  checks: Array<{ checkId: string; required: boolean; outcome: 'fail' | 'open'; detail?: string }>;
  refused?: { code: string; detail?: string };
  /** Set by the converter: the template field and a message without the report's values. */
  conversion?: string;
  conversionField?: string;
  conversionSafe?: string;
  scopeField?: string;
  salt?: string;
  [k: string]: unknown;
}

const STAGE_MESSAGE: Record<Exclude<RefusalStage, 'checks' | 'not_converted' | 'intake' | 'not_salted'>, string> = {
  wrong_workspace: 'the job did not run in the pinned workspace',
  wrong_scope: "the job's request is not the deal's scope",
  files_not_added: "the result's files or its artifacts could not be added",
};
const SALT_MESSAGES = ['the report is not UTF-8 text', 'the report is not JSON', 'the report is not a JSON object', 'the report already has a top-level salt'];
const INTAKE_CODES = /^[a-z][a-z0-9_]{0,40}$/;
/** A name from the terms or the configuration, shown as it is: printable, short, no pointer or message syntax. */
const NAME = /^[A-Za-z0-9_.-]{1,80}$/;
const GENERIC_CHECK = 'the check fails on this report';
const GENERIC_SCHEMA = 'the value does not match the schema';

const isRecord = (v: J): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);
/** RFC 6901: `~` and `/` inside a segment. */
const seg = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');

/** Every property name a schema declares, at any depth: under properties, required and dependent keywords. */
export function schemaNames(schema: J, out = new Set<string>(), depth = 0): Set<string> {
  if (depth > 64 || schema === null || typeof schema !== 'object') return out;
  if (Array.isArray(schema)) {
    for (const s of schema) schemaNames(s, out, depth + 1);
    return out;
  }
  if (isRecord(schema.properties)) for (const k of Object.keys(schema.properties)) out.add(k);
  if (Array.isArray(schema.required)) for (const k of schema.required) if (typeof k === 'string') out.add(k);
  for (const [k, v] of Object.entries(schema)) if (k !== 'enum' && k !== 'const') schemaNames(v, out, depth + 1);
  return out;
}

const NUMBER = '-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?';
const TYPES = '(?:null|boolean|object|array|number|string|integer)';
/** The schema validator's own phrases (packages/judgment/src/checks/json-schema.ts). Anything else is not shown. */
const SCHEMA_PHRASES: RegExp[] = [
  new RegExp(`^expected ${TYPES}(?:\\|${TYPES})*$`),
  /^not in enum$/, /^not equal to const$/, /^items not unique$/, /^allOf not satisfied$/, /^anyOf not satisfied$/, /^matches not$/,
  /^does not match pattern$/, /^false schema$/, /^oneOf matched \d+$/,
  /^(?:fewer|more) than \d+ items$/, /^(?:shorter|longer) than \d+$/, new RegExp(`^(?:below|above|not above|not below) ${NUMBER}$`),
];

/**
 * A JSON-schema check's message (`schema: /a: /0: missing b`) as a pointer and a phrase, read against the check's own
 * schema. The validator writes each path segment as `/<name>: `, and a property the report added as
 * `/<key>: additional property ...` with the key unescaped, so a key can hold `: `, `/` and digits that look like
 * segments (T-502 review and red team). So a segment is kept only where the schema at that point declares it: a name
 * under `properties`, or an index under an array schema's `items`. Anything else is `*`, and the pointer stops there.
 * When the message holds an added property anywhere, no index is kept at all, since the key may imitate one, and the
 * phrase is read from the message's end, which is always the validator's own.
 */
export function safeSchemaMessage(detail: string, schema: J): { pointer?: string; message: string } {
  if (detail === 'deliverable is not valid JSON') return { message: 'the report is not valid JSON' };
  if (!detail.startsWith('schema: ')) return { message: GENERIC_SCHEMA };
  const names = schemaNames(schema);
  const added = detail.includes(': additional property ');
  let rest = detail.slice('schema: '.length);
  const segs: string[] = [];
  let node: J = schema;
  let stopped = false;
  for (let guard = 0; rest.startsWith('/') && guard < 256; guard++) {
    const props = isRecord(node) && isRecord(node.properties) ? Object.keys(node.properties).sort((x, y) => y.length - x.length) : [];
    const name = props.find((n) => rest.startsWith(`/${n}: `) && !rest.startsWith(`/${n}: additional property `));
    if (name !== undefined) {
      segs.push(seg(name));
      rest = rest.slice(name.length + 3);
      node = node.properties[name];
      continue;
    }
    const index = /^\/(\d{1,9}): /.exec(rest);
    const isArray = isRecord(node) && node.items !== undefined && node.properties === undefined && node.additionalProperties === undefined;
    if (index && isArray && !added) {
      segs.push(index[1]!);
      rest = rest.slice(index[0].length);
      node = node.items;
      continue;
    }
    segs.push('*');
    stopped = true;
    break;
  }
  const pointer = segs.length ? { pointer: `/${segs.join('/')}` } : {};
  // The phrase: what follows the walk, or, past a segment the schema does not declare, what follows the last `: `.
  let tail = stopped || added ? detail.slice(detail.lastIndexOf(': ') + 2) : rest;
  while (tail.startsWith('additional property ')) tail = tail.slice('additional property '.length);
  const missing = /^missing (.+)$/.exec(tail);
  let phrase: string;
  if (missing) phrase = names.has(missing[1]!) && NAME.test(missing[1]!) ? `missing ${missing[1]}` : 'missing a required property';
  else phrase = SCHEMA_PHRASES.some((p) => p.test(tail)) ? tail : GENERIC_SCHEMA;
  return { ...pointer, message: added ? `additional property: ${phrase}` : phrase };
}

/** The columns a table check names in the terms. */
function checkColumns(check: J): Set<string> {
  const out = new Set<string>();
  for (const k of ['column', 'keyColumn']) if (typeof check?.[k] === 'string') out.add(check[k]);
  if (Array.isArray(check?.columns)) for (const c of check.columns) if (typeof c === 'string') out.add(c);
  return out;
}
const HIDDEN = /^over the limit for [a-zA-Z]+(?:, [a-zA-Z]+)* \([a-zA-Z]+ \d+(?:, [a-zA-Z]+ \d+)*\)$/;
/** The judgment writes a share as a count of a total (`3/40`) and a limit in basis points (`500 bps`). */
const PCT = '\\d+/\\d+';
const BPS = '\\d+ bps';
const TABLE_PHRASES: RegExp[] = [
  /^\d+ rows; expected \d+ to \d+$/, /^duplicate key at row \d+$/, /^row \d+ is not an ISO 8601 date$/,
  new RegExp(`^null ${PCT} exceeds ${BPS}$`), new RegExp(`^match ${PCT} below ${BPS}$`), new RegExp(`^reference match ${PCT} below ${BPS}$`),
  /^reference not available$/, /^reference bytes do not match the committed hash$/, /^reference is not valid UTF-8$/, /^reference contains Unicode tag characters$/,
  /^reference is \d+ bytes; the cap is \d+$/, /^csv_columns_exact needs a text\/csv deliverable, not [a-z]+\/[a-z0-9.+-]+$/,
  /^inconclusive: the check work budget for this delivery ran out$/, /^check could not be evaluated on this input$/,
  /^deliverable could not be read as a table$/,
];

/** One failing check's message, rebuilt from the terms' check and the judgment's fixed phrases. */
export function safeCheckMessage(check: J, detail: string | undefined): { pointer?: string; message: string } {
  if (detail === undefined) return { message: GENERIC_CHECK };
  if (detail === 'inconclusive: the check work budget for this delivery ran out' || detail === 'check could not be evaluated on this input') return { message: detail };
  if (detail.startsWith('check invalid: ')) return { message: 'the check itself is invalid' };
  if (check?.type === 'json_schema') return safeSchemaMessage(detail, check.schema);
  if (check?.type === 'csv_columns_exact' && !detail.startsWith('csv_columns_exact needs')) return { message: 'the columns are not the agreed columns' };
  if (check?.type === 'hidden_characters_max') return { message: HIDDEN.test(detail) ? detail : GENERIC_CHECK };
  const notFound = /^column (.+) not found$/.exec(detail);
  if (notFound) return { message: checkColumns(check).has(notFound[1]!) && NAME.test(notFound[1]!) ? detail : 'a column the check names is not found' };
  return { message: TABLE_PHRASES.some((p) => p.test(detail)) ? detail : GENERIC_CHECK };
}

/** The reason for a refusal the adapter recorded, safe to show anyone. `acceptance`: the deal's signed acceptance. */
export function reasonOf(detail: RefusalDetail, acceptance: J): RefusalReason {
  const checksById = new Map<string, J>();
  for (const k of Array.isArray(acceptance?.deterministicChecks) ? acceptance.deterministicChecks : []) if (typeof k?.id === 'string') checksById.set(k.id, k);
  switch (detail.result) {
    case 'wrong_workspace':
    case 'files_not_added':
      return { stage: detail.result, message: STAGE_MESSAGE[detail.result], checks: [] };
    case 'wrong_scope':
      return { stage: 'wrong_scope', ...(typeof detail.scopeField === 'string' && NAME.test(detail.scopeField) ? { field: detail.scopeField } : {}), message: STAGE_MESSAGE.wrong_scope, checks: [] };
    case 'not_converted':
      return {
        stage: 'not_converted',
        ...(typeof detail.conversionField === 'string' && detail.conversionField !== '' ? { field: detail.conversionField } : {}),
        message: typeof detail.conversionSafe === 'string' ? detail.conversionSafe : 'the report mapping cannot convert the report',
        checks: [],
      };
    case 'not_salted':
      return { stage: 'not_salted', message: typeof detail.salt === 'string' && SALT_MESSAGES.includes(detail.salt) ? detail.salt : 'the salt cannot be added', checks: [] };
  }
  if (detail.refused) {
    const code = INTAKE_CODES.test(detail.refused.code) ? detail.refused.code : 'refused';
    return { stage: 'intake', code, message: 'intake refuses the report before any check runs', checks: [] };
  }
  const checks: CheckReason[] = detail.checks.map((f) => {
    const check = checksById.get(f.checkId);
    const { pointer, message } = f.outcome === 'open' ? { pointer: undefined, message: 'the check could not be decided within its work budget' } : safeCheckMessage(check, f.detail);
    return { checkId: check ? f.checkId : 'unknown', required: f.required === true, outcome: f.outcome === 'open' ? 'open' : 'fail', ...(pointer === undefined ? {} : { pointer }), message };
  });
  const open = checks.some((c) => c.outcome === 'open');
  return { stage: 'checks', message: open ? 'a check cannot be decided, so the deal would escalate' : 'an agreed check fails, so the adjudicator would reject the report and refund the buyer', checks };
}

/** One line for the log and the command: `checks: report /artifacts/9: anyOf not satisfied; scope ...`. */
export function reasonLine(r: RefusalReason): string {
  if (r.stage === 'checks') return `checks: ${r.checks.map((c) => `${c.outcome === 'open' ? 'OPEN' : 'FAIL'} ${c.checkId} (${c.required ? 'required' : 'optional'})${c.pointer ? ` ${c.pointer}` : ''}: ${c.message}`).join('; ')}`;
  return `${r.stage}${r.code ? ` ${r.code}` : ''}${r.field ? ` at ${r.field}` : ''}: ${r.message}`;
}
