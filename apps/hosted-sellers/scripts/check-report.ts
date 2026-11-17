// `node apps/hosted-sellers/scripts/check-report.ts <seller folder> <job.json> [<artifacts.json>] --scope <scope.json>
//   [--options <options.json>] [--terms <terms.json>] [--detail] [--json]` (T-502), after `pnpm install && pnpm -r build`.
// `pnpm -C apps/hosted-sellers check-report ...` runs the same, with paths read from apps/hosted-sellers.
//
// Runs a finished job's answer through every step the hosted seller runs before it delivers, on this machine: the
// result mapping, the artifacts call, the report mapping, the salt, the adjudicator's intake and every agreed check.
// It calls the seller's own code (src/check-report.ts), so its verdict is the live preflight's. It reads local files
// only and sends nothing.
//
//   <seller folder>   the folder the deploy reads: hosted.json, adapter.json, the template and the report mapping
//   <job.json>        the result call's answer for the job; an export with the artifacts already inside works too
//   <artifacts.json>  the artifacts call's answer (sellerApi.result.merge), when the job's answer does not hold them
//   --scope           the deal's scope, as the buyer's quote names it
//   --terms           the signed terms (GET /v1/commitments/<id>/terms); left out, the terms a quote would sign
//   --detail          also print each check's own message, which can quote the report: keep it out of shared files
//
// Prints the verdict, then one line per agreed check, with the pointer and message /health would show.
// Exit 0: the seller would deliver it. 1: the seller would refuse it, or the job is not finished. 2: bad usage.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkReport, verdictLines } from '../src/check-report.ts';

const USAGE = 'usage: node apps/hosted-sellers/scripts/check-report.ts <seller folder> <job.json> [<artifacts.json>] --scope <scope.json> [--options <options.json>] [--terms <terms.json>] [--detail] [--json]';

function main(argv: string[]): Promise<number> | number {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--detail' || a === '--json') flags[a.slice(2)] = true;
    else if (a === '--scope' || a === '--options' || a === '--terms') {
      const v = argv[++i];
      if (v === undefined) return usage(`${a} needs a file`);
      flags[a.slice(2)] = v;
    } else if (a.startsWith('--')) return usage(`unknown option ${a}`);
    else positional.push(a);
  }
  if (positional.length < 2 || positional.length > 3) return usage('give the seller folder, the job file and, if separate, the artifacts file');
  if (typeof flags['scope'] !== 'string') return usage('--scope <scope.json> is required: the deal\'s scope');
  const [folder, jobFile, secondFile] = positional as [string, string, string | undefined];
  const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
  let input;
  try {
    input = {
      read: (name: string) => {
        try {
          return readFileSync(join(folder, name), 'utf8');
        } catch {
          return undefined;
        }
      },
      job: readFileSync(jobFile),
      ...(secondFile === undefined ? {} : { second: readFileSync(secondFile) }),
      scope: json(flags['scope']),
      ...(typeof flags['options'] === 'string' ? { options: json(flags['options']) } : {}),
      ...(typeof flags['terms'] === 'string' ? { terms: json(flags['terms']) } : {}),
    };
  } catch (e) {
    return usage((e as Error).message);
  }
  return checkReport(input).then(
    (v) => {
      if (flags['json']) {
        // Without --detail, no check's own message: those can quote the report.
        const shown = flags['detail'] ? v : { ...v, detail: undefined, checks: v.checks.map((k) => Object.fromEntries(Object.entries(k).filter(([f]) => f !== 'detail'))) };
        console.log(JSON.stringify(shown, null, 2));
      } else for (const line of verdictLines(v, { detail: flags['detail'] === true })) console.log(line);
      return v.verdict === 'pass' ? 0 : 1;
    },
    (e: Error) => usage(e.message),
  );
}
function usage(why: string): number {
  console.error(`check-report: ${why}\n${USAGE}`);
  return 2;
}

process.exit(await main(process.argv.slice(2)));
