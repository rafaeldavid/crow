// Entry point for `pnpm demo`. Output goes to demo/out at the repository root. The environment reaches main()
// for --live only: run it under op run --env-file=config/secrets/judges.refs (docs/operations.md, Secrets).
import { fileURLToPath } from 'node:url';
import { main } from './cli.js';

const outDir = fileURLToPath(new URL('../../../demo/out', import.meta.url));

process.exitCode = await main(process.argv.slice(2), {
  outDir,
  log: (line) => console.log(line),
  error: (line) => console.error(line),
  ...(process.argv.includes('--live') ? { env: process.env } : {}),
});
