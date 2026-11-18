// T-502: the reason a seller shows for a refused result holds nothing from the report. The table pins the messages a
// seller sees; the randomized part runs reports full of marker strings, as keys and values, through the adjudicator's
// own checks and the converter, and reads every reason for the marker.
import { preflightDelivery } from '@holdback/judgment';
import { describe, expect, it } from 'vitest';
import { convertReport, parseReportMapping, ReportNotConverted } from './report-converter.ts';
import { reasonLine, reasonOf, safeCheckMessage, safeSchemaMessage, schemaNames } from './seller-refusal.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const MARK = 'zqmark';
/** A report key of digits, such as an account or ticket number: it must never show either (review and red team, H1). */
const DIGITS = '482913377';

describe('the reason for a refusal (T-502): messages', () => {
  const schema = {
    type: 'object',
    required: ['artifacts'],
    properties: {
      title: { type: 'string' },
      byId: { type: 'object', additionalProperties: { type: 'string' } },
      artifacts: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { kind: { enum: ['a'] }, data: { type: 'object', required: ['title'] } } } },
    },
  };
  it.each([
    ['schema: /artifacts: /9: anyOf not satisfied', { pointer: '/artifacts/9', message: 'anyOf not satisfied' }],
    ['schema: /artifacts: /0: /data: missing title', { pointer: '/artifacts/0/data', message: 'missing title' }],
    ['schema: missing artifacts', { message: 'missing artifacts' }],
    ['schema: missing zqmark', { message: 'missing a required property' }],
    ['schema: /artifacts: /2: /zqmark: additional property false schema', { pointer: '/artifacts/*', message: 'additional property: false schema' }],
    ['schema: /kind: additional property not in enum', { pointer: '/*', message: 'additional property: not in enum' }],
    ['schema: /artifacts: /1: /kind: not in enum', { pointer: '/artifacts/1/kind', message: 'not in enum' }],
    ['schema: /artifacts: fewer than 3 items', { pointer: '/artifacts', message: 'fewer than 3 items' }],
    ['schema: /zq: mark: expected string', { pointer: '/*', message: 'expected string' }],
    ['schema: /title: zqmark', { pointer: '/title', message: 'the value does not match the schema' }],
    // A report key of digits, under a map: never shown as an index (review and red team, H1).
    ['schema: /byId: /411111111: additional property expected string', { pointer: '/byId/*', message: 'additional property: expected string' }],
    // A key that imitates segments: digits and declared names inside it never reach the pointer.
    ['schema: /artifacts: /0: /4111: /1111: /1111: additional property false schema', { pointer: '/artifacts/*', message: 'additional property: false schema' }],
    ['schema: /byId: /title: /artifacts: /7: additional property expected string', { pointer: '/byId/*', message: 'additional property: expected string' }],
    ['schema: /title: /123: expected string', { pointer: '/title/*', message: 'expected string' }],
    ['deliverable is not valid JSON', { message: 'the report is not valid JSON' }],
  ])('%s', (detail, want) => {
    expect(safeSchemaMessage(detail, schema)).toEqual(want);
  });

  it('keeps the numbers of a table check and replaces what names the report', () => {
    expect(safeCheckMessage({ type: 'row_count_range' }, '12 rows; expected 1 to 10')).toEqual({ message: '12 rows; expected 1 to 10' });
    expect(safeCheckMessage({ type: 'csv_columns_exact', columns: ['a'] }, 'columns are [zqmark]; expected [a]')).toEqual({ message: 'the columns are not the agreed columns' });
    expect(safeCheckMessage({ type: 'null_rate_max', column: 'a' }, 'column a not found')).toEqual({ message: 'column a not found' });
    expect(safeCheckMessage({ type: 'null_rate_max', column: 'a' }, 'column zqmark not found')).toEqual({ message: 'a column the check names is not found' });
    expect(safeCheckMessage({ type: 'hidden_characters_max' }, 'over the limit for total (tag 0, bidi 0, variationSelector 0, otherIgnorable 2, total 2)').message).toContain('otherIgnorable 2');
    expect(safeCheckMessage({ type: 'regex_match_rate_min', column: 'a' }, 'zqmark')).toEqual({ message: 'the check fails on this report' });
    // The judgment's own number formats (red team, L3): a count of a total, a limit in basis points.
    expect(safeCheckMessage({ type: 'null_rate_max', column: 'a' }, 'null 1/2 exceeds 100 bps')).toEqual({ message: 'null 1/2 exceeds 100 bps' });
    expect(safeCheckMessage({ type: 'regex_match_rate_min', column: 'a' }, 'match 0/2 below 10000 bps')).toEqual({ message: 'match 0/2 below 10000 bps' });
  });

  it('names each stage, and a check the terms do not hold is "unknown"', () => {
    const acceptance = { deterministicChecks: [{ id: 'report', type: 'json_schema', required: true, schema: { type: 'object', required: ['summary'] } }] };
    expect(reasonOf({ result: 'wrong_workspace', workspace: `the job ran in account ${MARK}`, checks: [] }, acceptance)).toEqual({ stage: 'wrong_workspace', message: 'the job did not run in the pinned workspace', checks: [] });
    expect(reasonOf({ result: 'wrong_scope', scope: `asked for commit ${MARK}`, scopeField: 'commit', checks: [] }, acceptance)).toMatchObject({ stage: 'wrong_scope', field: 'commit' });
    expect(reasonOf({ result: 'files_not_added', files: `file ${MARK}.sol: 404`, checks: [] }, acceptance).message).not.toContain(MARK);
    expect(reasonOf({ result: 'reject', refused: { code: 'payload_too_large', detail: 'plaintext is 9 bytes' }, checks: [] }, acceptance)).toMatchObject({ stage: 'intake', code: 'payload_too_large' });
    const r = reasonOf({ result: 'reject', checks: [{ checkId: 'report', required: true, outcome: 'fail', detail: 'schema: missing summary' }, { checkId: MARK, required: true, outcome: 'fail', detail: MARK }] }, acceptance);
    expect(r.checks).toEqual([{ checkId: 'report', required: true, outcome: 'fail', message: 'missing summary' }, { checkId: 'unknown', required: true, outcome: 'fail', message: 'the check fails on this report' }]);
    expect(reasonLine(r)).toBe('checks: FAIL report (required): missing summary; FAIL unknown (required): the check fails on this report');
  });

  it('collects the names a schema declares, at any depth', () => {
    expect([...schemaNames({ properties: { a: { items: { required: ['b'], properties: { c: {} } } } }, anyOf: [{ required: ['d'] }] })].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

/** A small seeded generator, so a failure names its seed. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
}

describe('the reason for a refusal (T-502): nothing from the report, on random reports', () => {
  it('a marker in any key or value of the report never reaches the reason', () => {
    const schema = {
      type: 'object',
      required: ['summary', 'artifacts'],
      additionalProperties: false,
      properties: {
        summary: { type: 'string', maxLength: 40 },
        byId: { type: 'object', additionalProperties: { type: 'integer' } },
        artifacts: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['kind', 'data'],
            additionalProperties: false,
            properties: { kind: { enum: ['finding', 'scope'] }, data: { type: 'object', required: ['title'], properties: { title: { type: 'string', pattern: '^[A-Z]' }, lines: { type: 'integer', minimum: 1 } } } },
          },
        },
      },
    };
    const acceptance = { deterministicChecks: [{ id: 'report', type: 'json_schema', required: true, schema }, { id: 'hidden', type: 'hidden_characters_max', required: true, max: { total: 0 } }] };
    const words = [MARK, `${MARK}: x`, `/${MARK}`, `${MARK}: additional property ${MARK}`, 'finding', 'Title', '', `a​${MARK}`];
    const keys = ['summary', 'artifacts', 'kind', 'data', 'title', 'lines', 'byId', MARK, `${MARK}: additional property `, `kind: ${MARK}`, DIGITS, `4111: /${DIGITS}: /${DIGITS}`, `title: /0: /${DIGITS}`, `artifacts: /3: /${DIGITS}: additional property `];
    for (let seed = 1; seed <= 400; seed++) {
      const r = rng(seed);
      const pick = <T,>(a: T[]): T => a[Math.floor(r() * a.length)]!;
      const value = (depth: number): J => {
        const x = r();
        if (depth > 3 || x < 0.3) return pick(words);
        if (x < 0.4) return Math.floor(r() * 5) - 1;
        if (x < 0.65) return Array.from({ length: Math.floor(r() * 3) }, () => value(depth + 1));
        return Object.fromEntries(Array.from({ length: 1 + Math.floor(r() * 3) }, () => [pick(keys), value(depth + 1)]));
      };
      const report = { summary: pick(words), artifacts: Array.from({ length: Math.floor(r() * 3) }, () => ({ kind: pick(['finding', 'scope', MARK]), data: value(1) })), ...(r() < 0.5 ? { [pick(keys)]: value(1) } : {}), ...(r() < 0.5 ? { byId: { [pick(keys)]: value(2) } } : {}) };
      const pre = preflightDelivery({ plaintext: new TextEncoder().encode(JSON.stringify(report)), mime: 'application/json', format: 'application/json', acceptance: acceptance as J });
      const failed = pre.deterministic.filter((o) => !o.passed).map((o) => ({ checkId: o.checkId, required: o.required, outcome: 'fail' as const, ...(o.detail === undefined ? {} : { detail: o.detail }) }));
      const reason = reasonOf({ result: pre.result, checks: failed }, acceptance);
      expect(JSON.stringify(reason), `seed ${seed}`).not.toContain(MARK);
      expect(reasonLine(reason), `seed ${seed}`).not.toContain(MARK);
      expect(JSON.stringify(reason), `seed ${seed}`).not.toContain(DIGITS);
    }
  });

  it('a marker in the report never reaches a conversion refusal', () => {
    const mapping = parseReportMapping({ version: 1, report: { title: { $path: 'name' }, severity: { $path: 'level', $map: { high: 'High' } }, count: { $path: 'n', $as: 'integer' }, extra: { $path: 'meta', $optional: true }, items: { $each: 'list', $item: { at: { $path: 'line', $as: 'integer' } } } } });
    const reports: J[] = [
      {},
      { name: MARK },
      { name: 'a', level: MARK },
      { name: 'a', level: 'high', n: MARK },
      { name: 'a', level: 'high', n: 1, meta: { [MARK]: 1.5 } },
      { name: 'a', level: 'high', n: 1, list: [{ line: MARK }] },
      { name: 'a', level: 'high', n: 1, list: MARK },
    ];
    for (const report of reports) {
      let err: ReportNotConverted | undefined;
      try {
        convertReport(mapping, new TextEncoder().encode(JSON.stringify(report)));
      } catch (e) {
        err = e as ReportNotConverted;
      }
      expect(err, JSON.stringify(report)).toBeInstanceOf(ReportNotConverted);
      const reason = reasonOf({ result: 'not_converted', conversion: err!.message, conversionField: err!.safeField, conversionSafe: err!.safe, checks: [] }, {});
      expect(JSON.stringify(reason), JSON.stringify(report)).not.toContain(MARK);
    }
  });
});
