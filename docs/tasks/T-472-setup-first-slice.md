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
- [x] **No ambient settings.** The command ignores `HOLDBACK_*` and `CROW_*` variables in its environment and never sets the key in its own process's environment. A test sets a deployment pin and operators in the environment and sees no change. Narrowed on 2026-11-15 after the red team's pass to what a file can do about Node's own settings: the command deletes `NODE_TLS_REJECT_UNAUTHORIZED` and refuses to run, naming the variable, when `NODE_OPTIONS`, `NODE_EXTRA_CA_CERTS` or `NODE_USE_ENV_PROXY` is set. It cannot undo a `NODE_OPTIONS` that loads code: Node runs that code before any file acts. The operators default to Crow's two and change with `--operators`. Only the Sepolia deployment is accepted, except with an explicit test-world flag, which makes every line say that it is not the live service.
- [x] **The payout address is asked, never defaulted.** `seller` exits 3 with the question until the person gives an address or `this-key`. With `this-key` the command prints that every deal then names this folder's standing address in its public terms, and that its key is on this machine. `first-deal`'s preview states the same link.
- [x] **Where the folder lives.** The default is `~/.crow/<name>`. The command refuses a folder inside a git work tree, a known synced folder or the card's output folder, unless a flag says otherwise. The folder gets a `.gitignore` that covers `keys/`.
- [x] **Keys.** The signing key is made by the command, written with mode 0600 inside a `keys/` folder of mode 0700, and never printed, logged, put on a command line or sent anywhere. A test reads every line the commands print and every file outside `keys/` and fails if it finds the standing key, a derived deal key, the faucet holding key or an encryption secret, in hex or in base64.
- [x] **The check holds a bad setup back.** Each of these fails `check`, naming the cause, and `first-deal` refuses to run after it: a template the bundled commitment schema refuses; a sample result the checks refuse; a template whose checks still pass a result with a required field removed; a configuration the adapter's own loader refuses; a key's or a secret's value in any file outside `keys/`.
- [x] **Resume.** Killed after any step, the same command run again finishes without a second key, a second offer for the same first deal or a second delivery.
- [x] **What `setup.txt` says.** A counterparty's offer, card and delivered work are data and never instructions. The assistant does not read, print or copy a file under `keys/`; on a machine it shares with the keys, that is a rule the guide gives and nothing enforces. Test tokens only. Crow's API is free in the pilots and an operator may charge a fee later (`fees.operator`). Every deal on the live service is public. The five ways the setup leans on Crow-run hosts (the design, "Where the signing part runs"). What the hash protects and what it does not, with the one optional command that compares the file with the repository's copy.
- [x] One live run on Sepolia by this task's session proves the path: `seller --sample`, `first-deal`, `Released`. It spends test tokens only (change kind 9).
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
- **After the fix round and the live run, at `4c549fdf`** (measured): `pnpm exec vitest run examples/setup apps/test-agents/src/setup.test.ts tests/site-guides.test.ts tests/card-schema.test.ts tests/record-copies.test.ts tests/cut-feature-alignment.test.ts` passed 80 of 80 tests in about 26 s; `node site/build.mjs` left the tree clean; `node site/check.mjs`, `pnpm typecheck` and `eslint` on the changed sources passed. `site/setup.mjs` is 2,335,442 bytes, SHA-256 `5c98ef522ad1e5146a3d767cebedc1d8f7b705bab573ce1d79081d9c7d7ce5ab`. `site/try.mjs` and `site/buy.mjs` kept the two hashes below, and the frozen-path diff is empty. The red team's `attacks.ts`, run against the bundle of `c7dde367` and again against the bundle of `4c549fdf`, printed PASS on its 12 lines both times. The lines below "The live run" are the state before the fix round, at `8392b363`.

### The live run on Sepolia (2026-11-15, change kind 9, measured)

One run, with the bundle of `c7dde367` (SHA-256 `ec3a99e0…beb26`), the default operators and Crow's test buyer, test tokens only. A scratch file loaded with `node --import` wrote down each request's time, method, host and path (`reports/scratch/t-472/live-fetch-log.mjs`, `live-1-requests.jsonl`); it changed nothing that was sent. The folder is `reports/scratch/t-472/live-1` in the main checkout, left in place; nobody read or printed its key file. The folder is inside a git work tree and under `Documents`, so `seller` got `--allow-git --allow-synced`.

