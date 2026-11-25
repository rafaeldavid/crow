// T-496: what each published bundle can reach, read from its syntax tree, so an agent can trust one short list
// instead of reading thousands of lines. Each bundle site/build.mjs writes has an entry below: its static imports, the
// require calls it makes, the members of `process` it reads, and every host named in a string. A later edit that adds
// an import, a require, a host or a process member fails here until the entry is changed on purpose, in review.
// No bundle may load code at run time: no import(), eval, Function, Worker, child process, vm or worker thread. One
// exception is named in LOADS below, with its reason (T-478).
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
        // An alias of eval or Function counts as the thing itself: (0, eval)(...), globalThis.eval(...), x['Function'](...), and any .constructor(...) call.
        const c = node['callee'] as Node;
        const last = c?.type === 'SequenceExpression' ? (c['expressions'] as Node[]).at(-1) : undefined;
        const member = c?.type === 'MemberExpression' ? (c['computed'] ? ((c['property'] as Node)['value'] as string) : name(c['property'])) : undefined;
        if (name(last) === 'eval' || member === 'eval') loads.add('eval');
        if (member === 'Function') loads.add('Function');
        // new this.constructor() with no argument is a class copying itself (noble's hashes); anything else may build a function.
        if (member === 'constructor' && ((c['object'] as Node).type !== 'ThisExpression' || (node['arguments'] as Node[]).length > 0)) loads.add('.constructor()');
        if (member === 'getBuiltinModule') loads.add('getBuiltinModule');
        const callee = name(node['callee']);
        const arg = (node['arguments'] as Node[])[0];
        const literal = arg?.type === 'Literal' ? JSON.stringify(arg['value'], (_k, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v)) : '...';
        if (callee === 'require' || callee === '__require' || callee === 'createRequire') requires.add(`${callee}(${callee === 'createRequire' ? '...' : literal})`);
        if (callee === 'eval' || callee === 'Function' || callee === 'Worker') loads.add(`${node.type === 'NewExpression' ? 'new ' : ''}${callee}`);
        break;
      }
      case 'MemberExpression':
        if (name(node['object']) === 'process') proc.add(node['computed'] ? '[computed]' : name(node['property'])!);
        if (name(node['object']) === 'WebAssembly') loads.add('WebAssembly');
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
  for (const s of strings) {
    for (const m of s.matchAll(/\b(?:https?|wss?):\/\/([a-z0-9.-]+)/gi)) hosts.add(m[1]!.toLowerCase());
    // A URL whose host is joined on at run time: the string ends at the scheme.
    if (/\b(?:https?|wss?):\/\/$/i.test(s)) hosts.add('(joined at run time)');
  }
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
    // T-478: node:dns, node:https and node:net for check --published, which resolves an address and checks it before
    // it connects; node:child_process for the one pinned Wrangler run (LOADS).
    imports: ['node:child_process', 'node:crypto', 'node:dns', 'node:fs', 'node:http', 'node:https', 'node:module', 'node:net', 'node:os', 'node:path', 'node:url'],
    requires: ['__require("buffer")', '__require("crypto")', '__require("process")', 'createRequire(...)'],
    process: ['argv', 'cwd', 'env', 'exit', 'exitCode', 'kill', 'pid', 'platform', 'stderr', 'stdout', 'versions'],
    // 127.0.0.1 is the local preview it serves, whose bound address is joined at run time; holdback.dev and json-schema.org
    // are schema IDs; the rest are examples in its help.
    hosts: ['(joined at run time)', '127.0.0.1', 'abitype.dev', 'adapter', 'api.crow.direct', 'api2.crow.direct', 'crow.direct', 'docs.soliditylang.org', 'holdback.dev', 'join.crow.direct', 'json-schema.org', 'sample', 'seller.example', 'sepolia.etherscan.io', 'viem.sh', 'your-site.example'],
  },
  // T-478: a seller's own Worker. It runs in Cloudflare's runtime on the party's account, never with Node on a machine.
  // Its hosts are the demo's, the schema IDs, and the documentation hosts viem and ox name in their messages.
  'seller-worker.mjs': {
    imports: ['./seller-bundle.txt', 'node:crypto', 'node:fs', 'node:path', 'node:url'],
    requires: [],
    process: ['argv', 'cwd', 'env', 'exit', 'stdout'],
    hosts: ['127.0.0.1', '4byte.sourcify.dev', 'abitype.dev', 'arweave.net', 'crow.direct', 'docs.soliditylang.org', 'holdback.dev', 'ipfs.io', 'json-schema.org', 'oxlib.sh', 'rolldown.rs', 'seller.example', 'sepolia.etherscan.io', 'viem.sh'],
  },
  // T-551: it reads the card at a URL the person gives, so its hosts are the demo's, the schema IDs and viem's docs.
  'take.mjs': {
    imports: ['node:crypto', 'node:fs', 'node:module', 'node:path', 'node:url'],
    requires: ['__require("crypto")', 'createRequire(...)'],
    process: ['argv', 'cwd', 'env', 'exit', 'exitCode', 'stderr', 'stdout'],
    hosts: ['abitype.dev', 'api.crow.direct', 'api2.crow.direct', 'docs.soliditylang.org', 'holdback.dev', 'json-schema.org', 'seller.example', 'sepolia.etherscan.io', 'viem.sh'],
  },
};

