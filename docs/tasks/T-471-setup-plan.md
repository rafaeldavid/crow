# T-471: The plan for "Claude, set up Crow for me"

- **Lane:** research (a plan, a design and its task files; documents only)
- **Phase:** 2
- **Depends on:** nothing
- **Paths this task may touch:** `docs/research/2026-11-15-setup-baseline.md`, `docs/research/2026-11-15-blygger-study.md`, `docs/research/2026-11-15-setup-design.md`, `docs/research/README.md`, `docs/decisions-today.md` (D73, D74), and the task files `docs/tasks/T-471-setup-plan.md` to `T-479-setup-signer-limits.md`, `T-481-signer-worker-shell.md`, `T-482-bench-isolated-machines.md` and `T-483-setup-own-api.md`
- **Human gate:** no (documents only; nothing deployed, sent or run against the live service)
- **Status:** done
- **Agent/session:** the setup-plan session, started by the coordinator on 2026-11-15
- **Roadmap row:** N160
- **Change kind:** 10 (research and decisions), with 2 (task files). No local checks.
- **Review:** one `reviewer` pass on the whole plan and one `red-teamer` pass on its keys, secrets, privacy and neutrality parts.
- **Token budget:** 1,500,000 tokens for the plan and its reviews, a target the coordinator set.

## Intent

Rafa's direction of 2026-11-15: setting Crow up must be as good as blygger.org's start path, as simple as deploying a page on one's own website; the product is the seller's and the buyer's package; the setup file is made for the least assistant effort and for privacy; and the API needs nobody set up until their first deal.

This task plans that work and builds nothing. It answers four questions, each in a document a later session can build from:

1. **What must a new party do today?** Every step, read, command, secret and request, for a seller with its own API and for a buyer, with what is already measured.
2. **How does Blygger do it?** Each pattern of its start path, with a decision to copy, adapt or decline.
3. **What does Crow build?** The smallest design that makes one sentence to a person's own assistant end in a first settled test deal, with nothing sent to Crow before that deal.
4. **In what order?** Task files with paths, reviews, budgets and dependencies, and the first slice named.

Non-goals: any code; any change to `docs/plan.md`, the roadmap or the daily log, which are the coordinator's; any change to the paths the pilot's hosted sellers deploy from.

## What it produced

| File | What it holds |
| --- | --- |
| `docs/research/2026-11-15-setup-baseline.md` | Today's path for a seller and a buyer; what must exist before a first deal; the benchmark's numbers |
| `docs/research/2026-11-15-blygger-study.md` | Ten patterns of Blygger's start path, each copied, adapted or declined; the answer to "nobody is set up until they act" |
| `docs/research/2026-11-15-setup-design.md` | The design, where the signer runs, the privacy table, the measure and its targets, the isolated machine for a simulated party, the build plan, what is deferred, and the choices for Rafa |
| `docs/decisions-today.md`, D73 and D74 | The decisions the design makes |
| `docs/tasks/T-472` to `T-479`, `T-481`, `T-482`, `T-483` | Eleven build tasks |

## Acceptance criteria

- [x] The baseline lists, for a seller with its own API and for a buyer, each step from nothing to a first settled test deal: what the assistant reads in bytes and tokens, each command, each thing a person does, each secret and each request that leaves the machine.
- [x] The baseline answers whether the API needs nobody set up until their first deal, and names each thing that must exist before one and whether it involves Crow.
- [x] The study covers the three ways in, the free first route, `init`, the deploy on the party's own account, identity as the origin, leaving, shared defaults, the conformance kit and how an assistant drives the install, each with a decision and a reason.
- [x] The design covers `setup.txt`, the ways in for both roles, what a party publishes, where the signing part runs, keys and limits, a privacy table, leaving, a conformance check and the measure with targets, and says what it leaves out.
- [x] Each build task has a reserved number, a change kind, its paths, a budget, its review and its dependencies. The first slice and the parallel tasks are named, and every task that touches the pilot's paths is marked as waiting.
- [x] Each decision is in `docs/decisions-today.md`; the choices that are Rafa's are a list with a recommendation and a default.
- [x] One `reviewer` pass and one `red-teamer` pass ran; their findings are fixed in the plan or recorded below.

