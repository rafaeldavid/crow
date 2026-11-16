# T-492: the deal record never reads a refused read as missing data

- **Lane:** agent access (the buyer's and seller's record tool in `examples/`, bundled into `site/buy.mjs` and `site/setup.mjs`)
- **Phase:** 2
- **Depends on:** T-333 (the deal record)
- **Paths this task may touch:** `examples/deal-record.ts`, `examples/deal-record.test.ts`, `examples/record-seller.test.ts` (one wait), `site/buy.mjs` and `site/setup.mjs` (regenerated), this file.
- **Human gate:** yes, for the site deploy that publishes the new `buy.mjs` and `setup.mjs`, which is Rafa's. He chose to change the pinned files on 2026-11-16 ("Fix it first").
- **Status:** review
- **Agent/session:** the expo/exact review session, 2026-11-16, branch `t-492-record-refused-reads`.
- **Roadmap row:** N164
- **Change kind:** 4 is the nearest (code that agents run); one `reviewer` pass, since the record is a party's evidence of where the money went.

## Intent

Restated in my own words.

The deal record (`buy.mjs record`, and the seller's record inside `setup.mjs`) reads each operator and writes what happened to a deal. Its `get` returned "no data" for any answer other than 200. A 429 rate limit or a 500 on the events read therefore left the record with no postings, and a refunded deal's record said `refundedTo: null`, with no error and no failed check. On a busy operator the record could tell a buyer that no refund had reached it.

This caused a CI failure on PR 594 (2026-11-16 06:39 UTC) in `examples/buyer-signer-addresses.test.ts:407`. The refund had landed, since the balance check on line 405 passed, but the record said no refund. The session first reran the job to get past it; Rafa rejected that ("That is a dangerous thing to do"), and this task fixes the cause.

The fix: every read retries a 429 after the wait it names (at most 30 s) and a 5xx or no answer after 1 s, three tries in all. A read still refused is named in a new check, `every read answered`, with `ok: false`. The record then never presents a gap as a fact.

## Acceptance criteria

1. A 429 or a 500 on a read is retried, and the record then holds what the read returned.
2. A read still refused after its tries makes `every read answered` fail and names the operator, the path and the status.
3. Existing record tests pass. The pinned `buy.mjs` and `setup.mjs` are rebuilt; `try.mjs` and the goal files keep their hashes.

## Evidence

All measured on 2026-11-16 in the worktree, on Node 22.22.2.

- **The cause:**
  - [measured] `vitest run examples/buyer-signer-addresses.test.ts --repeats 15`, before the fix, gives `rate_limited: too many requests` from the test world, which allows 1,200 reads a minute per client (`apps/demo-cloud/src/limits.ts`).
  - [read] `get` (`deal-record.ts`) returned `body: null` for any answer other than 200, and `read()`'s `page()` stopped on it.
  - [inferred] The CI run's record met a refused read. Its log shows the result, `refundedTo: null` after a landed refund, but not the read.
- **The fix, tested:**
  - `examples/deal-record.test.ts`, T-492: events refused twice with 429, then twice with 500, are retried. Each time the record carries `refundedTo` and `every read answered` is ok.
  - Events always refused make the check fail, naming `<operator>: /v1/commitments/<id>/events answered 429 after 3 tries`.
- **The other tests:**
  - `vitest run examples/deal-record.test.ts examples/record-seller.test.ts examples/audit-deal.test.ts examples/buyer-signer-addresses.test.ts`: 71 of 71 passed.
  - `examples/record-seller.test.ts`: its restart test now waits for the second run, up to 10 s, in place of a fixed 300 ms. The record retries the operator that is down for about 2 s first.
- **The bundles:** `node site/build.mjs && node site/check.mjs` passes. Hashes, first 16 hex digits, before and after:
  - `site/buy.mjs`: `e74ff2230f0d4fd4` to `dacd061cce22b387`.
  - `site/setup.mjs`: `3b2b84e017df5679` to `9fb75acbb37be682`.
  - `site/try.mjs`: `04ef4434fb4b5635`, unchanged.
  - Only dated records name the old hashes; no partner kit does (searched the public repository and crow-private's `design-partners/`, `control/` and `strategy/`).
- `eslint` on the changed files and `tsc -p examples/tsconfig.json --noEmit`: no findings.
- **Review:** one `reviewer` pass returned PASS with no blocking finding. Its three notes are fixed here:
  - A ciphertext that no operator would serve now names its refused reads in `every read answered` (new test).
  - `setup.ts`'s `writeRecord` keeps its 10 rereads but stops after 2 minutes on the live service, since a refused read now fails a check.
  - A retried answer's body is cancelled before the wait.

  After the fixes: the record tests 72 of 72; the setup tests (`setup-bundle`, `setup-list`, `setup-check`, `one-click-setup`) 104 of 104; the site check passes.

## Handoff

- **Old install lines fail safely.** The site deploy publishes the new `buy.mjs` and `setup.mjs`, and the guides carry the new hashes. An install line copied before the deploy now fails its hash check and runs nothing.
- **A record can now take up to about 90 s longer.** A read refused three times waits up to 30 s each time; a record with one operator down waits about 2 s more.
- **Left for later, not in this task:** `buyer-signer.ts`'s own reads and the test stand-in seller also take a 429 without retrying (seen only under 15 back-to-back repeats). `deal()` in `deal-record.test.ts` treats `finalAt` as the deal's end, although the world may still append `appeal.expired` about 1 s later. Both are in crow-private `roadmap/triage/2026-11-16-exact-lessons.md`.
