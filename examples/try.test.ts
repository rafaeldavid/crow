// The one-approval test deal runs as a stranger runs it, a separate Node process that reaches the
// operators over HTTP only. The operators here are the public demo's own world (apps/demo-cloud, the code the
// live nodes run, with their 1 bp operator fee) served in this process on two origins, so CI needs no network.
// The source (examples/try.ts) and the published bundle (site/try.mjs) both run a deal.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import { MemoryFeedbackStore } from '@holdback/operator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { finality } from './finality.ts';
import { serveTwoOrigins } from './two-origins.ts';

const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));

/**
 * The demo world as two nodes: http://127.0.0.1:<port> is node 0, http://localhost:<port> node 1 (world.test.ts).
 * `rewrite` alters the successful answers of the nodes listed in `lying`.
 */
async function serve(rewrite?: (path: string, body: string) => string, lying: number[] = [0], { reports = false } = {}): Promise<{ urls: [string, string]; close(): Promise<void> }> {
  const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000' }, ...(reports ? { feedbackStore: new MemoryFeedbackStore() } : {}) });
  return serveTwoOrigins(world, { tickMs: 100, rewrite: rewrite && ((node, path, body) => (lying.includes(node) ? rewrite(path, body) : undefined)) });
}

let demo: Awaited<ReturnType<typeof serve>>;
beforeAll(async () => {
  demo = await serve();
});
afterAll(() => demo.close());

type Run = { code: number | null; out: string };
/** Runs `args` with node against `operators`, with `stdin` piped in. */
function node(args: string[], operators: readonly string[], opts: { stdin?: string; cwd?: string } = {}): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: opts.cwd ?? process.cwd(), env: { ...process.env, HOLDBACK_OPERATORS: operators.join(',') } });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('exit', (code) => resolve({ code, out }));
    child.stdin.end(opts.stdin ?? '');
  });
}