## Out of scope

- Building any task. The coordinator reads the plan first.
- `docs/plan.md`: it lists no task after the phase-one contract work, and the coordinator updates it (`docs/team.md`, "A change edits only its own task file").

## Evidence

All of 2026-11-15. Measured unless labelled.

- **Sources read:** the repository at `58ef0c7a` (`origin/main`); `https://crow.direct/guide-budget.json`, `llms.txt`, `buy.txt`, `sell.txt` and `status.json` by plain GET; Blygger's public pages, Studio repository and spec repository by plain GET; Cloudflare's, DigitalOcean's, Fly.io's, exe.dev's and boat's own documentation pages. Nothing was posted, deployed, created or run against a live service. No `.env` file or keystore was read.
- **Five research passes,** each a separate agent with a written brief: the seller's baseline, the buyer's baseline, the Blygger study, the signer on Cloudflare against two VMs, and the machines for simulated parties. This session read the central sources itself as well: `site/llms.txt`, `sell.txt`, `buy.txt`, `ref/intake.txt`, `ref/http.txt`, `ref/seller-adapter.txt`, ADR-0037, `docs/privacy-baseline.md`, `tools/one-click/README.md`, the adapter's start and mandate code, and Blygger's start page, README install sections and `scripts/init.ts`.
- **The baseline's numbers:** in the baseline, each beside its source.
- **Task numbers:** reserved with `node roadmap/ids.mjs reserve`, one each for T-471 to T-479 and T-481 to T-483. T-480 is another session's.
- **Checks run locally:** `tests/design-map.test.ts` against the worktree's docs, 37 of 37 passed; `scripts/id-check.mjs` with the pull request's branch, title and body, pass. CI's `check`, `gitleaks` and `id-check` are the gate.
- **Tokens:** the seven agents used 1,957,824 tokens (357,793; 329,555; 417,958; 243,974; 104,785; 248,084; 255,675), before this session's own. The plan is over its target of 1,500,000. The three baseline and study passes cost 330,000 to 418,000 tokens each, because each produced a line-by-line record; the coordinator's two additions added two passes.

### Reviews

Both agents got `CLAUDE.md`, the decision records, `docs/privacy-baseline.md` and the plan, and not this session's conclusions. Both read the code the design relies on. Neither ran anything against the live service.

**The `reviewer` pass: ISSUES, 2 High, 9 Medium, 7 Low.** It verified the facts the design leans on (the mandate check, the per-deal faucet grant, the adapter's in-process key, the test buyer's rules, the guide budget, the six benchmark rows and their medians). What changed:

| Finding | Severity | What changed |
| --- | --- | --- |
| The buyer's first deal does not fit the tools T-475 imported: the test seller takes sealed proposals, and the buyer's tools are quote-driven | High | T-475 names the intake purchase as new code on `agent.ts`, `verify.ts` and pull request 578's kit; its budget is 250,000 tokens |
| "Requests before the first deal" was circular, and the probes record no body | High | The first deal starts at a marker the `first-deal` command writes; a request names the party when it is not a GET to a Crow-run host or its path holds an address (design; T-473) |
| A one-file bundle runs the bundled tools' own command lines | Medium | T-472's first criterion: a build transform, proved before anything else |
| The payout address defaulted to the standing key, against the privacy and limits claims | Medium | The payout address is always asked; the design's linking claim is corrected; `leave` lists balances the person abandons |
| Pull request 578 was treated only as a file conflict | Medium | The design and T-472 say what is reused (self-contained bundles, the kit) and what the setup adds |
| The approval targets contradicted the design's own counts | Medium | Recomputed: at most 9 and 3 with default permissions; the consent is the command's approval, not a separate question |
| "Pins the operators" against "no single API provider" and the scripted tests | Medium | The operators are a flag with Crow's two as the default |
| Wrong parallel and order claims | Medium | T-472 and T-474 share two build files and say so; T-477 owns what `leave` does after `publish`; T-477 wires the card's check |
| T-472 was not the smallest slice | Medium | Split: T-472 is the sample path; T-483 adds the party's own API, its secrets, real results and the self-bought first deal |
| D73 claimed reviews that had not run | Medium | True now; this section records them |
| A live run with a job API on the loopback address is unverified | Medium | T-473 probes it first |
| The baseline's file count; the buyer's step table; over-claims on a shared machine; budgets above the recipes; s7's counterparty; the hosted bundle's hash; three "X, not Y" sentences | Low | Each fixed in the file it names |

