# T-472: `setup.txt` and the setup command, a seller's first deal from its own machine

- **Lane:** demo (agent access: the guides in `site/` and the reference tools in `examples/`)
- **Phase:** 2
- **Depends on:** T-471 (the plan and its design, `docs/research/2026-11-15-setup-design.md`); pull request 578 (T-469), which adds self-contained pinned bundles and `examples/goal-kit.ts` and changes `site/build.mjs`, `site/check.mjs` and the top of `site/llms.txt`. Start from `main` after 578 merges.
- **Paths this task may touch:** new files only, plus the site's build lists: `site/setup.txt`, `site/setup-entry.mjs`, `site/setup.mjs` (generated), `examples/setup.ts`, `examples/setup-seller.ts`, `examples/setup-check.ts`, `examples/setup-sample-api.ts`, `examples/setup*.test.ts`, `site/build.mjs`, `site/check.mjs`, `site/guides.mjs`, one line in `site/llms.txt`, `tests/site-guides.test.ts`, this file. It imports `examples/seller-adapter.ts`, `examples/seller-adapter-core.ts`, `examples/seller-adapter-api.ts`, `examples/check-delivery.ts`, `examples/report-converter.ts`, `examples/deal-record.ts`, `examples/goal-kit.ts` and `packages/` and changes none of them.
- **Human gate:** yes, for one step only: the site deploy that publishes `setup.txt` and `setup.mjs` is Rafa's. The merge has no gate.
- **Status:** in progress
- **Agent/session:** an implementer sub-session started by the coordinator on 2026-11-15, on branch `t-472-setup-first-slice`. It worked in two phases: Phase A proved the bundle, Phase B built the rest. Both are committed and not pushed; the live run and the red-team pass are the coordinator's to order.
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

- [x] **The bundle is proved first.** `site/build.mjs` bundles the adapter's Node shell, the check library and the two libraries into one file that runs with nothing installed. The bundled tools' own command lines do not run when `setup.mjs` starts: three of them test whether the running file is their own (`examples/seller-adapter.ts`, `check-delivery.ts`, `report-converter.ts`), and a build transform handles that without changing those files. If either cannot be done, the task stops and says so in Handoff.
- [x] `site/setup.txt` exists, is filled and published by `site/build.mjs` like the other guides, and is at most 8,000 bytes; `site/check.mjs` fails above that. It carries one command line that downloads `setup.mjs` as a `.part` file, moves it into place only when its SHA-256 matches, and runs the first step. A test fails on a stale bundle, a stale hash or a stale command, as `examples/try.test.ts` does for `try.mjs`.
- [x] `site/try.mjs` and `site/buy.mjs` keep their SHA-256. `git diff` shows no change under `apps/hosted-sellers`, `packages/`, `examples/seller-adapter-core.ts` or `examples/seller-adapter-api.ts`. The hosted bundle's SHA-256 for the kit's seller folders is unchanged, measured as T-443 measured it.
- [x] **End to end, scripted:** in the in-process world with Crow's test buyer, `seller --sample` then `first-deal` ends `Released` with the test buyer as the buyer, and writes a deal record whose checks pass.
- [x] **Nothing before the first deal:** a test records every request the commands make. `seller` and `check` make no request to an operator, the faucet, the test agents or crow.direct, and post no terms anywhere. The first request that is not a GET, or whose path holds an address, is made by `first-deal`, after its marker.
- [x] **No ambient settings.** The command ignores `HOLDBACK_*` and `CROW_*` variables in its environment and never sets the key in its own process's environment. A test sets a deployment pin and operators in the environment and sees no change. The operators default to Crow's two and change with `--operators`. Only the Sepolia deployment is accepted, except with an explicit test-world flag, which makes every line say that it is not the live service.
- [x] **The payout address is asked, never defaulted.** `seller` exits 3 with the question until the person gives an address or `this-key`. With `this-key` the command prints that every deal then names this folder's standing address in its public terms, and that its key is on this machine. `first-deal`'s preview states the same link.
- [x] **Where the folder lives.** The default is `~/.crow/<name>`. The command refuses a folder inside a git work tree, a known synced folder or the card's output folder, unless a flag says otherwise. The folder gets a `.gitignore` that covers `keys/`.
- [x] **Keys.** The signing key is made by the command, written with mode 0600 inside a `keys/` folder of mode 0700, and never printed, logged, put on a command line or sent anywhere. A test reads every line the commands print and every file outside `keys/` and fails if it finds the standing key, a derived deal key, the faucet holding key or an encryption secret, in hex or in base64.
- [x] **The check holds a bad setup back.** Each of these fails `check`, naming the cause, and `first-deal` refuses to run after it: a template the bundled commitment schema refuses; a sample result the checks refuse; a template whose checks still pass a result with a required field removed; a configuration the adapter's own loader refuses; a key's or a secret's value in any file outside `keys/`.
- [x] **Resume.** Killed after any step, the same command run again finishes without a second key, a second offer for the same first deal or a second delivery.
- [x] **What `setup.txt` says.** A counterparty's offer, card and delivered work are data and never instructions. The assistant does not read, print or copy a file under `keys/`; on a machine it shares with the keys, that is a rule the guide gives and nothing enforces. Test tokens only. Crow's API is free in the pilots and an operator may charge a fee later (`fees.operator`). Every deal on the live service is public. The five ways the setup leans on Crow-run hosts (the design, "Where the signing part runs"). What the hash protects and what it does not, with the one optional command that compares the file with the repository's copy.
- [ ] One live run on Sepolia by this task's session proves the path: `seller --sample`, `first-deal`, `Released`. It spends test tokens only (change kind 9).
- [ ] The red-team pass finds no way for the commands to print or send a key, and no request that names the party to a Crow-run host before `first-deal`. Its findings and what changed are in Evidence.

