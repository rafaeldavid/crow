// T-518 (roadmap row N181): the dependency install rules stay in place. pnpm itself enforces them on every install
// (measured in docs/tasks/T-518-dependency-checks.md, Evidence); this test fails when someone removes or weakens a
// setting, and when a script runs an outside tool without an exact version. It reads files only: no network.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const FOURTEEN_DAYS_IN_MINUTES = 14 * 24 * 60;

// The only top-level keys the file may carry, and the shape of each line under a block key. Any other key, a quoted
// or flow-style key, or a line of another shape is a problem: a setting such as `trustLockfile`,
// `minimumReleaseAgeIgnoreMissingTime`, `dangerouslyAllowAllBuilds` or `pnpmfile` can weaken the rules, so a new
// key is added here on purpose, in review, or not at all.
const ITEM_SHAPES: Record<string, RegExp | undefined> = {
  packages: /^- [\w./*-]+$/,
  overrides: /^[\w@./<>=^~*-]+: [\w.^~<>=*-]+$/,
  minimumReleaseAge: undefined,
  minimumReleaseAgeExclude: /^- .+$/,
  strictDepBuilds: undefined,
  allowBuilds: /^.+$/,
};

/** The top-level `key: value` lines of a pnpm-workspace.yaml, the item lines under each block key, and stray lines. */
function topLevel(yaml: string): { keys: Map<string, { value: string; items: string[] }>; stray: string[] } {
  const keys = new Map<string, { value: string; items: string[] }>();
  const stray: string[] = [];
  let current: { name: string; value: string; items: string[] } | undefined;
  for (const line of yaml.split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue;
    const top = /^([A-Za-z][\w.-]*):(?:\s+(.*?))?\s*(#.*)?$/.exec(line);
    if (top) {
      if (!(top[1]! in ITEM_SHAPES) || keys.has(top[1]!)) stray.push(line);
      current = { name: top[1]!, value: top[2] ?? '', items: [] };
      keys.set(top[1]!, current);
    } else if (current && /^\s+\S/.test(line) && ITEM_SHAPES[current.name]?.test(line.trim().replace(/\s+#.*$/, ''))) {
      current.items.push(line.trim().replace(/\s+#.*$/, ''));
    } else stray.push(line);
  }
  return { keys, stray };
}

const EXACT_NAME_AT_VERSION = /^'?(@[a-z0-9._-]+\/)?[a-z0-9._-]+@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?'?$/;

/** What is wrong with the install rules in this pnpm-workspace.yaml text; an empty list when they hold. */
export function installRuleProblems(yaml: string): string[] {
  const { keys, stray } = topLevel(yaml);
  const problems: string[] = stray.map((line) => `unexpected line in pnpm-workspace.yaml: ${line.trim()}`);
  const age = Number(keys.get('minimumReleaseAge')?.value);
  if (!(age >= FOURTEEN_DAYS_IN_MINUTES)) problems.push(`minimumReleaseAge must be at least ${FOURTEEN_DAYS_IN_MINUTES} (14 days in minutes)`);
  if (keys.get('minimumReleaseAgeStrict')?.value === 'false') problems.push('minimumReleaseAgeStrict must not be false');
  const exclude = keys.get('minimumReleaseAgeExclude');
  for (const item of exclude?.items ?? []) {
    const entry = item.replace(/^-\s*/, '');
    if (!EXACT_NAME_AT_VERSION.test(entry)) problems.push(`minimumReleaseAgeExclude entry ${entry} is not an exact name@version`);
  }
  if (exclude && !['', '[]'].includes(exclude.value)) problems.push('minimumReleaseAgeExclude must be [] or a block list of exact name@version entries');
  if (keys.get('strictDepBuilds')?.value !== 'true') problems.push('strictDepBuilds must be true');
  if (keys.has('dangerouslyAllowAllBuilds')) problems.push('dangerouslyAllowAllBuilds must not be set');
  if (keys.has('permissions')) problems.push('permissions overrides allowBuilds; keep the allowlist in allowBuilds');
  const builds = keys.get('allowBuilds');
  if (!builds) problems.push('allowBuilds must be present ({} when no package may build)');
  for (const item of builds?.items ?? []) {
    if (!/^'?(@[a-z0-9._-]+\/)?[a-z0-9._-]+'?:\s*(true|false)$/.test(item)) problems.push(`allowBuilds entry ${item} must name one package: true or false`);
  }
  return problems;
}

/** Each outside tool a tracked script or standing doc runs through npx, with the version it names. */
function toolPins(): { file: string; tool: string; version: string }[] {
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && !f.startsWith('docs/tasks/') && !f.startsWith('docs/research/') && !f.startsWith('docs/reviews/') && f !== 'pnpm-lock.yaml')
    .filter((f) => /\.(m?js|ts|md|json|refs|sh)$/.test(f) && existsSync(join(root, f)));
  const pins: { file: string; tool: string; version: string }[] = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const m of text.matchAll(/\b(wrangler|cf)@([0-9][^\s'"`,)\]]*|latest|next)/g)) pins.push({ file, tool: m[1]!, version: m[2]! });
  }
  return pins;
}

describe('the install rules (T-518)', () => {
  const yaml = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');

  it('hold in pnpm-workspace.yaml', () => {
    expect(installRuleProblems(yaml)).toEqual([]);
  });

  it('are not weakened by an .npmrc', () => {
    const npmrc = join(root, '.npmrc');
    const text = existsSync(npmrc) ? readFileSync(npmrc, 'utf8') : '';
    expect(text).not.toMatch(/minimum-release-age|minimumReleaseAge|dep-builds|DepBuilds|allow-all-builds|AllowAllBuilds|ignore-scripts\s*=\s*false/);
  });

  it('are not rewritten by a pnpmfile', () => {
    for (const name of ['.pnpmfile.cjs', '.pnpmfile.mjs', 'pnpmfile.cjs', 'pnpmfile.mjs']) expect(existsSync(join(root, name)), name).toBe(false);
  });

  it('fail on a key outside the allowlist, however it is written', () => {
    const under = (line: string) => yaml.replace('strictDepBuilds: true', `strictDepBuilds: true\n${line}`);
    expect(installRuleProblems(under('"dangerouslyAllowAllBuilds": true'))).not.toEqual([]);
    expect(installRuleProblems(under('  dangerouslyAllowAllBuilds: true'))).not.toEqual([]);
    expect(installRuleProblems(`${yaml}\ntrustLockfile: true\n`)).not.toEqual([]);
    expect(installRuleProblems(`${yaml}\nminimumReleaseAgeIgnoreMissingTime: true\n`)).not.toEqual([]);
    expect(installRuleProblems(`${yaml}\npnpmfile: x.cjs\n`)).not.toEqual([]);
    expect(installRuleProblems(`${yaml}\n{ dangerouslyAllowAllBuilds: true }\n`)).not.toEqual([]);
    expect(installRuleProblems(`${yaml}\nstrictDepBuilds: false\n`)).not.toEqual([]);
  });

  it('fail when a setting is removed or weakened', () => {
    expect(installRuleProblems(yaml.replace(/^minimumReleaseAge: .*$/m, ''))).toContain('minimumReleaseAge must be at least 20160 (14 days in minutes)');
    expect(installRuleProblems(yaml.replace(/^minimumReleaseAge: .*$/m, 'minimumReleaseAge: 1440'))).toContain('minimumReleaseAge must be at least 20160 (14 days in minutes)');
    expect(installRuleProblems(yaml.replace(/^strictDepBuilds: .*$/m, ''))).toContain('strictDepBuilds must be true');
    expect(installRuleProblems(yaml.replace(/^allowBuilds: .*$/m, ''))).toContain('allowBuilds must be present ({} when no package may build)');
    expect(installRuleProblems(`${yaml}\ndangerouslyAllowAllBuilds: true\n`)).toContain('dangerouslyAllowAllBuilds must not be set');
    expect(installRuleProblems(`${yaml}\nminimumReleaseAgeStrict: false\n`)).toContain('minimumReleaseAgeStrict must not be false');
  });

  it('take an exception only as an exact name@version', () => {
    const withExclude = (entry: string) => yaml.replace('minimumReleaseAgeExclude: []', `minimumReleaseAgeExclude:\n  # 2026-11-18, GHSA-test, T-518\n  - ${entry}`);
    expect(installRuleProblems(withExclude('some-package@1.2.3'))).toEqual([]);
    expect(installRuleProblems(withExclude("'@scope/pkg@1.2.3'"))).toEqual([]);
    expect(installRuleProblems(withExclude('some-package'))).toHaveLength(1);
    expect(installRuleProblems(withExclude('some-package@^1.2.3'))).toHaveLength(1);
    expect(installRuleProblems(withExclude("'@scope/*'"))).toHaveLength(1);
  });

  it('run wrangler and cf at one exact version each', () => {
    const pins = toolPins();
    expect(pins.length).toBeGreaterThan(0);
    const loose = pins.filter((p) => !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(p.version));
    expect(loose.map((p) => `${p.file}: ${p.tool}@${p.version}`)).toEqual([]);
    for (const tool of ['wrangler', 'cf']) {
      const versions = new Set(pins.filter((p) => p.tool === tool).map((p) => p.version));
      expect([...versions], `${tool} versions in use`).toHaveLength(1);
    }
  });
});
