# T-628: Cold sellers start from their own work in setup.txt

- **Lane:** demo (agent access: the guides in `site/`)
- **Phase:** 2
- **Depends on:** T-472 (the setup command and `setup.txt`), T-543 (selling from a template), T-552 (`publish`)
- **Paths this task may touch:**
  - The page: `site/setup.txt`.
  - The command's tail: `setupCommand` in `site/build.mjs`, and the two checks that pin it, `site/check.mjs` and `examples/setup-bundle.test.ts`.
  - This file.
  - It changes no generated bundle: `site/setup.mjs` keeps its SHA-256.
- **Human gate:** yes, for the site deploy that publishes the page (the coordinator's, batched). The merge is not gated.
- **Status:** in progress
- **Agent/session:** `cold-sellers-setup`, started by the `journeys` session on 2026-11-26
- **Roadmap row:** N213, N195

## What exists

- **The page.** `site/setup.txt` leads with Crow's sample: its one command ends `node setup.mjs seller --sample`, and the seller section opens with `seller --sample --payout <answer>`. The person's own work (`--template`, `--file`) comes after, in a paragraph that also holds `deliver` and `publish`.
- **The measurement.** crow-private `case-studies/cold-sellers-2026-11-26/README.md` (measured 2026-11-26, 8 runs): a median of 6 approvals on the first deal and 6.5 on the standing offer, against a pass mark of 5. The floor is 5 on both paths. The 25 calls above it trace to three places on the page:
  1. the command ends `seller --sample`; one DeepSeek run ran it as written, sold the sample and never sold its file (16 calls above the floor);
  2. "`seller` alone prints its shape" and "`status` prints the folder's state" led DeepSeek to run both before the folder existed (8 calls in 4 runs);
  3. the `publish` paragraph ends "More: https://crow.direct/sell.txt", which 3 of 4 standing-offer runs read (4 calls).
- **The command already answers a bare `seller`** with exit 3 and the questions, the template's shape among them (`examples/setup-seller.ts`, `QUESTIONS`). Nothing in the command needs to change.

## Intent

Make a cold seller's assistant reach the floor of 5 approvals from `setup.txt` alone. The page leads with the person's own work, gives the template's shape so no exploratory call is needed, says that nothing runs before `seller`, and gives `publish` a complete paragraph of its own. The sample stays, as the practice option. Then measure with the same runner and pass rule, and say which calls above the floor went and which stayed.

- **Inputs:** the report's three places, the page's byte limit (`SETUP_MAX_BYTES`, 10,000 bytes, `site/guides.mjs`).
- **Outputs:** the page, the command's tail without `--sample`, and a second set of 8 runs in crow-private.
- **Non-goals:** the two approvals of one decision (preview and send) and `list --skip`, which keep the floor at 5; any change to `setup.mjs`; the runner's fence on `--name`.

## Acceptance criteria

- [x] The one command names no product: it ends `node setup.mjs seller`, and the line after it names `--template <file> --file <path>` first and `--sample` as practice.
- [x] The seller section opens with `seller --template <file> --file <path> --payout <answer>`, gives the template's four fields, and says nothing runs before it.
- [x] The page no longer says "`seller` alone prints its shape" or describes `status` before the folder exists.
- [x] `publish` has its own paragraph, names where its card goes, and does not point to `sell.txt`.
- [x] The published page is at most 10,000 bytes, and `node site/check.mjs` passes.
- [x] `site/setup.mjs`'s SHA-256 is unchanged.
- [ ] A second set of 8 runs, same runner, models and pass rule, recorded in crow-private beside the first.

## Out of scope

- Allowing `--name` in the runner's fence (the report's suggestion for a later set): this set keeps the fence, so the two sets compare.
- Cutting the floor below 5 (one approval for preview and send; `list --skip` for a question already answered).

## Evidence

- **Page size** [measured]: the published `setup.txt` is 9,980 bytes (was 9,998), limit 10,000.
- **Hash** [measured]: `site/setup.mjs` is `5d7636bd9f7671523d3436a37e816c1770042e5346e736e5ebd872aa806ed0c9` before and after `node site/build.mjs`.
- **Checks** [measured]: `node site/build.mjs && node site/check.mjs` PASS. `pnpm vitest run tests/site-guides.test.ts examples/setup-bundle.test.ts`: 2 files, 41 tests passed.
- **The runs:** after the deploy; see Handoff.

## Decisions

- **The command names no product.** Ending it at `seller` stops the literal-follow failure and still costs nothing: run as written, `seller` exits 3 with its questions and makes nothing. `site/setup.mjs` is untouched, so its pinned SHA-256 holds.
- **Absolute paths.** The command runs `cd ~/.crow` before `seller`, and `--template` and `--file` resolve against the working directory (`realPath`, `examples/setup-seller.ts`), so the page asks for absolute paths.
- **Bytes.** The page was 2 bytes under its limit. The additions were paid for by the folder's list, now one sentence; the `kept` field, which `publish`'s own line carries; and five phrases of wording. Every phrase `site/check.mjs` requires stays.

## Handoff

- **Done:** the page and the command's tail, merged in rafaeldavid/crow#843 at `f0568298` (2026-11-26, 08:27 UTC); every check passed.
- **The measurement is now a light check** (Rafa, in the journeys thread, 2026-11-26: accept the page as is if it works for testing). One cold run per path on the live page: DeepSeek on the first deal, where the first set's DeepSeek run sold the sample, and Claude on the standing offer, where both Claude runs read `sell.txt`. Same runner, brief and fence as the first set. Each run must reach its outcome; its approvals go beside the 2026-11-26 set in crow-private. The page is not changed again to reach 5: calls still above the floor go here as findings for later.
- **Waiting, 08:28 UTC:** the site carrying `f0568298` is not live. The coordinator's 07:29 UTC operators deploy at `9375c7d` failed and rolled back to `5220712`, and the site was not deployed. The coordinator has been asked to include #843 in its next site deploy. **To resume:** once the coordinator says that site is live, download `setup.mjs` by the page's own line into the scratch folder's `dl2/`, then run `reports/scratch/set2/light.sh` from this task's worktree.
