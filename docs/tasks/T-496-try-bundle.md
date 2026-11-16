# T-496: try.mjs carries its two packages, names its roles and source commit, and keeps an opt-in record

- **Lane:** demo (the one-command test deal)
- **Phase:** 2
- **Depends on:** T-495 on the try path, which gives the prompt its roles, exposure and permission flag (roadmap row N168)
- **Paths this task may touch:** `examples/try.ts`, `examples/try.test.ts`, `site/build.mjs`, `site/check.mjs` (its try checks), `site/try.mjs`, `site/index.html`, `site/llms.txt` (one sentence of the try section), `tests/site-bundles.test.ts` (new), `apps/test-agents/src/try.test.ts` (the lines it pins), this file.
- **Human gate:** the site deploy that publishes the new `try.mjs` and its hash, Rafa's.
- **Status:** review
- **Agent/session:** the try-bundle session, 2026-11-16, branch `t-496-try-bundle`.
- **Roadmap row:** N169
- **Change kind:** 1 (copy and agent docs: the published command and its page), with the examples' own tests for the code

## Intent

Restated in my own words.

The first outside run of the test deal, on 2026-11-15, found four problems with `try.mjs`, the one-command buyer demo. It asks for an npm install whose transitive packages resolve on the stranger's machine. One log line says "the seller's own terms" when the buyer sent its own terms. The run keeps nothing. And an agent cannot cheaply confirm what the 2,255-line file imports and calls. Each fix changes the file, and so its pinned SHA-256, so all of them go in one change. Copies of the old command then fail their hash check, which is the safe way to fail.

The change:

1. `site/build.mjs` bundles viem and tweetnacl into `try.mjs`, as it already does for the goal commands. The home page's command becomes curl, the hash check and Node, with no npm.
2. The proposal line says the buyer sent its own terms.
3. One line names who runs each role: the buyer is this script, and Crow runs the test seller, the three adjudicators and both operators.
4. The faucet's limit on a stopped run is the one the code allows.
5. `--out <dir>` writes the terms, the transaction hashes, the data and its SHA-256. Without it the script writes nothing.
6. The banner names the commit of the bundle's sources.
7. The last line names the report route.
8. A site test pins every bundle's imports and literal hosts, and refuses `import()`, `require`, `eval`, `new Function` and `child_process`.

Non-goals: the prompt's approval, roles and exposure text and the permission flag (T-495); a pause before funding and a `--plan` mode (Rafa's choice, D1 and D2 in the triage).

## Acceptance criteria

- [x] `site/try.mjs` imports nothing from npm; the try command has no `npm`.
- [x] The run prints the buyer's own terms, a roles line, the faucet's real limit and the report route.
- [x] `--out <dir>` writes the record; a run without it writes no file.
- [x] The banner names the source commit, and the publish build refuses when that commit's sources differ from the tree.
- [x] `tests/site-bundles.test.ts` fails on a new import, a new host or a dynamic load in any bundle.
- [x] The new SHA-256 is in `site/index.html` and in the filled `llms.txt`.

## Evidence

All measured on 2026-11-16, on branch `t-496-try-bundle`.

- **The new file:** `site/try.mjs` has SHA-256 `92bdad2dcf9850896a2623f3d83341e54f17b6bb7a9373f1c94e08dee82750cb` (was `04ef4434…75c8`). Its one import is `node:fs`; viem 2.57.13 and tweetnacl 1.0.3 are inside. The new hash is in `site/index.html` and in a filled `llms.txt`; the old one is in neither.
- **Local checks of kind 1:** `node site/build.mjs && node site/check.mjs` prints "site check PASS", and the build changes no other bundle's bytes. `pnpm exec vitest run examples/try.test.ts apps/test-agents/src/try.test.ts apps/test-agents/src/try-goals.test.ts tests/site-bundles.test.ts tests/site-guides.test.ts tests/guide-budget.test.ts tests/record-copies.test.ts tests/site-deploy.test.ts tests/site-headers.test.ts`: 9 files, 96 tests passed. `pnpm typecheck` and eslint on the changed files report nothing. No snapshot changed.
- **The tests cover:** the bundle running a deal from an empty folder with no `node_modules` and writing nothing; `--out` under `node --permission`, refused before the deal without write access, and writing the record with it; the report line after `done` when the operators take reports; the faucet's limit read from discovery on a stopped run; the roles line and the buyer's-terms wording on the `--seller` path. `tests/site-bundles.test.ts` pins each of the 7 published bundles' imports, requires, `process` members and hosts, and a planted sample shows it catches `import()`, `eval`, `new Function`, `child_process`, `process.binding`, a require and a new host.
- **One live run on Sepolia** of the new file from an empty folder, under `node --permission --allow-fs-read=. --allow-fs-write=rec`, with `--seller https://crow.direct/agents/test-seller --out rec`: exit 0, Released in 47 s, commitment `0x6014a3f9…6b38`, 3 transactions (funded `0xb8a467c8…`, delivered `0xb987f4fc…`, decided `0x10bfe8c6…`), the record and the CSV written to `rec/`, and the last line names `POST https://api.crow.direct/v1/feedback or https://api2.crow.direct/v1/feedback`.

## Decisions

- **The source commit is the newest commit whose bundled files equal the tree, and an ancestor of HEAD.** A commit cannot name itself, so `site/build.mjs` keeps the commit the committed banner names while it still holds, and otherwise takes the newest commit that changed those files. With uncommitted sources the banner says "Source commit: none". `examples/try.test.ts` refuses "none" in CI; it checks the commit itself only where the clone has it (CI's checkout is shallow); the publish build (`--out`) refuses a commit that is not an ancestor or whose files differ. Cost: a change to `try.ts`, `agent.ts`, `verify.ts`, `finality.ts` or `deployments.ts` takes two commits, the sources and then the rebuilt `site/try.mjs`. The test's message says so.
- **`try.mjs` imports `node:fs`.** The brief asked for no `node:` module, but `--out` must write files. The alternative, `process.getBuiltinModule`, is a load at run time that a reader cannot see in the import list. One static import, named in the banner and pinned by the test, is easier to audit, and under `node --permission` it writes only where `--allow-fs-write` allows.
- **No require in `try.mjs`.** A build plugin (`WEB_CRYPTO` in `site/build.mjs`) points noble's hashes and tweetnacl's random bytes at Web Crypto, so the bundle needs neither `node:crypto` nor `createRequire`. The plugin refuses a package version whose code no longer matches. The goal bundles and `setup.mjs` still carry tweetnacl's `__require("crypto")`; the test pins that as it is, so their hashes do not change here.
- **The report line prints only when an operator's discovery lists `feedback`,** so it never names a route that is not there.
- **The faucet's limit comes from discovery** (`demo.faucet.perClientPerWindow` and `perAddressEverySec`), so the line cannot drift from the code again.

## Handoff

- **The deploy is Rafa's.** Until it runs, crow.direct serves the old `try.mjs` and the old command; a copy of the new command fails its hash check, which is the safe way to fail. After the deploy, a copy of the old command fails its hash check the same way.
- **The redeploy flow** (`scripts/record-copies.mjs`) rewrites `examples/deployments.ts` and rebuilds before committing, so its `try.mjs` reads "Source commit: none" until the copies are committed and `node site/build.mjs` runs again. The CI test says which command to run.
- **Follow-ups not built:** the goal bundles and `setup.mjs` can take the same Web Crypto plugin at their next hash change, which removes their `createRequire`. The roles line prints after the "settling on chain" line, inside the keys step; moving it first is cosmetic.