**The `red-teamer` pass: 0 Critical, 4 High, 8 Medium, 7 Low, 1 Info.** Two of the design's claims were false against the code and are corrected. What changed:

| Finding | Severity | What changed |
| --- | --- | --- |
| On the test service a buyer pays nothing real, so an open quote address gives a seller's real work to anyone and spends its faucet grants | High | `publish` refuses an open quote address without a credential or `--open`, and asks for a daily limit (design; T-477) |
| The payout address links every deal of a per-deal seller: the design said it "links nothing" | High | Corrected in the design and the privacy table; always asked; a payout address for each deal is deferred until the adapter's core can change |
| The hash covered the bundle and not its two libraries, and it comes from the same origin as the file | High | The bundle carries its libraries, so npm leaves the path; the design states what the pin does not protect and gives an optional comparison with the repository's copy |
| A Worker's outgoing requests may carry its zone, so the operators would see the party's domain beside each deal key; "nobody reads the secret back" was too strong | High | The design's table is corrected and marked inferred; T-478 measures the header, pins the cloud tool and states who can reach the key |
| Variables in the environment override the bundle's pins and operators | Medium | The command ignores `HOLDBACK_*` and `CROW_*`, accepts the Sepolia deployment only, and takes every setting as a flag (design; T-472) |
| A credential pasted into a mapping's header passes the check and reaches the export | Medium | The check refuses it (T-483); the export test covers it (T-476) |
| The folder's place was unstated: a repository, a synced folder or a served folder would carry `keys/` | Medium | Default `~/.crow/<name>`; the card goes to a separate folder; the command refuses those places (T-472) |
| The buyer's limits: a seller's text in the assistant's context, a rewritten limits file, two runs at once | Medium | Work written to a file; limits change only at a terminal; a locked ledger; attack tests (T-475) |
| A service installed as root survives `leave` | Medium | `leave` checks the quote address and exits with an error while it answers (T-477) |
| The check of a live address could be turned on a private network or print fetched text; nothing but TLS binds an offer to a domain | Medium | Same origin or a stated one, no redirect, private addresses refused, pass or fail only; the design says what binds an offer (T-477) |
| An early accept or a settlement by agreement releases without judgment, and nothing sets a lowest price | Medium | Two rows added to the limits table, with the rung each has |
| A fresh key for each deal needs the faucet for every quote | Medium | Named as a trade under Neutrality and made Rafa's choice 9 |
| `secret` from a pipe; the check building an offer at an operator; missing rows in the privacy table; dust that blocks `--delete-keys`; dependencies not admitted; the leak test's coverage; T-478's key wording | Low | Each fixed in the design or the task it names |
| The setup keeps keys in files, where the hard rule says environment variables only | Info | Recorded in D73 as a line Rafa may overrule, and as his choice 10 |

**Not fixed, and why:**

- **Whoever controls crow.direct can serve a changed file and a matching hash.** The plan states it and gives a second origin; closing it needs a channel outside Crow's own site, which is not this plan's to add.
- **The fixtures the red team named** (`attack.setup-*`, `neutrality.setup-*`) are not written: nothing is built. Each is an acceptance criterion of the task that builds the defence.
- **Neither pass verified the Blygger facts or the vendors' pages** (they had no network). They rest on the research passes' own reading.
- **The fixes were not reviewed again** (one round, `docs/team.md`).

## Decisions

