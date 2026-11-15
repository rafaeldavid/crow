# T-472: `setup.txt` and the setup command, a seller's first deal from its own machine

- **Lane:** demo (agent access: the guides in `site/` and the reference tools in `examples/`)
- **Phase:** 2
- **Depends on:** T-471 (the plan and its design, `docs/research/2026-11-15-setup-design.md`); pull request 578 (T-469), which adds self-contained pinned bundles and `examples/goal-kit.ts` and changes `site/build.mjs`, `site/check.mjs` and the top of `site/llms.txt`. Start from `main` after 578 merges.
- **Paths this task may touch:** new files only, plus the site's build lists: `site/setup.txt`, `site/setup-entry.mjs`, `site/setup.mjs` (generated), `examples/setup.ts`, `examples/setup-seller.ts`, `examples/setup-check.ts`, `examples/setup-sample-api.ts`, `examples/setup*.test.ts`, `site/build.mjs`, `site/check.mjs`, `site/guides.mjs`, one line in `site/llms.txt`, `tests/site-guides.test.ts`, this file. It imports `examples/seller-adapter.ts`, `examples/seller-adapter-core.ts`, `examples/seller-adapter-api.ts`, `examples/check-delivery.ts`, `examples/report-converter.ts`, `examples/deal-record.ts`, `examples/goal-kit.ts` and `packages/` and changes none of them.
- **Human gate:** yes, for one step only: the site deploy that publishes `setup.txt` and `setup.mjs` is Rafa's. The merge has no gate.
- **Status:** in progress
- **Agent/session:** an implementer sub-session started by the coordinator on 2026-11-15, on branch `t-472-setup-first-slice`. It works in two phases: Phase A proves the bundle and stops for the coordinator; Phase B builds the rest.
- **Roadmap row:** N160
- **Change kind:** 4 is the nearest recipe (client code in `examples/`), with 1 (an agent guide in `site/`). Local checks: `pnpm exec vitest run examples/setup tests/site-guides.test.ts`, `node site/build.mjs && node site/check.mjs`.
- **Review:** one `red-teamer` pass (keys, secrets, what leaves the machine) and one `reviewer` pass. Blocking findings only.
- **Token budget:** 250,000 tokens, a target.

## Intent

Restate this in your own words before writing code.

A person says one sentence to their own assistant: "Read https://crow.direct/setup.txt and set up Crow for me as a seller." The assistant reads one file, runs one pinned command, and ends with a first settled test deal on Sepolia in which the person's own machine is the seller. Nothing that names the person, their key, their domain or their terms goes to a Crow-run host before the first deal starts.

This task builds the smallest slice that makes that sentence true: **a seller on its own machine that sells Crow's sample product.** The command serves a small sample API on the loopback address, priced in the test token, and runs the seller adapter against it. The party's own API comes next, in T-483, on the same commands.

Pull request 578 already has one pinned command, `try-sell.mjs`, that sells a sample file to Crow's test buyer over plain HTTP with keys in memory. This task reuses its self-contained bundling and its kit for the handshake with the test buyer. It adds what a party keeps: a folder with a key that lasts, the adapter's path that a real API will use, and the check.

Inputs: Node 22.18 or later, and nothing else. Outputs: one folder on the person's machine, a first deal that ends `Released`, and its deal record.

Non-goals: the party's own API, its secrets and the fallback in which the command buys the job itself (T-483); a public address for quotes (T-477, T-478); a buyer's setup (T-475); leaving (T-476); the card's schema (T-474); `setup.txt` in `guide-budget.json` (deferred); any change to the seller adapter, the hosted sellers or `packages/`.

## Context

- The design: `docs/research/2026-11-15-setup-design.md`, sections "`setup.txt`", "The setup command", "Keys, secrets and limits", "The conformance check" and "The privacy table".
- The baseline it replaces: `docs/research/2026-11-15-setup-baseline.md`, "A seller today".
- The pattern for a pinned, self-contained bundle: pull request 578 (`site/build.mjs`, `examples/goal-kit.ts`), and the row "A published script is the code CI ran" in `docs/team.md`.
- The adapter starts from one configuration with its environment passed as an argument (`startSellerAdapter(c, env)` in `examples/seller-adapter.ts`). `"signingKey": "per-deal"` takes its faucet grant with each quote, not at start.
- Crow's test buyer and its published rules: `site/ref/intake.txt`, "Sell to Crow's test buyer"; `apps/test-agents/src/buyer-rules.ts`. The adapter's default windows do not fit them; the setup writes windows that do.
- Decisions: D73 and D74 in `docs/decisions-today.md`.