/**
 * The only code a bundle may load at run time, by file (T-478): setup.mjs runs one child process, the pinned Wrangler
 * through npx, for `cloudflare --key` and `leave`. The test below holds it to that one call.
 */
const LOADS: Record<string, string[]> = { 'setup.mjs': ['node:child_process'] };

/** Every file in site/ whose opening comment says site/build.mjs generated it: the published bundles. */
const bundles = () => readdirSync(site('.')).filter((f) => f.endsWith('.mjs') && /^\/\/[^\n]*\n(\/\/[^\n]*\n)*?\/\/[^\n]*Generated by site\/build\.mjs/.test(`${readFileSync(site(f), 'utf8').split('\n').slice(0, 8).join('\n')}\n`)).sort();

describe('the published bundles (T-496)', () => {
  it('are each listed here', () => {
    expect(bundles()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [file, expected] of Object.entries(EXPECTED)) {
    it(`${file} imports, requires, reads from process and names only what its entry lists, and loads no code at run time`, () => {
      const got = contents(readFileSync(site(file), 'utf8'));
      expect(got.loads, `${file} loads code at run time`).toEqual(LOADS[file] ?? []);
      expect({ imports: got.imports, requires: got.requires, process: got.process, hosts: got.hosts }, `${file} reaches something its entry in tests/site-bundles.test.ts does not list`).toEqual(expected);
    });
  }

  it('setup.mjs starts one child process: npx with the pinned Wrangler, and the arguments its command gives', () => {
    const code = readFileSync(site('setup.mjs'), 'utf8');
    const calls = [...code.matchAll(/\bspawn\(/g)];
    expect(calls).toHaveLength(1);
    expect(code).toContain('spawn("npx", [...WRANGLER, ...args],');
    expect(code).toMatch(/const WRANGLER = \["--yes", `wrangler@\$\{WRANGLER_VERSION\}`\];/);
    expect(code).toMatch(/const WRANGLER_VERSION = "4\.151\.3";/);
  });

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
    const aliased = contents("(0, eval)('1'); globalThis.eval('1'); globalThis['Function']('x'); (() => {}).constructor('x')(); process['binding']; globalThis.process.getBuiltinModule('child_process'); WebAssembly.instantiate(b); fetch('https://' + h);");
    expect(aliased.loads).toEqual(['.constructor()', 'Function', 'WebAssembly', 'eval', 'getBuiltinModule']);
    expect(aliased.process).toEqual(['[computed]']);
    expect(aliased.hosts).toEqual(['(joined at run time)']);
    expect(planted.loads).toEqual(['eval', 'import()', 'new Function', 'node:child_process', 'process.binding']);
    expect(planted.requires).toEqual(['__require("os")', 'require("fs")']);
    expect(planted.hosts).toEqual(['evil.example']);
  });
});
