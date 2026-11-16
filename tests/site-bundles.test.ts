// T-496: what each published bundle can reach, read from its syntax tree, so an agent can trust one short list
// instead of reading thousands of lines. Each bundle site/build.mjs writes has an entry below: its static imports, the
// require calls it makes, the members of `process` it reads, and every host named in a string. A later edit that adds
// an import, a require, a host or a process member fails here until the entry is changed on purpose, in review.
// No bundle may load code at run time: no import(), eval, Function, Worker, child process, vm or worker thread.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rolldown/parseAst';
import { describe, expect, it } from 'vitest';

const site = (f: string) => fileURLToPath(new URL(`../site/${f}`, import.meta.url));
type Node = { type: string; [k: string]: unknown };
type Contents = { imports: string[]; requires: string[]; process: string[]; hosts: string[]; loads: string[] };

/** What a bundle reaches, from its syntax tree: strings in comments do not count, strings in code do. */
export function contents(code: string): Contents {
  const imports = new Set<string>(), requires = new Set<string>(), proc = new Set<string>(), hosts = new Set<string>(), loads = new Set<string>();
  const strings: string[] = [];
  const name = (n: unknown) => ((n as Node)?.type === 'Identifier' ? ((n as Node)['name'] as string) : undefined);
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    const node = n as Node;
    switch (node.type) {
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'ExportNamedDeclaration':
        if (node['source']) imports.add((node['source'] as Node)['value'] as string);
        break;
      case 'ImportExpression':
        loads.add('import()');
        break;
      case 'CallExpression':
      case 'NewExpression': {
        const callee = name(node['callee']);
        const arg = (node['arguments'] as Node[])[0];
        const literal = arg?.type === 'Literal' ? JSON.stringify(arg['value']) : '...';
        if (callee === 'require' || callee === '__require' || callee === 'createRequire') requires.add(`${callee}(${callee === 'createRequire' ? '...' : literal})`);
        if (callee === 'eval' || callee === 'Function' || callee === 'Worker') loads.add(`${node.type === 'NewExpression' ? 'new ' : ''}${callee}`);
        break;
      }
      case 'MemberExpression':
        if (name(node['object']) === 'process' && !node['computed']) proc.add(name(node['property'])!);
        break;
      case 'Literal':
        if (typeof node['value'] === 'string') strings.push(node['value']);
        break;
      case 'TemplateElement':
        strings.push(((node['value'] as { cooked?: string; raw: string }).cooked ?? (node['value'] as { raw: string }).raw));
        break;
    }
    for (const [k, v] of Object.entries(node)) if (k !== 'type' && k !== 'start' && k !== 'end') walk(v);
  };
  walk(parseAst(code));
  for (const s of strings) for (const m of s.matchAll(/\b(?:https?|wss?):\/\/([a-z0-9.-]+)/gi)) hosts.add(m[1]!.toLowerCase());
  for (const m of imports) if (/^(node:)?(child_process|vm|worker_threads|cluster|inspector|wasi)$/.test(m)) loads.add(m);
  for (const m of ['binding', '_linkedBinding', 'dlopen']) if (proc.has(m)) loads.add(`process.${m}`);
  const sorted = (s: Set<string>) => [...s].sort();
  return { imports: sorted(imports), requires: sorted(requires), process: sorted(proc), hosts: sorted(hosts), loads: sorted(loads) };
}

/** The demo's own hosts, and the documentation hosts viem names in its error messages. */
const CROW = ['api.crow.direct', 'api2.crow.direct', 'crow.direct', 'sepolia.etherscan.io'];
const VIEM_DOCS = ['abitype.dev', 'docs.soliditylang.org', 'viem.sh'];
const GOAL = {
  requires: ['__require("crypto")', 'createRequire(...)'], // tweetnacl's random bytes; try.mjs takes them from Web Crypto (T-496)
  process: ['argv', 'env', 'exit', 'versions'],
  hosts: [...CROW, ...VIEM_DOCS].sort(),
};

