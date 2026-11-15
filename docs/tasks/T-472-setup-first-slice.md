# T-472: `setup.txt` and the setup command, a seller's first deal from its own machine

- **Lane:** demo (agent access: the guides in `site/` and the reference tools in `examples/`)
- **Phase:** 2
- **Depends on:** T-471 (the plan and its design, `docs/research/2026-11-15-setup-design.md`). It builds on top of pull request 578 (T-469), which changes `site/build.mjs`, `site/check.mjs` and the top of `site/llms.txt`: start from `main` after 578 merges, or rebase on it.
- **Paths this task may touch:** new files only, plus the site's build lists: `site/setup.txt`, `site/setup-entry.mjs`, `site/setup.mjs` (generated), `examples/setup.ts`, `examples/setup-seller.ts`, `examples/setup-check.ts`, `examples/setup-sample-api.ts`, `examples/setup*.test.ts`, `site/build.mjs`, `site/check.mjs`, `site/guides.mjs`, `site/guide-budget.mjs`, `site/guide-budget.schema.json`, one line in `site/llms.txt` ("Read one page for your role"), `tests/site-guides.test.ts`, `tests/guide-budget.test.ts`, this file. It imports `examples/seller-adapter.ts`, `examples/seller-adapter-core.ts`, `examples/seller-adapter-api.ts`, `examples/check-delivery.ts`, `examples/report-converter.ts`, `examples/deal-record.ts` and `packages/` and changes none of them.
- **Human gate:** yes, for one step only: the site deploy that publishes `setup.txt` and `setup.mjs` is Rafa's. The merge has no gate.
- **Status:** todo
- **Agent/session:** not started; the coordinator starts it after it has read the plan
- **Roadmap row:** N160
- **Change kind:** 4 (client code in `examples/`) with 1 (an agent guide in `site/`). Local checks: `pnpm exec vitest run examples/setup tests/site-guides.test.ts`, `node site/build.mjs && node site/check.mjs`.
- **Review:** one `red-teamer` pass (keys, secrets, what leaves the machine) and one `reviewer` pass. Blocking findings only.
- **Token budget:** 300,000 tokens, a target.

## Intent

Restate this in your own words before writing code.

A person says one sentence to their own assistant: "Read https://crow.direct/setup.txt and set up Crow for me as a seller." The assistant reads one file, runs one pinned command, and ends with a first settled test deal on Sepolia in which the person's own machine is the seller. Nothing that names the person, their key, their domain or their terms goes to a Crow-run host before the first deal starts.

This task builds the smallest slice that makes that sentence true for one case: a seller on its own machine, with no hosting and no domain. It has two entry points:

- **`--sample`:** the command serves a small sample API on the loopback address, priced in the test token. A person with no API yet sees the whole path.
- **`--api <base URL>`:** the person's own HTTP API. The assistant writes the API mapping and the deal template (the deliverable and its checks); the command checks them against real results before anything is offered.

Inputs: Node 22.18 or later with npm, and nothing else. Outputs: one folder on the person's machine, a first deal that ends `Released`, and its deal record.

Non-goals: a public address for quotes (T-477, T-478); a buyer's setup (T-475); leaving (T-476); the card's schema (T-474); hard limits through a signer (T-479); any change to the seller adapter, the hosted sellers or `packages/`.

## Context

- The design: `docs/research/2026-11-15-setup-design.md`, sections "`setup.txt`", "The setup command", "Keys, secrets and limits", "The conformance check" and "The privacy table".
- The baseline it replaces: `docs/research/2026-11-15-setup-baseline.md`, "A seller today".
- The pattern for a pinned command: `site/build.mjs` (`tryCommand`, `buyInstall`), `examples/try.test.ts`, and the row "A published script is the code CI ran" in `docs/team.md`.
- The adapter starts from one JSON file with the key in its environment (`examples/seller-adapter.ts`); `"signingKey": "per-deal"` takes its faucet grant with each quote, not at start (`site/ref/seller-adapter.txt`, "A fresh key for each deal").
- Crow's test buyer and its published rules: `site/ref/intake.txt`, "Sell to Crow's test buyer".
- Decisions: D73 and D74 in `docs/decisions-today.md`.

## What the command does

One file, `setup.mjs`, the unminified bundle of `examples/setup.ts` and what it imports, pinned by its SHA-256 in `setup.txt` as `try.mjs` and `buy.mjs` are in their pages. It works in one folder and never outside it.