- **Three records, not one.** The baseline and the study are measurements a later reader may want without the design; the design cites both.
- **One quoted sentence from Blygger.** The study names each pattern by Blygger's own heading and points to its line, and quotes only the sentence on shared defaults.
- **Rafa's question of 2026-11-15** (is Crow's API the equivalent of Blygger's Studio, with a charge only later and only for the API?) is answered in the design, "What is offered, and by whom", and left as his choice: the plan records his direction and does not turn a question into a decision.
- **Two additions from the coordinator on 2026-11-15,** both from Rafa's questions of that day, are in the design: where Crow's own two machines run ("Where the signer runs", with T-481), and an isolated machine for each simulated party ("An isolated machine for each simulated party", with T-482). Each rests on one more research pass over the vendors' own pages; nothing was tested against a live account or machine.
- **No task for "the mandate at the first quote".** The seller adapter's `"signingKey": "per-deal"` already takes each deal key's faucet grant with its quote, so the setup writes that setting and the adapter does not change.
- **The first slice was split after review.** T-472 sells the sample product; T-483 adds the party's own API.

## Handoff

**Done:** the three records, D73 and D74, and eleven task files.

**Not done:** nothing is built. The plan waits for the coordinator's review.

**How to resume:** start T-472, the first slice, from `main` after pull request 578 merges. T-473 (the benchmark's scenarios) and T-474 (the card's schema) can start at the same time. T-483, T-475, T-476 and T-477 follow T-472 one at a time, in that order. T-482 follows T-473. T-478 waits for the pilot's deploy; T-479 waits for the own-agents proof run; T-481 waits for both.

**For the coordinator:**

- Pull request 578 (T-469) changes `site/build.mjs`, `site/check.mjs`, `site/llms.txt` and `site/ref/intake.txt`, and adds the bundling pattern and the kit that T-472 reuses.
- Crow Control's reader of the benchmark's records needs the two new scenarios and the two new fields (T-473); it is in the private repository.
- `docs/plan.md`, the roadmap row's fields and the daily log are not touched.
- The raw research is under `reports/scratch/setup-plan/` in the main checkout, not committed.

**Found on the way, not fixed here** (for triage; none blocks this plan):

1. The benchmark's headline (11 approvals, 680,590 tokens, 3 min 21 s) is the median of six runs whose median records are the two seller runs. The four buyer runs alone give 20 approvals, 1,095,097 tokens and 4 min 17 s (inferred from the measured records).
2. `site/sell.txt` step 9 puts the seller's signing key on a command line, and its opening says nothing after the install needs a key or the network, which step 9 does.
3. The adapter's default delivery window (604,800 s) and the stub's price (500 tUSD) do not fit the test buyer's published rules (86,400 s; 50 tUSDC), and no stand-in API prices in the Sepolia token, so the adapter cannot be tried on the test service without a real API (inferred).
4. `site/ref/seller-adapter.txt` says a club's principal gives a seller its mandate elsewhere, but no operator route takes a principal's own mandate (`POST /v1/agents` answers 501).
5. The Node version differs between the guides: `site/llms.txt` says 22.18 or later; `examples/try.ts`, the bundle's banner and the home page's prompt say Node 20; `examples/seller-adapter-service.md` says Node 22.
6. `examples/try.ts` prints that the faucet allows 10 new addresses an hour per client; the code allows 50. Fixing it changes `try.mjs`'s hash.
7. `tools/one-click/README.md` still says the seller scenario of `run.mjs` waits for the test buyer, which is live. T-473 corrects it.
8. Terms exist in two formats, a YAML terms file for `pnpm audit-deal` and a JSON template for the adapter, with no public converter.
9. `apps/hosted-sellers` has no README; its runbook is in `docs/operations.md`.
10. The tools read `HOLDBACK_DEPLOYMENT`, `HOLDBACK_CHAIN_ID`, `HOLDBACK_VERIFYING_CONTRACT` and `HOLDBACK_OPERATORS` from the environment, and the SimChain pin is always accepted (`examples/verify.ts`, `examples/buyer-signer.ts`). A variable left in a shell can point the seller adapter at operators that are not Crow's (the red team's finding; it holds for today's adapter too).
11. A call mapping's `headers` take any text (`examples/seller-adapter-api.ts`), so a seller can put its API key in the configuration file in plain text, and the adapter does not refuse it.
