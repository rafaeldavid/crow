# T-471: The plan for "Claude, set up Crow for me"

- **Lane:** research (a plan, a design and its task files; documents only)
- **Phase:** 2
- **Depends on:** nothing
- **Paths this task may touch:** `docs/research/2026-11-15-setup-baseline.md`, `docs/research/2026-11-15-blygger-study.md`, `docs/research/2026-11-15-setup-design.md`, `docs/research/README.md`, `docs/decisions-today.md` (D73, D74), `docs/tasks/T-471-setup-plan.md` to `T-479-setup-signer-limits.md`
- **Human gate:** no (documents only; nothing deployed, sent or run against the live service)
- **Status:** review
- **Agent/session:** the setup-plan session, started by the coordinator on 2026-11-15
- **Roadmap row:** N160
- **Change kind:** 10 (research and decisions), with 2 (task files). No local checks.
- **Review:** one `reviewer` pass on the whole plan and one `red-teamer` pass on its keys, secrets, privacy and neutrality parts.
- **Token budget:** 1,500,000 tokens for the plan and its reviews, a target.

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
| `docs/research/2026-11-15-setup-design.md` | The design, the privacy table, the measure and its targets, the build plan, what is deferred, and the choices for Rafa |
| `docs/decisions-today.md`, D73 and D74 | The decisions the design makes |
| `docs/tasks/T-472` to `T-479` | Eight build tasks |

## Acceptance criteria

- [x] The baseline lists, for a seller with its own API and for a buyer, each step from nothing to a first settled test deal: what the assistant reads in bytes and tokens, each command, each thing a person does, each secret and each request that leaves the machine.
- [x] The baseline answers whether the API needs nobody set up until their first deal, and names each thing that must exist before one and whether it involves Crow.
- [x] The study covers the three ways in, the free first route, `init`, the deploy on the party's own account, identity as the origin, leaving, shared defaults, the conformance kit and how an assistant drives the install, each with a decision and a reason.
- [x] The design covers `setup.txt`, the ways in for both roles, what a party publishes, where the signing part runs, keys and limits, a privacy table, leaving, a conformance check and the measure with targets, and says what it leaves out.
- [x] Each build task has a reserved number, a change kind, its paths, a budget, its review and its dependencies. The first slice and the parallel tasks are named, and every task that touches the pilot's paths is marked as waiting.
- [x] Each decision is in `docs/decisions-today.md`; the choices that are Rafa's are a short list with a recommendation and a default.
- [ ] One `reviewer` pass and one `red-teamer` pass ran; their blocking findings are fixed or recorded here.

## Out of scope

- Building any task. The coordinator reads the plan first.
- `docs/plan.md`: it lists no task after the phase-one contract work, and the coordinator updates it (`docs/team.md`, "A change edits only its own task file").

## Evidence

All of 2026-11-15. Measured unless labelled.

- **Sources read:** the repository at `58ef0c7a` (`origin/main`); `https://crow.direct/guide-budget.json`, `llms.txt`, `buy.txt`, `sell.txt` and `status.json` by plain GET; Blygger's public pages, Studio repository and spec repository by plain GET. Nothing was posted, deployed or run against the live service. No `.env` file or keystore was read.
- **Three research passes,** each a separate agent with a written brief: the seller's baseline, the buyer's baseline, and the Blygger study. This session read the central sources itself as well: `site/llms.txt`, `sell.txt`, `buy.txt`, `ref/intake.txt`, `ref/http.txt`, `ref/seller-adapter.txt`, ADR-0037, `docs/privacy-baseline.md`, `tools/one-click/README.md`, and Blygger's start page, README install sections and `scripts/init.ts`.
- **The baseline's numbers:** in the baseline, each beside its source.
- **Task numbers:** reserved with `node roadmap/ids.mjs reserve`, one each for T-471 to T-479.
- **Checks:** none apply to documents (change kinds 10 and 2). CI's `check`, `gitleaks` and `id-check` are the gate.
- **Reviews:** see below.

### Reviews

To fill in after the two passes.

## Decisions

- **Three records, not one.** The baseline and the study are measurements a later reader may want without the design; the design cites both.
- **One quoted sentence from Blygger.** The study names each pattern by Blygger's own heading and points to its line, and quotes only the sentence on shared defaults.
- **Rafa's question of 2026-11-15** (is Crow's API the equivalent of Blygger's Studio, with a charge only later and only for the API?) is answered in the design, "What is offered, and by whom", and left as his choice: the plan records his direction and does not turn a question into a decision.
- **No task for "the mandate at the first quote".** The seller adapter's `"signingKey": "per-deal"` already takes each deal key's faucet grant with its quote, so the setup writes that setting and the adapter does not change.

## Handoff

**Done:** the three records, D73 and D74, and eight task files.

**Not done:** nothing is built. The plan waits for the coordinator's review.

**How to resume:** start T-472, the first slice. T-473 (the benchmark's scenarios) and T-474 (the card's schema) can start at the same time on separate paths. T-475, T-476 and T-477 follow T-472 one at a time. T-478 waits for the pilot's deploy; T-479 waits for the own-agents proof run.

**For the coordinator:**

- Pull request 578 (T-469) changes `site/build.mjs`, `site/check.mjs`, `site/llms.txt` and `site/ref/intake.txt`. T-472 and T-474 start after it merges, or rebase on it.
- The guide budget's file gains a third role, `setup` (T-472). Crow Control's reader of `guide-budget.json`, and its reader of the benchmark's records (T-473), are in the private repository.
- `docs/plan.md`, the roadmap row's fields and the daily log are not touched.

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
