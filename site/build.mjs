// site/llms.txt is the one source of the front door. This renders it into site/index.html (placeholders kept), or,
// for publishing, writes both files with the operator URLs filled in. It also bundles examples/try.ts into
// site/try.mjs, the one-command test deal, whose sha256 llms.txt carries. The other agent guides (T-393) are the
// buyer's page site/buy.txt, the seller's page site/sell.txt and the reference files site/ref/*.txt; a publish build
// writes each beside llms.txt as written, editor notes left out (site/guides.mjs lists them and holds the budget).
//
//   node site/build.mjs                                   regenerate site/try.mjs and site/index.html
//   node site/build.mjs --op1 URL --op2 URL --out DIR
//                                                         filled llms.txt, index.html and try.mjs in DIR, ready to
//                                                         publish at the site root; refuses while a "%% CONFIRM"
//                                                         note remains or while site/try.mjs is stale
//
// Lines starting with "%% " in llms.txt are editor notes: they never reach a published file.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { JOIN_URL } from './drawer.ts';
import { CARDS, cardTags, FOOTER_CSS, footerHtml } from './footer.ts';
import { headerBar, ICON_FILES, iconBytes, iconLinks, iconTags, kitCss, listRows, sectionHead, TOKENS } from './brand/kit.mjs';
import { writeInlineHashes } from './csp.mjs';
import { guideFiles, guideSource } from './guides.mjs';
import { PAGES_CSS, securityTxt, statusJson, statusPage, trustFacts, trustPage, trustText } from './trust.mjs';

export const SITE_URL = 'https://crow.direct/';
/** The path the site is served under ('/' on crow.direct); every link is absolute from it. */
export const BASE = new URL(SITE_URL).pathname;
const here = (p) => new URL(p, import.meta.url);

export const TRY_URL = `${SITE_URL}try.mjs`;
/** Crow's test seller's intake (apps/test-agents, D47): the one command buys from it. */
export const TEST_SELLER_URL = `${SITE_URL}agents/test-seller`;
/**
 * The exact versions of the two packages try.mjs imports, as the lockfile resolves them for examples/ (where
 * try.ts, agent.ts and verify.ts live and are tested), so the one command installs the viem and tweetnacl CI ran.
 * Their own dependencies resolve afresh on the stranger's machine, which has no lockfile.
 */
export function pins() {
  const lock = readFileSync(here('../pnpm-lock.yaml'), 'utf8');
  const at = lock.indexOf('\n  examples:\n');
  const importer = lock.slice(at, lock.indexOf('\n\n', at + 1));
  const version = (name) => {
    const v = new RegExp(`\\n      ${name}:\\n        specifier: [^\\n]+\\n        version: ([0-9]+\\.[0-9]+\\.[0-9]+)`).exec(importer)?.[1];
    if (at < 0 || !v) throw new Error(`pnpm-lock.yaml resolves no ${name} for examples/`);
    return v;
  };
  return { viem: version('viem'), tweetnacl: version('tweetnacl') };
}

/** The repository files a bundle carries, relative to the root, from its module paths (bundleContents, below). */
const ownFiles = (moduleIds, root) => bundleContents(moduleIds, root).own;

/**
 * The commit try.mjs's banner names (T-496): one whose copies of the bundled source files are byte for byte the
 * tree's, and an ancestor of HEAD, so anyone can fetch it from the public repository and compare. It keeps the commit
 * the committed site/try.mjs already names while that still holds, so a later commit that changes none of the files
 * does not change the bundle; else it takes the newest commit that changed any of them. null when the files have
 * uncommitted changes, or git cannot answer: the bundle then says so, and the tests and the publish build refuse it.
 */
export function trySourceCommit(files, { git = gitIn, committed = readOr(here('try.mjs')) } = {}) {
  const ok = (c) => /^[0-9a-f]{40}$/.test(c ?? '') && sourceCommitProblem(c, files, git) === null;
  const named = sourceCommitOf(committed);
  if (ok(named)) return named;
  const newest = git(['log', '-1', '--format=%H', '--', ...files]);
  const c = newest.status === 0 ? newest.stdout.trim() : null;
  return ok(c) ? c : null;
}
/** Why `commit` is not a source commit for `files`, or null: it must be an ancestor of HEAD with the same files as the tree. */
export function sourceCommitProblem(commit, files, git = gitIn) {
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) return 'it names no source commit (examples/ had uncommitted changes when it was built): commit them, then run node site/build.mjs';
  if (git(['cat-file', '-e', `${commit}^{commit}`]).status !== 0) return `its source commit ${commit} is not in this clone`;
  if (git(['merge-base', '--is-ancestor', commit, 'HEAD']).status !== 0) return `its source commit ${commit} is not an ancestor of HEAD (a rebase?): run node site/build.mjs`;
  const diff = git(['diff', '--quiet', commit, '--', ...files]);
  if (diff.status !== 0) return `its source files differ from commit ${commit}: commit them, then run node site/build.mjs`;
  return null;
}
/** A bundle's opening comment as one line of text. */
const header = (code) => (code ?? '').split('\n').filter((l, i, all) => all.slice(0, i + 1).every((x) => x.startsWith('//'))).map((l) => l.slice(3)).join(' ');
/** The source commit a try.mjs banner names, or null. */
export const sourceCommitOf = (code) => /Source commit: ([0-9a-f]{40}),/.exec(header(code))?.[1] ?? null;
const gitIn = (args) => spawnSync('git', ['-C', fileURLToPath(here('..')), ...args], { encoding: 'utf8' });
const readOr = (url) => {
  try {
    return readFileSync(url, 'utf8');
  } catch {
    return '';
  }
};

