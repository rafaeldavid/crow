// T-473: a rehearsal of a setup run, for tests/metrics/one-click-setup.test.ts only. It stands in for the setup command
// until T-483 lands, so the test drives the harness's own scripted path (bench-local.mjs, playScripted) with s7's job
// API, the first-deal marker and the buyer check. It is not a setup command: it sets nothing up.
//   1. the setup's own step: an estimate from the party's job API (CROW_BENCH_JOB_API), which is not Crow-run;
//   2. with --faucet-first, a faucet post before the first deal, which the count must show as 1;
//   3. the first-deal marker on standard error;
//   4. the first deal: one sale to Crow's test buyer, as scripted/sell-to-buyer.ts makes it.
import { sellOnce } from '../../../apps/test-agents/src/sell-once.ts';
import { knownPins } from '../../../examples/verify.ts';

const operators = (process.env['HOLDBACK_OPERATORS'] ?? '').split(',').filter(Boolean);
const base = process.env['CROW_TEST_BUYER'] ?? '';
const api = process.env['CROW_BENCH_JOB_API'] ?? '';
const key = process.env['CROW_BENCH_JOB_API_KEY'] ?? '';
const payout = process.env['CROW_BENCH_PAYOUT'] ?? '';
const pin = knownPins()[0]!; // SimChain: the in-process world only
try {
  const estimate = await fetch(`${api}estimates`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key }, body: JSON.stringify({ target: 'example.org', depth: 1, client: 'rehearsal' }) });
  console.log(`estimate  ${estimate.status}`);
  if (process.argv.includes('--faucet-first')) {
    const grant = await fetch(`${operators[0]}/v1/faucet`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ address: payout }) });
    console.log(`faucet    ${grant.status}`);
  }
  console.error(`crow-setup: first-deal started ${Date.now()}`);
  const { id } = await sellOnce({ operators, pin, buyer: (path, init) => fetch(`${base}${path}`, init), timeoutMs: 120_000 });
  console.log(`done      commitment ${id} Released`);
} catch (e) {
  console.log(`stopped at: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