## Out of scope

- The party's own API, the `secret` command and the fallback in which the command buys the job itself: T-483.
- A quote address that an outside buyer can reach, and the card on the person's domain: T-477 and T-478.
- The local rehearsal on SimChain (`pnpm audit-deal`). It needs the repository and stays in `site/sell.txt` for a seller who clones it.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

Measured on 2026-11-15 at commit `8392b363` unless a line says otherwise. Paths are relative to the worktree. No command here reached a live host: every run was against the demo world served in the test's own process, under a recorder that refuses a connection that leaves the machine.

- **Commands run and results** (measured):
  - `pnpm exec vitest run examples/setup tests/site-guides.test.ts apps/test-agents/src/setup.test.ts`: 34 of 34 tests passed in about 8 s.
  - `node site/build.mjs`, then `git status`: no file changed, so the committed bundle is the build's output. `node site/check.mjs`: pass.
  - `pnpm typecheck`: pass. `pnpm exec eslint` over the four `examples/setup*.ts` sources, the two test files, `site/setup-entry.mjs`, `site/build.mjs`, `site/check.mjs`, `site/guides.mjs` and `tests/site-guides.test.ts`: 0 errors.
  - 40 test files that read the guides, the site build or the bundles (`tests/record-copies.test.ts`, `tests/site-deploy.test.ts`, `tests/site-headers.test.ts`, `tests/guide-budget.test.ts`, `tests/metrics`, `tools/duet/duet.test.ts`, `examples/try.test.ts`, `apps/test-agents/src` and others): 659 tests passed, 17 skipped. The whole suite and `pnpm verify` were not run.
  - A publish build into `reports/scratch/t-472/site-out` wrote `setup.txt` (6,899 bytes with the command filled) and `setup.mjs` with the committed file's SHA-256.
  - `gitleaks dir` (8.30.1, default rules) on `site/setup.mjs` and on the new test files: no leak. CI's own rules are not measured.
