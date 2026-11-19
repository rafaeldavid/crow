# T-568: The seller's deliver command: one pass delivers every funded deal

- **Lane:** demo (agent access: the guides in `site/` and the reference tools in `examples/`)
- **Phase:** 2
- **Depends on:** T-543 (selling from a template), T-472 (the setup command)
- **Paths this task may touch:**
  - The command: `examples/setup.ts`, `examples/setup-seller.ts` (the shared discovery check), `examples/setup-deliver.ts` (new), `examples/setup-deliver.test.ts` (new).
  - The page and the bundle: `site/setup.txt`, `site/setup.mjs` (generated).
  - This file.
  - It changes nothing in `examples/seller-adapter-core.ts`, `examples/seller-adapter-api.ts` or `examples/seller-adapter.ts`, nothing under `packages/`, `apps/`, `spec/schemas/` or `contracts/`, no existing test, and no generated bundle but `site/setup.mjs`.
- **Human gate:** yes, for the site deploy that publishes the new pinned `setup.mjs` and `setup.txt`. The merge is not gated.
- **Status:** review
- **Agent/session:** a session started by the `journeys` session on 2026-11-19 (item 4 of its list of what is missing)
- **Roadmap row:** N196

## What exists

Read in `docs/what-a-deal-can-do.md`, `docs/api.md` and the code at `10322887`.

- **The adapter delivers a funded deal it offered.** Its pass reads each open deal in its journal from every operator, starts the job once the hold is funded, runs the agreed checks on the result, holds a result that fails and names each failing check, and delivers one that passes (`examples/seller-adapter-core.ts`, `advance`). Run as a service it does this every `pollMs`.
- **The setup runs that adapter only inside `first-deal`.** For work not finished, `first-deal` exits 0 at `Held` with `workPath` and `deliverBy`; the person must run it again, on time (T-543). It follows one deal: the folder's first.
- **Nothing tells a seller that a deal was funded.** `POST /v1/webhooks` answers 501 (`docs/api.md`). The operators do list a party's deals: `GET /v1/commitments?party=&role=seller&escrowState=Held`.
- **ADR-0040 assumes a worker** that "watches the funded deals of its contract address" and delivers. None exists.
- **What is missing:** one command a seller's own machine can run on a schedule that delivers every funded deal of the folder, including one the folder's own adapter did not offer, and stops. That is this task.

## Intent

`node ~/.crow/setup.mjs deliver` makes one pass over the folder's funded deals and exits. It reads the deals the adapter's journal holds open, and asks every operator for the funded deals whose seller is one of the folder's addresses. A funded deal found that way joins the journal only when it is exactly this folder's own offer: the folder's key signed its terms, and they equal, field for field, the terms the folder's adapter signs for that buyer at that time. The adapter's own pass then runs once: it delivers each funded deal whose work is in `work/` and passes the agreed checks, holds a file that fails and names each failing check, and leaves the rest. The command prints one line per deal and a last line, and its exit status says whether a funded deal still waits for its work. Run twice, it delivers nothing twice, because the adapter reads the settlement layer before it delivers.

`deliver --schedule` prints the one entry the person adds to the machine's scheduler to run `deliver` every 5 minutes: a crontab line on Linux, a launchd job on macOS; on Windows the command with a note. It installs nothing.

- **Inputs:** the folder (`crow.json`, `adapter.json`, `template.json`, `journal.json`, `keys/signing.key`), the work files in `work/`, the operators' reads.
- **Outputs:** one JSON line per deal (`delivered`, `waiting` with `deliverBy` and `workPath`, `held` with each failing check), one summary line, the exit status: 0 nothing is due, 4 a funded deal still waits for its work, 1 a step failed.
- **Non-goals:** a service, a timer or anything always on; a new route, schema, signed message or contract change; any change to the adapter; the standing seller's contract (T-552), beyond a seam where its address is one more to read; a folder that sells Crow's sample (its first deal delivers itself).

## Context

