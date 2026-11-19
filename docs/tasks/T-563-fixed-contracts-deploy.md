# T-563: the fixed contract version is live on Sepolia

- **Lane:** contracts deploy, operators, test agents, hosted sellers, site and docs; on the lane `contracts-audit-ready` and on `main`
- **Phase:** 2
- **Kind:** a contracts cutover by `docs/redeploy-contracts.md`, with docs (2) and deploy-script fixes
- **Depends on:** T-540 (the fixed version is ready), T-553 (the fix review and D85)
- **Paths this task may touch:** `contracts/deployments/`, every pin `scripts/record-copies.mjs` writes, `docs/redeploy-contracts.md`, `contracts/script/` and `scripts/` for rehearsal fixes, `docs/operations.md`, `docs/audit/`, `site/` for the trust page's words, this file. Never `contracts/src/`.
- **Human gate:** Rafa's go for the whole runbook (2026-11-19); his hands for the contract deploy with his keystore, the live rounds and the tag push
- **Status:** done
- **Agent/session:** the T-563 session, started by the coordinator on 2026-11-19
- **Roadmap row:** N187

## What exists

- Two contract versions. The first, tag `contracts-phase-one-1` (`27ab44e8`), is deployed on Sepolia, and every live service points at it. The fixed version is the first plus four fixes, on the lane `contracts-audit-ready`: `contracts/src` tree `c4edcfb1185a34f5a205d9170e0ae690c758c157`, the same as at `d621291e`.
- An outside firm's fix review read `d621291e` on 2026-11-19 and rated nothing above Informational (`docs/audit/outside-scan.md`). D85: two findings stay known limits in phase one, and the review's new finding waits for the next version.
- The runbook is `docs/redeploy-contracts.md`; T-540's Handoff lists the steps in order.

## Intent

Deploy the fixed contract version on Sepolia exactly as reviewed, point every live service at it (both operators, the test agents, both hosted sellers, the site's pinned buyer bundles), merge the record into `main`, tag it `contracts-phase-one-2`, and leave the records true.

**Non-goals:** any change to `contracts/src`, NatSpec or a test's meaning; the next contract version's fixes; the pilot's rehearsal cases (runbook step 11.5).

## Acceptance criteria

1. `contracts/src` at the deployed commit has tree `c4edcfb1185a34f5a205d9170e0ae690c758c157`, before the deploy and in the record.
2. The five contracts are created on Sepolia, `--check` passes, and Sourcify reports an exact match for all five.
3. Both operators' discovery names the new rules contract and the deployed commit; a fresh deal from the site's command ends Released on it; a newly refused message gets its named refusal.
4. The test agents and both hosted sellers read `operational` on the new contracts.
5. The site serves the re-pinned bundles, with their hashes checked live.
6. `main` carries the merge, and the tag `contracts-phase-one-2` exists on it.
7. `docs/operations.md`, `docs/audit/scope.md`, `known-issues.md`, `outside-scan.md` and the trust page say which version is live.

## Evidence

All measured on 2026-11-19 unless marked; the dated record is `docs/operations.md`, "The fixed contract version: new contracts, a new world". Results and logs: `reports/cutover-contracts-phase-one-2/` in the main checkout (untracked).

1. **The reviewed code, as reviewed:** the frozen commit `1adfa55b` (pull request 690) and the deployed record's `commit` both have `contracts/src` tree `c4edcfb1185a34f5a205d9170e0ae690c758c157`; at the tag, `git diff --quiet contracts-phase-one-2 <record's commit> -- contracts/src` exits 0. Runtime hashes on chain equal the build's.
2. **Deployed and verified:** five creations from block 12,169,902 by the new deployer `0xa27Cd8A0…3E6a`; rules `0xaAF8A86e54B1Cb867c00BD452c78981664153d56`. `--check` passes from `main`; Sourcify: exact match, runtime and creation, for all five.
3. **Every live service points at it:** both operators' discovery names the new rules contract and build `81f8ea29`; the smoke deal `0x30a1ced1…46ed` Released; a buyer with the new `try.mjs` Released `0xdda3276f…75c5` and Refunded `0x6e427397…23d2`; the sale to the test buyer `0xd83ae527…05dc` released; live round 5b `0x1cc5f352…64e2` Released and round 12 `0xad6f3c4c…1211` Released, `0x78ffbb44…349c` Refunded. A primary decision with a beacon gets 400 `invalid_terms` by name on both operators.
4. **The sellers:** test seller, test buyer, pilot-scan-1 and pilot-scan-2 read `operational`, `open: 0`.
5. **The site:** `try.mjs` and `buy.mjs` match live and name the new rules contract and token.
6. **`main` and the tag:** pull request 706 merged as `978aa38d`; the tag `contracts-phase-one-2` points at it.
7. **The records:** `docs/operations.md`, `docs/audit/` (scope, README, known-issues, outside-scan), `contracts/README.md` and the trust page say the fixed version is the one deployed, that an outside firm's automated scan read the first version and its fix review read the fixed one. Token budgets: buyer's first-deal path 4,881 of 5,000, seller's 4,508 of 5,000 (estimates).

**What still cites the first version, and why it may:** dated records keep their values: `docs/cutover-phase-one.md`, the 2026-11-13 entries of `docs/operations.md`, `contracts/deployments/sepolia-2026-11-13T0532Z-domain-0.8.json`, the "Figures as of 2026-11-17" section of `docs/audit/README.md`, the outside scan's own findings in `docs/audit/outside-scan.md` (it read `27ab44e8`), the rows of `known-issues.md` marked "fixed at the tag `contracts-phase-one-1`", task files and reviews by date, and the offline receipt fixtures (`fixtures/evidence/`, `examples/evidence.ts`), which check a deal record offline. `scripts/record-copies.mjs` swept every other tracked file: none left.

## Handoff

**Done.** The fixed version is live and every live service points at it; the records are merged.

**Left open:**
- Crest pins Holdback at the first tag (T-560); its module is per rules deployment, so it must name the new rules contract `0xaAF8…3d56` and the tag `contracts-phase-one-2`.
- Anyone given the test service needs the new tUSDC from the faucet: the token changed (Rafa's word to them).
- Triage, none blocking: (1) `apps/demo-cloud/src/limits.attack.test.ts` "replay-cpu" times 30 replays by the clock, so it fails on a loaded machine (0.73 and 1.90 against 0.5) and passes alone; (2) `tools/duet` publish shortens every 32-byte hex on the page, the endings' `href`s included, so a publish writes broken record links; this refresh spliced the section instead; (3) the message schema answers a drand beacon without its signature with "must have required property 'seller'"; (4) the duet "paid" scenario wrote a ticket on a loaded machine (a time measure); (5) `drand-fork.test.ts` cannot fork the public node ("block not found").