- **The bundle's size and SHA-256** (measured): `site/setup.mjs`, 2,314,438 bytes, `54b17ff6b950f312edf0b99c7d1169617209c68ccfadced853781de62bef8a1a`. **Inferred until the pull request's CI run shows it:** CI builds the same bytes. The bundle holds `tsc`'s output of `packages/`, so the stale-bundle test compares against CI's own build of those packages.
- **The pinned files and the frozen paths** (measured): `site/try.mjs` is `04ef4434fb4b5635bb3c49df69c7547f3200c6c41f903237ee37098be23f75c8` and `site/buy.mjs` is `e74ff2230f0d4fd426525095731e42d50b65b55ab7792a43cab73c302b22eb88`, before the first change and after the last (`shasum -a 256`). `git diff --stat origin/main --` over `apps/hosted-sellers`, `packages`, the ten imported files in `examples/` and the five other generated bundles prints nothing. The hosted bundle's SHA-256 for the kit's two seller folders (`reports/scratch/own-agents/bundle-hash.ts`, run against this worktree) is `ab20eea9…ba6c67` and `301df04c…a59fd9`, the values T-443 and T-444 recorded.
- **The requests each command made, by host** (measured, `apps/test-agents/src/setup.test.ts` and `examples/setup-bundle.test.ts`):
  - `seller` and `check`: none to an operator or the test buyer. Their only connections went to the loopback address, to the command's own sample API. With no `--operators`, where the defaults are Crow's two hosts, they opened no connection off the machine.
  - `first-deal`: nothing before its marker. After it, to the operators: reads of discovery first, then 1 `POST /v1/faucet` (the deal's fresh key), 1 `POST /v1/commitments` (the offer), 1 `POST /v1/commitments/<id>/deliveries`, and reads. To the test buyer: a read of its card and 1 post of the commitment ID.
  - Run again after `Released`: no request.
- **Metrics** (measured): in the test world the first deal ends `Released` within the 8 s the three files take together. The deal's time on Sepolia is not measured: the live run is ordered separately.
- **One path outside the task's list in each phase, and why:**
  - `eslint.config.js`: one entry, `site/setup.mjs` among the ignored generated bundles, beside the other five.
  - `tests/cut-feature-alignment.known.json`: one entry, `site/setup.mjs`. The bundle carries `packages/core`, which still names the appeal types phase one cut, as the other five bundles are listed for.
  - `apps/test-agents/src/setup.test.ts`: the first deal's test lives beside the test buyer's code, as `try-goals.test.ts` does. `examples/` cannot import `apps/` under its `tsconfig.json`.

### The acceptance criteria, each with its check (2026-11-15, measured)

| Criterion | The test or check that shows it |
| --- | --- |
| The bundle is proved first | `examples/setup-bundle.test.ts`, "the bundle": one file, Node built-ins only, no tool's own command line with seven argument shapes (a `deal-record` shape among them), and a control build without the transform |
| `setup.txt`, its size and its command | `site/check.mjs` group 19 fails above 8,000 bytes, on a stale bundle, hash or command. `examples/setup-bundle.test.ts`, "setup.txt carries the one command", fails on the same in CI, which does not run `site/check.mjs` |
| The pinned hashes and the frozen paths | The lines above |
| End to end, scripted | `apps/test-agents/src/setup.test.ts`, first test: `Released`, the test buyer as the buyer, a deal record with no failed check and no disagreement |
| Nothing before the first deal | The same test: the operators and the test buyer record each request with whether the marker file was there; none came before it. A recorder in the command's process lists every connection |
| No ambient settings | Both files run with `HOLDBACK_OPERATORS`, `HOLDBACK_DEPLOYMENT` (not JSON), `HOLDBACK_CHAIN_ID`, `HOLDBACK_VERIFYING_CONTRACT`, `HOLDBACK_KEY` and `CROW_SIGNER_URL` set and see no change. Without `--test-world`, operators that serve chain 31337 are refused, with a deployment pin for that chain in the environment |
| The payout address is asked | "asks for the payout address": exit 3, one JSON object; `this-key` prints the link and where the key is; the preview repeats it |
| Where the folder lives | "the default folder is ~/.crow/<name>" and "refuses a folder inside a git work tree, a synced folder or the card's folder" |
| Keys | "makes the folder": modes 0700 and 0600. The leak test searches every printed line and every file outside `keys/` for the standing key, the deal's key and the faucet holding key, in hex and base64 |
| The check holds a bad setup back | "the check holds a bad setup back": six causes, each named, and `first-deal` refuses after each with no marker written |
| Resume | "resumes" in both files: no second key after a stop; killed after the test buyer took the offer, the next run makes no second offer, one faucet grant and one delivery |
| What `setup.txt` says | `site/check.mjs` group 19 holds a phrase of each statement and the five numbered ways |
| One live run on Sepolia | Not done: the coordinator orders it |
| The red-team pass | Not done: the coordinator orders it |

### Phase A, the bundle (2026-11-15)

Each line is measured unless it says otherwise. Paths are relative to the worktree. The size and hash here are Phase A's; the lines above hold the final ones.

- **The bundle builds to one file.** `node site/build.mjs` wrote `site/setup.mjs`: 2,241,580 bytes, SHA-256 `eb314c233501b8266e020fb6322761f90027fa34a74f9a60745d5be8cfa27de1`. Every `import` in it names a Node built-in, and it holds no `import()`. It carries the adapter's Node shell and core, the check library (`packages/judgment`, `packages/core`), `packages/testkit` with `packages/settlement`, and nine packages from npm, which its banner lists with their versions and licences.
- **It runs with nothing installed.** `pnpm exec vitest run examples/setup-bundle.test.ts` passed 7 of 7 tests in about 2.4 s. Each test copies the committed file alone into a fresh empty folder under the system's temporary folder and runs it there with `node`, with only `PATH` and `HOME` in its environment. By hand, the copy at `reports/scratch/t-472/alone-a1/setup.mjs` in the main checkout answered `status` with one JSON line and exit 0.
- **No bundled tool's own command line runs.** With six argument shapes the three tools would take, the file prints only its own lines. The control build, without the transform, prints `check-delivery`'s and `report-converter`'s usage on `status` and exits 2 before `status` runs.
- **The adapter starts from inside the bundle.** Against the demo world served in the test's process, `first-deal --test-world --operators <the two URLs>` started the adapter with the folder's key in the `env` argument, read its own `/defaults` (status 200), and stopped. The run had other operators, another key and a signer URL in `HOLDBACK_OPERATORS`, `HOLDBACK_KEY` and `CROW_SIGNER_URL`; none changed it. No printed line held the key in hex or base64.
- **The frozen files are unchanged.** `git diff --stat origin/main --` over `apps/hosted-sellers`, `packages`, the nine frozen files in `examples/` and the five generated bundles printed nothing. `site/try.mjs` is `04ef4434fb4b5635bb3c49df69c7547f3200c6c41f903237ee37098be23f75c8` and `site/buy.mjs` is `e74ff2230f0d4fd426525095731e42d50b65b55ab7792a43cab73c302b22eb88`, before and after (`shasum -a 256`).
- **Other checks.** `pnpm typecheck` passed. `pnpm exec eslint` over the new files and `site/build.mjs` reported 0 errors. `node site/check.mjs` passed, with the buyer's first-deal path at 4,581 of 5,000 tokens. `gitleaks dir site/setup.mjs` (version 8.30.1, default rules) found no leak; CI's own rules are not measured.
- **Inferred, not measured:** CI builds the same bytes. The bundle now holds `tsc`'s output of `packages/`, so the stale-bundle test compares against CI's own build of those packages.

## Decisions

Choices made inside this task. Escalate anything that changes architecture, a contract or a defense to an ADR.

**Restated intent** (written after Phase A's code, not before it as the brief asked)**.** A person tells their assistant to read one page and set them up as a seller. The assistant reads `setup.txt`, runs one pinned file, and the person's own machine sells Crow's sample product to Crow's test buyer on Sepolia, ending `Released`. The file makes a folder with a key that lasts, the seller adapter's configuration, a sample API on the loopback address and a deal template; it checks them; then it runs the first deal through the adapter in its own process. Before that first deal starts, no Crow-run host learns the party's address, key, domain or terms, and the key never leaves `keys/`. This task builds only the sample path. It leaves out the party's own API, a public quote address, the buyer's setup, leaving, the card's schema and `setup.txt`'s place in the token budget, and it changes nothing in the adapter, the hosted sellers or `packages/`.

**Phase A's choices (2026-11-15).**

- **The three own command lines: a transform that replaces the test with `false`.** `site/build.mjs` replaces the exact line `if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {` in `examples/seller-adapter.ts`, `check-delivery.ts` and `report-converter.ts` with `if (false) {`. The build stops when one of the three no longer holds that line exactly once, and when the finished bundle still holds such a test from any file. The bundler then drops each block and what only it imports, which leaves the file at 2,241,580 bytes against the control build's 3,274,571 bytes (measured).
- **The entry runs the command with no test of its own.** A test that compares the running file's path with the module's fails silently through a symbolic link: on macOS the temporary folder is one, and there the control build's tools did not run at all (measured). So `site/setup-entry.mjs` always runs `main`, and the bundle exports nothing.
- **Ambient settings are removed twice.** The bundle's banner deletes every `HOLDBACK_*` and `CROW_*` variable before any module runs, because `examples/goal-kit.ts` reads `HOLDBACK_OPERATORS` when it loads; `main()` deletes them again for a run from source.
- **A list of allowed npm packages.** `SETUP_PACKAGES` in `site/build.mjs` names each package the bundle may carry with its licence line. A package that is not listed stops the build. The control build pulled in `ox`, and the list stopped it (measured).
- **In Phase A, `first-deal` and `check` existed in part,** to prove the adapter and the check library inside the real file. Phase B replaced both.

**Phase B's choices (2026-11-15).**

- **The sample API keeps one port.** The first design gave it a new port each run. A deal continued by a second run then stopped: the adapter starts a job only at the address its offer was priced at (measured: `start-unknown`, "the start's configuration changed"). `seller` now takes a free port on the loopback address and writes it into `adapter.json`; a port another program holds stops `first-deal` with a line that names it.
- **`first-deal` runs the check itself** and refuses on a failure, so it never trusts an old result in `crow.json`.
- **The marker comes before discovery.** The task allows GET requests with no address before the marker. `first-deal` sends none: the preview, the marker file, the marker line, and only then the first read.
- **Only Sepolia without `--test-world`.** `first-deal` reads the EIP-712 domain from every operator and compares it with the pins in `examples/verify.ts`. Without the flag it takes the Sepolia pin only; with it, any pinned layer but Sepolia. `--test-world` needs `--operators`, and `first-deal` then needs `--buyer`, so a test world never reaches a Crow host by a default.
- **The schema check uses the testkit's loader.** `examples/` cannot import `packages/core`. `check` fills the template with the sample scope and stand-in values, and passes it as JSON to `parseTermsYaml` in `packages/testkit`, which builds a whole commitment and runs the bundled schema. So `yaml` in the bundle is now used.
- **One part of `packages/settlement` is left out, against the coordinator's word to leave the bundle as it was.** The bundle held a built copy of `accepted-tokens.json`, the Sepolia token's address, through `packages/testkit`'s index, in code the setup never calls. The cutover's copies step does not rewrite a build output, and `tests/record-copies.test.ts` failed on the old address in `site/setup.mjs` (measured). `site/build.mjs` now tells the bundler that the built files of `packages/settlement` run nothing when they load, so it leaves out the ones no code reaches. Nothing the setup calls changed. The other choice is to keep them and have the cutover build the packages before the site; the coordinator may overrule this one.
- **The role line in `llms.txt` was reworded, not only extended.** The plain-HTTP buyer's path had 8 bytes of room under its 9,450-token budget (measured: 37,792 of 37,800 bytes). The line now links `setup.txt` and says the same in fewer words; the path stands at 9,450 tokens.
- **`--allow-served` and the check.** When the card's folder holds the party's folder by the person's own flag, the check's search for a key's value leaves `keys/` out wherever it reaches it. Without that, the flag would always end in a failed check.
- **The card is a draft.** It names the party and the sample, with no address and no quote address. Its schema is T-474's.
- **A first deal that ended without a release is not offered again by itself.** `first-deal --again` makes a new offer.

## Handoff

**Built and committed on `t-472-setup-first-slice`; not pushed. Two criteria wait for the coordinator: the one live run on Sepolia, and the red-team pass.**

- **To resume:** run `pnpm install --frozen-lockfile` and `pnpm build`, then `pnpm exec vitest run examples/setup tests/site-guides.test.ts apps/test-agents/src/setup.test.ts` and `node site/build.mjs && node site/check.mjs`. All pass at `8392b363`. After any change to `examples/setup*.ts` or a file they import, run `node site/build.mjs` and commit `site/setup.mjs`: its SHA-256 is in the command `setup.txt` publishes.
- **The live run, when ordered:** `node site/setup.mjs seller --sample --payout <address or this-key>` and then `node site/setup.mjs first-deal`, from a folder outside any git work tree. It makes 1 faucet grant and 1 offer to Crow's test buyer, and waits up to 20 minutes. It was never run against a live host.
- **Not done, each for a later task or the coordinator:**
  - The live run and the red-team pass.
  - **The leak test does not search for the delivery's content key.** The adapter makes it in memory for each delivery and the test cannot name it. The seller's side has no encryption secret of its own: the adapter passes zeros.
  - **`--test-world` against operators that serve Sepolia** is refused in code and not tested: no local world serves that domain.
  - **The check's size row** (a result under the operators' size limit) from the design is not built; the task's criteria do not list it.
  - **`docs/team.md`'s row "A published script is the code CI ran"** names `site/try.mjs` only. A line for `site/setup.mjs` and its test belongs there; this task may not edit that file.
  - **`vitest.config.ts` holds measured run times per test file.** The two new files have no entry.
- **A follow-up, by the coordinator's word:** `packages/testkit`'s index still brings code the setup never calls into the bundle (`packages/testkit`'s scenario runner and parts of `yaml`). A resolve step for `@holdback/testkit` in `site/build.mjs` would cut it. It is a size cut only and was left out of this slice.
- **For T-483, the party's own API:** `examples/setup-check.ts` asks the sample API for one result; the design asks for 3 real results. `first-deal` refuses a configuration whose API is not the sample on the loopback address.
- **If the bundle stops building:** the fallback, a clone of the repository at a tag, changes the approvals count and is the coordinator's call.