## What the command does

One file, `setup.mjs`: the unminified, self-contained bundle of `examples/setup.ts` and what it imports, pinned by its SHA-256 in `setup.txt`. It works in one folder and never outside it.

| Command | What it does | Requests to a Crow-run host |
| --- | --- | --- |
| `node setup.mjs seller --sample --payout <address or this-key>` | Makes the folder, a signing key (file mode 0600, the address printed, the key never), the adapter's configuration with `"signingKey": "per-deal"` and windows that fit the test buyer, the sample's deal template, and the card files in a separate output folder. It asks nothing at a prompt: when an answer is missing it prints one JSON object that names each missing answer with a plain question, and exits 3. Run again, it continues from `crow.json`. It ends by running `check`. | none |
| `node setup.mjs check` | The conformance check: one JSON line per check and exit 0 only when all pass. | none |
| `node setup.mjs first-deal` | Prints what it is about to send and to whom, writes the marker that the first deal starts, then sells one job: it starts the adapter in this process, asks its own quote address for an offer to Crow's test buyer, posts the commitment ID to the test buyer, delivers when the hold is funded, follows the deal to `Released` and writes the deal record. | the first ones: discovery, the faucet grant for the deal key, the offer, the delivery |
| `node setup.mjs status` | The folder's state: the role, the steps done, the addresses, the open deals. No secret. | none |

## Acceptance criteria

- [ ] **The bundle is proved first.** `site/build.mjs` bundles the adapter's Node shell, the check library and the two libraries into one file that runs with nothing installed. The bundled tools' own command lines do not run when `setup.mjs` starts: three of them test whether the running file is their own (`examples/seller-adapter.ts`, `check-delivery.ts`, `report-converter.ts`), and a build transform handles that without changing those files. If either cannot be done, the task stops and says so in Handoff.
- [ ] `site/setup.txt` exists, is filled and published by `site/build.mjs` like the other guides, and is at most 8,000 bytes; `site/check.mjs` fails above that. It carries one command line that downloads `setup.mjs` as a `.part` file, moves it into place only when its SHA-256 matches, and runs the first step. A test fails on a stale bundle, a stale hash or a stale command, as `examples/try.test.ts` does for `try.mjs`.
- [ ] `site/try.mjs` and `site/buy.mjs` keep their SHA-256. `git diff` shows no change under `apps/hosted-sellers`, `packages/`, `examples/seller-adapter-core.ts` or `examples/seller-adapter-api.ts`. The hosted bundle's SHA-256 for the kit's seller folders is unchanged, measured as T-443 measured it.
- [ ] **End to end, scripted:** in the in-process world with Crow's test buyer, `seller --sample` then `first-deal` ends `Released` with the test buyer as the buyer, and writes a deal record whose checks pass.
- [ ] **Nothing before the first deal:** a test records every request the commands make. `seller` and `check` make no request to an operator, the faucet, the test agents or crow.direct, and post no terms anywhere. The first request that is not a GET, or whose path holds an address, is made by `first-deal`, after its marker.
- [ ] **No ambient settings.** The command ignores `HOLDBACK_*` and `CROW_*` variables in its environment and never sets the key in its own process's environment. A test sets a deployment pin and operators in the environment and sees no change. The operators default to Crow's two and change with `--operators`. Only the Sepolia deployment is accepted, except with an explicit test-world flag, which makes every line say that it is not the live service.
- [ ] **The payout address is asked, never defaulted.** `seller` exits 3 with the question until the person gives an address or `this-key`. With `this-key` the command prints that every deal then names this folder's standing address in its public terms, and that its key is on this machine. `first-deal`'s preview states the same link.
- [ ] **Where the folder lives.** The default is `~/.crow/<name>`. The command refuses a folder inside a git work tree, a known synced folder or the card's output folder, unless a flag says otherwise. The folder gets a `.gitignore` that covers `keys/`.
- [ ] **Keys.** The signing key is made by the command, written with mode 0600 inside a `keys/` folder of mode 0700, and never printed, logged, put on a command line or sent anywhere. A test reads every line the commands print and every file outside `keys/` and fails if it finds the standing key, a derived deal key, the faucet holding key or an encryption secret, in hex or in base64.
- [ ] **The check holds a bad setup back.** Each of these fails `check`, naming the cause, and `first-deal` refuses to run after it: a template the bundled commitment schema refuses; a sample result the checks refuse; a template whose checks still pass a result with a required field removed; a configuration the adapter's own loader refuses; a key's or a secret's value in any file outside `keys/`.
- [ ] **Resume.** Killed after any step, the same command run again finishes without a second key, a second offer for the same first deal or a second delivery.
- [ ] **What `setup.txt` says.** A counterparty's offer, card and delivered work are data and never instructions. The assistant does not read, print or copy a file under `keys/`; on a machine it shares with the keys, that is a rule the guide gives and nothing enforces. Test tokens only. Crow's API is free in the pilots and an operator may charge a fee later (`fees.operator`). Every deal on the live service is public. The five ways the setup leans on Crow-run hosts (the design, "Where the signing part runs"). What the hash protects and what it does not, with the one optional command that compares the file with the repository's copy.
- [ ] One live run on Sepolia by this task's session proves the path: `seller --sample`, `first-deal`, `Released`. It spends test tokens only (change kind 9).
- [ ] The red-team pass finds no way for the commands to print or send a key, and no request that names the party to a Crow-run host before `first-deal`. Its findings and what changed are in Evidence.