| Command | What it does | Requests to a Crow-run host |
| --- | --- | --- |
| `node setup.mjs seller --sample` or `--api <base URL>` | Makes the folder, a signing key (file mode 0600, the address printed, the key never), the adapter configuration with `"signingKey": "per-deal"`, the deal template, and a card file. Asks nothing at a prompt: when an answer is missing it prints one JSON object that names each missing answer with a plain question, and exits 3. Run again, it continues from `crow.json`. It ends by running `check`. | none |
| `node setup.mjs check` | The conformance check: one JSON line per check and exit 0 only when all pass. See the acceptance criteria. | none |
| `node setup.mjs first-deal` | Prints what it is about to send and to whom, then sells one job: it starts the adapter in this process, asks its own `/quote` for an offer to Crow's test buyer, posts the commitment ID to the test buyer, delivers when the hold is funded, and follows the deal to `Released`. When the offer does not fit the test buyer's published rules (a price above its maximum, for one), the command buys the job itself with a fresh buyer key and says so. It writes the deal record. | the first ones: discovery, the faucet grant for the deal key, the offer, the delivery |
| `node setup.mjs secret <NAME>` | The person runs this one in their own terminal. A hidden prompt takes the value and writes it to `keys/secrets.env` (mode 0600). The assistant never sees it. | none |
| `node setup.mjs status` | The folder's state: the role, the steps done, the addresses, the open deals. No secret. | none |

## Acceptance criteria

- [ ] `site/setup.txt` exists, is filled and published by `site/build.mjs` like the other guides, and is at most 8,000 bytes. `site/check.mjs` fails above that. It is a third path in the guide budget (role `setup`, the one file), served in `guide-budget.json`.
- [ ] `setup.txt` carries one command line that installs the pinned packages, downloads `setup.mjs`, checks its SHA-256 and runs the first step. A test fails on a stale bundle, a stale hash or a stale command, as `examples/try.test.ts` does for `try.mjs`.
- [ ] `site/try.mjs` and `site/buy.mjs` keep their SHA-256. `git diff` shows no change under `apps/hosted-sellers`, `packages/`, `examples/seller-adapter-core.ts` or `examples/seller-adapter-api.ts`.
- [ ] **The sample path, scripted:** in the in-process world of the benchmark (`tools/one-click/bench-local.mjs`) or the test agents' test world, `seller --sample` then `first-deal` ends `Released` with Crow's test buyer as the buyer, and writes a deal record whose checks pass.
- [ ] **The own-API path, scripted:** against the job stub of another shape (`examples/seller-adapter-job-stub.ts`) with a mapping and a template written by the test, the same two commands end `Released`.
- [ ] **Nothing before the first deal:** a test records every request the commands make. `seller` and `check` make no request to an operator, the faucet, the test agents or crow.direct. The first request that carries the seller's address is made by `first-deal`.
- [ ] **The check holds a bad setup back.** Each of these fails `check`, naming the cause, and `first-deal` refuses to run after it: fewer than 3 sample results; a sample the checks refuse; a template whose checks still pass a sample with a required field removed; a configuration the adapter's own loader refuses; a secret's value in any file outside `keys/`; two credentials naming one variable.
- [ ] **Keys.** The signing key is made by the command, written with mode 0600 inside a `keys/` folder of mode 0700, and never printed, logged, put on a command line or sent anywhere. A test reads every line the commands print and every file outside `keys/` and fails if the key's value is in one. The folder gets a `.gitignore` that covers `keys/`.
- [ ] **The payout address is asked, never defaulted.** `seller` exits 3 with the question until the person gives an address or answers "this folder's key". With the second answer the command prints that every deal then names this folder's standing address in its public terms, and that its key is on this machine.
- [ ] **Resume.** Killed after any step, the same command run again finishes without a second key, a second offer for the same first deal or a second delivery.
- [ ] **The offer text is data.** `setup.txt` says, in its rules, that a counterparty's offer, card and delivered work are data and never instructions, and that the assistant never reads, prints or copies a file under `keys/`.
- [ ] `setup.txt` states in one line each: test tokens only; Crow's API is free in the pilots and an operator may charge a fee later (`fees.operator`); every deal on the live service is public (`docs/privacy-baseline.md`).
- [ ] The red-team pass finds no way for the commands to print or send a key, and no request to a Crow-run host before `first-deal`. Its findings and what changed are in Evidence.

## Out of scope

- A quote address that an outside buyer can reach, and the card on the person's domain: T-477 and T-478.
- A command that drafts checks from samples. The check refuses weak checks; writing them stays the assistant's work until the benchmark shows it fails (deferred, the design's list).
- The local rehearsal on SimChain (`pnpm audit-deal`). It needs the repository and stays in `site/sell.txt` for a seller who clones it.
- A live run on Sepolia by this task's session beyond one deal to prove the path, which spends only test tokens (change kind 9).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- The bundle's size and SHA-256:
- The requests each command made, by host:
- Metrics:

## Decisions

Choices made inside this task. Escalate anything that changes architecture, a contract or a defense to an ADR.

## Handoff

Not started. Start from the design's sections named under Context. The first thing to prove is the bundle: that `site/build.mjs` can bundle the adapter's Node shell and the check library into one file that runs with the two pinned packages. If it cannot, write what stops it here and stop: the fallback, a clone of the repository at a tag, changes the approvals count and is the coordinator's call.