- ADR-0040 (standing offers), section 3: the seller's worker delivers funded takes; it may decline any.
- D26, D31, D32: bounded loss; the person carries the schedule; no always-on machinery.
- `examples/seller-adapter-core.ts` (`createSellerAdapter`, `advance`, `signerFor`) and `examples/setup-work-api.ts` (`startWorkApi`, `workFor`): read, not changed.
- The test world of `apps/test-agents/src/setup-template.test.ts`: the public demo's world on two origins and Crow's test buyer's real code.

## Acceptance criteria

- [x] `deliver` reads the journal's open deals and every operator's `GET /v1/commitments?party=<address>&role=seller&escrowState=Held` for each of the folder's seller addresses, with one function that names those addresses (`sellerAddressesOf`).
- [x] A funded deal the folder did not offer joins the journal only when every operator serves the same terms, their commitment ID is the deal's, the seller's signature recovers to the folder's address, and they equal the offer the folder signs for that buyer at that time; otherwise one line says why, and nothing is delivered.
- [x] One pass delivers each funded deal with a work file that passes the agreed checks, holds one that fails and names each failing check, and prints the deadline and path of each funded deal with no work.
- [x] A second pass delivers nothing a second time.
- [x] Exit 0 when nothing is due, 4 while a funded deal waits for its work, 1 when a step failed; a run that finds another run working in the folder sends nothing and exits 1. One operator's failed read stops no delivery of the journal's deals. A pass ends within 240 s.
- [x] `deliver --schedule` prints the scheduler entry for this machine and sends nothing; it refuses a line break in any part of the entry.
- [x] No change to the adapter, no new route, schema, signed message or contract change; `site/buy.mjs` and `site/try.mjs` keep their hashes.
- [x] The published `setup.txt` is within `SETUP_MAX_BYTES`; `node site/build.mjs && node site/check.mjs` pass.
- [x] Tests in the local test world: two funded deals, one with work; a second pass; a file that fails a check; a deal the folder did not offer.
- [x] On Sepolia, one deal with Crow's test buyer is delivered by `deliver`, recorded with its commitment ID.

## Out of scope

- The standing seller's contract address as a seller (T-552): the seam is there, the address is not.
- Declining a take on purpose, alerts, a log that keeps more than the last pass.
- A folder that sells Crow's sample.

## Evidence

### The kind's local checks (agent docs and reference tools), on base `c20ba520`

- `node site/build.mjs && node site/check.mjs`: PASS [measured, 2026-11-19]. The published `setup.txt` is 9,974 of 10,000 bytes; before this task it was 9,999 [measured]. The seller's first-deal path (llms.txt and sell.txt) is unchanged at 18,013 bytes [measured].
- `site/buy.mjs` (sha256 `b87e478b…`) and `site/try.mjs` (`71634a90…`) keep their hashes; `site/setup.mjs` is now `2b7cbc68…`, the same after the rebase [measured].
- `pnpm exec vitest run` on `examples/setup-deliver.test.ts`, `examples/setup-bundle.test.ts`, `setup-check`, `setup-list`, `setup-work-api`, `apps/test-agents/src/setup.test.ts`, `setup-template.test.ts`, `tests/site-guides.test.ts` and `tests/metrics/one-click-setup.test.ts`: 162 of 162 pass, 9 of them new in `setup-deliver.test.ts` [measured]. No snapshot fixture is involved.
- `pnpm typecheck` and `eslint` on the four changed source files: no error [measured].
- Control: the bundle on `main` answers `deliver is not a command of this file` and exits 2 [measured].
- On `main` the committed `site/setup.mjs` was current against `examples/` once the workspace packages were built; a worktree without `pnpm build` bundles a wrong file [measured]. Build the packages before `site/build.mjs`.

### The local test world (`examples/setup-deliver.test.ts`)

The demo's world on two origins and Crow's test buyer's real code, as `setup-template.test.ts` runs them [measured, each a test]:

