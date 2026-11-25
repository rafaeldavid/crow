// The entry of site/serve.mjs (T-606): the seller adapter run from one configuration file, in one pinned file, run
// with Node and no clone.
//
//   node serve.mjs <seller.json>   examples/serve.ts: start the adapter, run until SIGTERM or Ctrl-C
//
// It runs the command whenever the file runs, as site/setup-entry.mjs does. A call that started nothing ends the process
// at once with its status, as seller-adapter.ts's own command line does: a start refused on one operator's answer can
// leave a request to another still open, which would keep the process alive for minutes. A running adapter keeps the
// process alive by itself.
import { main } from '../examples/serve.ts';

const status = await main(process.argv.slice(2));
if (status !== undefined) process.exit(status);
