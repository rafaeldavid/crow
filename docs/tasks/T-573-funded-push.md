# T-573: decide how a seller's system learns that a deal is funded without polling

- **Lane:** research
- **Phase:** 2
- **Depends on:** none. Touches the same ground as T-549 (schema v0.12 and the operators, open) and PR 714 (`setup.mjs deliver`, open); this task changes neither.
- **Paths this task may touch:** `docs/decisions/ADR-0042-funded-notice.md` (new), `docs/decisions-today.md` (one entry), this file.
- **Human gate:** no for the record. Rafa answers the decision before anything is built.
- **Status:** done
- **Agent/session:** the T-573 session, 2026-11-19, branch `t-573-funded-push`, started by the coordinator session.
- **Roadmap row:** N210
- **Change kind:** 10, research and decisions.

## What exists

`docs/what-a-deal-can-do.md` lists no push to a party. The full inventory, with file and line, is in ADR-0042's Context. In short:
- the API serves an unauthenticated server-sent events stream, `GET /v1/events?from=<seq>`, and both live operators answer it [measured 2026-11-19];
- the rules contract emits `JobCreated` (seller indexed) and `JobFunded` in the funding transaction;
- `POST /v1/webhooks` is planned under ADR-0017 and answers 501;
- the hosted seller adapter, the test seller and `setup.mjs deliver` (PR 714) all poll.

The task is still needed: no seller-side component follows the stream or the chain today, and no record says which way is the product's.

## Intent

Restated in my own words. A seller's system should hear that a buyer's money is in the hold without asking every few seconds. Stage 2 of the roadmap wants a "funded" push that is signed, retried and idempotent. Several ways exist or could exist: the seller listens to the chain or to a stream itself, an operator calls a URL the seller registered, or polling stays with one documented command. This task compares them against the neutrality test, D35 (rails, not a record-keeper) and the founder's concern about product bloat, recommends the smallest one that honestly meets the bar, and plans the build. It builds nothing: Rafa answers first.

Non-goals: no code, no schema change, no change to the site or the adapter.

## Acceptance criteria

- [x] An inventory, with file and line, of every way a party learns of a state change today.
- [x] A research pass by a Fable max-effort agent, given the code and the documents, not a conclusion.
- [x] ADR-0042, status Proposed, comparing at least (a) the seller listens itself, (b) an operator's signed webhook, (c) polling with one command, each with its API contract change, operator storage, behaviour when the pushing operator refuses or is offline (with the `neutrality.*` fixture that proves the deal still settles), how the seller checks the notice against the chain, and the tokens an outside agent needs.
- [x] A recommendation of the smallest option that meets the bar, and a plain statement of whether the bar's wording fits.
- [x] A build plan: pull requests in order, their kind, their fixtures and a token estimate labelled guessed.
- [x] An entry in `docs/decisions-today.md` with status "needs Rafa".
- [x] A reviewer pass over the ADR, with its findings fixed.

## Out of scope

- Building any option.
- Changing `spec/schemas/` (T-549 has it open).

## Evidence

- Live stream, measured 2026-11-19 about 22:00 UTC: `curl -s -N --max-time 6 "https://api.crow.direct/v1/events?from=130"` and the same at `api2.crow.direct` answered 200 `text/event-stream`, first byte in 0.055 s and 0.061 s, 12 events each, including `hold.funded` at seq 136 with the same hash on both nodes and the funding transaction's hash and block in its payload.
- Research: see ADR-0042, "Research".
- Review, 2026-11-19: the reviewer returned ISSUES with three blocking points, all fixed in this pull request: the start call is retried only when the seller's start mapping names its idempotency header (now stated, measured at `examples/seller-adapter-api.ts:485-486`); a silent operator could still stop a start through the every-operator read (the chain read now gates the start in PR 2, which closes the open question); the chain read beside the reason for rejecting A1 (now explained, with the tokens re-estimated). Lower findings fixed: one wrong test path, two line numbers, "waits forever", private deals' per-deal keys in the log filter, the build plan's overlaps with PRs 714 and 715, a fixture for options B and C, and the titles.
- Checks, measured: `pnpm vitest run tests/decisions-status.test.ts tests/design-map.test.ts` passed (125 tests); the reviewer ran `node scripts/id-check.mjs --title "T-573: …" --branch t-573-funded-push`, which passed; the diff holds no term from the private deny list as a whole word.

## Decisions

- The record is ADR-0042 and D86, both free on `origin/main` and on the open branches at the time of writing [measured].
- The chain read gates a start in PR 2, rather than going to triage: it closes the gap the reviewer found at no extra route, and the research pass had left it open as a question.

## Handoff

Done. Rafa decided D86 on 2026-11-20 ("Use the event feed and the chain read"): ADR-0042 is accepted, D86 is decided, ADR-0017 carries a note that the webhook route is withdrawn, and `site/ref/http-seller.txt` says where a seller learns its deal is funded. The record merged in PR 723; the acceptance in the pull request that closes this task.

Not done, for new tasks: ADR-0042's build plan, PRs 2 to 4 (the follower and the chain read in `examples/` after PR 714; the stream's three repairs after PR 715; the other guides). The coordinator rewords row N210 and reserves those tasks. A site deploy that serves the new paragraph waits for Rafa. No open questions.