- Deal A is the folder's first deal, Held with no work; deal B was offered with the folder's standing key from another folder, which then went offline. Pass 1 delivers B (found on the operators) and names A's deadline and path: exit 4, one POST to `/deliveries` for B, none for A.
- Pass 2 delivers nothing and changes B's journal entry in no way: exit 4.
- A's file without the `url` column is held, `failed` names `cols` and not `rows`: exit 4. The corrected file is delivered: exit 0. After both are Released a pass prints one line and exits 0; two deliveries in all.
- Declined, with `ready.csv` in place and nothing delivered: a standing-key deal paying another address, one selling other work, one at 1 base unit, one whose served signature is another key's, and one whose judging window is 1 s longer. Exit 0: the folder owes them nothing.
- One operator listing a deal nobody serves, or answering 500 on its list: the journal's own deal is still delivered, the failure is named, exit 1.
- No deal: one line, exit 0, no POST. No state file, or a live lock: exit 1, nothing sent.
- `--schedule` on macOS: a launchd plist with `StartInterval` 300 s and `/bin/sh -c`, every path quoted (a folder named `it's a folder`), Node started through `env -u` for the three refused settings; no POST. A line break in `--operators` exits 2; one in the folder path exits 1 with no entry.

### Sepolia, Crow's live operators and test buyer, 2026-11-19 (UTC)

Built `site/setup.mjs` from this branch, a fresh folder under `reports/scratch/`, the template of `setup-template.test.ts` (CSV with `name` and `url`, 2 to 500 rows, 5,000,000 base units, 5.00 tUSDC). Test tokens only; no Sepolia ETH was used by the seller [measured: the operators relay].

| Step | Time (UTC) | Result |
| --- | --- | --- |
| `first-deal`, no work | 20:40:33 to 20:41:05 | `Held`, exit 0, `deliverBy` `2026-11-20T19:40:52Z` |
| `deliver`, no work | 20:41:13, under 1 s | the deal `due` with its deadline and path, exit 4 |
| `deliver`, work in place | 20:59:09 to 20:59:14 | `Delivered`, 60 bytes, exit 0 |
| `deliver` again | 20:59:22 | nothing delivered, exit 0 |
| `first-deal` again | 20:59:30 | `Released`; the deal record's checks 15 passed, 0 failed, 5 not run; the operators agree |

- Commitment ID: `0x07e9e24fac3f1443c51cb34395599833e87233a686d3c506583778a5f752769e` [measured].
- The live operators answer the seller list read (`role=seller&escrowState=Held`) [measured: pass 1 read it with no failure line].

### The review and the red team

