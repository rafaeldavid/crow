# T-555: publish the outside scan of Crow's contracts and its review of the fixes

- **Lane:** docs and site
- **Phase:** 2
- **Kind:** 2 (docs and records), 1 (the trust page), with a test that follows the published files
- **Depends on:** T-523 (the triage), T-527 to T-529 (the fixes on `contracts-audit-ready`, tip `d621291e` for the review), T-553 (the fix review's deal)
- **Paths this task may touch:** `docs/audit/outside-scan.md`, `docs/audit/outside-scan/`, `docs/audit/known-issues.md`, `docs/audit/README.md`, `site/trust.mjs` and the files `site/build.mjs` renders from it (`site/trust.txt`, `site/trust.html`), `tests/outside-scan.test.ts`, this file. Never `contracts/src/`, the lane, `spec/schemas/`, `.github/` or the pinned bundles.
- **Human gate:** yes: publishing the reviewers' output and naming them (Rafa's answers, 2026-11-19), and the site deploy
- **Status:** done
- **Agent/session:** the T-555 session, started by the coordinator on 2026-11-19
- **Roadmap row:** N193

## What exists

- `docs/audit/known-issues.md` already lists the scan's confirmed findings as OS-1 to OS-5 without naming the reviewers. The full list of 69 findings, the fix review and its new finding are private.
- The trust page (`site/trust.mjs`) lists "An outside audit of Crow's own contracts" as coming soon, and answers "Has the rules contract had an external audit?" with "No".

## Intent

Publish what the outside firm did to Crow's contracts, in words that claim no more than that:
- the redacted output of both runs;
- Crow's page, with every finding, its status and the fix review's verdict;
- a check that the redaction holds;
- the trust page's two lines corrected.

**Non-goals:** any contract change, a deploy, a message to the reviewers.

## Rafa's answers (2026-11-19, in this session)

- (a) Naming: "Name them now". The public files name Zero Cool, the firm, and none of its people.
- (b) Timing: "Publish now, marked open". The three open items are `696fcaca`, `8a875efc` and `bf7f2cb1`.
- (c) Form: "Both". Crow's page with every finding, and the reviewers' files with identifiers removed.
- (d) The trust page: shorter. Say that further reviews follow over time as partners ask, and that Zero Cool's AI deep scan reviewed the contracts. Mention its Sherlock and Cantina contest results.

## Acceptance criteria

- [x] `docs/audit/outside-scan.md` states what was reviewed, by what process, on which commits and when, and gives the result. Then every finding, what stays open and why, and how to check it.
- [x] The redacted data files are written by `docs/audit/outside-scan/redact.mjs` and checked by `tests/outside-scan.test.ts`.
- [x] `known-issues.md` and the trust page match, and "Coming soon" no longer lists a review that has happened.
- [x] Rafa's go on the diff ("Yes, go", 2026-11-19). Then pull request 686, merged by hand once every check passed: 14 passed and 4 skipped at `4d102e5a`, merged as `81ccce23` at 14:51:28 UTC.

## Evidence

- **The redaction** [measured]: `node docs/audit/outside-scan/redact.mjs <private crow-scan folder>` wrote `first-scan.json` (308,239 bytes, the job and 76 artifacts) and `fix-review.json` (348,299 bytes, the job and 81 artifacts). The written files contain no UUID and no email address. The private deny-list check, with the private roadmap's folding rule, finds no term in either file.
- **The test** [measured]: `pnpm exec vitest run tests/outside-scan.test.ts` passes 12 of 12 on the maintainer's machine, the 2 private-copy checks included. As a probe, the requester's name from the originals and an email address were planted in `site/trust.txt`. The test then failed 2 of 12 (the email check and the originals check), and passed again once the file was restored.
- **The table** [measured]: 70 findings, 70 triage rows. By Crow's status: open 3, fixed in part 1, fixed in the new version 10, fixed off chain 4, deploy check 2, accepted limit 47, not a defect 3.
- **The contracts** [measured]: `contracts-phase-one-1` is `27ab44e8bf359783116a95eb45102c95ce5c3ed6`. `contracts/src` at `d621291e` and at `origin/contracts-audit-ready` (`1a573345`) is the tree `c4edcfb1185a34f5a205d9170e0ae690c758c157`. `contracts/src` on `main` equals the tag's tree, `9c1b2e54bcbfd2d5ade7beac8b1cb74f0656815a`. This change touches neither.
- **The site** [measured]: `node site/build.mjs && node site/check.mjs` passes. The first-deal paths are unchanged: buyer 4,888 of 5,000 tokens, seller 4,509 of 5,000 (estimates: bytes divided by four). `site/setup.mjs`, `site/buy.mjs` and `site/try.mjs` are unchanged.
- **The reviewers' terms** [reported: zerocool.ai/terms, last updated 2026-11-12, read on 2026-11-19]:
  - Section 8: the customer owns its findings and report content, and may publish them, including for disclosure.
  - Section 7: the same reports are the customer's confidential information, and the terms do not reconcile the two sections.
  - The contest results on the trust page are Zero Cool's own claims (zerocool.ai home page): first place in two Sherlock contests in September 2026, linked to the firm's own posts, and second place in Cantina's Mento V3 contest in December 2025, linked to Cantina's leaderboard.

## Handoff

- **Deployed** on Rafa's word ("go ahead and deploy when ready"). **Site deploy 2026-11-19 14:52 UTC, commit `81ccce2` on a detached HEAD: pass.** crow-site `1d90ca19-101f-4d1e-ba1e-5d0dcda82328` (rollback target `ed7a837e-21b0-440f-bdb5-1d0896b3c207`). https://crow.direct/trust.txt serves the new words [measured, 14:53 UTC].
- **CI found two defects at `b9077cca`, both fixed in `4d102e5a`:** CodeQL flagged a table cell that did not escape a backslash, and `tests/ci-gated.test.ts` needed the redaction test's two private-copy cases exempted, with the reason.
- **Not done here:**
  - the threat model's TA-7 and contract-signer row, which the fix review finds still wrong for `696fcaca`;
  - the fix review's text items (the `_call` NatSpec, `IHoldbackBeacon`'s declarations). Both belong to the open choices in `outside-scan.md`.
- **The private deny list** still lists the firm's name. The test allows only those two terms, on Rafa's word.
