// The Worker's entry (T-478). site/build.mjs bundles this file into site/seller-worker.mjs, pinned by SHA-256, and
// keeps `./seller-bundle.txt` outside the bundle: `setup.mjs cloudflare` writes that file beside the Worker, and
// Wrangler uploads it as a text module (its default rule for *.txt). It holds the seller's bundle as JSON, and no
// secret. worker.ts holds everything else.
import text from './seller-bundle.txt';
import { OwnSellerObject, setupOf, workerFor, type Env } from './worker.ts';
import type { DurableObjectState } from '../../hosted-sellers/src/worker.ts';

const parsed = (() => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return 'seller-bundle.txt is not JSON';
  }
})();
const setup = setupOf(parsed);

/** The seller's Durable Object, bound to the deployed bundle. */
export class OwnSeller extends OwnSellerObject {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, setup);
  }
}

export default workerFor(setup);