/** What every successful run prints: one line per step, then the commitment ID and the final state. */
function expectDeal(r: Run): string {
  expect(r.code, r.out).toBe(0);
  for (const step of ['keys', 'faucet', 'offer', 'accepted', 'check', 'fund', 'deliver', 'outcome', 'open', 'balances', 'final']) expect(r.out, step).toMatch(new RegExp(`^${step} +\\S`, 'm'));
  expect(r.out).toMatch(/^faucet +1000 tUSD each, both admitted to demo-club$/m);
  // T-496: who runs each role, before any money moves; on other operators than Crow's it claims none for Crow.
  expect(r.out).toMatch(/^roles +buyer: this script, with fresh keys; seller: this script too; adjudicators \(primary, fallback, appeal\): 0x[0-9a-f]{6}\.\.\.[0-9a-f]{4}, 0x[0-9a-f]{6}\.\.\.[0-9a-f]{4}, 0x[0-9a-f]{6}\.\.\.[0-9a-f]{4}, as the operators' discovery names them; operators: 127\.0\.0\.1:\d+ and localhost:\d+$/m);
  // T-390: phase one's terms have no appeal window, so the closing line says the decision is final, and names no window.
  expect(r.out).toMatch(/^final +\S.*; final at the decision, since the terms have no appeal window$/m);
  expect(r.out).not.toMatch(/appeal window closes/);
  expect(r.out).toMatch(/^offer +0x[0-9a-f]{6}\.\.\.[0-9a-f]{4} Offered: 3 rows of customer_id,email for 25 tUSD/m);
  // T-401: an agent copies what the one command prints, so it prints "Crow" in words and only ASCII.
  expect(r.out).toMatch(/^Crow test deal on /m);
  expect(r.out).not.toMatch(/[^\x00-\x7f]/);
  expect(r.out).toMatch(/^fund +Held: 26 tUSD held \(25 price \+ 1 adjudication fee\), operator fee 0\.01 tUSD$/m);
  expect(r.out).toMatch(/^outcome +Released: checks cols pass, rows pass, uniq pass; decision accept$/m);
  expect(r.out).toContain('3 rows, 1,ada@example.com | 2,alan@example.com | 3,grace@example.com');
  expect(r.out).toMatch(/^balances +buyer 973\.99 tUSD, seller 1025 tUSD$/m);
  const done = /\ndone +commitment (0x[0-9a-f]{64}) Released\n$/.exec(r.out);
  expect(done, `the last line names the commitment and its state:\n${r.out}`).not.toBeNull();
  return done![1]!;
}

/** Serves the demo with the offer's terms, as the operators serve them to the buyer, raised to 9,000 tUSD. */
const raisedTerms = (lying: number[]) =>
  serve((path, body) => {
    if (!/^\/v1\/commitments\/0x[0-9a-f]{64}\/terms$/.test(path)) return body;
    const terms = JSON.parse(body);
    terms.price.amount = '9000000000';
    return JSON.stringify(terms);
  }, lying);

describe('try.ts', () => {
  it('plays both sides of one checks-only deal against two operators and ends Released', async () => {
    const id = expectDeal(await node([here('./try.ts')], demo.urls));
    const state = (await (await fetch(`${demo.urls[1]}/v1/commitments/${id}`)).json()) as { escrowState: string };
    expect(state.escrowState).toBe('Released');
  }, 60_000);

  it('with --outcome refund, delivers work that fails the rows check and ends Refunded', async () => {
    const r = await node([here('./try.ts'), '--outcome', 'refund'], demo.urls);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/^outcome +Refunded: checks cols pass, rows FAIL, uniq pass; decision reject$/m);
    expect(r.out).toMatch(/^refund +the price came back to the buyer; no key was released/m);
    expect(r.out).toMatch(/^balances +buyer 998\.99 tUSD, seller 1000 tUSD$/m);
    expect(r.out).toMatch(/\ndone +commitment 0x[0-9a-f]{64} Refunded\n$/);
  }, 60_000);

  it('refuses to sign an offer an operator altered, and exits 3 naming the field', async () => {
    // Node 0 raises the price in the offer it prepares; node 1 is honest.
    const lying = await serve((path, body) => {
      if (path !== '/v1/prepare/offer') return body;
      const prepared = JSON.parse(body);
      prepared.submit.body.price.amount = '9000000000';
      return JSON.stringify(prepared);
    });
    try {
      const r = await node([here('./try.ts')], lying.urls);
      expect(r.code, r.out).toBe(3);
      expect(r.out).toMatch(/^refused at offer: refusing to sign: body\.price\.amount differs from what you asked for$/m);
      expect(r.out).not.toMatch(/^done /m);
    } finally {
      await lying.close();
    }
  }, 60_000);

  it('as the buyer, refuses to agree when both operators serve terms other than the seller sent, and exits 3', async () => {
    const lying = await raisedTerms([0, 1]);
    try {
      const r = await node([here('./try.ts')], lying.urls);
      expect(r.code, r.out).toBe(3);
      expect(r.out).toMatch(/^refused at check: refusing to agree: the terms the operators serve are not the ones the seller sent$/m);
      expect(r.out).not.toMatch(/^fund /m);
    } finally {
      await lying.close();
    }
  }, 60_000);

  it('as the buyer, stops before funding when one operator serves other terms, and exits 1', async () => {
    const lying = await raisedTerms([0]);
    try {
      const r = await node([here('./try.ts')], lying.urls);
      expect(r.code, r.out).toBe(1);
      expect(r.out).toMatch(/^stopped at check: operators disagree on \/v1\/commitments\/0x[0-9a-f]{64}\/terms; do not proceed$/m);
      expect(r.out).not.toMatch(/^fund /m);
    } finally {
      await lying.close();
    }
  }, 60_000);

  it('site/try.mjs is the current bundle of examples/try.ts, and that bundle runs a deal with no npm install', async () => {
    const { tryBundle, sourceCommitOf, sourceCommitProblem, tryFiles } = await import(here('../site/build.mjs'));
    const committed = readFileSync(here('../site/try.mjs'), 'utf8');
    // The code is current for the commit its banner names (T-496). That commit is checked where the clone has it:
    // CI's shallow clone does not, and the publish build refuses one that does not hold.
    const commit = sourceCommitOf(committed);
    expect(commit, 'site/try.mjs names no source commit: commit examples/, then run node site/build.mjs').toMatch(/^[0-9a-f]{40}$/);
    expect(committed === (await tryBundle(undefined, { commit })), 'site/try.mjs is stale: run node site/build.mjs').toBe(true);
    const problem = sourceCommitProblem(commit, tryFiles(committed));
    if (!problem?.endsWith('is not in this clone')) expect(problem).toBeNull();
    expect(tryFiles(committed)).toEqual(['examples/agent.ts', 'examples/deployments.ts', 'examples/finality.ts', 'examples/try.ts', 'examples/verify.ts']);
    // viem and tweetnacl are inside; the one import is Node's fs, for --out (tests/site-bundles.test.ts pins the rest).
    const imports = [...committed.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['node:fs']);
    // As the one command runs it: one file in an empty folder, no node_modules anywhere above it, no npm.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'crow-try-')));
    try {
      copyFileSync(here('../site/try.mjs'), join(dir, 'try.mjs'));
      expectDeal(await node([join(dir, 'try.mjs')], demo.urls, { cwd: dir }));
      // It wrote nothing: the folder holds only the file itself.
      expect(readdirSync(dir)).toEqual(['try.mjs']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('with --out, writes the terms, the transaction hashes, the data and its SHA-256, and runs under node --permission', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'crow-try-')));
    try {
      copyFileSync(here('../site/try.mjs'), join(dir, 'try.mjs'));
      const out = join(dir, 'record');
      // Under the permission model without write access, --out refuses before any deal, and names the flag.
      const denied = await node(['--permission', `--allow-fs-read=${dir}`, join(dir, 'try.mjs'), '--out', out], demo.urls, { cwd: dir });
      expect(denied.code, denied.out).toBe(1);
      expect(denied.out).toContain(`create the folder first (mkdir -p ${out}), then add --allow-fs-write=${out}`);
      expect(denied.out).not.toMatch(/^faucet /m);
      // Granted a folder that did not exist when Node started, which Node does not let it write: refused before the deal too.
      const missing = await node(['--permission', `--allow-fs-read=${dir}`, `--allow-fs-write=${out}`, join(dir, 'try.mjs'), '--out', out], demo.urls, { cwd: dir });
      expect(missing.code, missing.out).toBe(1);
      expect(missing.out).not.toMatch(/^faucet /m);
      // With the folder made first and write access to it only, the deal runs and the record is there.
      mkdirSync(out, { recursive: true });
      const r = await node(['--permission', `--allow-fs-read=${dir}`, `--allow-fs-write=${out}`, join(dir, 'try.mjs'), '--out', out], demo.urls, { cwd: dir });
      const id = expectDeal(r);
      expect(r.out).toContain(`record    wrote ${out}/${id}.json and ${out}/${id}.csv`);
      expect(readdirSync(out).sort()).toEqual([`${id}.csv`, `${id}.json`]);
      const csv = readFileSync(join(out, `${id}.csv`));
      expect(csv.toString()).toBe('customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n');
      const record = JSON.parse(readFileSync(join(out, `${id}.json`), 'utf8'));
      expect(record).toMatchObject({ type: 'crow-try-record', commitmentId: id, state: 'Released', operators: demo.urls, transactions: [], data: { file: `${id}.csv`, format: 'text/csv', bytes: csv.length, sha256: createHash('sha256').update(csv).digest('hex') } });
      expect(record.terms.price).toEqual({ token: 'tUSD', amount: '25000000' });
      // No key in the record.
      expect(JSON.stringify(record)).not.toMatch(/privateKey|secretKey/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it('ends with the report route when the operators take reports, after the done line', async () => {
    const reporting = await serve(undefined, [], { reports: true });
    try {
      const r = await node([here('./try.ts')], reporting.urls);
      expect(r.code, r.out).toBe(0);
      const [op1, op2] = reporting.urls;
      expect(r.out).toMatch(/\ndone +commitment 0x[0-9a-f]{64} Released\nreport +.*\n$/);
      expect(r.out.trimEnd().split('\n').at(-1)).toBe(`report    with your principal's yes, report a problem or this first deal: POST ${op1}/v1/feedback or ${op2}/v1/feedback (https://crow.direct/ref/limits.txt, "Reporting a problem")`);
    } finally {
      await reporting.close();
    }
  }, 60_000);

  it("names the faucet's own limits when a run stops", async () => {
    // An operator that funds nothing: the faucet answers 429, as it does past its limit per client.
    const capped = await serve((path, body) => (path === '/v1/faucet' ? '{' : body), [0, 1]);
    try {
      const r = await node([here('./try.ts')], capped.urls);
      expect(r.code, r.out).toBe(1);
      expect(r.out).toMatch(/^Nothing here is real money\. Run it again for a fresh deal; the faucet funds at most 50 new addresses per client every 60 min\.$/m);
    } finally {
      await capped.close();
    }
  }, 60_000);

  it('llms.txt carries the one command, with the sha256 of site/try.mjs and the lockfile versions, and the homepage copies it without showing it', async () => {
    const { tryCommand, page, filled, pins } = await import(here('../site/build.mjs'));
    const sha = createHash('sha256').update(readFileSync(here('../site/try.mjs'))).digest('hex');
    // The pins are the versions this test ran the deal with: what pnpm installed for examples/.
    const v = (name: string) => (JSON.parse(readFileSync(here(`./node_modules/${name}/package.json`), 'utf8')) as { version: string }).version;
    expect(pins()).toEqual({ viem: v('viem'), tweetnacl: v('tweetnacl') });
    const command = tryCommand();
    // T-496: no npm. The file is checked as try.mjs.part and becomes try.mjs only when its SHA-256 matches.
    expect(command).toBe(`mkdir -p crow-try && cd crow-try && curl -fsSL https://crow.direct/try.mjs -o try.mjs.part && echo "${sha}  try.mjs.part" | shasum -a 256 -c && mv try.mjs.part try.mjs && node --permission --allow-fs-read=. try.mjs --seller https://crow.direct/agents/test-seller`);
    const md = readFileSync(here('../site/llms.txt'), 'utf8');
    const html = readFileSync(here('../site/index.html'), 'utf8');
    expect(html === page(md), 'site/index.html is stale: run node site/build.mjs').toBe(true);
    // One-Click Escrow (D51, T-229): the copy button copies a prompt that carries the exact command on its own line,
    // so a fresh assistant asks for one approval. The visible page shows only the Try line (Rafa, 2026-11-04).
    const span = /<span id="prompt" hidden>([^<]*)<\/span>/.exec(html);
    const prompt = (span?.[1] ?? '').replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
    expect(prompt.split('\n')).toContain(command);
    expect(prompt).toContain('https://crow.direct/llms.txt');
    const visible = html.replace(span?.[0] ?? '', '');
    expect(visible).not.toContain('try.mjs.part');
    expect(visible).not.toContain(sha);
    const txt: string = filled(md.split('\n').filter((l) => !l.startsWith('%% CONFIRM')).join('\n'), { op1: 'https://op1.example', op2: 'https://op2.example' });
    const tryIt = txt.slice(txt.indexOf('## Try it'), txt.indexOf('\n## ', txt.indexOf('## Try it') + 3));
    expect(tryIt.split('\n').find((l) => l.startsWith('mkdir -p crow-try '))).toBe(command);
    // Each fetch before the command is one more approval: "Try it" asks for none, and keeps the sha256 pin and the source.
    expect(tryIt).not.toMatch(/before you ask|fetch https:\/\/crow\.direct\/try\.mjs/);
    expect(tryIt).toContain('runs it only if its SHA-256 matches the one in the command');
    expect(tryIt).toContain('`examples/try.ts`, `agent.ts` and `verify.ts` in https://github.com/rafaeldavid/crow');
  });
});

describe('the closing line\'s finality clause (T-390 part 3)', () => {
  it('says the decision is final when the terms have no appeal window, and names the window, with its own length, only when they have one', () => {
    for (const w of [0, '0', undefined]) expect(finality(w, '2026-11-12T20:00:00Z')).toBe('final at the decision, since the terms have no appeal window');
    expect(finality('60', '2026-11-12T20:00:00Z')).toBe('final at 2026-11-12T20:00:00Z, when the 60 s appeal window closes, with nobody needing to act');
    expect(finality(86_400)).toBe('final at the end of the appeal window, when the 86400 s appeal window closes, with nobody needing to act');
  });
});