const tryBanner = ({ viem, tweetnacl }, files, commit) => `// try.mjs: one test deal on the Crow demo (${SITE_URL}). Test tokens only. With --seller <url> it is the buyer and
// Crow's test seller the other party; without, or when the test seller is unavailable, it plays both sides with fresh keys.
${commentLines(`Generated by site/build.mjs (do not edit here) from ${files.join(', ')} in https://github.com/rafaeldavid/holdback. ${commit ? `Source commit: ${commit}, where those files are the same; site/build.mjs and the lockfile at the commit that merged this file rebuild it byte for byte.` : 'Source commit: none, since those files had uncommitted changes: not for publishing.'}`)}
// Not minified, so you can read it before you run it. It calls only the two demo operators and the test seller you
// name, keeps its keys in memory, and writes no file unless --out <dir> asks for the deal's record. Its one import is
// node:fs, for --out; it has no import(), require, eval or child process. Self-contained: viem@${viem} (MIT License,
// Copyright (c) 2023-present weth, LLC) and tweetnacl@${tweetnacl} (public domain, The Unlicense) are bundled in, each
// taking its random bytes from Web Crypto, so it needs Node 20 or later and no npm install.
`;

/**
 * T-496: the two places the bundled packages would reach for Node's crypto module, pointed at Web Crypto
 * (globalThis.crypto, in Node 20 and later) instead, so try.mjs needs no node:crypto import and no require. noble's
 * hashes take its own browser build of the same module; tweetnacl seeds its random bytes from getRandomValues, as it
 * does in a browser. Each refuses a file whose code no longer matches; a file that moves is not transformed, and then
 * the import and require lists that site/check.mjs and tests/site-bundles.test.ts pin fail the build.
 */
const WEB_CRYPTO = {
  name: 'web-crypto',
  transform(code, id) {
    if (id.endsWith('/@noble/hashes/esm/cryptoNode.js')) {
      if (!code.includes("import * as nc from 'node:crypto';")) throw new Error(`${id} changed: check the web-crypto plugin in site/build.mjs`);
      return { code: "export const crypto = typeof globalThis === 'object' && 'crypto' in globalThis ? globalThis.crypto : undefined;\n", map: null };
    }
    if (id.endsWith('/tweetnacl/nacl-fast.js')) {
      const from = "var crypto = typeof self !== 'undefined' ? (self.crypto || self.msCrypto) : null;";
      const node = /\} else if \(typeof require !== 'undefined'\) \{\n\s+\/\/ Node\.js\.\n\s+crypto = require\('crypto'\);\n\s+if \(crypto && crypto\.randomBytes\) \{\n[\s\S]*?\n\s{4}\}\n\s{2}\}\n/;
      if (!code.includes(from) || !node.test(code)) throw new Error(`${id} changed: check the web-crypto plugin in site/build.mjs`);
      return { code: code.replace(from, 'var crypto = globalThis.crypto;').replace(node, '}\n'), map: null };
    }
    return null;
  },
};

/** examples/try.ts bundled as one plain ESM file, viem and tweetnacl included, not minified. Deterministic. */
export async function tryBundle(p = pins(), { commit } = {}) {
  const root = fileURLToPath(here('../'));
  const bundle = await rolldown({
    cwd: root,
    input: fileURLToPath(here('../examples/try.ts')),
    plugins: [DROP_TOKEN_STORE, WEB_CRYPTO],
    platform: 'node',
    tsconfig: fileURLToPath(here('../examples/tsconfig.json')),
    logLevel: 'warn',
  });
  try {
    const banner = (chunk) => {
      const files = ownFiles(chunk.moduleIds, root).sort();
      return tryBanner(p, files, commit === undefined ? trySourceCommit(files) : commit);
    };
    const { output } = await bundle.generate({ format: 'esm', minify: false, banner, codeSplitting: false });
    if (output.length !== 1 || output[0].type !== 'chunk') throw new Error(`bundling examples/try.ts gave ${output.length} files, not one`);
    const { packages } = bundleContents(output[0].moduleIds, root);
    for (const name of ['viem', 'tweetnacl']) if (packages.get(name) !== p[name]) throw new Error(`site/try.mjs would carry ${name}@${packages.get(name)}, not the ${p[name]} the lockfile pins for examples/`);
    return output[0].code;
  } finally {
    await bundle.close();
  }
}

/** The repository files site/try.mjs carries, as its banner lists them. */
export const tryFiles = (code) => (/Generated by site\/build\.mjs \(do not edit here\) from (.+?) in https:/.exec(header(code))?.[1] ?? '').split(', ').filter(Boolean);

/**
 * The deployment record's tokenStoreImplementation is a public contract address that no bundled command reads (pinOf
 * takes the top-level fields), and the secret scanner reads its name as a key's (generic-api-key). buy.mjs and the
 * goal files leave it out, so the scanner flags nothing it would have to be told to ignore.
 */
const DROP_TOKEN_STORE = { name: 'drop-token-store-implementation', transform: (code, id) => (id.endsWith('/examples/deployments.ts') ? { code: code.replace(/^[ \t]*tokenStoreImplementation: '0x[0-9a-fA-F]{40}',\n/gm, ''), map: null } : null) };

export const BUY_MJS_URL = `${SITE_URL}buy.mjs`;
/**
 * How a person runs each command site/buy.mjs holds (T-393). The bundle's banner declares it as
 * `globalThis.crowCommands`, which examples/entry.ts reads, so the lines the commands print name `node buy.mjs …`.
 */
export const BUY_COMMANDS = Object.freeze({ 'buy-with-signer': 'node buy.mjs', 'pay-from-wallet': 'node buy.mjs pay', 'deal-record': 'node buy.mjs record' });
const buyBanner = ({ viem, tweetnacl }) => `// buy.mjs: the buyer's commands for a deal on the Crow demo (${SITE_URL}), in one file. Test tokens only.
//   node buy.mjs <quote URL> <key store> '<scope>' <the most you pay> [<defaults URL>]   quote, then stop for approval
//   node buy.mjs approve | resume ...   node buy.mjs pay files | check | fund ...   node buy.mjs record <commitment ID> ...
// Generated by site/build.mjs from site/buy-entry.mjs and examples/buy-with-signer.ts, pay-from-wallet.ts,
// deal-record.ts, buyer-signer.ts, agent.ts, verify.ts, deployments.ts and entry.ts in https://github.com/rafaeldavid/holdback
// (do not edit here; one field of the deployment record, the escrow's token store, which no command here reads, is
// left out). Not minified, so you can read it before you run it. Its keys stay in the key store you name, on
// this machine. Node 22.18 or later, with npm install viem@${viem} tweetnacl@${tweetnacl}.
Object.defineProperty(globalThis, 'crowCommands', { value: Object.freeze(${JSON.stringify(BUY_COMMANDS)}), enumerable: false, configurable: false, writable: false });
`;

/** site/buy-entry.mjs and the commands it imports, bundled as one plain ESM file; viem and tweetnacl stay imports. */
export async function buyBundle(p = pins()) {
  const root = fileURLToPath(here('../'));
  const bundle = await rolldown({
    cwd: root,
    input: fileURLToPath(here('buy-entry.mjs')),
    external: [/^viem(\/.*)?$/, 'tweetnacl'],
    plugins: [DROP_TOKEN_STORE],
    platform: 'node',
    tsconfig: fileURLToPath(here('../examples/tsconfig.json')),
    logLevel: 'warn',
  });
  try {
    const { output } = await bundle.generate({ format: 'esm', minify: false, banner: buyBanner(p), codeSplitting: false });
    if (output.length !== 1 || output[0].type !== 'chunk') throw new Error(`bundling site/buy-entry.mjs gave ${output.length} files, not one`);
    if (/tokenStoreImplementation/.test(output[0].code)) throw new Error('site/buy.mjs still carries tokenStoreImplementation: the transform that leaves it out no longer matches examples/deployments.ts');
    return output[0].code;
  } finally {
    await bundle.close();
  }
}

/** The sha256 of site/buy.mjs, hex. */
export const buySha256 = () => createHash('sha256').update(readFileSync(here('buy.mjs'))).digest('hex');

/**
 * The buyer's one setup command (T-393): a fresh folder, the two pinned packages with no install scripts, and
 * buy.mjs from the site, downloaded as buy.mjs.part and moved to buy.mjs only when its sha256 is the pinned one, so a
 * file that fails the check is never buy.mjs. buy.txt carries it as {{BUY_INSTALL}}.
 */
export function buyInstall(sha = buySha256(), { viem, tweetnacl } = pins()) {
  return `mkdir -p crow-buy && cd crow-buy && npm init -y >/dev/null && npm install --silent --ignore-scripts viem@${viem} tweetnacl@${tweetnacl} && curl -fsSL ${BUY_MJS_URL} -o buy.mjs.part && echo "${sha}  buy.mjs.part" | shasum -a 256 -c && mv buy.mjs.part buy.mjs`;
}

/**
 * The goal commands (T-469): one per goal the benchmark scenarios cover beside try.mjs's, each bundled into one
 * self-contained file with viem and tweetnacl inside, so the agent's one command has no install step. `placeholder`
 * is where llms.txt carries the command; `args` are the flags the published command adds.
 */
export const GOALS = Object.freeze({
  'try-sell': { source: 'examples/try-sell.ts', placeholder: '{{SELL_COMMAND}}', args: '', what: "the seller's side of one deal with Crow's test buyer" },
  'try-judged': { source: 'examples/try-judged.ts', placeholder: '{{JUDGED_COMMAND}}', args: '', what: "one purchase from Crow's test seller judged by a live panel against a rubric" },
  'try-reclaim': { source: 'examples/try-reclaim.ts', placeholder: '{{RECLAIM_COMMAND}}', args: '', what: "one purchase from Crow's test seller that is never delivered, and the buyer's reclaim" },
});
/**
 * The preflight (T-491): one read-only command llms.txt runs first, bundled and pinned as a goal file is. It imports
 * only Node's own modules, so its banner names no package. llms.txt carries its command as `placeholder`.
 */
export const PREFLIGHT = Object.freeze({ name: 'preflight', source: 'examples/preflight.ts', placeholder: '{{PREFLIGHT_COMMAND}}' });
const preflightBanner = () => `// preflight.mjs: checks what a first deal on the Crow demo (${SITE_URL}) needs, before anything is signed. Reads only.
// Generated by site/build.mjs from ${PREFLIGHT.source}, deployments.ts and entry.ts in
// https://github.com/rafaeldavid/holdback (do not edit here). Not minified. Imports only Node's own modules; needs
// Node 20 or later. It makes no key, sends only GETs to the two demo operators and Crow's test agents, and writes no file.
`;
const sourceOf = (name) => (name === PREFLIGHT.name ? PREFLIGHT.source : GOALS[name].source);
export const goalUrl = (name) => `${SITE_URL}${name}.mjs`;
const goalBanner = (name, { viem, tweetnacl }) => `// ${name}.mjs: ${GOALS[name].what}, on the Crow demo (${SITE_URL}). Test tokens only.
// Generated by site/build.mjs from ${GOALS[name].source}, goal-kit.ts, agent.ts, verify.ts and finality.ts in
// https://github.com/rafaeldavid/holdback (do not edit here). Not minified, so you can read it before you run it. It
// makes fresh keys in memory, never prints, sends or writes them, and calls only the two demo operators and the test
// agent it names. Self-contained: viem@${viem} (MIT License, Copyright (c) 2023-present weth, LLC) and
// tweetnacl@${tweetnacl} (public domain, The Unlicense) are bundled in, so it needs Node 20 or later and no npm install.
`;

/** A goal command's source (or the preflight's) bundled as one plain ESM file, viem and tweetnacl included, not minified. Deterministic. */
export async function goalBundle(name, p = pins()) {
  const root = fileURLToPath(here('../'));
  const bundle = await rolldown({
    cwd: root,
    input: fileURLToPath(here(`../${sourceOf(name)}`)),
    plugins: [DROP_TOKEN_STORE],
    platform: 'node',
    tsconfig: fileURLToPath(here('../examples/tsconfig.json')),
    logLevel: 'warn',
  });
  try {
    const { output } = await bundle.generate({ format: 'esm', minify: false, banner: name === PREFLIGHT.name ? preflightBanner() : goalBanner(name, p), codeSplitting: false });
    if (output.length !== 1 || output[0].type !== 'chunk') throw new Error(`bundling ${sourceOf(name)} gave ${output.length} files, not one`);
    return output[0].code;
  } finally {
    await bundle.close();
  }
}

/** The sha256 of site/<name>.mjs, hex. */
export const goalSha256 = (name) => createHash('sha256').update(readFileSync(here(`${name}.mjs`))).digest('hex');

/**
 * A goal's one command, in the folder it is run in (it writes one file and installs nothing): the file from the site downloaded as <name>.mjs.part and moved to <name>.mjs
 * only when its sha256 is the pinned one, as buyInstall does, so a file that fails the check is never <name>.mjs (red
 * team F3). No npm: the file carries its two packages.
 */
export function goalCommand(name, sha = goalSha256(name)) {
  return `curl -fsSL ${goalUrl(name)} -o ${name}.mjs.part && echo "${sha}  ${name}.mjs.part" | shasum -a 256 -c && mv ${name}.mjs.part ${name}.mjs && node ${GOALS[name] ? `${NODE_PERMISSION} ` : ''}${name}.mjs${GOALS[name]?.args ? ` ${GOALS[name].args}` : ''}`;
}
/** The preflight's one command, in llms.txt as {{PREFLIGHT_COMMAND}}. */
export const preflightCommand = (sha = goalSha256(PREFLIGHT.name)) => goalCommand(PREFLIGHT.name, sha);
/** Each pinned command llms.txt carries beside try.mjs's, by its placeholder: the goals', then the preflight's (T-491). */
export const goalCommands = () => ({ ...Object.fromEntries(Object.entries(GOALS).map(([name, g]) => [g.placeholder, goalCommand(name)])), [PREFLIGHT.placeholder]: preflightCommand() });

/**
 * Three tools that site/setup.mjs carries run their own command line when the running file is their own: each ends in
 * a block that opens with OWN_MAIN_TEST. Inside one bundled file that test is true for every module, so each tool
 * would read setup.mjs's arguments as its own: report-converter.ts prints its usage and exits 2 before setup's first
 * line. The setup bundle replaces the test with `false`, so the block never runs and the bundler leaves it out. The
 * three files stay as they are (T-472): a file that no longer holds the test exactly once stops the build.
 */
const OWN_MAIN_TEST = 'if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {';
const OWN_MAIN_FILES = ['seller-adapter.ts', 'check-delivery.ts', 'report-converter.ts'];
const SILENCE_OWN_MAINS = {
  name: 'silence-own-command-lines',
  transform: (code, id) => {
    const file = OWN_MAIN_FILES.find((f) => id.endsWith(`/examples/${f}`));
    if (!file) return null;
    if (code.split(OWN_MAIN_TEST).length !== 2) throw new Error(`examples/${file} no longer holds its own command line's test exactly once: site/build.mjs cannot keep it from running inside site/setup.mjs`);
    return { code: code.replace(OWN_MAIN_TEST, 'if (false) {'), map: null };
  },
};

