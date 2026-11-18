# T-543: Sell work from a template with the setup command

- **Lane:** demo (agent access: the guides in `site/` and the reference tools in `examples/`)
- **Phase:** 2
- **Depends on:** T-472 (the setup command and `setup.txt`), T-486 (the listing step)
- **Paths this task may touch:**
  - The command: `examples/setup.ts`, `examples/setup-seller.ts`, `examples/setup-check.ts`, `examples/setup-work-api.ts` (new), `examples/setup-work-api.test.ts` (new), `apps/test-agents/src/setup-template.test.ts` (new).
  - The pages and the bundle: `site/setup.txt`, `site/sell.txt`, `site/setup.mjs` (generated).
  - This file.
  - It changes nothing in `examples/seller-adapter-core.ts` or `examples/seller-adapter-api.ts`, nothing under `apps/operator`, `apps/demo-cloud`, `packages/`, `spec/schemas/` or `contracts/`, no existing test, and no generated bundle but `site/setup.mjs`.
- **Human gate:** yes, for the site deploy that publishes the new pinned `setup.mjs` and the two pages. The merge is not gated.
- **Status:** review
- **Agent/session:** `sell-from-template`, started by the `journeys` session on 2026-11-18
- **Roadmap row:** N195, N160

## What exists

Read in `docs/what-a-deal-can-do.md` and the code at `21bb4e54`.

- **The setup command sells Crow's sample only.** `node setup.mjs seller --sample` makes the folder; `first-deal` sells `squares.csv` to Crow's test buyer through a three-call API on the loopback address (`examples/setup-sample-api.ts`), which the seller adapter runs against inside the command's own process (T-472, T-486).
- **The adapter already does the judging part.** It runs the agreed checks on a result, holds a result that fails them, names each failing check, and delivers a corrected one (`site/ref/seller-adapter.txt`, "Deliver" and "Fix a refused report"). It reads "still running" as HTTP 202.
- **A seller with its own API has a path** (`site/sell.txt`): clone, configure the adapter, run it as a service.
- **What is missing:** a seller with no API, or with work that is not finished, has no path. The setup's `first-deal` also waits 1,200 s for the deal to end and then fails, so it cannot serve work that takes longer. That is this task.

## Intent

A seller describes what it sells in one JSON file, the template: the work and its format, a fixed price, the declarative checks, and how long after the offer the work is due. The setup command offers that to Crow's test buyer. Once the buyer has funded the hold, the command stops and says where the work goes and when it is due. The seller, or its assistant, does the work and puts the file there. The same command, run again, runs the agreed checks on the file, holds a file that fails and names each failing check, and delivers one that passes. A seller whose work is finished names the file at the start, and one run ends `Released`.

- **Inputs:** `seller --template <file> [--file <path>] --payout <answer>`; later, a work file in the folder's `work/` directory; `check --work <file>` for a sample of the work.
- **Outputs:** the folder (a second kind beside `sample`), the `first-deal` line at `Held` with `deliverBy` and `workPath`, the line that names each failing check, the deal record at `Released`.
- **Non-goals:** a buyer's input to the work (the template takes no scope; the standing-offers ADR decides that), a published offer, a hosted seller with a file source, any change to a route, a schema, a signed message, a contract or the adapter's core.

## Context

- The design: the private study of 2026-11-18 (T-532, section 5.3), with Rafa's words "Yes, reshape it" and, for the pause on the setup track (row N160), "Yes, lift it", for this task only.
- D31 and D32: warnings, never refusals, for values the parties can manage; a party that can protect itself with a check carries that.
- `examples/seller-adapter-core.ts` (`advance`, `refuse`, `configFrom`) and `examples/seller-adapter-api.ts` (`sellerApi.auth`, the 202 status): read, not changed.
- `apps/test-agents/src/buyer-rules.ts`: the test buyer takes work due within 86,400 s of the post, 1 to 10 checks with at least one required, and at most 50 tUSDC.

## Acceptance criteria