const EXPECTED: Record<string, Omit<Contents, 'loads'>> = {
  'try.mjs': { imports: ['node:fs'], requires: [], process: ['argv', 'env', 'exit', 'permission', 'versions'], hosts: [...CROW, ...VIEM_DOCS].sort() },
  'try-sell.mjs': { imports: ['node:crypto', 'node:fs', 'node:module'], ...GOAL },
  'try-judged.mjs': { imports: ['node:crypto', 'node:module'], ...GOAL },
  'try-reclaim.mjs': { imports: ['node:crypto', 'node:module'], ...GOAL },
  'preflight.mjs': { imports: ['node:url'], requires: [], process: ['argv', 'env', 'exit', 'versions'], hosts: ['api.crow.direct', 'api2.crow.direct', 'crow.direct'] },
  'buy.mjs': { imports: ['node:fs', 'node:path', 'node:url', 'tweetnacl', 'viem', 'viem/accounts'], requires: [], process: ['argv', 'cwd', 'env', 'exit', 'exitCode', 'stderr', 'stdout'], hosts: ['api.crow.direct', 'api2.crow.direct', 'seller.example', 'sepolia.etherscan.io'] },
  'setup.mjs': {
    imports: ['node:crypto', 'node:fs', 'node:http', 'node:module', 'node:os', 'node:path', 'node:url'],
    requires: ['__require("buffer")', '__require("crypto")', '__require("process")', 'createRequire(...)'],
    process: ['argv', 'cwd', 'env', 'exit', 'exitCode', 'kill', 'pid', 'platform', 'stderr', 'stdout', 'versions'],
    // 127.0.0.1 is the local preview it serves; holdback.dev and json-schema.org are schema IDs; the rest are examples in its help.
    hosts: ['127.0.0.1', 'abitype.dev', 'adapter', 'api.crow.direct', 'api2.crow.direct', 'crow.direct', 'docs.soliditylang.org', 'holdback.dev', 'join.crow.direct', 'json-schema.org', 'sample', 'seller.example', 'sepolia.etherscan.io', 'viem.sh', 'your-site.example'],
  },
};

/** Every file in site/ whose opening comment says site/build.mjs generated it: the published bundles. */
const bundles = () => readdirSync(site('.')).filter((f) => f.endsWith('.mjs') && /^\/\/[^\n]*\n(\/\/[^\n]*\n)*?\/\/[^\n]*Generated by site\/build\.mjs/.test(`${readFileSync(site(f), 'utf8').split('\n').slice(0, 8).join('\n')}\n`)).sort();

describe('the published bundles (T-496)', () => {
  it('are each listed here', () => {
    expect(bundles()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [file, expected] of Object.entries(EXPECTED)) {
    it(`${file} imports, requires, reads from process and names only what its entry lists, and loads no code at run time`, () => {
      const got = contents(readFileSync(site(file), 'utf8'));
      expect(got.loads, `${file} loads code at run time`).toEqual([]);
      expect({ imports: got.imports, requires: got.requires, process: got.process, hosts: got.hosts }, `${file} reaches something its entry in tests/site-bundles.test.ts does not list`).toEqual(expected);
    });
  }

  it('try.mjs says in its banner what this test checks', () => {
    const banner = readFileSync(site('try.mjs'), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 12).join(' ');
    expect(banner.replace(/\s*\/\/\s*/g, ' ')).toContain('Its one import is node:fs, for --out; it has no import(), require, eval or child process.');
  });

  it('finds what it is meant to find', () => {
    const planted = contents(
      [
        "import { exec } from 'node:child_process';",
        "const m = await import('x');",
        "eval('1'); new Function('return 1'); require('fs'); __require('os');",
        "process.binding('fs'); fetch('https://evil.example/x');",
        '// https://comment.example is a comment, which is not code',
      ].join('\n'),
    );
    expect(planted.loads).toEqual(['eval', 'import()', 'new Function', 'node:child_process', 'process.binding']);
    expect(planted.requires).toEqual(['__require("os")', 'require("fs")']);
    expect(planted.hosts).toEqual(['evil.example']);
  });
});
