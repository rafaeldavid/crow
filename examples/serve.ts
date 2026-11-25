// Serve: the seller adapter (seller-adapter.ts) run from one configuration file, with no clone and no build (T-606).
// site/build.mjs bundles this file, and the adapter it imports unchanged, into site/serve.mjs. It is for a seller
// whose work depends on the buyer's order, which a standing offer does not cover.
//
//   node serve.mjs <seller.json>
//
// The environment is the adapter's own: HOLDBACK_KEY (or CROW_SIGNER_URL), HOLDBACK_OPERATORS, HOLDBACK_DEPLOYMENT
// for a local chain, and each variable the file names for a credential. Unlike setup.mjs, it removes none of them:
// the file's tokens reach the adapter as the seller set them. site/build.mjs's banner removes one variable only,
// NODE_TLS_REJECT_UNAUTHORIZED, which would switch off the check of each host's certificate.
//
// Every start check is the adapter's own (loadConfig, startSellerAdapter). Its reports carry no salt unless the file
// sets reportSalt, whatever the template is named. This file adds two checks:
//   - the configuration names its deal template. The published file carries none: the adapter's shipped template is a
//     file beside its source, for one sample product.
//   - every settlement layer the tools would sign under is a test chain, Sepolia or a local one. The published file
//     runs beside a key that lasts, so an environment that pins another chain stops the start before anything is signed.
// It has no --sim: that mode takes its key from a running `pnpm sim`, which needs the repository.
// Exit status: 0 after SIGTERM or Ctrl-C, 2 for a wrong call or a start that is refused, with one line saying why.
import { readFileSync } from 'node:fs';
import { helpAsked } from './help.ts';
import { plain } from './plain.ts';
import { loadConfig, startSellerAdapter, type RunningAdapter } from './seller-adapter.ts';
import { knownPins } from './verify.ts';

/** Sepolia and a local chain (SimChain's domain carries the same ID): the chains this file signs under. */
const TEST_CHAINS: readonly unknown[] = [11155111, 31337];

export const USAGE = [
  'serve.mjs: sells your own work through Crow from one configuration file. Test tokens only.',
  'usage: node serve.mjs <seller.json>',
  '  The file names your API (sellerApi), your deal template (template) and the fields of an order (scope).',
  '  Environment: HOLDBACK_KEY (your signing key, or CROW_SIGNER_URL), HOLDBACK_OPERATORS (two or more, comma-separated),',
  '  and each variable the file names for a credential.',
  'guide: https://crow.direct/ref/serve.txt',
].join('\n');

/**
 * Runs the command. A number is the exit status of a call that started nothing; undefined means the adapter runs, and
 * the process ends when SIGTERM or SIGINT stops it.
 */
export async function main(argv: readonly string[]): Promise<number | undefined> {
  const asked = helpAsked(argv);
  if (asked !== null) {
    (asked === 0 ? console.log : console.error)(USAGE);
    return asked;
  }
  const file = argv[0];
  if (argv.length !== 1 || file === undefined || file.startsWith('-')) {
    console.error(USAGE);
    return 2;
  }
  // The handlers go in before the start: startSellerAdapter prints its ready line before it returns, so one installed
  // after it left a signal sent on that line to the operating system, which killed the process (a failed CI run).
  // From that line to the assignment of `adapter` below, only synchronous code and microtasks run, and Node runs a
  // signal's handler between turns of its event loop. So after the ready line, the handler finds the adapter.
  let adapter: RunningAdapter | undefined;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      const running = adapter;
      // Still starting, perhaps waiting on an operator that never answers: no quote is served and no pass has run.
      if (running === undefined) {
        console.log(`${new Date().toISOString()} ${signal}: the adapter stops before it serves; the journal keeps every open deal.`);
        process.exit(0);
      }
      // As seller-adapter.ts's own command line: it stops taking quotes, lets the step in progress finish and record
      // itself in the journal, then exits. The next start resumes every open deal from the journal.
      console.log(`${new Date().toISOString()} ${signal}: the adapter stops after the step in progress; the journal keeps every open deal.`);
      void running.close().then(() => process.exit(0));
    });
  }
  try {
    const settings = loadConfig(file); // it throws on a file that is not one JSON object, so the read below parses
    if (!Object.hasOwn(JSON.parse(readFileSync(file, 'utf8')) as object, 'template')) {
      throw new Error(`${file}: template is required: serve.mjs carries no deal template, so name your own, with its scope`);
    }
    // The adapter takes a template beside its own file for the repository's shipped one, and salts its reports. In one
    // bundled file that is the folder the command was downloaded into, so every template here is the seller's own: no
    // salt unless the file sets reportSalt.
    settings.reportSalt ??= false;
    for (const pin of knownPins()) {
      if (!TEST_CHAINS.includes(pin.domain.chainId)) {
        throw new Error(`chain ${plain(String(pin.domain.chainId)).slice(0, 20)} is not Sepolia (11155111) or a local chain (31337): this file moves test tokens only. Check HOLDBACK_DEPLOYMENT and HOLDBACK_CHAIN_ID`);
      }
    }
    adapter = await startSellerAdapter(settings, process.env);
  } catch (e) {
    console.error(`serve: ${plain((e as Error).message)}`);
    return 2;
  }
  return undefined;
}
