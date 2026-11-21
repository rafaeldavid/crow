// N166: after a deploy that may have changed what runs, the deploy asks for a Crow Control build, so the page shows
// the deploy within minutes, not after its two-hour wait. It never changes the deploy's exit code, and a refusal
// before any upload, a dry run or a check-only run asks for none. No network: the command runner is a fake.
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain ESM script without type declarations
import { CONSOLE_BUILD, finishDeploy, refreshConsole } from '../scripts/deploy-lib.mjs';

type Run = (cmd: string, args: string[], o: { show: boolean; timeoutMs: number }) => Promise<{ code: number | null; stdout: string; out: string }>;
const fake = (code: number | null) => {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const run: Run = async (cmd, args) => (calls.push({ cmd, args }), { code, stdout: '', out: '' });
  return { run, calls };
};

describe('the Crow Control build after a deploy (N166)', () => {
  it('starts a manual build of the console workflow, which always builds', async () => {
    const f = fake(0);
    expect(await refreshConsole(f.run)).toBe('Crow Control: a build started; the page shows this deploy in about 5 minutes.');
    expect(f.calls).toEqual([{ cmd: 'gh', args: ['workflow', 'run', 'control-hourly.yml', '--repo', 'rafaeldavid/crow-ops-private', '--ref', 'main'] }]);
    expect(CONSOLE_BUILD).toEqual({ repo: 'rafaeldavid/crow-ops-private', workflow: 'control-hourly.yml', ref: 'main' });
  });

  it('says so in one line and names the command when gh cannot start it', async () => {
    expect(await refreshConsole(fake(1).run)).toMatch(/^Crow Control: no build started \(gh exit 1\);.* or run: gh workflow run control-hourly\.yml/);
    expect(await refreshConsole(fake(null).run)).toMatch(/^Crow Control: no build started \(gh timed out\)/);
  });

  it('keeps the deploy exit code, and asks for a build only when the deploy may have changed what runs', async () => {
    for (const [code, args, asks] of [[0, [], true], [1, [], true], [2, [], false], [0, ['--dry-run'], false], [0, ['--check-only'], false]] as const) {
      const f = fake(0);
      const lines: string[] = [];
      expect(await finishDeploy(code, [...args], { run: f.run, log: (l: string) => lines.push(l) })).toBe(code);
      expect(f.calls.length, `${code} ${args.join(' ')}`).toBe(asks ? 1 : 0);
      expect(lines.length).toBe(asks ? 1 : 0);
    }
  });
});
