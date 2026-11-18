# T-483: A seller's own API, checked against real results before the first deal

- **Lane:** demo (agent access: the guides in `site/` and the reference tools in `examples/`)
- **Phase:** 2
- **Depends on:** T-472 (the setup command, the folder, the keys, the bundle, the sample path).
- **Paths this task may touch:** `examples/setup-seller.ts`, `examples/setup-check.ts`, `examples/setup-secret.ts` (new), `examples/setup-self-buy.ts` (new), `examples/setup*.test.ts`, one entry in `examples/setup.ts`'s command table, the seller's section of `site/setup.txt`, `site/setup.mjs` (generated), this file. It imports the seller adapter, `examples/buy-with-signer.ts`, `examples/buyer-signer.ts` and `packages/` and changes none of them.
- **Human gate:** yes, for one step only: the site deploy that publishes the new bundle is Rafa's. The merge has no gate.
- **Status:** todo
- **Agent/session:** not started; starts after T-472 merges
- **Roadmap row:** N160
- **Change kind:** 4 is the nearest recipe, with 1. Local checks: `pnpm exec vitest run examples/setup`, `node site/build.mjs && node site/check.mjs`.
- **Review:** one `red-teamer` pass (the party's own API key, what the check sends, the self-bought deal) and one `reviewer` pass.
- **Token budget:** 250,000 tokens, a target.

## Intent

Restate this in your own words before writing code.

T-472 sells Crow's sample product. This task lets a party sell its own: "Read https://crow.direct/setup.txt and set up Crow for me as a seller of the API at <address>." The assistant writes two files, a mapping of the API's quote, start and result calls and a deal template with the deliverable and its checks. The command checks both against real results of that API before any offer exists.

This is where the pilot failed by hand: its terms passed one sample and failed real output (baseline). So the check takes several real results, runs the deal's own checks on each through the adjudicator's first stage, and proves the checks are not empty by breaking a result and seeing it fail.

It also adds what an API of one's own needs: a way for the person to give the API's key without the chat, and a first deal for an offer that Crow's test buyer will not take.

Non-goals: a command that drafts checks from samples (deferred); a public quote address (T-477); a lowest price or other hard limit (T-479); any change to the adapter.

## Context

- The design: `docs/research/2026-11-15-setup-design.md`, "The ways in, by effort" (a seller, way 0), "Keys, secrets and limits", "The conformance check".
- The mapping and the template: `site/ref/seller-adapter.txt`, "Your API's shape" and "Terms per quote"; `site/ref/checks.txt`; `examples/seller-adapter.job-api.config.json`.
- The job API of another shape the tests use: `examples/seller-adapter-job-stub.ts` (read, not changed).
- The test buyer's rules: `apps/test-agents/src/buyer-rules.ts`: a price of at most 50 tUSDC, checks only, the work due within a day.

## Acceptance criteria

- [ ] `node setup.mjs seller --api <base URL>` writes a starting mapping and template, prints as JSON what the assistant must fill in (the three calls, the scope's fields, the deliverable, the checks, the price's unit), and exits 3 until they are there. `setup.txt` names the two reference files to fetch for that, and no others.
- [ ] **Real results, and how many, are the person's call.** `check` needs at least `--min-samples` results, 3 unless the person sets another number; no number is refused (D31). Results are past outputs the person puts in `samples/`, or fresh ones the command fetches from the API after it prints how many jobs that starts and the person passes `--fetch-samples`. A fetched job may cost the party; the command says so.
- [ ] Each result is converted by the mapping and run through the deal's checks with the adjudicator's first stage. All must pass. Each result with one required field removed must fail. A result above the operators' size limit fails.
- [ ] **`secret`.** `node setup.mjs secret <NAME>` takes one value at a hidden prompt and writes it to `keys/secrets.env` (mode 0600). It refuses to run when its input is not a terminal, so an assistant cannot pipe a value in. The configuration names the variable, never the value.
- [ ] **No credential in a mapping.** `check` refuses a call mapping whose headers carry a credential in plain text (a header named like an authorization or key header, or a value shaped like a token) and points to the configuration's `auth` field.
- [ ] **The check sends nothing to Crow.** With `--fetch-samples` its only requests go to the party's own API under its base address. A test records them.
- [ ] **A first deal that fits the test buyer** sells one job of the party's API to Crow's test buyer and ends `Released`. Scripted, against the job stub of another shape, with a mapping and a template the test writes.
- [ ] **A first deal that does not fit** (a price above the test buyer's maximum, or a refusal or a 429 from the test buyer): the command says why, and with `--self-buy` it buys the job itself with a fresh buyer key. The deliverable's description in the public terms then says that the deal is a setup self-test, and the deal record says the party bought from itself. Without the flag nothing is offered.
- [ ] `first-deal` prints, before it sends anything, that the deal starts one real job at the party's API.
- [ ] The leak test of T-472 covers the API key and the quote credentials: no value in any printed line, log, journal or file outside `keys/`.
- [ ] The red-team pass tries to: get the API key into a printed line, a file outside `keys/` or a request to another host; make `check` call a Crow-run host; pass a self-bought deal off as a sale. Each fails, or the finding and its fix are in Evidence.

## Out of scope

- Drafting the checks. The assistant writes them; the check refuses weak ones.
- A converter between the YAML terms file of `pnpm audit-deal` and the adapter's JSON template. The setup writes the JSON template only.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- The requests each command made, by host:

## Decisions

Choices made inside this task.

## Handoff

Not started. Starts after T-472 merges, because both change the bundle `site/setup.mjs` and its pinned hash. Whether the self-bought first deal stays is Rafa's choice 3 in the design; its default is that it does.
