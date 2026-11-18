# T-407: A hosted seller adapter on Crow's Cloudflare account

- **Lane:** infra
- **Phase:** 2
- **Depends on:** T-406 (a quote priced per unit, PR 497), T-399 (the live rehearsal of a design partner's two scans)
- **Paths this task may touch:** `docs/decisions/ADR-0037-hosted-seller-adapter.md`, `docs/decisions-today.md` (one entry), this file; after Rafa picks the design: `examples/seller-adapter*.ts`, `examples/report-converter.ts`, a new `apps/hosted-sellers/`, `pnpm-workspace.yaml`, `fixtures/` for the new tests, `docs/operations.md` (a "how to deploy" section only)
- **Human gate:** yes for any deploy and every secret. The build itself is confined to the repository.
- **Status:** done (the design record, ADR-0037: pull request 499, merged 2026-11-14 as `b9e33a9b`; the build is T-433 to T-436)
- **Agent/session:** the T-407 session, started 2026-11-14 by the pilot coordinator
- **Roadmap row:** N134

## Intent

Crow runs the seller side of a deal for a design partner whose only interface is an HTTP job API priced in credits. Today that seller side is `examples/seller-adapter.ts`, a Node process with a file journal and a poll loop on Rafa's Mac. For the pilot's two scans a tunnel from that Mac carries it (Rafa, 2026-11-14). This task makes the repeatable path for later design partners: the same adapter behaviour hosted on Crow's own Cloudflare account beside the test seller, with a public card page, so that:

- a buyer on any machine needs nothing but crow.direct;
- a deal survives the loss of any one machine through a 7-day delivery window;
- the partner's API key and the seller's signing key exist only as platform secrets;
- a job runs only in the partner workspace its configuration names.

Inputs: one adapter configuration per seller in the `loadConfig` shape. Outputs: a Worker that serves the seller's card, quote and defaults routes and advances its deals. Non-goals: any change to the protocol, the API contract or the contracts; selling for more than one partner per configuration; a deploy.

## Context

- `examples/seller-adapter.ts`, `examples/seller-adapter-api.ts`, `examples/report-converter.ts`: the adapter today.
- `apps/test-agents/` and `docs/operations.md`: how the test seller runs as a Worker with a Durable Object, an alarm and one Worker secret.
- `site/buy.txt` step 2, `site/ref/intake.txt` and `site/ref/seller-adapter.txt`: the card a buyer reads.
- The pilot's private kit (`docs/private-materials.md`): the workspace rule and the duplicate-start rule. Nothing from it is copied here.

## Acceptance criteria

- [ ] A design record (`docs/decisions/ADR-0037-hosted-seller-adapter.md`) compares a Worker with a Durable Object against a container, and Rafa picks.
- [ ] One configuration per seller, in the `loadConfig` shape, with `sellerApi` mappings, `quote.read.units` and `unitPrice`, `reportMapping` and `quoteAuth`.
- [ ] The partner's API key and the seller's signing key are platform secrets only: no file, log line or journal entry holds either. A test greps the journal and the logs for both.
- [ ] A public card page per seller at `crow.direct/agents/<seller>`, with a `crow-agent` card naming the quote and defaults addresses.
- [ ] A guard: a job's quote and start go only to the workspace its configuration names, and a result from another workspace is not delivered.
- [ ] Tests on the in-process world: quote, hold, start, result, delivery and release; a restart in each stage; the guard's refusals.
- [ ] A red-team review, since the Worker holds a third party's key and starts paid work.
- [ ] No deploy and no secret set: both are Rafa's.

## Out of scope

- The pilot's two scans: they run from Rafa's Mac through a tunnel.
- Party bonds, spending limits and any protocol change.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

- 2026-11-14: the design record first, the build after Rafa picks (the task's brief).
- 2026-11-14: one independent research pass (a separate agent, at maximum effort) compared the runtimes from the code and Cloudflare's documentation. It recommends the same option and found the High finding below; ADR-0037 section 9 records it.
- 2026-11-14: the start fix (ADR-0037 section 6, open question 6) shipped on its own, before the pilot's scans, as T-408 (PR 501, merged as `f6b30a8`). This task's own version, PR 500, was closed unmerged as a duplicate.

## Handoff

**State: done.** Closed on 2026-11-17.

- **The design:** ADR-0037 (PR 499).
- **The build:**
  - T-433 (PR 551, `bd29e77`): the adapter follows no redirect, in a way Workers accept.
  - T-434 (PR 553, `6efc9c7`): the core split.
  - T-435 (PR 556, `6eb7b9f`): the Worker.
  - T-436 (PR 557, `896e53d8`): the deploy and secret scripts.
- **The start fix** (a start sent at most once) is T-408 (PR 501).
- **Live:** Rafa deployed two hosted sellers for the pilot's design partner on 2026-11-15 and set their secrets on 2026-11-16: `crow.direct/agents/pilot-scan-1` and `pilot-scan-2`. The record is in `docs/operations.md` (PR 592). Their seller folders were written by the pilot's session (T-470) outside this repository.
- **Follow-ups:** roadmap row N154, "Finish the seller adapter's follow-ups after the pilot". It waits until the pilot's scans are Released, because no path the hosted sellers deploy from may change before then. It covers:
  - the quote route's rate limit, which lives in memory;
  - `{"startAgain": true}`, from closed PR 500;
  - the per-deal key's false alert after a failed journal write.
