# T-606: a published seller command that runs from a config file

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-331, T-472
- **Paths this task may touch:** `examples/serve.ts`, `examples/serve.test.ts`, `site/serve-entry.mjs`, `site/serve.mjs`, `site/ref/serve.txt`, `site/build.mjs`, `site/check.mjs`, `site/llms.txt` (the Reference list), `site/ref/seller-adapter.txt` (one pointer), `tests/site-bundles.test.ts`, `examples/seller-adapter.ts` and `examples/seller-adapter.test.ts` (the follow-up below), `tests/cut-feature-alignment.known.json` (one line for the new bundle), `eslint.config.js` (the ignore list); this file.
- **Human gate:** no. The site deploy waits for Rafa.
- **Status:** done (merged in pull requests 803 and 813, 2026-11-25)
- **Agent/session:** p17-seller-config, 2026-11-25; branch `t-606-serve-command`
- **Roadmap row:** N167
- **Change kind:** 4 (a published client command and its guide); the local checks named by the brief, and one reviewer

## What exists

- `examples/seller-adapter.ts` runs the adapter from a config file (T-331), from a clone that is installed and built.
- `site/setup.mjs` carries the adapter, but no command in it takes a seller's config file. Its check accepts only its own loopback API and refuses `quoteAuth`, and its first line removes every `CROW_*` variable.
- `site/take.mjs` takes a standing offer, which cannot cover work that depends on the buyer's order.
- Still needed: one pinned file that runs the adapter from a config file.

## Intent

Publish `serve.mjs`: `node serve.mjs <seller.json>` runs the seller adapter, unchanged, from one hash-pinned download, with the adapter's own environment variables. It keeps every variable the config names and every start check, and it loads no code at run time. No existing pinned file changes. Non-goals: a new adapter setting, a change to the adapter, a deploy.

## Acceptance criteria

- [x] A configuration that a program generates for one order runs against the pinned file on a local world and ends Released.
- [x] No existing pinned hash changes.
- [x] The file loads no code at run time, keeps the config's token variables, and runs the adapter's own start checks.
- [x] The hash is pinned in the site check and in a guide, `site/ref/serve.txt`; both first-deal budgets still pass.

## Decisions

- A new entry, not a `setup.mjs` command, so `setup.mjs` keeps its hash. `seller-adapter.ts` was not edited, since `setup.mjs` bundles it; the follow-up below edits it and leaves `setup.mjs` unchanged.
- The file carries no deal template. A config without `template` is refused: the adapter's shipped template is a file beside its source, for one sample product.
- One check added: every pinned chain is Sepolia or 31337, as `take.mjs` does. The adapter alone accepts any chain `HOLDBACK_DEPLOYMENT` pins, and this file is published to run beside a seller's key.
- It removes `NODE_TLS_REJECT_UNAUTHORIZED`, as `take.mjs` does, and nothing else.
- No `--sim`: that mode needs a running `pnpm sim`, which needs the repository.
- The guide has a Windows PowerShell install line, since Windows has no `shasum`.
- No salt unless the file sets `reportSalt`. The adapter takes a template beside its own file for the shipped one, which inside one bundled file means the download folder.
- A call that starts nothing ends the process at once, as the adapter's own command line does.

## Evidence

All measured on 2026-11-25 on main at `91430b55` (PR 795 merged) plus this branch, unless labeled otherwise.

- `site/serve.mjs`: SHA-256 `faf1df138198f35c900219c0e36aa02d6b764f72f7d49cba6dc8388b2fa84095`, about 2.3 MB.
- Existing pinned files: `try.mjs`, `buy.mjs`, `take.mjs`, `setup.mjs`, `try-sell.mjs`, `try-judged.mjs`, `try-reclaim.mjs` and `preflight.mjs` are byte for byte main's after the rebuild.
- `pnpm typecheck` and `pnpm lint`: exit code 0. `pnpm snap`: 57 passed, 0 failed.
- `node site/build.mjs && node site/check.mjs`: PASS. First-deal paths: buyer 4,906 and seller 4,977 of 5,000 tokens (estimate, bytes divided by four; no counting key set). The published `ref/serve.txt` has 3,883 bytes.
- `pnpm test`: 5,780 passed, 2 failed, 315 skipped.
  - `cut-feature-alignment`: the list did not name the new bundle. It matches the same 13 identifiers as `setup.mjs` and no other. With the line added, that file passes (2 of 2).
  - `safe-regex.test.ts`, "random nested patterns": it ran 31.2 s against a 30 s limit, at a load average near 199 on 8 cores. Alone, at about the same load, it passed in 11.9 s (9.2 s of CPU). This branch changes nothing under `packages/`. Cause, inferred: a CPU-bound test with a wall-clock limit on a loaded machine. The full suite did not run again; CI is the gate.