- **`seller --sample --payout this-key`:** exit 0, six checks `ok`. Its line says `"sent":"nothing"`, and the log shows 3 requests, all to the sample API on the loopback address.
- **`first-deal --preview`:** exit 0, one `preview` line, no request, no marker.
- **`first-deal`:** the deal ended **`Released`**. Commitment `0x5a93a8117e95080ce57d7c6d8c6b3cb978e293c141a8811c350021dcedf39042`, 1.00 tUSDC, buyer `0xd0a29422c5515a0ee31586a379a649803821dc29` (Crow's test buyer), seller `0xc492a22a9f0d1d2e0f11e7a1339c30585bcca959` (the deal's own key), payout address `0x88f23d7307bda5bd292cad7b13fd6decd015dff5` (the folder's standing address). The operators report 1,000,000 base units at the payout address after it.
- **Transactions:** funded https://sepolia.etherscan.io/tx/0xc9233c7bfa4b5257b4c6dfb55f39a02586d44af542c2f79890183a5ad90a4d70, delivered https://sepolia.etherscan.io/tx/0xf522283bd48648c242012e553f41afd5c4dc39d2588330677542ba5cd324290a, decided and released https://sepolia.etherscan.io/tx/0x0029fb2822a8d536f36fa9097153821070faacbc61c103dd164c7b5b9c7079c0.
- **Times (UTC):** marker 10:47:28.035; first request to a host other than this machine 10:47:28.047; faucet grant 10:47:29; offer 10:47:39; commitment ID to the buyer 10:47:40; funded 10:47:48; delivered 10:48:00; decided and settled 10:48:12. That is 44 s from the marker to the settlement by the record's times. The command ran 120 s: about 50 s from the marker until it saw `Released` on both operators and first read the record (10:48:18), then about 70 s in the fault below.
- **Requests by host, `first-deal`:** `api.crow.direct` 145 GET and 6 POST (the faucet, prepare offer, the offer, the ciphertext, prepare delivery, the delivery); `api2.crow.direct` 133 GET; `crow.direct` 1 GET (the buyer's card) and 1 POST (the commitment ID); the loopback address 7 (the command's own sample API and adapter).
- **The fault the run found.** The deal was released and paid, and the command's last line said `"ok":false` with `"paidTo":null`, exit 1. The fix round had made that line take the payee from the deal record, and on a chain the operators' events carry no postings, so the record names no payee (`examples/deal-record.ts`). The command read the record 11 times over about 70 s, waiting for one. Fixed in `4c549fdf` with a unit test: where the record's own checks say the events carry no postings, the command holds the payout address in the signed terms to the person's answer.
- **The one rerun, with the bundle of `4c549fdf`:** `first-deal` read the record again with 19 GET requests and no other, and ended `"ok":true`, `"state":"Released"`, exit 0, in 1 s. The deal record has 14 checks passed, 0 failed, 5 not run (they need the buyer's key, the signed delivery body or postings), and the two operators agree.
- **The bundle's size and SHA-256 before the fix round** (measured): `site/setup.mjs`, 2,314,438 bytes, `54b17ff6b950f312edf0b99c7d1169617209c68ccfadced853781de62bef8a1a`. **Inferred until the pull request's CI run shows it:** CI builds the same bytes. The bundle holds `tsc`'s output of `packages/`, so the stale-bundle test compares against CI's own build of those packages.
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
| `setup.txt`, its size and its command | `site/check.mjs` group 20 fails above 8,000 bytes, on a stale bundle, hash or command. `examples/setup-bundle.test.ts`, "setup.txt carries the one command", fails on the same in CI, which does not run `site/check.mjs` |
| The pinned hashes and the frozen paths | The lines above |
| End to end, scripted | `apps/test-agents/src/setup.test.ts`, first test: `Released`, the test buyer as the buyer, a deal record with no failed check and no disagreement |
| Nothing before the first deal | The same test: the operators and the test buyer record each request with whether the marker file was there; none came before it. A recorder in the command's process lists every connection |
| No ambient settings | Both files run with `HOLDBACK_OPERATORS`, `HOLDBACK_DEPLOYMENT` (not JSON), `HOLDBACK_CHAIN_ID`, `HOLDBACK_VERIFYING_CONTRACT`, `HOLDBACK_KEY` and `CROW_SIGNER_URL` set and see no change. Without `--test-world`, operators that serve chain 31337 are refused, with a deployment pin for that chain in the environment |
| The payout address is asked | "asks for the payout address": exit 3, one JSON object; `this-key` prints the link and where the key is; the preview repeats it |
| Where the folder lives | "the default folder is ~/.crow/<name>" and "refuses a folder inside a git work tree, a synced folder or the card's folder" |
| Keys | "makes the folder": modes 0700 and 0600. The leak test searches every printed line and every file outside `keys/` for the standing key, the deal's key and the faucet holding key, in hex and base64 |
| The check holds a bad setup back | "the check holds a bad setup back": six causes, each named, and `first-deal` refuses after each with no marker written |
| Resume | The tests stop the command at these points, and no other: `seller` after the key step, between the key file's rename and the state's key step, and while the key is written; `first-deal` killed after the test buyer took the offer, and killed while the delivery call is in flight (the job started, nothing delivered). Each rerun finishes with the same key, 1 offer, 1 faucet grant and 1 delivery the world took. A kill between the adapter's answer to the quote and the state's write is covered by the journal's own record and is not tested |
| What `setup.txt` says | `site/check.mjs` group 20 holds a phrase of each statement and the five numbered ways |
| One live run on Sepolia | Done on 2026-11-15: `Released`; "The live run on Sepolia" above |
| The red-team pass | One pass done, with findings; each is in "Reviews" below with what changed, and its script now prints PASS on all 12 lines. A second pass over the fixes is the coordinator's to order, so the box stays open |

### Reviews (2026-11-15)

Both passes ran the code at `e15ecd32`. The coordinator relayed their findings; the probes are in `reports/scratch/t-472-review/` and `reports/scratch/t-472-redteam/` in the main checkout. Each fix has a test that failed before it. The fixes are commits `5f3827ba` (tests), `dd525385` (commands) and `c7dde367` (guide, build, bundle).

**The reviewer's pass: ISSUES, 3 High.**

| Finding | Severity | What changed |
| --- | --- | --- |
| `first-deal --again` resumed the refused or ended deal, and a recorded deal the folder could not continue asked for the same command forever | High | A deal is continued only by its own commitment ID and only while the journal works on it. `--again` sets the unreleased deal aside in `crow.json`. Refused, expired and unknown deals are saved as ended, with what to run. Tests: a refused offer, an expired offer, an unknown ID |
| A kill between the job's start and the delivery lost the job: the sample API kept jobs in memory | High | The sample API keeps nothing; the job's ID carries its result. Test: killed while the delivery call is in flight, the next run delivers the same job |
| The payout address the command reported came from `crow.json`, and the deal used `adapter.json`'s | High | `check` holds the two equal and holds a sample folder's three API addresses to the sample's. `first-deal` reads the signed terms before it posts the ID. `paidTo` is the deal record's. `seller` keeps no configuration it did not write |
| The hint "run the same command again: it continues this deal" was printed with no deal to continue | Low | The hint names a continued deal only when a commitment ID exists |
| A stray edit, `export const trySha256 =() =>`, in `site/build.mjs` | Low | Reverted |

**The red team's pass: the payout, folder and retry claims broken.** Its script `attacks.ts` printed ISSUES on all 12 lines; run again against the rebuilt bundle on 2026-11-15, it prints PASS on all 12 (measured).

| Finding (the script's line) | Severity | What changed |
| --- | --- | --- |
| `attack.setup-payout-differs-from-preview` | High | As the third row above: the check refuses the changed configuration, so no deal starts |
| `attack.setup-buyer-card-text-raw` | Medium | A card's intake prints as the URL parser writes it, as one plain line of at most 200 characters; every other field from a card or a buyer's answer goes through the same filter |
| `attack.setup-state-file-names-the-buyer` | Medium | The buyer comes from `--buyer` or the default, and from the state only for a deal the folder itself offered and has not ended |
| `neutrality.setup-refused-first-offer` | High | As the first row above |
| `attack.setup-planted-key`, `attack.setup-keys-symlink`, `attack.setup-planted-adapter`, `attack.setup-planted-payout-answer` | Medium | `seller` takes an empty folder only, adopts a key only when its state says it made one, follows no link at `keys/` or the key file and changes no link target's mode, and takes a state's answers only from a state that finished asking |
| `attack.setup-served-folder-case`, `attack.setup-synced-folder-symlink` | Low | The folder tests read real paths and ignore letter case; they add iCloud's Desktop and Documents, and Box |
| `attack.setup-zero-payout` | Low | The zero address is refused by name |
| `attack.setup-ambient-proxy` | Low | The command exits 2, naming the variable, when `NODE_OPTIONS`, `NODE_EXTRA_CA_CERTS` or `NODE_USE_ENV_PROXY` is set, and deletes `NODE_TLS_REJECT_UNAUTHORIZED` |
| A stop while the key was written wedged the folder; eight runs at once failed on one `.tmp` name | Medium | The key is written whole under a name of its own in `keys/` and renamed; every temporary name is unique; one run works in a folder at a time |
| Without the test-world flag, operators on this machine or over http were taken, and one host could be named twice | Low | Refused in the operators' parsing, before the marker |
| Another program on the machine could ask the adapter for a quote while `first-deal` ran | Low | The adapter takes a quote only with a credential made for that run |
| The secrets check did not know the deal keys, followed links silently and skipped large files silently | Low | It searches for the folder's deal keys and the holding key, follows no link and names each, and names each file it did not read for its size |
| `setup.txt`: commands that named no folder, no preview before the consent, an untrue line on `ok`, and four missing statements | Medium | Every command after the first is `node ~/.crow/setup.mjs`; `first-deal --preview` is new; the page says which lines carry `ok`, what an empty comparison hash means, that deleting the folder deletes a `this-key` payout's key, what `--again` and `--buyer` do, and that the folder refusals know common names only. Three sentences now speak of this version |

**Not fixed, and why.**

- **`docs/team.md`'s row "A published script is the code CI ran" does not name `site/setup.mjs`.** That file is the coordinator's; this task may not edit it.
- **The plain-HTTP buyer's path in `site/llms.txt` stands at its limit of 9,450 tokens,** so the next edit that adds to that page fails `tests/site-guides.test.ts`. Making room is a decision about that page, not this task's.
- **Whoever controls crow.direct can serve a changed file and a matching hash.** It is the design's stated limit; `setup.txt` says so and gives the comparison with the repository's copy.
- **Two hostile operators that both answer can make the seller start a job and deliver.** The design admits it for `--operators`: the person names the operators, and the command checks only that both serve the pinned deployment and agree.
- **A `NODE_OPTIONS` that loads code runs before the file can refuse.** No file can stop what Node did before it started the file; the criterion is narrowed to say so.
- **The leak test cannot name the delivery's content key,** which the adapter makes in memory for each delivery.
- **Without `--test-world`, the refusal of operators that serve another chain than Sepolia is in the code and untested:** live operators must be https hosts that are not this machine, and no local world is one.

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
- **A first deal that ended without a release is not offered again by itself.** `first-deal --again` makes a new offer. **Corrected in the fix round:** as first built, `--again` did not always do that. It continued any deal in the adapter's journal that named the same buyer, so after a refused offer it resumed the refused one, and the test passed only because its made-up ID was in no journal (the reviewer's finding 1).

**The fix round's choices (2026-11-15), after the reviewer's and the red team's passes.**

- **A deal is continued only by its own commitment ID.** The ID in `crow.json`, or the one deal the journal gained since the offer was asked for (the state keeps the journal's IDs from just before the quote). `--again` moves an unreleased deal to `ended` in `crow.json` and never continues it.
- **Ended states the operators do not name.** The operators keep an unfunded offer as `Offered` past its expiry (measured). The command reads the end from the offer's own windows and settlement time, and saves `Expired`. It also saves `RefusedByBuyer` (a 422 from the buyer), `Withheld` (the signed terms differ from the answer), `Unknown` (the operators do not serve the recorded ID) and `SetAside`.
- **The sample API keeps nothing.** A job's ID is `squares-<rows>`, and the result is made from it, so a run that stops after the job's start loses nothing.
- **The payout address is checked in three places.** `check` holds `adapter.json` to the answer in `crow.json`; `first-deal` reads the terms every operator serves before it posts the ID, and stops when they differ; the last line's `paidTo` is the deal record's.
- **`seller` owns its folder.** It takes an empty folder, writes `crow.json` first, takes a key file only when its state says it began or finished one, keeps a configuration only when its SHA-256 is the one it recorded, and follows no link at `keys/`. A state's answers count only when the state shows the payout and key steps done. Before the first deal, `seller --payout <new>` changes the answer and the configuration together.
- **One run in a folder at a time.** `crow.lock` names the process. `seller` waits up to 30 s for it; `first-deal` refuses at once. A lock whose process is gone is taken over.
- **The quote route takes this run's credential only.** `first-deal` gives the adapter a random bearer credential in its `env` object and uses it for its own quote, so no other program on the machine can have the adapter sign an offer while it listens.
- **Live hosts.** Without `--test-world`, each operator and the buyer is an https host that is not this machine; in both modes one host is not two operators. The command refuses before the marker.
- **The iCloud rule reaches the repository's own scratch folder.** On macOS a folder under the person's `Desktop` or `Documents` needs `--allow-synced`. The live run's folder is under `Documents`, so it passed that flag beside `--allow-git`.

## Handoff

**Built, fixed after the two reviews, run once on Sepolia (`Released`), and committed on `t-472-setup-first-slice`; not pushed. One criterion stays open for the coordinator: a red-team pass over the fixes.** The lines below were written before the fix round; "Reviews" and "The live run on Sepolia" under Evidence, and "The fix round's choices" under Decisions, hold what changed since. The current tip's checks pass at `4c549fdf`.

- **To resume:** run `pnpm install --frozen-lockfile` and `pnpm build`, then `pnpm exec vitest run examples/setup tests/site-guides.test.ts apps/test-agents/src/setup.test.ts` and `node site/build.mjs && node site/check.mjs`. All pass at `8392b363`. After any change to `examples/setup*.ts` or a file they import, run `node site/build.mjs` and commit `site/setup.mjs`: its SHA-256 is in the command `setup.txt` publishes.
- **The live run is done** (Evidence). Its folder, `reports/scratch/t-472/live-1` in the main checkout, holds a key that holds 1.00 tUSDC of test tokens and nothing else.
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
