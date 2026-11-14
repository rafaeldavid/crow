# T-468: Today's handed-over wording, in the docs it belongs to

- **Lane:** docs (kind: docs)
- **Phase:** 2
- **Depends on:** T-422 (the operators' limits, pull request 527), T-423 (ADR-0038 step 1, pull request 520), T-451 and T-462 (the security headers, pull request 564 and the T-462 pull request), pull request 534 (the faucet's limit per client)
- **Paths this task may touch:** `docs/api.md`, `docs/neutrality.md`, `docs/judgment-and-defenses.md`, `docs/audit/known-issues.md`, `docs/decisions-today.md` (one dated line in D22), `docs/operations.md` (the security headers section), `docs/operator-threat-model.md` (the faucet's limit only), the Status lines of task files under `docs/tasks/`, this file
- **Human gate:** no. Nothing is deployed.
- **Status:** in progress
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

- [ ] `docs/api.md` documents 429 `rate_limited` (`retryAfterSec`, `Retry-After`), 413 `payload_too_large` (`maxBytes`), the fields of `limits` and `demo.limits`, and that a replay of an accepted request is answered.
- [ ] `docs/neutrality.md`'s operator row names `neutrality.operator-daily-cap` and its test file.
- [ ] T13, R-12 and D22 carry T-423's text, corrected where D69 changed it.
- [ ] `docs/operations.md`'s security headers section covers all four public Workers, the redirect and CORS, with no paragraph repeated.
- [ ] No doc under `docs/` outside dated records and task files states the faucet's per-client number.
- [ ] Each Status line set here matches a merged pull request on GitHub.
- [ ] `node site/build.mjs && node site/check.mjs` passes, and the change touches nothing it reads.
- [ ] One reviewer pass, told to check each sentence against the code.

## Evidence

(filled in before the pull request)

## Handoff

(filled in before the pull request)