- [x] `seller` takes `--template <file>` and an optional `--file <path>` beside `--sample`; the folder's state gains the kind `template`.
- [x] A second API of the same three calls on the loopback address: the quote answers the template's fixed price, the job's ID is the commitment ID, the result answers 202 until the deal's work is in `work/`, then its bytes. With `--file`, the finished work is delivered as soon as the deal is funded.
- [x] `first-deal`, for work that is not finished, stops once every operator shows the deal `Held`, prints one line with the deadline and the exact path for the work, and exits 0. Run again, it continues the same deal and delivers once the work is there.
- [x] The deadline comes from the template; the default fits the test buyer.
- [x] `check` has a branch for the party's own template: the template passes the bundled commitment schema; with a sample of the work it runs the checks on it and on a copy with a field removed; with none it prints one advisory line and fails nothing.
- [x] A work file that fails a check is not delivered, and the output names each failing check; the corrected file is delivered by the next run.
- [x] A format outside CSV, JSON, plain text and Markdown, and finished work over 1 MiB, are refused at `seller`, naming the limit.
- [x] No change to the adapter's core, no new route, schema, signed message or contract change; `site/buy.mjs` and `site/try.mjs` keep their hashes.
- [x] The sample path passes its existing tests unchanged.
- [x] The published `setup.txt` is within `SETUP_MAX_BYTES`; `node site/build.mjs && node site/check.mjs` pass; `site/sell.txt` has one step that points to it.
- [ ] On Sepolia, a seller with a template and no finished work reaches `Held` against Crow's test buyer and ends `Released` after the work is put there; a seller that names `--file` ends `Released` in one run. See Evidence.

## Out of scope

- A template that takes the buyer's input (a scope). The standing-offers ADR answers how.
- A quote address other buyers can reach, and the published form of a template offer.
- Any deal beyond the folder's first deal and `first-deal --again`.
- The rest of the setup track (row N160), which stays paused.

## Evidence

Each item is labelled measured, inferred or guessed.

### Checked before any code

- **A result that stays "still running" across restarts and days does not break the design** [inferred from the code, then measured for restarts]. In `advance` (`examples/seller-adapter-core.ts`), a deal at `started` reads the settlement state and the settlement time, then asks the result call; on "running" it returns and changes nothing. The journal file holds the stage and the job's ID, so a new process continues from it. The only end is the deal's own `deliverBy`: after it, the adapter closes the deal and the buyer may reclaim. The check on a changed start configuration applies only at `starting`, and the folder keeps one port, so the configuration's hash does not change between runs. Measured: the test below stops and starts the command four times on one deal. Not measured: several days; nothing in the code counts time except `deliverBy`.
- **One finding from that reading changed the design, inside the configuration and not the core:** a refused result is fetched again only when `redelivery.refetchEverySec` allows it, and the default is 600 s. The folder's `adapter.json` sets it to 0 (the adapter's own setting: "at every poll"), so the next run reads a corrected file at once.
- **An empty scope is accepted with a party's own template** [measured]. `configFrom` requires `scope` to be present, and `{}` is. `fieldsError` passes an empty scope against empty rules. The test below signs, funds and settles a deal whose scope is `{}`.

### Commands run and results

- `npx vitest run examples/setup-work-api.test.ts`: 10 of 10 tests pass [measured, 2026-11-18].
- `npx vitest run apps/test-agents/src/setup-template.test.ts`: 7 of 7 tests pass in 17 s [measured, 2026-11-18]. They run the built `site/setup.mjs` in its own process against the demo's world on two origins (SimChain, the local test world) and the test buyer's real code:
  - a template and no finished work: `Held`, exit 0, `deliverBy` 82,800 s after the offer, `workPath` under `work/`; a second run prints the same line and makes no second offer;
  - a work file without the `url` column: exit 1, `failed: [{check: "cols"}]`, no delivery posted; a third run with the same file says the same;
  - the corrected file: `Released`, one delivery posted, a deal record whose checks pass;
  - `--file` at the start: `Released` in one run, with the template's own window of 3,600 s;
  - finished work that fails the template's checks: the check fails and `first-deal` sends nothing.
