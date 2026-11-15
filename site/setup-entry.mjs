// The entry of site/setup.mjs (T-472): the setup command in one pinned file, run with Node and no clone.
//
//   node setup.mjs <command> [flags]     examples/setup.ts: status, check, first-deal
//
// It runs the command whenever the file runs, with no test of whether this file is the program: such a test compares
// paths, and fails silently in a folder reached through a symbolic link. The bundled tools' own tests of that kind are
// taken out by site/build.mjs, so only this file reads the command line.
// It sets the exit status and lets the process end by itself, so every line is written before it ends.
import { main } from '../examples/setup.ts';

process.exitCode = await main(process.argv.slice(2));