- **Reviewer: ISSUES** [measured, its report]. Medium: one operator's failed list or terms read stopped the whole pass; a pass had no time limit; a failed step on an unfunded deal read as "nothing is due". Low: declined deals counted as due; no price check; no folder check before delivering; Windows; wording.
- **Red team: one High** [measured, its report]. A deal the standing key signed elsewhere at 1 base unit got the folder's `ready.csv` (its test measured one delivery). The folder's own adapter signs every deal with a fresh key, so every deal under the standing address comes from outside the folder. Medium: one operator stops the pass; a line break in `--operators` became a second crontab entry. Low: a hung read holds the lock; a stale lock after a recycled process number; smaller items.
- **Fixed in one round**, each with a test: admission is now field-for-field equality with the offer the folder signs (`publicOfferTerms`, as `verify.ts` checks the adapter's own offers); each operator's list and each listed deal fail on their own line and the journal's deals still go; declined deals are not due; the folder's check runs first; a pass ends within 240 s; `--operators` and the printed entry refuse control characters; the entry clears `NODE_OPTIONS`, `NODE_EXTRA_CA_CERTS` and `NODE_USE_ENV_PROXY`.

## Decisions

- **A deal the folder did not offer joins only when it is exactly the folder's own offer.** The operators' list says which deals name the folder's address; it is not trusted for more. From every operator's answer: the commitment ID, the seller is one of the folder's addresses, the seller's signature over the terms recovers to it, and the terms equal, field for field, `publicOfferTerms` of the request the folder's adapter makes, with the buyer's fields, the nonce and `createdAt` taken from the deal. That covers the payout address, the template, the price, the club, the adjudicators and their fee, and every window. The folder's own adapter signs each deal with a fresh key (`signingKey: "per-deal"`), so a deal under the standing address was signed outside the folder: by a second machine of the seller's, or by a leaked key (ADR-0040, finding 9). Exact equality keeps the folder's finished work (`work/ready.<ext>`) from going to a deal priced or judged otherwise (red team F1). A declined deal is named with its deadline, is not counted as due, and ends in the buyer's refund (ADR-0040: the worker may decline any take).
- **One operator's failed read is one line.** Each operator's list and each listed deal's terms are read on their own; a failure is named, the pass counts as failed (exit 1), and the journal's deals are still delivered (red team F2, review finding 1).
- **A pass ends within 240 s,** a minute under the interval. On time-out it prints a line, removes the lock and ends the process; a delivery the adapter recorded as started is read from the settlement layer before anything is sent again.
- **The folder's check runs first,** as in `first-deal`: a changed `adapter.json` or key mode delivers nothing.
- **The adapter's own pass, unchanged, is the delivery.** `deliver` adds an admitted deal to the journal at the stage `offered`, the stage the adapter gives a deal when it signs it, and runs the core's pass once. The core then reads every operator, starts the local job, runs the agreed checks, holds or delivers, and reads the settlement layer before any delivery. No delivery or check code is new.
- **Exit 4 for "work is due".** Exit 0 says nothing is due, 1 a step failed, as in the other commands; 4 is new and only `deliver` uses it, so a scheduler's log or the person's assistant tells "waiting" from "broken".
- **The schedule is printed, never installed.** Every 5 minutes (fixed: the person edits the entry to change it). Each pass replaces `deliver.log`, so the log holds the last pass only; the journal and `deals/` keep the history. launchd on macOS, cron elsewhere; Windows gets the command and a note.
- **The discovery check is one function.** `first-deal` and `deliver` pin the settlement layer through `pinnedReader` (`examples/setup-seller.ts`), with `first-deal`'s refusals word for word.
- **The page's bytes.** The published `setup.txt` had 1 byte left. The new sentence took its bytes from three that other lines already carry: "Fix what a failed line names, then run it again" (each failed line says so), "The file is not minified", and how `--payout` changes before the first deal (the seller command handles it).
- **`pinnedReader` lives in `examples/setup-seller.ts`,** beside the folder's other shared helpers: in `setup-deliver.ts` it would make `setup.ts` and `setup-deliver.ts` import each other.

## Handoff

**Done.** `node ~/.crow/setup.mjs deliver` and `deliver --schedule`, with their tests, the page line and the rebuilt bundle. Measured in the local test world and on Sepolia (Evidence). The pull request merges with no gate.

**What Rafa must deploy.** The site deploy that publishes the new pinned `site/setup.mjs` (sha256 `2b7cbc683e4171c833edfc5914b03a700ec77936fc02180c00c8347a3ac64010`) with `site/setup.txt`, whose command carries that hash. Until then crow.direct serves the old file and its hash, and `deliver` is not in it.

**For T-552 (the standing seller's contract).**
- Add the contract's address to `sellerAddressesOf` (`examples/setup-deliver.ts`) with a kind of its own, and give `signedBy` its check: ERC-1271, since no key recovers for a contract.
- The expected terms in `admission` are a per-buyer offer's; a standing take's terms come from its template and the take's dates, so the rebuild needs the take's own rule there.
- The adapter's `signerFor` refuses terms whose seller is neither the key's address nor a deal key, so it cannot deliver a take whose seller is the contract: that needs a signer for the contract's key path, outside this task's no-adapter-change rule.

**Left, each for the backlog or triage.**
- The lock (`locked`, `setup-seller.ts`, before this task): a lock left by a killed run whose process number another user's process now holds reads as live, and every pass exits 1 until the lock is deleted (red team F5, inferred). The fixed work-API port is a second guard against two passes at once.
- Windows gets the command and a note, not a Task Scheduler entry.
- More than 2,000 funded deals listed for one address by one operator: the pass reads the first 2,000, says so and exits 1.
- The printed entry names Node by its full path; moving that Node (an nvm upgrade) needs the entry printed again, which its line says.
- The adjudicators' encryption keys come from registrations the operators serve (`agent.ts`), as in every delivery before this task (red team, outside T-568).
- No test runs a pass that reaches its 240 s limit end to end; `withDeadline` has a unit test.

**How to resume.** Branch `t-568-seller-deliver`. Build the packages (`pnpm build`) before `node site/build.mjs`.