## Out of scope

- The party's own API, the `secret` command and the fallback in which the command buys the job itself: T-483.
- A quote address that an outside buyer can reach, and the card on the person's domain: T-477 and T-478.
- The local rehearsal on SimChain (`pnpm audit-deal`). It needs the repository and stays in `site/sell.txt` for a seller who clones it.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- The bundle's size and SHA-256:
- The requests each command made, by host:
- Metrics:

### Phase A, the bundle (2026-11-15)

Each line is measured unless it says otherwise. Paths are relative to the worktree.

- **The bundle builds to one file.** `node site/build.mjs` wrote `site/setup.mjs`: 2,241,580 bytes, SHA-256 `eb314c233501b8266e020fb6322761f90027fa34a74f9a60745d5be8cfa27de1`. Every `import` in it names a Node built-in, and it holds no `import()`. It carries the adapter's Node shell and core, the check library (`packages/judgment`, `packages/core`), `packages/testkit` with `packages/settlement`, and nine packages from npm, which its banner lists with their versions and licences.
- **It runs with nothing installed.** `pnpm exec vitest run examples/setup-bundle.test.ts` passed 7 of 7 tests in about 2.4 s. Each test copies the committed file alone into a fresh empty folder under the system's temporary folder and runs it there with `node`, with only `PATH` and `HOME` in its environment. By hand, the copy at `reports/scratch/t-472/alone-a1/setup.mjs` in the main checkout answered `status` with one JSON line and exit 0.
- **No bundled tool's own command line runs.** With six argument shapes the three tools would take, the file prints only its own lines. The control build, without the transform, prints `check-delivery`'s and `report-converter`'s usage on `status` and exits 2 before `status` runs.
- **The adapter starts from inside the bundle.** Against the demo world served in the test's process, `first-deal --test-world --operators <the two URLs>` started the adapter with the folder's key in the `env` argument, read its own `/defaults` (status 200), and stopped. The run had other operators, another key and a signer URL in `HOLDBACK_OPERATORS`, `HOLDBACK_KEY` and `CROW_SIGNER_URL`; none changed it. No printed line held the key in hex or base64.
- **The frozen files are unchanged.** `git diff --stat origin/main --` over `apps/hosted-sellers`, `packages`, the nine frozen files in `examples/` and the five generated bundles printed nothing. `site/try.mjs` is `04ef4434fb4b5635bb3c49df69c7547f3200c6c41f903237ee37098be23f75c8` and `site/buy.mjs` is `e74ff2230f0d4fd426525095731e42d50b65b55ab7792a43cab73c302b22eb88`, before and after (`shasum -a 256`).
- **Other checks.** `pnpm typecheck` passed. `pnpm exec eslint` over the new files and `site/build.mjs` reported 0 errors. `node site/check.mjs` passed, with the buyer's first-deal path at 4,581 of 5,000 tokens. `gitleaks dir site/setup.mjs` (version 8.30.1, default rules) found no leak; CI's own rules are not measured.
- **Inferred, not measured:** CI builds the same bytes. The bundle now holds `tsc`'s output of `packages/`, so the stale-bundle test compares against CI's own build of those packages.