- `examples/serve.test.ts`: the committed file, copied alone into a new folder, sells one request on a local world from a generated configuration and ends Released. Both `CROW_*` token variables stay set, and no connection leaves the machine.
- A run outside the repository ended Released with 11 checks on the final file. It used a real per-order program's generated configuration and template, and its own HTTP handler. The work itself was a stand-in, and the adapter's port was changed to 0 because another process held it.
- The Windows PowerShell line has not run: this machine has no PowerShell. A test compares its text only.
- One reviewer pass: ISSUES. Fixed: a fixture too close to a private program's names (replaced with invented ones before the first commit); a refused start that stayed alive for minutes while one operator was silent; a template with the shipped template's name taken for the shipped one; the Windows line's error handling; three guide claims; two test gaps; one banner comment. The two behaviour fixes each have a test that failed before the fix. No second review ran on the fixes.

## Follow-up: a signal at the ready line killed the process

2026-11-25, in two pull requests: `t-606-signal-before-ready` (`serve.mjs`, merged as PR 813) and `t-606-adapter-signal` (the repo adapter). All items measured, unless labeled otherwise; the first on main at `ae327a9a`, the second at `b02ccd8a`.

- **Symptom:** on PR 812's CI (shard 1 of 4), the shipped-template-name test got exit code `null` after 429 ms. PR 812 touches none of this code.
- **Cause:** `startSellerAdapter` prints the ready line (`serves POST`) and more log lines before it returns, and `serve.ts` installed its handlers after the return. A signal in between took the operating system's default action. The order dates from the first version of `serve.ts`, not from a later merge.
- **Why it passed before:** the test looked for the ready line every 25 ms, so the child had usually installed its handlers. That a busy CI runner delayed the child there is inferred.
- **Reproduced** on main's `serve.mjs`, with a script outside the commit: SIGTERM sent as soon as the ready line arrived killed 241 of 300 runs. With the child paused 300 ms at that line, 5 of 5 for SIGTERM and 5 of 5 for SIGINT.
- **Fix:** the handlers go in before the start. After the ready line they stop the adapter gracefully, as before. During a start they exit with status 0 at once and say that nothing was served.
- **After:** the same script: SIGTERM 300 of 300 and SIGINT 100 of 100 ran the graceful stop, exit code 0; the paused case 5 of 5 for each signal.
- **Tests:** two new ones in `examples/serve.test.ts`, for both signals: at the ready line with the child paused there, and during a start that waits on a silent operator. Both failed before the fix. A failed exit check now names the signal.
- **The repo adapter had the same order** (`examples/seller-adapter.ts`, its own command line). Both commands now call one function there, `stopOnSignals`, before the start. The same script, before and after, on the adapter: SIGTERM 269 of 300 killed, then 0; SIGINT 92 of 100 killed, then 0; paused, 5 of 5 killed for each signal, then 0. On the rebuilt `serve.mjs` after the change: 0 killed in the same 410 runs. Two tests of the same two cases are in `examples/seller-adapter.test.ts`; both failed before the fix.
- **Hash:** `site/serve.mjs` is `0b9687dbbeb14b9c0c1bc6a29f3597a70c66d3569d8001b3d94b35f94ff25f96` with the repo adapter's fix (`772c81b5...` with PR 813 alone). It is the only pinned file this follow-up changes: `setup.mjs`, which carries `seller-adapter.ts`, is byte for byte main's, since it never calls the new function.
- **Checks:** `pnpm typecheck` and `pnpm lint` exit 0; `node site/build.mjs && node site/check.mjs` PASS; the adapter, signer, setup, audit-deal and bundle test files: 418 passed, 4 skipped. The signal and command-line tests of both files passed 20 runs in a row. The full suite did not run here; CI is the gate.
- **Live:** during this fix, on 2026-11-25, https://crow.direct/serve.mjs served the first build (`faf1df13`), which has the race, until the next site deploy.

## Out of scope

- Check kinds added after the build: the file carries the check library as it was when built, so a new kind needs a rebuild and a new hash.
- The adapter's log line that names `node examples/seal.ts` for a delivery by hand: changing it changes `setup.mjs`'s hash. The guide says to leave `redelivery` a way to fetch.

## Handoff

Built; the pull request waits for review and merge. The site deploy is Rafa's. Until it, https://crow.direct/serve.mjs and https://crow.direct/ref/serve.txt do not exist.

- A later change to the adapter or the check library rebuilds `serve.mjs` and moves its hash. If main moves first, merge it, run `node site/build.mjs`, and take the new hash; never resolve a bundle by hand.
- Run the Windows line once on Windows before a seller depends on it.
- Follow-up, outside this task: give the `safe-regex` property test a time limit that a loaded machine can meet.