export const SETUP_MJS_URL = `${SITE_URL}setup.mjs`;
/**
 * Every package from npm that site/setup.mjs may carry, with the licence line its banner prints (each from the
 * package's own LICENSE file). The file runs beside a key that lasts, so a package that is not listed here stops the
 * build: adding one is a decision, with its licence, never a side effect of an import.
 */
const SETUP_PACKAGES = Object.freeze({
  viem: 'MIT License, Copyright (c) 2023-present weth, LLC',
  abitype: 'MIT License, Copyright (c) 2022-present weth, LLC',
  '@noble/curves': 'MIT License, Copyright (c) 2022 Paul Miller (https://paulmillr.com)',
  '@noble/hashes': 'MIT License, Copyright (c) 2022 Paul Miller (https://paulmillr.com)',
  tweetnacl: 'public domain, The Unlicense',
  ajv: 'MIT License, Copyright (c) 2015-2021 Evgeny Poberezkin',
  'ajv-formats': 'MIT License, Copyright (c) 2020 Evgeny Poberezkin',
  'fast-deep-equal': 'MIT License, Copyright (c) 2017 Evgeny Poberezkin',
  yaml: 'ISC License, Copyright Eemeli Aro <eemeli@gmail.com>',
});

/** What a bundle holds, from its module paths: the repository's own files, and each npm package with its version. */
function bundleContents(moduleIds, root) {
  const own = [], packages = new Map();
  for (const id of moduleIds) {
    if (id.startsWith('\0')) continue; // the bundler's own runtime helpers
    const npm = /\/node_modules\/\.pnpm\/[^/]+\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id);
    if (!npm) {
      // A workspace package is reached through node_modules, which a copy of the repository may link to another
      // checkout (the cutover's rehearsal, tests/record-copies.test.ts): its built files count as packages/<name>.
      const built = /\/packages\/([a-z-]+)\/dist\//.exec(id);
      if (id.startsWith(root)) own.push(id.slice(root.length));
      else if (built) own.push(`packages/${built[1]}/dist/${id.slice(built.index + built[0].length)}`);
      else throw new Error(`site/setup.mjs would carry ${id}, a file outside the repository`);
      continue;
    }
    const version = new RegExp(`/node_modules/\\.pnpm/${npm[1].replace('/', '\\+')}@([0-9]+\\.[0-9]+\\.[0-9]+)`).exec(id)?.[1];
    if (!version) throw new Error(`site/setup.mjs: no version in the path of ${id}`);
    if (packages.has(npm[1]) && packages.get(npm[1]) !== version) throw new Error(`site/setup.mjs would carry two versions of ${npm[1]}: ${packages.get(npm[1])} and ${version}`);
    packages.set(npm[1], version);
  }
  return { own, packages };
}

/** Lines of at most 118 characters, each a comment. */
const commentLines = (text) => text.split(' ').reduce((lines, word) => (`${lines.at(-1)} ${word}`.length > 118 ? [...lines, `// ${word}`] : [...lines.slice(0, -1), `${lines.at(-1)} ${word}`]), ['//']).join('\n');

const setupBanner = (moduleIds, root) => {
  const { own, packages } = bundleContents(moduleIds, root);
  const unknown = [...packages.keys()].filter((name) => !Object.hasOwn(SETUP_PACKAGES, name));
  if (unknown.length) throw new Error(`site/setup.mjs would carry ${unknown.join(', ')}, which SETUP_PACKAGES in site/build.mjs does not list: add each with its licence line, or drop the import`);
  const examples = own.filter((f) => f.startsWith('examples/')).map((f) => f.slice('examples/'.length)).sort();
  const workspace = [...new Set(own.filter((f) => f.startsWith('packages/')).map((f) => f.split('/')[1]))].sort();
  const other = own.filter((f) => !f.startsWith('examples/') && !f.startsWith('packages/') && f !== 'site/setup-entry.mjs');
  if (other.length) throw new Error(`site/setup.mjs would carry ${other.join(', ')}: only site/setup-entry.mjs, examples/ and packages/ belong in it`);
  return `// setup.mjs: makes one Crow folder on this machine and runs its first deal on the Crow demo (${SITE_URL}). Test tokens only.
//   node setup.mjs seller --sample --payout <address|this-key>   node setup.mjs check | list | first-deal | status   (${SITE_URL}setup.txt)
${commentLines(`Generated by site/build.mjs in https://github.com/rafaeldavid/holdback (do not edit here) from site/setup-entry.mjs, from examples/ (${examples.join(', ')}) and from the built packages/ (${workspace.join(', ')}).`)}
// It differs from those files in two ways. The own command lines of seller-adapter.ts, check-delivery.ts and
// report-converter.ts are left out, so only setup's runs. One field of the deployment record, the escrow's token store,
// which no command here reads, is left out. Not minified, so you can read it before you run it.
// Self-contained, so it needs Node 22.18 or later and no npm install. It carries these packages from npm:
${[...packages].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, version]) => `//   ${name}@${version} (${SETUP_PACKAGES[name]})`).join('\n')}
// The signing key stays in the folder's keys/ directory, on this machine. The command takes its settings from flags
// only: the next line removes every HOLDBACK_* and CROW_* variable from its environment before any module runs, and
// NODE_TLS_REJECT_UNAUTHORIZED, which would switch off the check of each host's certificate.
for (const name of Object.keys(process.env)) if (/^(HOLDBACK|CROW)_/.test(name) || name === 'NODE_TLS_REJECT_UNAUTHORIZED') delete process.env[name];
// The line after it names the one command this file runs (examples/entry.ts), so a bundled tool that asks whether it
// is the program, such as deal-record.ts, is told no and runs no command line of its own.
Object.defineProperty(globalThis, 'crowEntry', { value: 'setup', enumerable: false, configurable: false, writable: false });
`;
};

/**
 * site/setup-entry.mjs and what it imports, bundled as one plain ESM file with viem and tweetnacl inside, not minified.
 * Deterministic. `keepOwnMains` builds it without the transform above, for the test that shows why the transform is there.
 */
export async function setupBundle(p = pins(), { keepOwnMains = false } = {}) {
  const root = fileURLToPath(here('../'));
  // The two libraries the examples import are the versions the lockfile pins for examples/, as in every other bundle.
  const pinned = (packages) => {
    for (const name of ['viem', 'tweetnacl']) if (packages.get(name) !== p[name]) throw new Error(`site/setup.mjs would carry ${name}@${packages.get(name)}, not the ${p[name]} the lockfile pins for examples/`);
  };
  const bundle = await rolldown({
    cwd: root,
    input: fileURLToPath(here('setup-entry.mjs')),
    plugins: keepOwnMains ? [DROP_TOKEN_STORE] : [DROP_TOKEN_STORE, SILENCE_OWN_MAINS],
    // packages/testkit's index imports packages/settlement, which the setup never calls. Its built files run nothing
    // when they load, so the bundler may leave out the ones no code reaches. One of them is a built copy of
    // accepted-tokens.json, the Sepolia token's address: kept, the bundle would pin that address a second time, from a
    // build output that the cutover's copies step (scripts/record-copies.mjs) does not rewrite.
    treeshake: { moduleSideEffects: [{ test: /\/packages\/settlement\/dist\//, sideEffects: false }] },
    platform: 'node',
    tsconfig: fileURLToPath(here('../examples/tsconfig.json')),
    logLevel: 'warn',
  });
  try {
    // The control build keeps the tools' command lines and what only they import, so it gets no banner and no package list.
    const banner = keepOwnMains ? "// A control build of site/setup.mjs with the bundled tools' own command lines kept: for a test, never published.\n" : (chunk) => setupBanner(chunk.moduleIds, root);
    const { output } = await bundle.generate({ format: 'esm', minify: false, banner, codeSplitting: false });
    if (output.length !== 1 || output[0].type !== 'chunk') throw new Error(`bundling site/setup-entry.mjs gave ${output.length} files, not one`);
    pinned(bundleContents(output[0].moduleIds, root).packages);
    const code = output[0].code;
    if (/tokenStoreImplementation/.test(code)) throw new Error('site/setup.mjs still carries tokenStoreImplementation: the transform that leaves it out no longer matches examples/deployments.ts');
    // Any tool, these three or one added later, whose own command line's test reached the bundle would run on setup's arguments.
    if (!keepOwnMains && code.includes('import.meta.url === pathToFileURL(process.argv[1]')) throw new Error("site/setup.mjs still carries a bundled tool's own command line: add the tool to OWN_MAIN_FILES in site/build.mjs");
    return code;
  } finally {
    await bundle.close();
  }
}

/** The sha256 of site/setup.mjs, hex. */
export const setupSha256 = () => createHash('sha256').update(readFileSync(here('setup.mjs'))).digest('hex');

/**
 * The setup's one command (T-472), which setup.txt carries as {{SETUP_COMMAND}}: setup.mjs from the site into ~/.crow,
 * downloaded as setup.mjs.part and moved to setup.mjs only when its sha256 is the pinned one, as goalCommand does, so
 * a file that fails the check is never setup.mjs; then the seller's first step. No npm: the file carries its packages.
 * The assistant adds `--payout <address>` or `--payout this-key` when the person has answered; without it the step
 * prints the question and exits 3.
 */
export function setupCommand(sha = setupSha256()) {
  return `mkdir -p ~/.crow && cd ~/.crow && curl -fsSL ${SETUP_MJS_URL} -o setup.mjs.part && echo "${sha}  setup.mjs.part" | shasum -a 256 -c && mv setup.mjs.part setup.mjs && node setup.mjs seller --sample`;
}

/**
 * Node's permission model for the four goal commands (T-495): the script reads only the folder it runs in (each file
 * carries its packages, T-496), and Node refuses it any file write, child process or worker. It does not limit
 * the network on Node 22, so each banner's list of hosts still states that part. Stable from Node 22.13; the guides
 * say 22.18 or later, as the role pages do. It changes the command, not the file, so no bundle's sha256 moves.
 */
export const NODE_PERMISSION = '--permission --allow-fs-read=.';
/** The oldest Node the goal commands are run on under NODE_PERMISSION, as the pages say it. */
export const NODE_MIN = '22.18';

/** The sha256 of site/try.mjs, hex. */
export const trySha256 = () => createHash('sha256').update(readFileSync(here('try.mjs'))).digest('hex');

/**
 * The one command an agent asks its user to approve: in a fresh crow-try folder, which is all that
 * NODE_PERMISSION lets it read, fetch try.mjs as try.mjs.part, move it to try.mjs only when its
 * sha256 is the pinned one (as goalCommand does), and run it as the buyer against Crow's test seller (D47). No npm
 * since T-496: the file carries its two packages.
 */
export function tryCommand(sha = trySha256()) {
  return `mkdir -p crow-try && cd crow-try && curl -fsSL ${TRY_URL} -o try.mjs.part && echo "${sha}  try.mjs.part" | shasum -a 256 -c && mv try.mjs.part try.mjs && node ${NODE_PERMISSION} try.mjs --seller ${TEST_SELLER_URL}`;
}

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const inline = (s) =>
  esc(s)
    .split(/(`[^`]+`)/)
    .map((part) => (part.startsWith('`') && part.endsWith('`') && part.length > 1 ? `<code>${part.slice(1, -1)}</code>` : part.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(https:\/\/[^\s<)]+[^\s<).,;:])/g, '<a href="$1">$1</a>')))
    .join('');
