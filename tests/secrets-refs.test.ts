// T-480, row N137: the references files in config/secrets/ hold 1Password references and plain configuration only,
// never a secret, and nothing in the repository's scripts or standing docs loads or asks for a local .env file.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain .mjs module with no type declarations
import { lengthClass, loadRefs, parseRefs, PLAIN, redact } from '../scripts/secrets/refs.mjs';

const ROOT = join(import.meta.dirname, '..');
const DIR = join(ROOT, 'config', 'secrets');

describe('config/secrets', () => {
  it('holds only valid references files, none named .env*', () => {
    const files = readdirSync(DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f.startsWith('.env'), f).toBe(false);
      expect(f.endsWith('.refs'), f).toBe(true);
    }
    const { entries, errors } = loadRefs([DIR]);
    expect(errors).toEqual([]);
    expect(entries.length).toBeGreaterThan(0);
  });

  it('names each item once, in the crow vault, field credential', () => {
    const { entries } = loadRefs([DIR]);
    const items = entries.filter((e: { ref?: unknown }) => e.ref).map((e: { ref: { vault: string; item: string; field: string } }) => e.ref);
    expect(new Set(items.map((r: { item: string }) => r.item)).size).toBe(items.length);
    for (const r of items) expect([r.vault, r.field]).toEqual(['crow', 'credential']);
  });

  it('carries the live judges, the agents and the e2e seed', () => {
    const names = loadRefs([DIR]).entries.map((e: { name: string }) => e.name);
    for (const n of ['HOLDBACK_ANTHROPIC_API_KEY', 'HOLDBACK_OPENAI_COMPATIBLE_API_KEY', 'HOLDBACK_AGENT_ANTHROPIC_API_KEY', 'HOLDBACK_AGENT_OPENAI_COMPATIBLE_API_KEY', 'E2E_SEPOLIA_SEED', 'HOLDBACK_FEEDBACK_SECRET_KEY'])
      expect(names).toContain(n);
  });
});

describe('parseRefs', () => {
  const made = 'mk' + 'q7'.repeat(12);
  it('refuses a line that holds a value, and never repeats the value', () => {
    for (const line of [`HOLDBACK_ANTHROPIC_API_KEY=${made}`, `SEPOLIA_RPC_URL=https://rpc.example/${made}`, `X_BASE_URL=https://api.example/?key=${made}`, `HOLDBACK_ANTHROPIC_API_KEY="op://crow/a/credential"`, `lower=op://crow/a/credential`, made]) {
      const { entries, errors } = parseRefs(`# comment\n\n${line}\n`, 'f.refs');
      expect(entries, line).toEqual([]);
      expect(errors.length, line).toBe(1);
      expect(errors[0]).not.toContain(made);
    }
  });

  it('refuses another vault or field, and a reference with spaces or capitals', () => {
    for (const ref of ['op://other/a/credential', 'op://crow/a/password', 'op://crow/My Item/credential', 'op://crow/A/credential', 'op://crow/a/credential/extra'])
      expect(parseRefs(`A_KEY=${ref}`, 'f').errors.length, ref).toBe(1);
  });

  it('accepts a reference and a pinned base URL', () => {
    const { entries, errors } = parseRefs('A_KEY=op://crow/mac-a/credential\nHOLDBACK_OPENAI_COMPATIBLE_BASE_URL=https://api.deepseek.com\n', 'f');
    expect(errors).toEqual([]);
    expect(entries.map((e: { name: string }) => e.name)).toEqual(['A_KEY', 'HOLDBACK_OPENAI_COMPATIBLE_BASE_URL']);
  });

  it('refuses a base URL pointed at another host, since the key travels to it', () => {
    for (const line of ['HOLDBACK_OPENAI_COMPATIBLE_BASE_URL=https://attacker.example', 'HOLDBACK_AGENT_OPENAI_COMPATIBLE_BASE_URL=https://api.deepseek.com.evil.example', 'OTHER_BASE_URL=https://api.deepseek.com'])
      expect(parseRefs(line, 'f').errors.length, line).toBe(1);
  });

  it('pins each base URL to the host the judges and agents call (a change here is a reviewed change)', () => {
    expect(PLAIN).toEqual({ HOLDBACK_OPENAI_COMPATIBLE_BASE_URL: 'https://api.deepseek.com', HOLDBACK_AGENT_OPENAI_COMPATIBLE_BASE_URL: 'https://api.deepseek.com' });
  });
});

describe('loadRefs', () => {
  it('names a missing file or folder as an error, without a stack trace', () => {
    const { entries, errors } = loadRefs([join(ROOT, 'no-such-folder'), DIR]);
    expect(errors).toEqual([`${join(ROOT, 'no-such-folder')}: no such file or folder`]);
    expect(entries.length).toBeGreaterThan(0);
  });
});

describe('the helpers', () => {
  it('lengthClass says only empty, short or plausible', () => {
    expect([undefined, '', 'op://crow/a/credential', 'abc', 'x'.repeat(19), 'x'.repeat(20)].map(lengthClass)).toEqual(['not set', 'empty', 'still a reference', 'short', 'short', 'plausible']);
  });
  it('redact hides every value, longest first', () => {
    expect(redact('a abcdef abcdefgh b', ['abcdef', 'abcdefgh', 'x'])).toBe('a [redacted] [redacted] b');
  });
});

describe('nothing loads or asks for a local .env', () => {
  it('no package script loads an env file', () => {
    const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>;
    for (const [name, cmd] of Object.entries(scripts)) expect(cmd, name).not.toMatch(/env-file|dotenv/);
  });

  it('no standing doc or script tells anyone to load or fill .env', () => {
    // Dated records keep their commands as they ran (docs/writing.md, Numbers that drift).
    const tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '--', ':(exclude,glob)**/.env*', ':(exclude)docs/tasks', ':(exclude)docs/reviews', ':(exclude)docs/research', ':(exclude)docs/decisions', ':(exclude)docs/audit', ':(exclude)docs/cutover-phase-one.md', ':(exclude)tests/secrets-refs.test.ts'], { encoding: 'utf8' })
      .split('\n').filter((f) => /\.(md|mjs|ts|js|json|sh|template|txt|refs)$/.test(f));
    const bad = /--env-file(-if-exists)?=\.env\b|in (the git-ignored )?`?\.env`?( at the repo(sitory)? root)? as |(cp|cat) config\/keys[^ ]* >*\s*\.env|appends it to \.env|in \.env as /;
    const hits = tracked.filter((f) => { try { return bad.test(readFileSync(join(ROOT, f), 'utf8')); } catch { return false; } });
    expect(hits).toEqual([]);
  });
});
