// T-478: the pilot's hosted sellers are unchanged. The second shell lives in new paths, so the branch's diff against
// main touches none of the frozen paths (D72 to D75). The test reads the diff from git; a clone without main's
// history (a shallow checkout) skips it and says why.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const git = (...args: string[]) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
const FROZEN = ['apps/hosted-sellers/', 'examples/seller-adapter-core.ts', 'examples/seller-adapter-api.ts', 'packages/'];
const base = ['origin/main', 'main'].find((ref) => git('rev-parse', '--verify', '--quiet', ref).status === 0);
const mergeBase = base === undefined ? undefined : git('merge-base', base, 'HEAD').stdout.trim() || undefined;

describe('T-478: the frozen paths', () => {
  it.skipIf(mergeBase === undefined)('the diff from main changes no file of the hosted seller, the core, the API client or packages/', () => {
    const changed = git('diff', '--name-only', mergeBase!, '--').stdout.split('\n').filter(Boolean);
    expect(changed.filter((f) => FROZEN.some((p) => f.startsWith(p)))).toEqual([]);
  });
});