- `npx vitest run apps/test-agents/src/setup.test.ts examples/setup-bundle.test.ts examples/setup-check.test.ts examples/setup-list.test.ts`: 55 of 55 pass, with no change to those files [measured, 2026-11-18].
- `node site/build.mjs && node site/check.mjs`: PASS [measured]. The published `setup.txt` is 9,999 of 10,000 bytes [measured]; before this task it was 9,984. The seller's first-deal path (llms.txt and sell.txt) is 17,462 bytes, 4,366 of 5,000 estimated tokens [measured].
- `site/buy.mjs` and `site/try.mjs` are unchanged: `git status` lists neither after the build [measured].
- Sepolia: see "The live runs" below.

### The live runs

Filled in after the runs on Sepolia.

- Snapshot diffs: none; the task changes no scenario fixture.
- Metrics: none recorded.

## Decisions

Choices made inside this task. None changes architecture, a contract or a defense.

1. **The template is one JSON object with four fields:** `deliverable` (`kind`, `description`, `format`), `price` (base units, a decimal string), `checks`, and an optional `deliverWithinSec`. The setup writes the deliverable and the checks as the adapter's deal template and keeps the price, the format and the window in `crow.json`. It refuses only what cannot become an offer: a price or a window that is no whole number, a format no delivery has, a field this version does not take, a placeholder (the template takes no scope). Any window and any price the encoding holds is taken (D31).
2. **The default window is 82,800 s (23 hours).** The test buyer counts the window from settlement time at the post and refuses more than 86,400 s; an hour of room covers a seller's clock that runs ahead.
3. **The work's place is `work/<commitment ID>.<csv|json|txt|md>`.** The finished work of `--file` is copied to `work/ready.<ext>`, and the work API answers with it for any deal that has no file of its own. So `first-deal --again` delivers it too, and nothing is copied per deal.
4. **The work API takes a credential made for each run.** The folder is mode 0700, and the commitment ID is public: without a credential, any account on the machine could read unpaid work through the port. The adapter's own `sellerApi.auth` carries it, from the `env` object the setup passes, never from the process's environment.
5. **Work is read through no symbolic link**, with `O_NOFOLLOW`, and a file that is empty, over 1 MiB or no plain file counts as not there yet. The `first-deal` line says why. A path the person names with `--file` or `--work` may be a link: the person chose it.
6. **The setup reads no file whose name starts with `.env`,** for `--template`, `--file` and `--work`.
7. **A named sample that fails the template's own checks fails `check`.** That is a contradiction the adapter would act on: it would hold the delivery. No sample at all is advice only, and so is a copy with a field removed that still passes: what a party's checks hold is the party's to decide (D31, D32).
8. **A folder sells one kind for good,** and keeps its template while a deal is open. Before a deal, and after one ended, the same command with another `--template` replaces the price, the window and the checks.
9. **A file the adapter refused ends the run with exit 1** and `failed`, the list of failing checks. The deal stays open; the next run reads the file again.
10. **`setup.txt` stayed within 10,000 bytes by cuts, not by a raised limit.** The template path's paragraph is 513 bytes [measured]. The cuts: the list of what `check` checks (each check line says it), part of the `status` sentence, and four small phrases. The template's shape is not on the page: `seller` with no flag prints it, so only an assistant on that path pays for it.

## Handoff

**Done:** the code, the tests and the two pages, on branch `t-543-sell-from-template`.

**For Rafa: the site deploy.** The new pinned `setup.mjs`, `setup.txt` and `sell.txt` reach crow.direct only with `pnpm site:deploy` from `main` after the merge (`docs/operations.md`). Until then the live page pins the earlier file, which sells the sample only.

**Not done, by design:**
- `docs/what-a-deal-can-do.md` has no line for selling from a template. It is a shared doc; the coordinator adds it.
- The roadmap rows N195 and N160, the daily log and the links: the coordinator's.

**Follow-ups, none started:**
- Several days with no result were read in the code and not run.
- `status` shows `workPath` for the first deal only, as this version runs one deal at a time.
- The test buyer's wider limits (1,000 tUSDC and 7 days) are another task; when they land, the default window can grow with them.

**How to resume:** the worktree is `.worktrees/t-543-sell-from-template`. `node site/build.mjs` rebuilds the bundle the tests run; the tests are the three files named under Evidence.
