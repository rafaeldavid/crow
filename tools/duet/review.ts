// The security-review deal the demo page shows (T-500): the kind of deal Crow's first pilot runs, on a public
// training repository, in test tokens. One module holds what the replay and the three live deals share: the scope,
// the terms (the repository's public audit-report template, filled from the scope) and the demo report.
//
// The repository is Damn Vulnerable DeFi v4 (MIT), contracts written to be broken for practice. The report's
// findings are demo findings written for the page; they describe the flaws the exercises were built to hold and make
// no claim about any deployed project. The checks test the report's shape and scope, not the quality of the review.
import { readFileSync } from 'node:fs';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The code reviewed: one repository at one commit, two files, 80 lines in all (36 and 44). */
export const REPOSITORY = { name: 'Damn Vulnerable DeFi v4', url: 'https://github.com/theredguild/damn-vulnerable-defi', license: 'MIT' } as const;
export const REVIEW_SCOPE = {
  commit: '64fddf9f96de2782f8868898d68673acb295119c',
  files: ['src/truster/TrusterLenderPool.sol', 'src/side-entrance/SideEntranceLenderPool.sol'],
  lines: 80,
} as const;
/** The quoted price: 40.00 test tokens in base units (6 decimals), within the 1,000 Crow's test buyer pays at most. */
export const REVIEW_PRICE_UNITS = '40000000';
/** The five checks, in the template's order. */
export const REVIEW_CHECK_IDS = ['report', 'proof', 'scope', 'coverage', 'hidden'] as const;
/** The five checks, one sentence each, as the demo page says them. */
export const CHECK_WORDS: Record<(typeof REVIEW_CHECK_IDS)[number], string> = {
  report: 'The report follows the agreed format: the version reviewed, the files reviewed, and each finding with its place in the code and a fix.',
  proof: 'Every finding rated Medium or higher comes with files that prove it.',
  scope: 'Every finding points at a file in scope, at the agreed version of the code.',
  coverage: 'Every file in scope was reviewed, none left out.',
  hidden: 'The report holds no hidden characters.',
};

// The demo ran on version 1 of the security-review form, and its live deals and page are records of it, so the demo
// keeps that version: a byte copy of examples/seller-adapter.template.json at origin/main 557560c9 (T-534). The seller
// adapter of a duet run takes the same copy (tools.ts, adapterConfig).
export const TEMPLATE = new URL('./review/form-v1.json', import.meta.url);
const REPORT = new URL('./review/report.json', import.meta.url);

/**
 * Fills the audit-report template's placeholders from a scope: a whole-string "{{field}}" takes the field's value,
 * "{{field.length}}" a list's length, and a placeholder inside a longer string its text.
 */
export function fillTemplate(node: J, scope: J): J {
  const value = (path: string): J => (path.endsWith('.length') ? scope[path.slice(0, -7)]?.length : scope[path]);
  const fill = (n: J): J => {
    if (typeof n === 'string') {
      const whole = /^\{\{([\w.]+)\}\}$/.exec(n);
      if (whole) return value(whole[1]!);
      return n.replace(/\{\{([\w.]+)\}\}/g, (_m, p: string) => String(value(p)));
    }
    if (Array.isArray(n)) return n.map(fill);
    if (n && typeof n === 'object') return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, fill(v)]));
    return n;
  };
  return fill(node);
}

export const template = (): J => JSON.parse(readFileSync(TEMPLATE, 'utf8'));

/**
 * The live deals' terms: the template's deliverable and its five checks, filled from the scope. The description adds
 * the repository's address in front, so the terms name the code by repository as well as by commit.
 */
export function reviewTerms(scope: J = REVIEW_SCOPE): { deliverable: J; checks: J[] } {
  const t = template();
  const filled = fillTemplate({ deliverable: t.deliverable, checks: t.checks }, scope);
  const ids = filled.checks.map((c: J) => c.id).join(',');
  if (ids !== REVIEW_CHECK_IDS.join(',')) throw new Error(`the audit-report template's checks are ${ids}, not ${REVIEW_CHECK_IDS.join(',')}`);
  return { deliverable: { ...filled.deliverable, description: `Repository: ${REPOSITORY.url}. ${filled.deliverable.description}` }, checks: filled.checks };
}

/** What the seller delivers: the demo report; the same with F-01's proof of concept left out; or one file left out. */
export type ReportKind = 'ok' | 'no-proof' | 'missing-file';

export function reviewReport(kind: ReportKind = 'ok'): Uint8Array {
  const r = JSON.parse(readFileSync(REPORT, 'utf8'));
  if (kind === 'no-proof') delete r.findings.find((f: J) => f.id === 'F-01').pocFiles;
  if (kind === 'missing-file') r.filesReviewed = r.filesReviewed.slice(0, -1);
  return new TextEncoder().encode(`${JSON.stringify(r, null, 2)}\n`);
}
