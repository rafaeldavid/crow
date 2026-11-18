// The scripted agent of scenario s9 (T-489): a buyer that follows https://crow.direct/buy.txt step by step, with the
// pinned site/buy.mjs itself, against Crow's test seller's quote address in the in-process world bench.mjs serves.
// It copies buy.mjs into a folder of its own beside its two packages, as buy.txt's step 1 leaves crow-buy, reads the
// seller's card for the quoted offer (step 2), asks for a price and reads the stop (steps 3 and 4), runs the approve
// command the stop printed, unchanged (step 5), and reads the final JSON (steps 8 and 9). Each buy.mjs runs in its own
// Node process with this process's flags, so the fetch probe counts its calls too. It prints one line per step and ends
// with `done      commitment <id> Released`; it exits 1 otherwise.
//
//   HOLDBACK_OPERATORS=<url>,<url> node --experimental-transform-types tools/one-click/scripted/buy-by-quote.ts --seller <test seller base URL>
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const at = process.argv.indexOf('--seller');
const seller = at > 0 ? (process.argv[at + 1] ?? '') : '';
const operators = process.env['HOLDBACK_OPERATORS'] ?? '';
const SCOPE = '{"rows":5}';
const MOST = '5000000'; // 5 tUSDC: the price is 1 tUSDC, and the fees are below 4
const dir = mkdtempSync(join(tmpdir(), 'crow-buy-s9-'));

function buy(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...process.execArgv, 'buy.mjs', ...args], { cwd: dir, env: { PATH: process.env['PATH'] ?? '', HOME: dir, HOLDBACK_OPERATORS: operators } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}
const last = (s: string) => s.trim().split('\n').pop() ?? '';

try {
  if (!seller || !operators) throw new Error('needs --seller <base URL> and HOLDBACK_OPERATORS');
  mkdirSync(join(dir, 'node_modules'));
  for (const p of ['viem', 'tweetnacl']) symlinkSync(realpathSync(new URL(`../../../examples/node_modules/${p}`, import.meta.url)), join(dir, 'node_modules', p));
  copyFileSync(new URL('../../../site/buy.mjs', import.meta.url), join(dir, 'buy.mjs'));
  console.log('step 1    buy.mjs in a folder of its own');
  const card: J = await (await fetch(`${seller}/agent.json`)).json();
  const offer = (card.offers ?? []).find((o: J) => o?.pricing?.kind === 'quoted');
  if (!offer) throw new Error('the test seller lists no quoted offer');
  console.log(`step 2    the quoted offer ${offer.id}: ${offer.pricing.quote}`);
  const stop = await buy([offer.pricing.quote, 'deal-1', SCOPE, MOST, offer.pricing.defaults]);
  if (stop.code !== 3) throw new Error(`buy.mjs stopped with ${stop.code}: ${last(stop.stderr)}`);
  const shown = JSON.parse(last(stop.stdout));
  const terms = (shown.differences ?? []).filter((d: J) => !['createdAt', 'settlementTime'].includes(d.field));
  if (shown.approval !== 'needed' || terms.length > 0) throw new Error(`the offer differs from the defaults: ${JSON.stringify(terms).slice(0, 300)}`);
  if (String(shown.seller).toLowerCase() !== String(card.seller).toLowerCase()) throw new Error("the offer's seller is not the card's");
  console.log(`steps 3-4 offer ${shown.commitmentId}: ${shown.fees.total.amount} base units in all, no difference from the defaults`);
  // The stop's last line: `HOLDBACK_OPERATORS=... node buy.mjs approve deal-1 <id> <most>`, run as written.
  const words = last(stop.stderr).split(' ');
  const i = words.indexOf('buy.mjs');
  if (i < 1 || words[i - 1] !== 'node' || words[i + 1] !== 'approve') throw new Error(`the stop printed no approve command: ${last(stop.stderr)}`);
  const end = await buy(words.slice(i + 1));
  if (end.code !== 0) throw new Error(`the approve run exited ${end.code}: ${last(end.stderr)}`);
  const done = JSON.parse(last(end.stdout));
  if (done.outcome !== 'Released' || typeof done.work !== 'string' || !done.work.startsWith('n,square\n')) throw new Error(`the deal ended ${done.outcome}`);
  console.log(`steps 5-9 Released, with Crow's test seller as the other party; the work has ${done.work.trim().split('\n').length - 1} rows`);
  console.log(`done      commitment ${done.commitmentId} Released`);
} catch (e) {
  console.log(`stopped at: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