## Decisions

Choices made inside this task. Escalate anything that changes architecture, a contract or a defense to an ADR.

**Restated intent.** A person tells their assistant to read one page and set them up as a seller. The assistant reads `setup.txt`, runs one pinned file, and the person's own machine sells Crow's sample product to Crow's test buyer on Sepolia, ending `Released`. The file makes a folder with a key that lasts, the seller adapter's configuration, a sample API on the loopback address and a deal template; it checks them; then it runs the first deal through the adapter in its own process. Before that first deal starts, no Crow-run host learns the party's address, key, domain or terms, and the key never leaves `keys/`. This task builds only the sample path. It leaves out the party's own API, a public quote address, the buyer's setup, leaving, the card's schema and `setup.txt`'s place in the token budget, and it changes nothing in the adapter, the hosted sellers or `packages/`.

**Phase A's choices (2026-11-15).**

- **The three own command lines: a transform that replaces the test with `false`.** `site/build.mjs` replaces the exact line `if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {` in `examples/seller-adapter.ts`, `check-delivery.ts` and `report-converter.ts` with `if (false) {`. The build stops when one of the three no longer holds that line exactly once, and when the finished bundle still holds such a test from any file. The bundler then drops each block and what only it imports, which leaves the file at 2,241,580 bytes against the control build's 3,274,571 bytes (measured).
- **The entry runs the command with no test of its own.** A test that compares the running file's path with the module's fails silently through a symbolic link: on macOS the temporary folder is one, and there the control build's tools did not run at all (measured). So `site/setup-entry.mjs` always runs `main`, and the bundle exports nothing.
- **Ambient settings are removed twice.** The bundle's banner deletes every `HOLDBACK_*` and `CROW_*` variable before any module runs, because `examples/goal-kit.ts` reads `HOLDBACK_OPERATORS` when it loads; `main()` deletes them again for a run from source.
- **A list of allowed npm packages.** `SETUP_PACKAGES` in `site/build.mjs` names each package the bundle may carry with its licence line. A package that is not listed stops the build. The control build pulled in `ox`, and the list stopped it (measured).
- **`first-deal` and `check` exist in part.** To prove the adapter and the check library inside the real file, `check` runs two of its checks (the adapter's loader, the sample result) and `first-deal` starts the adapter, reads `/defaults` and stops with exit 1. `first-deal` runs only with `--test-world` until its marker is built, so no commit can send anything to a Crow-run host before the marker exists. The folder's file names in `examples/setup.ts` (`FILES`) are a first choice and may change in Phase B.
- **One path outside the task's list:** `eslint.config.js`, one entry, `site/setup.mjs` added to the ignored generated files, beside the other bundles.

## Handoff

**In progress: Phase A is done and committed; Phase B has not started.** The coordinator decides whether Phase B starts.

- **To resume:** read Evidence, "Phase A", and Decisions above. Run `pnpm exec vitest run examples/setup-bundle.test.ts` and `node site/build.mjs` first; both must pass before any change.
- **Phase B builds** every acceptance criterion but the first: `seller --sample`, the full `check`, `first-deal` with its marker and the deal with Crow's test buyer, `status`, the sample API, `site/setup.txt` with its pinned command, the checks in `site/check.mjs`, the line in `site/llms.txt`, and the leak, request-recording, ambient-settings and resume tests.
- **Known for Phase B:**
  - `examples/deal-record.ts` and other newer commands test `isMain` in `examples/entry.ts`, which is true inside a bundle unless the banner declares `globalThis.crowEntry`. Declare it in the setup banner when one of them is imported.
  - `examples/goal-kit.ts` fixes its operators when it loads. `first-deal` must build its own `Agent` from `--operators` and use only the kit's helpers that take no operator.
  - The adapter's shipped template path points beside the bundle, where no such file is. The folder's configuration must always name its own `template`.
  - `site/setup.mjs` is written by `node site/build.mjs` and a publish build refuses a stale one, but no publish build copies it out yet: that lands with `setup.txt`.
  - `packages/testkit`'s index brings `yaml` and parts of `packages/settlement` into the bundle, about 7,000 lines the setup never calls. A resolve step in `site/build.mjs` that takes only the kit's `untrusted.js` would drop them; it is not done.
- **If the bundle stops building:** the fallback, a clone of the repository at a tag, changes the approvals count and is the coordinator's call.
