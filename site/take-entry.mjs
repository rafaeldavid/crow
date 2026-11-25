// The entry of site/take.mjs (T-551): the buyer's command that takes a standing offer, in one pinned file, run with
// Node and no clone.
//
//   node take.mjs <card URL> <offer id> <key store> <the most you pay>   examples/take.ts: check, fill, show, stop
//   node take.mjs approve | resume ...
//
// It runs the command whenever the file runs, as site/setup-entry.mjs does, and sets the exit status, so every line
// is written before the process ends.
import { main } from '../examples/take.ts';

process.exitCode = await main(process.argv.slice(2));
