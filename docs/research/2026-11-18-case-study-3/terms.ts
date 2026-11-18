// Case study 3 (T-535): one deal's terms file for `pnpm audit-deal --terms`, built from version 2 of the
// security-review form (examples/seller-adapter.template.json) filled with the deal's scope, by the seller adapter's
// own fill. The shape is fixtures/terms/audit-report.yaml's, as JSON. The club, the adjudicators and the adjudication
// fee come from discovery in every audit-deal run; the values here only satisfy the commitment schema.
//
//   node docs/research/2026-11-18-case-study-3/terms.ts --scope <scope.json> --price <base units> --deliver-within <s> [--add-check <check.json>] [--token <id>] [--offer-within <s>] [--fund-within <s>] --out <terms.json>
//
// scope.json: {"commit": "<40 hex>", "files": ["<path>", ...], "lines": <n>}. --add-check adds one check the buyer
// asks for on top of the form (for example the proof check of site/ref/checks.txt).
import { readFileSync, writeFileSync } from 'node:fs';
import { fill } from '../../../examples/seller-adapter-core.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const [scopeFile, price, within, extra, out] = [arg('--scope'), arg('--price'), arg('--deliver-within'), arg('--add-check'), arg('--out')];
// The token: `tUSD` on the local world; on Sepolia, the token address discovery serves.
const token = arg('--token') ?? 'tUSD';
// The offer and funding windows (s), from the offer's creation like deliverWithinSec, so funding closes before work is due.
const offerWithin = Number(arg('--offer-within') ?? 600);
const fundWithin = Number(arg('--fund-within') ?? 900);
if (!scopeFile || !price || !/^[0-9]+$/.test(price) || !within || !/^[1-9][0-9]*$/.test(within) || !out || !(offerWithin <= fundWithin && fundWithin < Number(within))) {
  console.error('usage: node terms.ts --scope <scope.json> --price <base units> --deliver-within <s> [--add-check <check.json>] [--token <id>] [--offer-within <s>] [--fund-within <s>] --out <terms.json>; offer-within <= fund-within < deliver-within');
  process.exit(2);
}
const template = JSON.parse(readFileSync(new URL('../../../examples/seller-adapter.template.json', import.meta.url), 'utf8'));
const scope = JSON.parse(readFileSync(scopeFile, 'utf8'));
const checks = [...fill(template.checks, scope), ...(extra ? [JSON.parse(readFileSync(extra, 'utf8'))] : [])];
const terms = {
  schemaVersion: '0.8',
  clubId: 'demo-club',
  deliverable: fill(template.deliverable, scope),
  acceptance: { deterministicChecks: checks, rubric: { passThreshold: 0, criteria: [] } },
  price: { token, amount: price },
  adjudication: { policyId: 'bench-a/p1', fee: { token, amount: '1000000' } },
  timing: { offerExpiresInSec: offerWithin, fundWithinSec: fundWithin, deliverWithinSec: Number(within), judgeWithinSec: 120, fallbackWithinSec: 120, appealWindowSec: 0, appealDecideSec: 300, maxSubmissions: 1 },
  settlement: { mode: 'guaranteed_on_decision', token },
  remedy: { onReject: 'full_refund' },
  disclosure: { level: 'public' },
};
writeFileSync(out, `${JSON.stringify(terms, null, 2)}\n`);
console.log(`${out}: form version ${template.form?.version}, ${checks.length} checks (${checks.map((c: { id: string }) => c.id).join(', ')}), price ${price}, ${within} s to deliver`);
