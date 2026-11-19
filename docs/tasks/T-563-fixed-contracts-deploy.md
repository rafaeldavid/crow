# T-563: the fixed contract version is live on Sepolia

- **Lane:** contracts deploy, operators, test agents, hosted sellers, site and docs; on the lane `contracts-audit-ready` and on `main`
- **Phase:** 2
- **Kind:** a contracts cutover by `docs/redeploy-contracts.md`, with docs (2) and deploy-script fixes
- **Depends on:** T-540 (the fixed version is ready), T-553 (the fix review and D85)
- **Paths this task may touch:** `contracts/deployments/`, every pin `scripts/record-copies.mjs` writes, `docs/redeploy-contracts.md`, `contracts/script/` and `scripts/` for rehearsal fixes, `docs/operations.md`, `docs/audit/`, `site/` for the trust page's words, this file. Never `contracts/src/`.
- **Human gate:** Rafa's go for the whole runbook (2026-11-19); his hands for the contract deploy with his keystore, the live rounds and the tag push
- **Status:** in progress
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

(Filled in as the run goes.)

## Handoff

(Filled in at the end.)
