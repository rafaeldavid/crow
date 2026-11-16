# T-491: a preflight command and a first-deal report in the guides

- **Lane:** agent access (the agent guides in `site/`, a new command in `examples/`)
- **Phase:** 2
- **Depends on:** T-469 (the one-command goal files and their bundling), T-032 (the operators' report route, `POST /v1/feedback`)
- **Paths this task may touch:**
  - The command: `examples/preflight.ts` (new), `examples/preflight.test.ts` (new), `site/preflight.mjs` (new, generated).
  - The build and its check: `site/build.mjs`, `site/check.mjs`, `eslint.config.js` (its ignores), and `tests/site-guides.test.ts` only where an expectation names a changed line.
  - The guides: `site/llms.txt`, `site/buy.txt`, `site/sell.txt`, `site/setup.txt`, `site/ref/limits.txt`.
  - This file.
  - It changes no pinned bundle (`site/try.mjs`, `site/buy.mjs`, `site/setup.mjs` and the three goal files keep their SHA-256), nothing under `apps/`, `packages/`, `contracts/` or `spec/schemas/`.
- **Human gate:** yes, for the site deploy, which is Rafa's. Reports reach anyone only after a second gate, also Rafa's: a `FEEDBACK` KV namespace bound on operator 1 and an operator deploy (`docs/operations.md`, "Feedback triage"). The merge has no gate.
- **Status:** review
- **Agent/session:** the expo/exact review session, 2026-11-16, on Rafa's word ("Let's do" lessons 1 and 2), branch `t-491-preflight-report`.
- **Roadmap row:** N164
- **Change kind:** 1 (copy and agent docs), with a new read-only command in `examples/`. One `reviewer` pass on the command, since it reads the shell's environment.

## Intent

Restated in my own words.

An outside agent's first deal today meets its faults one at a time, mid-deal: the faucet refuses at the approve step, a stray `HOLDBACK_*` variable points the tools at other operators, or the Node version is too old for `buy.mjs`. This task adds one pinned, read-only command that checks all of them in one run, before anything is signed, and prints one line per check with what to do. The guides tell the agent to run it first.

Crow also learns of outside agents' friction only from its own benchmark. This task ends the buyer's, the seller's and the setup's pages with a short, fixed form for one report after the deal, sent only with the principal's yes, through the route that already exists. The live operators take no reports yet (no `FEEDBACK` namespace on operator 1, `docs/operations.md`), so the guides send it only when discovery lists a `feedback` service, and the preflight says which is true.

Source: crow-private `roadmap/triage/2026-11-16-exact-lessons.md`, lessons 1 and 2, taken from expo/exact's `setup --check` and its authoring diary.

Rafa's rule for the pages, 2026-11-16: the agent pages are written for machines, so every added line is as short as it can be, and the first-deal paths stay within their budgets.

Non-goals: binding the report store or deploying (Rafa's gates); changing any pinned file; a schema change; counting the faucet's remaining grants (the faucet does not publish it).

## Acceptance criteria

1. `node preflight.mjs` reads only: no POST, no key made, no file written. It runs every check even after a failure, prints one line per check (`ok`, `warn` or `fail`, the check's name, what it found, what to do), then a summary line, and exits 1 when any check fails, else 0. `--json` prints one JSON object instead. `--help` prints the usage.
2. The checks: the Node version against each command's need; every `HOLDBACK_*` and `CROW_*` variable set, by name only, never its value; each operator reachable, with its latency in ms; each operator's EIP-712 domain and token against the pins in `examples/deployments.ts`; the operators' list of operators; the clock against each operator's `settlementTime`; the faucet's published limits; whether reports are taken; Crow's test seller and test buyer cards reachable.
3. `site/preflight.mjs` is the bundle of `examples/preflight.ts`, imports only Node's own modules, and `site/check.mjs` fails when it is stale. Its command fetches it as `preflight.mjs.part` and runs it only after its SHA-256 matches.
4. `llms.txt` carries the command once; `buy.txt`, `sell.txt` and `setup.txt` say to run it first.
5. `buy.txt`, `sell.txt` and `setup.txt` end with the report form; `ref/limits.txt` says the route works only where discovery lists `feedback`.
6. `node site/build.mjs && node site/check.mjs` passes: both first-deal paths within 5,000 tokens, the plain-HTTP buyer path within 9,450, `setup.txt` within 10,000 bytes. The SHA-256 of every pinned file is unchanged.

## Evidence

All measured on 2026-11-16 in the worktree, on Node 22.22.2.

- `node site/build.mjs && node site/check.mjs`: PASS. The pinned bundles keep their SHA-256: `git diff --stat origin/main` over `site/try.mjs`, `buy.mjs`, `setup.mjs`, `try-sell.mjs`, `try-judged.mjs` and `try-reclaim.mjs` is empty. `site/preflight.mjs` is 12,578 bytes, SHA-256 `c9f60123…` at the first build (the build prints the current one).
- Guide budgets, before and after (bytes divided by four):

  | Path | Before | After | Limit |
  | --- | --- | --- | --- |
  | Buyer, `llms.txt` + `buy.txt` | 4,605 tokens | 4,613 tokens | 5,000 tokens |
  | Seller, `llms.txt` + `sell.txt` | 4,191 tokens | 4,244 tokens | 5,000 tokens |
  | Plain-HTTP buyer | 9,446 tokens | 9,439 tokens | 9,450 tokens |
  | `setup.txt` | 9,884 bytes | 9,974 bytes | 10,000 bytes |

  `llms.txt` lost four explanations written for people (Rafa, 2026-11-16: the agent pages are for machines) to make room: the Etherscan sentence, the domain's working-name note, the reason not to take the domain from an operator, and the repeated escrow name.
- `pnpm exec vitest run tests/site-guides.test.ts tests/cut-feature-alignment.test.ts examples/preflight.test.ts examples/examples.test.ts`: 4 files, 35 tests passed. `examples/preflight.test.ts` holds 8 of them: the pin equals `verify.ts`'s `pinOf`; GETs only; every failure reported in one run (4 fails and 1 warn from one bad world); variable values never printed; operators that disagree fail; operator text that holds line breaks or escape codes is never printed raw.
- `eslint` on the changed files and `tsc -p examples/tsconfig.json --noEmit`: no findings.
- Live, `node site/preflight.mjs` against `api.crow.direct` and `api2.crow.direct`: 12 ok, 1 note (`these operators take no reports`), 0 warn, 0 fail, exit 0; the operators answered in 317 to 354 ms. With `HOLDBACK_DEPLOYMENT` and `CROW_QUOTE_CREDENTIAL` set: 1 warn and 1 note naming the two, neither value printed, exit 0. `--bogus`: exit 2.

## Handoff

- **The preflight is not a step before the one-command goals.** Each command an agent runs costs its principal one approval, and the headline target is one approval a deal. So `llms.txt` asks for it before a role page and after an unexplained error, not before `try.mjs` [inferred from the benchmark's approval counts].
- **Reports reach no one until Rafa binds the store.** Operator 1 has no `FEEDBACK` KV namespace (measured live: discovery lists no `feedback`). The guides send a report only when the preflight says `reports taken`, so nothing changes for agents until then. Binding it is `docs/operations.md`, "Feedback triage", steps 1 and 2, then an operator deploy: both Rafa's.
- **The site deploy is Rafa's.** Until it runs, crow.direct serves the old pages and no `preflight.mjs`.
- `eslint.config.js` gained `site/preflight.mjs` in its ignores, beside the other generated bundles; the paths list above did not name it.
- Left for later: the faucet publishes no "grants left today", so the preflight states the limits only. A change to the test service would let it say more.
