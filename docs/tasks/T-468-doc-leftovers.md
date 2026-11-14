# T-468: Today's handed-over wording, in the docs it belongs to

- **Lane:** docs (kind: docs)
- **Phase:** 2
- **Depends on:** T-422 (the operators' limits, pull request 524), T-423 (ADR-0038 step 1, pull request 520), T-451 and T-462 (the security headers, pull requests 564 and 571), pull request 534 (the faucet's limit per client)
- **Paths this task may touch:** `docs/api.md`, `docs/neutrality.md`, `docs/judgment-and-defenses.md`, `docs/audit/known-issues.md`, `docs/decisions-today.md` (one dated line in D22), `docs/operations.md` (the security headers section), `docs/operator-threat-model.md` (the faucet's limit only), the Status lines of task files under `docs/tasks/`, this file
- **Human gate:** no. Nothing is deployed.
- **Status:** review
- **Agent/session:** the T-468 side session, on the coordinator's brief of 2026-11-14
- **Roadmap row:** N117, N19

## Intent

Several sessions merged on 2026-11-14 and left wording for docs another session owned that day. This task puts that wording where it belongs, after checking each sentence against the code on `origin/main`, and drops anything the code no longer bears out. It touches no guide under `site/`, no code and no schema.

The five items:

1. The operators' limits (T-422) in `docs/api.md` and `docs/neutrality.md`: the 429 and 413 answers, the limits as discovery publishes them, named by field and not by number, the replay rule, and the fixture that shows a limit never stops a valid deal.
2. ADR-0038 step 1 (T-423's Handoff) in T13, R-12 and D22, read against D69 as Rafa answered it.
3. The security headers (T-451, T-462): extend the section in `docs/operations.md` to the two Workers T-462 added, the redirect of plain HTTP and CORS.
4. The faucet's limit per client (pull request 534): any doc under `docs/` that still states the old number points to the discovery field.
5. Task files whose Status still reads review for work GitHub shows merged.

Non-goals: `site/`, `examples/`, `apps/`, `packages/`, `spec/`, `contracts/`, and the private repository.

## Acceptance criteria

- [x] `docs/api.md` documents 429 `rate_limited` (`retryAfterSec`, `Retry-After`), 413 `payload_too_large` (`maxBytes`), the fields of `limits` and `demo.limits`, and that a replay of an accepted request is answered.
- [x] `docs/neutrality.md`'s operator row names `neutrality.operator-daily-cap` and its test file.
- [x] T13, R-12 and D22 carry T-423's text, corrected where D69 changed it.
- [x] `docs/operations.md`'s security headers section covers all four public Workers, the redirect and CORS, with no paragraph repeated.
- [x] No doc under `docs/` outside dated records and task files states the faucet's per-client number.
- [x] Each Status line set here matches a merged pull request on GitHub.
- [x] `node site/build.mjs && node site/check.mjs` passes, and the change touches nothing it reads.
- [x] One reviewer pass, told to check each sentence against the code.

## Evidence

All measured on 2026-11-14 unless marked.

- **Item 1, the limits.** `docs/api.md`, "Limits", now has bullets for the 429, the 413, who is counted, the replay rule and `demo.limits`, by field name. Each sentence was checked against `apps/demo-cloud/src/limits.ts`, `world.ts` (the discovery block and the funding cap), `worker.ts` and `apps/operator/src/server.ts` (`knownKey`, `replayed`). The live discovery document at `api.crow.direct` publishes the same fields. `docs/neutrality.md`'s operator row names `neutrality.operator-daily-cap` (`apps/demo-cloud/src/limits.test.ts`) and says that an operator's limits never stop a valid deal.
- **Item 2, ADR-0038 step 1.** T13, R-12 and the dated D22 line carry T-423's text. Two corrections against ADR-0038 and D69: the daily cap binds only through each operator's own count, not through a counterparty (the reviewer found this); and "there is no recourse" now reads "the protocol offers no recourse", with recourse between the principal and its agent provider, as residual 12 and D22 say. T13's fixture cell named `error.revoked-agent`, which does not exist: `/v1/agents/{address}/revoke` is a planned route that answers 501 (`spec/openapi/paths.json`). The cell now says so.
- **Item 3, the security headers.** `docs/operations.md`'s section had T-451's paragraph only. It now covers the test agents and early access (T-462, imported `API_HEADERS`, the cards' own policy), CORS unchanged, and the redirect of plain HTTP on all four Workers. `docs/api.md`'s "Headers on every response" points to it.
- **Item 4, the faucet.** `docs/operator-threat-model.md` named the old limit per client in three places; each now names `demo.faucet.perClientPerWindow`. `git grep` over `docs/` finds the number only in the dated deploy record in `docs/operations.md`, which keeps it.
- **Item 5, Status lines.** Ten task files read review for merged work: T-400, T-401, T-402 (merged 2026-11-13), T-407, T-436, T-437, T-438, T-439, T-440 and T-442. Each now reads done with its pull request and merge commit from `gh pr view`. T-418 already read done.
- **Checks.** `node site/build.mjs && node site/check.mjs`: PASS, and the working tree stayed clean. The reviewer also ran `limits.test.ts`, `world.test.ts` and `envelope-spec.test.ts` (which read `docs/api.md`): all pass.
- **Review.** One `reviewer` pass: ISSUES, all Low or Info. Fixed: the header list (two headers missing), "numbers from discovery" against the numbers the page keeps, demo-Worker behaviour stated as every operator's, the daily cap in T13, R-12 and D22, the historical column in the threat model, and this file's pull request numbers. Long sentences: split where they were added.

## Handoff

- **For the guides' session (`site/ref/limits.txt`, not this task's file).** T-422's proposed bullet under "Honest limits" carries numbers. In the guides' style it could read: "**Limits per caller.** Each operator counts per client (an IPv4 address or an IPv6 /64), each node apart, and publishes its limits in discovery: `limits.reads`, `limits.writes`, and on the demo `demo.limits` (`floodCeiling`, `fundedDealsPerDay`, `ciphertextBytesPerDay`). Over a limit the answer is 429 `rate_limited` with `retryAfterSec`; a repeat of a request already accepted, with the same `Idempotency-Key` and body, is still answered. Refused at one operator, send the same signed request to the other, or to the contract yourself."
- **T-065 is in the private repository** (`roadmap/tasks/T-065-docs-without-merge-conflicts.md` in crow-private). The close-out audit says its Status still reads in progress. This task touches holdback `docs/` only, so it is left for the coordinator.
- **Found and not fixed (for triage):** `docs/operator-threat-model.md` still carries the current limits as numbers in standing rows (reads and writes a minute, the flood ceiling, the daily caps). `docs/api.md` keeps the demo's ciphertext cap and the faucet's grant cap as numbers, because `apps/demo-cloud/src/world.test.ts` reads them from the page.
- **Second review.** The reviewer suggests a short pass by a model of another family on T13, R-12, D22 and the new sentence in the neutrality operator row. Not run: the brief asks for one reviewer pass.