/** A heading's anchor: its lowercase letters and digits, joined by single hyphens, with any <tag> in it left out. */
const slug = (s) => {
  // Tags come out until none is left (CodeQL js/incomplete-multi-character-sanitization). For this pattern one
  // pass already leaves none, so the loop runs the replace at most twice and changes no slug.
  let text = s.toLowerCase(), before;
  do {
    before = text;
    text = text.replace(/<[^>]+>/g, '');
  } while (text !== before);
  return text.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
};

/** The small Markdown subset llms.txt uses: headings, paragraphs, lists, tables, fenced code. */
export function render(md) {
  const lines = md.split('\n'), out = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const body = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
    } else if (/^#{2,3} /.test(line)) {
      const level = line.startsWith('### ') ? 3 : 2, text = line.slice(level + 1);
      out.push(`<h${level} id="${slug(text)}">${inline(text)}</h${level}>`);
      i++;
    } else if (line.startsWith('|')) {
      const rows = [];
      for (; i < lines.length && lines[i].startsWith('|'); i++) rows.push(lines[i].slice(1, -1).split(' | ').map((c) => c.trim()));
      const [head, , ...body] = rows;
      out.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (/^(- |\d+\. )/.test(line)) {
      const ordered = /^\d+\. /.test(line), items = [];
      for (; i < lines.length && /^(- |\d+\. )/.test(lines[i]); i++) items.push(lines[i].replace(/^(- |\d+\. )/, ''));
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${tag}>`);
    } else if (line.trim() === '') {
      i++;
    } else {
      const para = [];
      for (; i < lines.length && lines[i].trim() !== '' && !/^(```|#|\||- |\d+\. )/.test(lines[i]); i++) para.push(lines[i]);
      out.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

/** Removes editor notes ("%% " lines). */
export const strip = (md) => md.split('\n').filter((l) => !l.startsWith('%% ')).join('\n');

/**
 * The landing page keeps the parts of Rafa's mock of 2026-11-10 (D56) in the layout he asked for on 2026-11-11:
 *   - The brand: the bird stands on the mark, large. The bird takes the height the text does not need, and the
 *     mark follows it, so the page fits one screen from 1280 × 720 px up.
 *   - Reading order, one step down one type scale each (36, 24, 21, 18, 16 px): the claim, which alternates "Sell
 *     to" and "Buy from"; the lede; a value prop; the tagline under the brand; the footer.
 *   - The six value props show one at a time, each under a pencil study (vignettes.mjs), and change every 7 s.
 *   - Spare height is shared by three gaps (above the claim, the value prop and the footer), never left in one.
 * The faint code streams down each side of the hero are the case study's code (examples/buy-dataset.ts): the buyer's on the
 * left, the seller's on the right, each with its call results as comments. They type in deal order through four
 * deals (release, refund, default, escalation); below 1100 px wide each spans half the page, fainter, behind the content.
 */
/** The value props: a name, one line, and an optional note set after the name. */
const FEATURES = [
  ['Verifiable Settlement', 'Payment is held until the work passes, and refunded at the deadline if it doesn\u2019t.', 'lock'],
  ['Made for Machines', 'One API. Every response reports its token cost, so agents can budget.', 'code'],
  ['High Speed, Low Cost', 'Settles when checks pass. No invoices, no marketplace cut.', 'bolt'],
  ['Frontier AI Verification', 'Have AI review the work before payment, when you need it.', 'check'],
  ['Spend Controls', 'Set a ceiling per purchase and per day, how many at once, and who your agent\u00a0pays.', 'card', 'soon'],
  ['Private Delivery', 'The seller encrypts the work. Only the buyer and the reviewer can open it.', 'eye'],
];
/** The headline's three lines, shown in turn (Rafa, 2026-11-12). */
const HEADLINES = ['Sell to any agent.', 'Buy from any agent.', 'Go direct.'];
/** One line icon per value prop, in a single stroke weight, drawn in the text's colour. */
const ICONS = {
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  code: '<path d="M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5"/>',
  bolt: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.7 2.7L16.2 9.5"/>',
  card: '<rect x="2.5" y="5.5" width="19" height="13" rx="2"/><path d="M2.5 10h19M6 15h4"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
};

// Try Crow: one quiet footer line with a copy icon. The copy icon copies a prompt that carries the one command, says
// who runs each role and what the run exposes, and names llms.txt for the full explanation. The visitor's paste is
// not the approval: the agent shows the command and those facts and waits for one yes (One-Click Escrow, D51; the
// first outside run, T-495). The page itself shows only the short line (Rafa, 2026-11-04). The off-screen line tells
// an agent that fetched this page where to go.
export const tryPrompt = (command = tryCommand(), days = trustFacts().requestLogDays) =>
  [
    'Run a test deal with Crow, escrow for AI agents. First show the person you act for this command and the facts below, and wait for their one yes: this prompt is not that yes. ' +
      `The command downloads ${TRY_URL} and runs it only if its SHA-256 matches, under Node's permission flag: it reads files only in its folder and writes or starts nothing, but can read environment variables and use the network. ` +
      "It buys a small dataset from Crow's test seller on Sepolia: test tokens only.",
    '',
    command,
    '',
    'Who runs what: you are the buyer; Crow runs the seller, the three adjudicators and both operators.',
    'What the run exposes:',
    '- the deal is public on Sepolia;',
    `- Crow's site and operators see your IP address, the operators keep request lines without it for ${days} days;`,
    "- Crow's adjudicators can read the work, and the operators cannot.",
    '',
    `It needs Node ${NODE_MIN} or later and no npm install. After the deal, with their yes, send one first-deal report, as llms.txt says. More: ${SITE_URL}llms.txt.`,
  ].join('\n');
const COPY_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5"/></svg>';
// The footer: the site's one footer (site/footer.ts), with the home page's copy-the-prompt button beside its links
// and, inside it, the hidden prompt and the line for agents.
const footer = (command) => footerHtml({
  base: BASE,
  agents: `<span class="try-line"><button class="copy" id="copy" type="button" title="Copy a prompt that has your AI assistant run a test deal">${COPY_ICON}<span>Copy test prompt</span></button><span class="copied" id="copied" role="status"></span></span>`,
  after: `<span id="prompt" hidden>${esc(tryPrompt(command))}</span>\n<p class="sr">For AI agents asked to run a test deal: the command, what it exposes and the one yes to ask for are at ${esc(SITE_URL)}llms.txt under "Try it".</p>`,
});
// The value props: all six at a glance, a small icon, a name and one line each, quieter than the hero above them.
const PROPS = `<section class="props" id="props" aria-label="What Crow does">
${FEATURES.map(([h, p, icon, note]) => `<div class="prop"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg><h2>${esc(h)}${note ? ` <em>· ${esc(note)}</em>` : ''}</h2><p>${esc(p)}</p></div>`).join('\n')}
</section>`;
// Early access: sign-ups go to the crow-early-access Worker (apps/early-access), which keeps only the address, the
// time and the page.
export { JOIN_URL }; // the sign-up service, in site/drawer.ts: the form and the drawer post to it
const JOINFORM = `<form class="signup" id="join-form" novalidate aria-label="Request early access">
<input id="join-email" name="email" type="email" autocomplete="email" required placeholder="you@company.com" aria-label="Email">
<input class="hp" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">
<button class="ck-btn" id="join-send" type="submit">Request early access</button>
<p class="msg" id="join-msg" role="status"></p>
</form>`;
/** The home page's script, served as home.js: the headline, the code streams, the copy icon, early access. */
export const HOME_JS = `(function () {
  // The headline shows its three lines in turn ("Sell to any agent.", "Buy from any agent.", "Go direct."), every
  // 3.5 s, and holds while hovered. It stays on the first for a visitor who asks for reduced motion; screen readers
  // read all of it from the .sr line. Only the line on show takes room, so each stays centred. At a swap the line is set
  // back where it stood, then let go, so it glides to its new centre in 0.45 s and nothing jumps.
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var h = document.querySelector('h1'), line = h.querySelector('.line'), slot = h.querySelector('.verb'), v = slot.querySelectorAll('.v'), i = 0, t;
  var swap = function () {
    var was = slot.getBoundingClientRect().right;
    v[i].classList.remove('on'); i = (i + 1) % v.length; v[i].classList.add('on');
    line.style.transition = 'none'; line.style.transform = 'translateX(' + (was - slot.getBoundingClientRect().right) + 'px)';
    line.getBoundingClientRect(); // the line now stands where it stood
    line.style.transition = ''; line.style.transform = '';
  };
  if (!still) {
    var start = function () { clearInterval(t); t = setInterval(swap, 3500); };
    h.addEventListener('mouseenter', function () { clearInterval(t); });
    h.addEventListener('mouseleave', start);
    start();
  }
  // The case study's code (examples/buy-dataset.ts: a buyer agent buys a cleaned customers.csv for 25 tUSDC from a
  // seller agent), typed faintly down the page: the buyer's code on the left, the seller's on the right, each
  // with its call results as comments. New lines arrive at the bottom and push older ones up. Each line is
  // [delay ms, 'b' | 's', text], the delay scaled by K; a new deal starts every 6200 ms \u00d7 K, about 13.6 s.
  var hex = function (n) { var s = ''; while (s.length < n) s += Math.floor(Math.random() * 16).toString(16); return s; };
  var K = 2.2; // one pace for both streams
  var CALLS = function (i, id) {
    var open = [
      [0, 'b', "const me = { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey };"],
      [80, 'b', "await mail(seller, me); // ask for an offer: customers.csv, at most 30 tUSDC"],
      [0, 's', "const offer = await seller.offer({"],
      [60, 's', "  template: 'checks-only', price: { token: TUSDC, amount: '25000000' },"],
      [120, 's', "  deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' },"],
      [180, 's', "  checks: [cols, rows, uniq], buyer: me, adjudicators: { primary, fallback, appeal },"],
      [240, 's', "}); // \\u2192 offer " + id + ": Offered"],
      [300, 's', "await mail(buyer, offer.terms);"],
      [320, 'b', "await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);"],
      [420, 'b', "const held = await buyer.agreeAndFund(offer.terms, 30_000_000n);"],
      [520, 'b', "// verify domain, price, nonces \\u00b7 sign Agree + FundingAuthorization"],
      [600, 'b', "// \\u2192 Held, 26000000 base units (price + fee)"],
      [620, 's', "await seller.waitFor(offer.id, ['Held']); // \\u2192 Held"],
      [700, 's', "await seller.deliver(offer.terms, new TextEncoder().encode(csv));"],
      [820, 's', "// AES-256-GCM \\u00b7 key sealed to 3 adjudicators + buyer \\u00b7 sign Delivery"],
      [1100, 's', "// \\u2192 Delivered"]
    ];
    var tail = [
      [ // release
        [1500, 'b', "const done = await buyer.waitFor(offer.id, ['Released', 'Refunded']);"],
        [1500, 's', "await seller.waitFor(offer.id, ['Released', 'Refunded']);"],
        [2100, 'b', "// adjudicator: cols \\u2713 rows \\u2713 uniq \\u2713 \\u2192 accept"],
        [2900, 'b', "// \\u2192 Released: the content key is mine"],
        [2900, 's', "// \\u2192 Released: 25000000 tUSDC paid to me"],
        [3300, 'b', "const work = await buyer.openDelivery(offer.id); // open envelope, check sha256"],
        [3600, 'b', "// customer_id,email \\u00b7 1,ada@example.com \\u00b7 2,alan@\\u2026"],
        [4300, 'b', "await balance(buyer); // \\u2192 9974000000"],
        [4300, 's', "await balance(seller); // \\u2192 10025000000"]
      ],
      [ // refund
        [1500, 'b', "const done = await buyer.waitFor(offer.id, ['Released', 'Refunded']);"],
        [1500, 's', "await seller.waitFor(offer.id, ['Released', 'Refunded']);"],
        [2100, 'b', "// adjudicator: cols \\u2713 rows \\u2717 (2 of 3) uniq \\u2713 \\u2192 reject"],
        [2900, 'b', "// \\u2192 Refunded: 25000000 tUSDC back to me (the 1 tUSDC fee is spent)"],
        [2900, 's', "// \\u2192 Refunded: unpaid, and the buyer never got the key"],
        [4300, 'b', "await balance(buyer); // \\u2192 9999000000"]
      ],
      [ // default
        [1500, 'b', "// judgeBy and fallbackBy pass with no decision from either adjudicator"],
        [1500, 's', "// judgeBy and fallbackBy pass with no decision from either adjudicator"],
        [2200, 'b', "await buyer.call('POST', '/v1/commitments/' + offer.id + '/triggers/default');"],
        [2350, 'b', "// \\u2192 Defaulted, then Refunded in the same transaction"],
        [2600, 's', "await seller.waitFor(offer.id, ['Refunded']);"],
        [2900, 'b', "// \\u2192 refunded: 25000000 tUSDC and the 1 tUSDC fee back to me"],
        [2900, 's', "// \\u2192 no decision, so the default outcome: the buyer's money goes back"]
      ],
      [ // escalation
        [1500, 'b', "const done = await buyer.waitFor(offer.id, ['Released', 'Refunded']);"],
        [1500, 's', "await seller.waitFor(offer.id, ['Released', 'Refunded']);"],
        [2100, 'b', "// primary adjudicator: the screen flags the work \\u2192 escalate"],
        [2600, 's', "// \\u2192 Escalated: the appeal adjudicator decides within appealDecideSec"],
        [3300, 'b', "// the drand round after the escalation's block seeds a fresh panel"],
        [4200, 'b', "// appeal adjudicator: rows \\u2717 (2 of 3) \\u2192 reject \\u00b7 final"],
        [4350, 'b', "// \\u2192 Refunded: 25000000 tUSDC back to me"],
        [4350, 's', "// \\u2192 Refunded: the decision is final when it settles"]
      ]
    ][i];
    // the agents asking the API about itself, spread over the four deals so every feature shows once
    var c = "'/v1/commitments/' + offer.id + '";
    var QA = [
      [ // release
        [4500, 'b', "// which adjudicators can we name, and what do they charge?"],
        [4620, 'b', "await buyer.call('GET', '/v1/adjudicators'); // \\u2192 3 \\u00b7 fee.min 1 tUSDC"],
        [4500, 's', "// does every operator serve the same record?"],
        [4620, 's', "await seller.call('GET', " + c + "/events'); // \\u2192 same hashes on op-1 and op-2"],
        [5200, 'b', "// what did the seller actually sign?"],
        [5320, 'b', "await buyer.call('GET', " + c + "/terms'); // \\u2192 matches the mailed offer"],
        [5200, 's', "// a fresh agent? the faucet funds it and admits it to the club"],
        [5320, 's', "await fresh.call('POST', '/v1/faucet', { address }); // \\u2192 1000 tUSDC \\u00b7 demo-club"]
      ],
      [ // refund
        [4500, 'b', "// what exactly did the checks find?"],
        [4620, 'b', "await buyer.call('GET', " + c + "/judgment'); // \\u2192 rows: 2, terms say 3"],
        [4500, 's', "// can I preview a submit before signing it?"],
        [4620, 's', "await seller.call('POST', " + c + "/deliveries?validateOnly=true', draft); // \\u2192 200, nothing changed"],
        [5200, 's', "// who must the content key be sealed to?"],
        [5320, 's', "await seller.call('GET', " + c + "/recipients'); // \\u2192 primary, fallback, appeal, buyer"]
      ],
      [ // default
        [4500, 'b', "// what does the club's rulebook say a default pays?"],
        [4620, 'b', "await buyer.call('GET', '/v1/clubs/demo-club'); // \\u2192 the default outcome: refund the buyer"],
        [4500, 's', "// what can this API do?"],
        [4620, 's', "await seller.call('GET', '/v1/openapi.json'); // \\u2192 OpenAPI 3.1, every route"],
        [5200, 's', "// which settlement layer is this, and what time is it there?"],
        [5320, 's', "await seller.call('GET', '/.well-known/holdback.json'); // \\u2192 domain, settlementTime"]
      ],
      [ // escalation
        [2700, 'b', "// who decides now, and by when?"],
        [2820, 'b', "await buyer.call('GET', " + c + "'); // \\u2192 escrowState: Escalated \\u00b7 the appeal adjudicator's turn"],
        [4800, 's', "// where are my receipts?"],
        [4920, 's', "await seller.call('GET', " + c + "/receipts'); // \\u2192 signed by each operator"],
        [5000, 'b', "// what do I hold now?"],
        [5120, 'b', "await buyer.call('GET', '/v1/balances/' + buyer.address); // \\u2192 the 25 tUSDC price is back"]
      ]
    ][i];
    return open.concat(tail, QA);
  };
  var streams = { b: document.getElementById('stream-b'), s: document.getElementById('stream-s') }, streamTimers = [];
  function say(side, text) {
    var el = streams[side];
    if (!el) return;
    var line = document.createElement('div'); line.textContent = text; el.appendChild(line);
    while (el.childNodes.length > 90) el.removeChild(el.firstChild);
  }
  function play(i) {
    streamTimers.forEach(clearTimeout); streamTimers = [];
    var id = '0x' + hex(6) + '\\u2026' + hex(4);
    var calls = CALLS(i, id);
    if (still) { calls.forEach(function (l) { say(l[1], l[2]); }); return; }
    var head = ' \\u00b7 ' + ['release', 'refund', 'default', 'escalation'][i];
    say('b', ''); say('b', '// buyer agent' + head);
    say('s', ''); say('s', '// seller agent' + head);
    calls.forEach(function (l) { streamTimers.push(setTimeout(function () { say(l[1], l[2]); }, l[0] * K)); });
  }
  // Four deals in turn, one every 6200 ms \u00d7 K. A visitor who asks for reduced motion gets the first deal's code
  // written once, with no animation.
  var deal = 0; play(0);
  if (!still) setInterval(function () { deal = (deal + 1) % 4; play(deal); }, 6200 * K);
  // Try Crow: the copy icon copies the prompt for the visitor's AI assistant.
  // Where the clipboard is refused, the prompt shows selected instead so the visitor can copy it by hand.
  var select = function (el) { var r = document.createRange(); r.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(r); };
  var prompt = document.getElementById('prompt').textContent, tag = document.getElementById('copied');
  var fallback = function () { tag.textContent = '\\u201c' + prompt + '\\u201d'; select(tag); };
  document.getElementById('copy').addEventListener('click', function () {
    var done = function () { tag.textContent = 'Copied'; setTimeout(function () { tag.textContent = ''; }, 2500); };
    if (navigator.clipboard) navigator.clipboard.writeText(prompt).then(done, fallback); else fallback();
  });
  // early access: the email form sits on the page
  var form = document.getElementById('join-form'), msg = document.getElementById('join-msg'), send = document.getElementById('join-send');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = form.email.value.trim();
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(email)) { msg.textContent = 'Please enter a full email address, like you@example.com.'; return; }
    send.disabled = true; msg.textContent = 'Sending…';
    fetch('${JOIN_URL}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email, company: form.company.value, page: location.pathname }) })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
      .then(function (x) { msg.textContent = x.ok ? 'Thank you. We’ll be in touch at ' + email + '.' : (x.b && x.b.error) || 'That didn’t go through. Please try again.'; if (x.ok) form.email.value = ''; })
      .catch(function () { msg.textContent = 'That didn’t go through. Check your connection and try again.'; })
      .then(function () { send.disabled = false; });
  });
})();
`;

/** The home page's styles, served as home.css: the kit (site/brand/, T-402), then the home page's own layout. */
export const HOME_CSS = kitCss({ parts: ['bar', 'button', 'pill', 'head', 'row', 'footer'] }) + `/* the home page (site/build.mjs): the enterprise look Rafa approved on 2026-11-12, light only (2026-11-13). The hero
   leads; the value props sit quietly below it. Colours and type come from the kit's tokens. */
* { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body { background: var(--page); color: var(--ink); font: var(--size-body)/1.5 var(--font); -webkit-font-smoothing: antialiased; }
a { color: inherit; }
/* the agents' code (Rafa kept it, 2026-11-12): faint terminal text down each side of the hero, buyer left and seller
   right, misting out at the edges, behind the words. It stops above the value props. A mask reads only alpha. */
html { overflow-x: clip; }
.stream { position: absolute; z-index: 0; top: 0; bottom: 0; width: min(460px, calc(50vw - 340px)); contain: strict; /* the lines never size the hero: it keeps one height while they type */
  display: flex; flex-direction: column; justify-content: flex-end; overflow: hidden; pointer-events: none; user-select: none;
  font: 10.5px/1.7 var(--mono); color: var(--ink-3); opacity: .55; text-align: left; white-space: pre; }
#stream-b { left: calc(50% - 50vw); padding: 0 12px 24px max(20px, env(safe-area-inset-left, 0px));
  -webkit-mask-image: radial-gradient(ellipse 95% 75% at 35% 60%, black 25%, transparent 78%); mask-image: radial-gradient(ellipse 95% 75% at 35% 60%, black 25%, transparent 78%); }
#stream-s { right: calc(50% - 50vw); padding: 0 max(20px, env(safe-area-inset-right, 0px)) 24px 12px;
  -webkit-mask-image: radial-gradient(ellipse 95% 75% at 65% 60%, black 25%, transparent 78%); mask-image: radial-gradient(ellipse 95% 75% at 65% 60%, black 25%, transparent 78%); }
.stream div { overflow: hidden; flex-shrink: 0; min-height: 1.7em; } /* never squeeze lines when the stream is full */
.hero { position: relative; }
.hero > :not(.stream) { position: relative; z-index: 1; }
.page { max-width: var(--width); margin: 0 auto; padding: 0 var(--gutter); }
.hero { text-align: center; max-width: 760px; margin: 0 auto; padding: 96px 0 72px; }
/* the hero's headline and lede: larger than the kit's section head, and centred (T-402 lists the difference) */
h1 { font-family: var(--display); font-size: 64px; line-height: 1.04; font-weight: var(--weight-bold); letter-spacing: -.035em; margin-top: 14px; }
.line { display: inline-block; white-space: nowrap; transition: transform .45s ease; }
.verb { position: relative; display: inline-block; }
.verb .v { position: absolute; right: 0; top: 0; opacity: 0; transform: translateY(.18em); transition: opacity .35s ease, transform .35s ease; }
.verb .v.on { position: static; display: inline-block; opacity: 1; transform: none; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.lede { font-size: var(--size-lede); line-height: 1.4; color: var(--ink-2); max-width: 600px; margin: 18px auto 0; text-wrap: balance; }
/* early access: an email box and the kit's tall filled button, each 48 px tall */
.signup { margin-top: 32px; display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.signup input[type=email] { font: inherit; font-size: 16px; color: var(--ink); background: var(--page); border: 1px solid var(--line); border-radius: var(--radius-pill); padding: 0 20px; width: min(320px, 80vw); min-height: 48px; }
.signup input::placeholder { color: var(--ink-3); opacity: 1; }
.signup .msg { flex-basis: 100%; color: var(--ink-2); font-size: var(--size-small); }
.signup .msg:empty { display: none; }
.hp { position: absolute; left: -10000px; width: 1px; height: 1px; opacity: 0; }
.demo-link { display: inline-block; margin-top: 18px; font-size: 16px; font-weight: 500; text-decoration: none; }
.demo-link:hover { text-decoration: underline; }
input:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
/* the value props: all six at a glance, small and quiet, in the kit's icon stroke */
.props { border-top: 1px solid var(--hair); padding: 40px 0 8px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px 40px; }
.prop { display: grid; grid-template-columns: 22px 1fr; gap: 4px 12px; align-items: start; }
.icon { grid-row: span 2; width: 22px; height: 22px; fill: none; stroke: var(--ink-2); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; margin-top: 1px; }
.prop h2 { font-size: var(--size-small); font-weight: var(--weight-strong); letter-spacing: -.005em; }
.prop h2 em { font-weight: 400; font-style: normal; color: var(--ink-3); }
.prop p { font-size: 14px; line-height: 1.45; color: var(--ink-2); }
@media (prefers-reduced-motion: reduce) { .line, .verb .v { transition: none; } }
/* the footer's copy-the-prompt button (beside the footer's links), then one quiet line for agents: the Try prompt and the agent docs */
.copy { position: relative; display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 10px; border: 1px solid var(--line); border-radius: var(--radius-pill); background: transparent; color: var(--ink-2); font: inherit; white-space: nowrap; cursor: pointer; }
.copy::after { content: ""; position: absolute; inset: -8px 0; } /* a 44 px target */
.copy svg { fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linejoin: round; }
.copy:hover { background: var(--band); color: var(--ink); }
.try-line { display: inline-flex; flex-wrap: wrap; align-items: center; max-width: 100%; min-height: 44px; } /* beside the footer's links, a 44 px target */
.copied { margin-left: 6px; color: var(--ink); overflow-wrap: anywhere; white-space: pre-wrap; }
.copied:empty { display: none; }
@media (max-width: 1100px) { .stream { width: 50vw; opacity: .14; } }
/* the 404 page: the kit's section head, then the ways back as the kit's list rows */
.nf { max-width: 640px; padding-top: 88px; padding-bottom: 88px; }
.nf .ck-rows { margin-top: 32px; }
/* a short desktop screen (720 px tall) shows the whole page, hero to footer, with no scroll */
@media (min-width: 821px) and (max-height: 820px) { .hero { padding: 44px 0 36px; } .props { padding-top: 26px; gap: 20px 40px; } }
@media (max-width: 820px) { .props { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { h1 { font-size: min(44px, 9.6vw); } .stream { display: none; } .lede { font-size: 19px; } .hero { padding: 64px 0 48px; } .props { grid-template-columns: 1fr; } }
`;

/**
 * The favicon links every page's head carries (T-428): the crow on a white square, from the brand kit (site/brand/icons/,
 * iconLinks()). A page this build writes puts ${FAVICON_LINKS} in its head; a page kept as it was made (the demo, the visual
 * walkthrough) goes through withIcons(), which takes out its own icon links and adds these. site/check.mjs group 17
 * fails the build when a built page lacks them.
 */
export const FAVICON_LINKS = iconLinks({ base: BASE });
export function withIcons(html) {
  const at = html.indexOf('</head>');
  if (at < 0) throw new Error('withIcons: the page has no </head>');
  let head = html.slice(0, at);
  for (const tag of iconTags(html)) head = head.includes(`${tag}\n`) ? head.replace(`${tag}\n`, '') : head.replace(tag, '');
  return `${head}${FAVICON_LINKS}\n${html.slice(at)}`;
}

/**
 * 404.html: what the site answers for an address it does not have (Cloudflare serves it with status 404). A visitor
 * gets Crow's header and the ways back; an agent that guessed an address gets the same pointers to the guides first,
 * in plain words, so one wrong guess costs it little.
 */
export function notFoundPage() {
  return `<!doctype html>
<!-- Not found (404). For AI agents: Crow's guide for agents is ${SITE_URL}llms.txt (plain text). Buyers then read ${BASE}buy.txt, sellers ${BASE}sell.txt. -->
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="alternate" type="text/plain" title="Agent docs (llms.txt)" href="${BASE}llms.txt">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(CARDS.notFound.title)}</title>
${cardTags({ site: SITE_URL, ...CARDS.notFound })}
${FAVICON_LINKS}
<link rel="stylesheet" href="${BASE}home.css">
</head>
<body>
${headerBar({ home: BASE, links: [[`${BASE}demo/`, 'Demo'], [`${BASE}llms.txt`, 'Agent docs']] })}
<main class="page nf">
${sectionHead({ eyebrow: '404', title: 'Page not found', lede: 'The address may be mistyped, or the page has moved.' })}
${listRows([
  { title: 'Home', href: BASE, line: 'What Crow does' },
  { title: 'Agent docs', href: `${BASE}llms.txt`, line: 'Start here if you are an AI agent: llms.txt' },
  { title: 'For buyers', href: `${BASE}buy.txt`, line: 'How an agent pays through Crow: buy.txt' },
  { title: 'For sellers', href: `${BASE}sell.txt`, line: 'How an agent sells through Crow: sell.txt' },
  { title: 'Demo', href: `${BASE}demo/`, line: 'Two agents close a deal' },
])}
</main>
${footerHtml({ base: BASE })}
</body>
</html>
`;
}

/**
 * index.html from llms.txt: the tagline gives the mark and the subtitle, and the paragraph after it gives the
 * headline (its first sentence, for screen readers) and the lede (the rest). Agents find the docs through the
 * <link rel="alternate"> in the head and the footer link, and the Try line's prompt carries the one command and
 * names llms.txt. Every link is relative, so the page works on any host that serves the site.
 */
export function page(md, command = tryCommand()) {
  const tagline = /^> (.+)$/m.exec(strip(md))[1];
  const subtitle = tagline.slice(tagline.indexOf('. ') + 1).trim(); // the title and the card text come from site/footer.ts
  // the first paragraph after the tagline: the headline's sentence, then the lede
  const src = strip(md), after = src.slice(src.indexOf(tagline) + tagline.length).trim();
  const intro = after.slice(0, after.indexOf('\n\n')).trim();
  const stop = intro.indexOf('. ') + 1, headline = intro.slice(0, stop), lede = intro.slice(stop).trim();
  return `<!doctype html>
<!-- For AI agents: Crow's guide for agents is ${SITE_URL}llms.txt (plain text). Buyers then read ${BASE}buy.txt, sellers ${BASE}sell.txt. -->
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="alternate" type="text/plain" title="Agent docs (llms.txt)" href="${BASE}llms.txt">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(CARDS.home.title)}</title>
${FAVICON_LINKS}
<link rel="canonical" href="${SITE_URL}">
<meta name="theme-color" content="${TOKENS.page}">
${cardTags({ site: SITE_URL, ...CARDS.home })}
<link rel="stylesheet" href="${BASE}home.css">
</head>
<body>
${headerBar({ home: BASE, links: [[`${BASE}llms.txt`, 'Agent docs']], button: { label: 'Watch Demo', href: `${BASE}demo/` } })}
<main class="page">
<section class="hero">
<div id="stream-b" class="stream" aria-hidden="true"></div>
<div id="stream-s" class="stream" aria-hidden="true"></div>
<p class="ck-eyebrow">${inline(subtitle)}</p>
<h1>
<span class="sr">${inline(headline)} Go direct.</span>
<span class="line" aria-hidden="true"><span class="verb">${HEADLINES.map((h, i) => `<span class="v${i ? '' : ' on'}">${esc(h)}</span>`).join('')}</span></span>
</h1>
<p class="lede">${inline(lede)}</p>
${JOINFORM}
<a class="demo-link" href="${BASE}demo/">Watch two agents close a deal ›</a>
</section>
${PROPS}
</main>
${footer(command)}
<script src="${BASE}home.js" defer></script>
</body>
</html>
`;
}

/**
 * One page per problem type at /problems/<type> (D39), from the operator's table
 * (apps/operator/src/problems.ts), so the `Link: <https://crow.direct/problems/<type>>; rel="type"` on every
 * problem resolves. Static assets serve problems/<type>.html at /problems/<type> (html_handling auto-trailing-slash).
 */
export async function problemPages() {
  const { PROBLEMS, PROBLEM_BASE } = await import(here('../apps/operator/src/problems.ts'));
  const shell = (title, body, path) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${cardTags({ site: SITE_URL, path, title, description: CARDS.problems.description })}
${FAVICON_LINKS}
<link rel="alternate" type="text/plain" title="Agent docs (llms.txt)" href="${BASE}llms.txt">
<style>
${kitCss({ parts: ['pill', 'footer'] })}/* the problem pages: still the earlier paper look, in tokens of their own (T-402 lists it for Rafa) */
body { margin: 0; background: var(--problems-page); color: var(--problems-ink); font: 18px/1.55 var(--problems-serif); }
main { max-width: 680px; margin: 0 auto; padding: 8vh 24px 64px; }
code { font: 15px var(--mono); }
a { color: var(--problems-link); }
.status { color: var(--problems-ink-2); }
</style>
</head>
<body>
<main>
${body}
</main>
${footerHtml({ base: BASE })}
</body>
</html>
`;
  const pages = new Map();
  const entries = Object.entries(PROBLEMS);
  for (const [type, p] of entries) {
    pages.set(
      `problems/${type}.html`,
      shell(
        `${type}: ${p.title}`,
        [
          `<p class="status">Crow API problem type · HTTP ${p.status}</p>`,
          `<h1><code>${esc(type)}</code></h1>`,
          `<p><strong>${inline(p.title)}.</strong></p>`,
          `<p>What to do: ${inline(p.next)}</p>`,
          `<p>Every problem is RFC 9457 <code>application/problem+json</code>: <code>type</code>, <code>title</code>, <code>status</code>, <code>detail</code>, <code>instance</code> (<code>urn:holdback:request:&lt;Request-Id&gt;</code>), and typed members where an agent branches: <code>state</code> and <code>needs</code> (invalid_state), <code>field</code> (invalid_terms), <code>fee</code> (payment_required), <code>retryAfterSec</code> (rate_limited). Branch on those, never on <code>detail</code>. The <code>Link: &lt;${esc(PROBLEM_BASE)}${esc(type)}&gt;; rel="type"</code> header points here.</p>`,
          `<p><a href="${BASE}problems/">All problem types</a> · <a href="${BASE}llms.txt">The agent guide</a></p>`,
        ].join('\n'),
        `problems/${type}`,
      ),
    );
  }
  pages.set(
    'problems/index.html',
    shell(
      CARDS.problems.title,
      [
        '<h1>Problem types</h1>',
        `<p>Each <code>type</code> an operator answers, with its HTTP status. See <a href="${BASE}llms.txt">the agent guide</a>, Conventions.</p>`,
        `<ul>${entries.map(([type, p]) => `<li><a href="${BASE}problems/${type}"><code>${esc(type)}</code></a> (${p.status}): ${inline(p.title)}</li>`).join('')}</ul>`,
      ].join('\n'),
      'problems/',
    ),
  );
  return pages;
}

/** A guide other than the front door as published (T-359, T-393): editor notes gone. A placeholder left is refused. */
export const SELL_URL = `${SITE_URL}sell.txt`;
export const BUY_URL = `${SITE_URL}buy.txt`;
export function guidePage(txt, name = 'sell.txt', install = () => buyInstall()) {
  if (/^%% CONFIRM/m.test(txt)) throw new Error(`${name} still has "%% CONFIRM" notes: check each, fix the text, delete the note, then build again`);
  // buy.txt's one setup command carries buy.mjs's sha256, which the build knows and the page cannot; setup.txt's
  // carries setup.mjs's in the same way.
  const out = name === 'buy.txt' ? strip(txt).replace('{{BUY_INSTALL}}', install) : name === 'setup.txt' ? strip(txt).replace('{{SETUP_COMMAND}}', () => setupCommand()) : strip(txt);
  if (/\{\{[^}]*\}\}/.test(out)) throw new Error(`${name} has a {{placeholder}}: it is published as written`);
  return out;
}
/** The seller's page as published (the two-agent run's local docs server calls this). */
export const sellerPage = (txt) => guidePage(txt, 'sell.txt');

/**
 * The visual walkthrough (site/visualdemo/index.html, a standalone page kept as it was made) as a publish build writes
 * it: its title in words, the site's card, and the site's footer, all from site/footer.ts.
 */
export function visualdemoPage(html) {
  const out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(CARDS.visualdemo.title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, cardTags({ site: SITE_URL, ...CARDS.visualdemo }))
    .replace('</head>', `<style>${FOOTER_CSS}</style>\n</head>`)
    .replace('</body>', `${footerHtml({ base: BASE })}\n</body>`);
  if (!out.includes('og:image') || !out.includes('class="ck-foot"')) throw new Error('site/visualdemo/index.html changed shape: its title, description, head or body was not found');
  return withIcons(out);
}

/**
 * The demo page (site/demo/index.html, written by `pnpm duet publish`) as a publish build writes it: the site's current
 * footer in place of the one the replay was published with, so a footer link added later (T-421: trust, status)
 * reaches it without a new replay.
 */
export function demoPage(html) {
  const at = html.indexOf('<footer class="ck-foot">'), end = html.indexOf('</footer>', at);
  if (at < 0 || end < 0 || html.indexOf('<footer class="ck-foot">', at + 1) >= 0) throw new Error('site/demo/index.html changed shape: it no longer holds exactly one site footer');
  return withIcons(`${html.slice(0, at)}${footerHtml({ base: BASE, current: 'demo' }).trimEnd()}${html.slice(end + '</footer>'.length)}`);
}

/**
 * Every agent guide as a publish build writes it, by published path: llms.txt filled with the two operators and
 * the one command, the others as written. The two-agent run's local docs server serves exactly these.
 */
export function publishedGuides({ op1, op2, command = tryCommand() }) {
  const guides = new Map(guideFiles().map((path) => [path, path === 'llms.txt' ? filled(guideSource(path), { op1, op2, command }) : guidePage(guideSource(path), path)]));
  guides.set(REFERENCE_PATH, referenceText(guides));
  return guides;
}

/**
 * The one optional reference file (T-469): every published ref/*.txt in one, in order, each under a line naming its
 * path, so an agent that needs the reference fetches once instead of once per file.
 */
export const REFERENCE_PATH = 'reference.txt';
export function referenceText(guides) {
  const refs = [...guides.keys()].filter((p) => p.startsWith('ref/')).sort();
  return [
    `# Crow reference: every file under ${SITE_URL}ref/ in one`,
    '',
    `Generated by site/build.mjs from site/ref/*.txt. Each part starts with a line "=== ref/<name>.txt ===": a guide that cites \`ref/<name>.txt\`, "<section>" means that part's section. The commands in ${SITE_URL}llms.txt need none of this.`,
    '',
    ...refs.flatMap((p) => [`=== ${p} ===`, '', guides.get(p).trimEnd(), '']),
  ].join('\n');
}

/** The images a publish build copies as they are. */
export const ASSETS = ['crow.png', 'crow-2x.webp', 'crow-mark.svg', 'favicon.png', 'og.png'];
/** A party's card's JSON Schema (T-474, D74): a publish build copies it as it is, served at https://crow.direct/card.schema.json. */
export const CARD_SCHEMA = 'card.schema.json';

/** llms.txt's two values read from their sources (T-495): the request log's retention and the oldest Node the goal commands run on. */
export const fillFacts = (md) => md.replace('{{REQUEST_LOG_DAYS}}', String(trustFacts().requestLogDays)).replaceAll('{{NODE_MIN}}', NODE_MIN);

/** The published files: placeholders filled, editor notes gone. */
export function filled(md, { op1, op2, command = tryCommand(), goals = goalCommands() }) {
  if (/^%% CONFIRM/m.test(md)) throw new Error('llms.txt still has "%% CONFIRM" notes: check each against the deployed API, fix the text, delete the note, then build again');
  const ok = (u) => typeof u === 'string' && /^https:\/\/[^\s/]+$/.test(u);
  if (!ok(op1) || !ok(op2)) throw new Error('--op1 and --op2 are https origins with no path and no trailing slash, e.g. https://holdback-op1.example.workers.dev');
  let out = strip(md).replace('{{OP1}}', op1).replace('{{OP2}}', op2).replace('{{TRY_COMMAND}}', () => command);
  out = fillFacts(out);
  for (const [placeholder, line] of Object.entries(goals)) out = out.replace(placeholder, () => line);
  if (/\{\{[A-Z0-9_]+\}\}/.test(out)) throw new Error('a placeholder is left unfilled');
  return out;
}

/** The checkout's commit, or null when its tracked files differ from it or git cannot answer (T-066). */
export function buildCommit(git = (args) => spawnSync('git', ['-C', fileURLToPath(here('..')), ...args], { encoding: 'utf8' })) {
  return commitOf(git(['rev-parse', 'HEAD']), git(['status', '--porcelain', '--untracked-files=no', '--ignore-submodules=dirty']));
}

/** Pure: a 40-hex HEAD from a clean tree, or null; a git call that failed counts as unknown, never as clean. */
export function commitOf(head, status) {
  const ok = (r) => r && r.status === 0 && !r.error && typeof r.stdout === 'string';
  if (!ok(head) || !ok(status) || status.stdout.trim() !== '') return null;
  const c = head.stdout.trim();
  return /^[0-9a-f]{40}$/.test(c) ? c : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const md = readFileSync(here('llms.txt'), 'utf8');
  const out = arg('out');
  const bundle = await tryBundle();
  const buy = await buyBundle();
  // The goal files and the preflight (T-491), each one self-contained file pinned by its sha256.
  const goals = Object.fromEntries(await Promise.all([...Object.keys(GOALS), PREFLIGHT.name].map(async (name) => [name, await goalBundle(name)])));
  const setup = await setupBundle();
  if (!out) {
    writeFileSync(here('setup.mjs'), setup);
    // try.mjs, buy.mjs and the goal files first: the pages carry their sha256.
    writeFileSync(here('try.mjs'), bundle);
    writeFileSync(here('buy.mjs'), buy);
    for (const [name, code] of Object.entries(goals)) writeFileSync(here(`${name}.mjs`), code);
    writeFileSync(here('index.html'), page(md));
    writeFileSync(here('home.css'), HOME_CSS);
    writeFileSync(here('home.js'), HOME_JS);
    writeFileSync(here('404.html'), notFoundPage());
    // T-421: the trust page, the status page and their stylesheet.
    writeFileSync(here('trust.html'), trustPage({ site: SITE_URL, base: BASE }));
    writeFileSync(here('status.html'), statusPage({ site: SITE_URL, base: BASE }));
    writeFileSync(here('pages.css'), PAGES_CSS);
    writeFileSync(here('trust.txt'), trustText({ site: SITE_URL }));
    writeFileSync(here('status.json'), statusJson({ site: SITE_URL }));
    console.log(`wrote site/try.mjs (sha256 ${trySha256()}), site/buy.mjs (sha256 ${buySha256()}), ${Object.keys(goals).map((n) => `site/${n}.mjs (sha256 ${goalSha256(n)})`).join(', ')}, site/setup.mjs (sha256 ${setupSha256()}), site/index.html, site/home.css, site/home.js, site/404.html, site/trust.html, site/trust.txt, site/status.html, site/status.json and site/pages.css`);
  } else {
    // Publish exactly the committed bundle, and only while it is current: the sha256 below is of that file.
    if (readFileSync(here('try.mjs'), 'utf8') !== bundle) throw new Error('site/try.mjs is stale against examples/: run node site/build.mjs, commit, then publish');
    // T-496: the source commit the banner names must hold its files as this tree has them, and be on this branch.
    const sourceProblem = sourceCommitProblem(sourceCommitOf(bundle), tryFiles(bundle));
    if (sourceProblem) throw new Error(`site/try.mjs: ${sourceProblem}; commit, then publish`);
    if (readFileSync(here('buy.mjs'), 'utf8') !== buy) throw new Error('site/buy.mjs is stale against examples/: run node site/build.mjs, commit, then publish');
    for (const [name, code] of Object.entries(goals)) if (readFileSync(here(`${name}.mjs`), 'utf8') !== code) throw new Error(`site/${name}.mjs is stale against examples/: run node site/build.mjs, commit, then publish`);
    if (readFileSync(here('setup.mjs'), 'utf8') !== setup) throw new Error('site/setup.mjs is stale against examples/: run node site/build.mjs, commit, then publish');
    const guides = publishedGuides({ op1: arg('op1'), op2: arg('op2') });
    const txt = guides.get('llms.txt');
    mkdirSync(join(out, 'ref'), { recursive: true });
    for (const [path, text] of guides) writeFileSync(join(out, path), text);
    writeFileSync(join(out, 'index.html'), page(txt));
    writeFileSync(join(out, 'home.css'), HOME_CSS);
    writeFileSync(join(out, 'home.js'), HOME_JS);
    writeFileSync(join(out, '404.html'), notFoundPage());
    // T-421: the trust page (/trust), the status page (/status), their stylesheet, and security.txt (RFC 9116), which the
    // site Worker serves at /.well-known/security.txt (apps/site/worker.js) with an Expires set from this build's date.
    writeFileSync(join(out, 'trust.html'), trustPage({ site: SITE_URL, base: BASE }));
    writeFileSync(join(out, 'status.html'), statusPage({ site: SITE_URL, base: BASE }));
    writeFileSync(join(out, 'pages.css'), PAGES_CSS);
    writeFileSync(join(out, 'trust.txt'), trustText({ site: SITE_URL }));
    writeFileSync(join(out, 'status.json'), statusJson({ site: SITE_URL }));
    writeFileSync(join(out, 'security.txt'), securityTxt(new Date(), SITE_URL));
    writeFileSync(join(out, 'try.mjs'), readFileSync(here('try.mjs')));
    writeFileSync(join(out, 'buy.mjs'), readFileSync(here('buy.mjs')));
    for (const name of Object.keys(goals)) writeFileSync(join(out, `${name}.mjs`), readFileSync(here(`${name}.mjs`)));
    // T-472: the setup's one file, the committed bytes setup.txt's command pins.
    writeFileSync(join(out, 'setup.mjs'), readFileSync(here('setup.mjs')));
    // T-066: the commit this site was built from, so Crow Control can tell what is merged but not live. null when the
    // tree has uncommitted changes or git cannot answer.
    writeFileSync(join(out, 'version.json'), `${JSON.stringify({ commit: buildCommit() }, null, 2)}\n`);
    for (const f of ASSETS) writeFileSync(join(out, f), readFileSync(here(f)));
    writeFileSync(join(out, CARD_SCHEMA), readFileSync(here(CARD_SCHEMA)));
    // T-428: the favicon set from the brand kit, at the site's root, so /favicon.ico answers a client that asks blind.
    for (const f of ICON_FILES) writeFileSync(join(out, f), iconBytes(f));
    // The visual walkthrough of a real two-agent deal, served at /visualdemo.
    mkdirSync(join(out, 'visualdemo'), { recursive: true });
    writeFileSync(join(out, 'visualdemo', 'index.html'), visualdemoPage(readFileSync(here('visualdemo/index.html'), 'utf8')));
    // The two-agent demo (T-391), served at /demo: one run's replay, written by \`pnpm duet publish <run folder>\`.
    mkdirSync(join(out, 'demo'), { recursive: true });
    writeFileSync(join(out, 'demo', 'index.html'), demoPage(readFileSync(here('demo/index.html'), 'utf8')));
    const problems = await problemPages();
    mkdirSync(join(out, 'problems'), { recursive: true });
    for (const [path, html] of problems) writeFileSync(join(out, path), html);
    // T-451: the hashes of every page's inline scripts and styles, last, once every page is written: the site Worker's
    // content security policy names them (apps/site/headers.js).
    writeInlineHashes(out);
    console.log(`wrote ${guides.size} guides (${[...guides.keys()].join(', ')}), ${join(out, 'index.html')}, ${join(out, 'try.mjs')} (sha256 ${trySha256()}) and ${problems.size} problem pages: publish them under ${SITE_URL}`);
  }
}
