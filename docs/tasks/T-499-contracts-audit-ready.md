# T-499: Contracts are ready for an outside audit

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-338, T-339, T-340, T-388 (the audit package and the phase-one reviews)
- **Paths this task may touch:** `docs/audit/`, `contracts/test/` (added coverage only), read-only scripts, this task file
- **Human gate:** no (engaging an auditor, and any source change, are Rafa's)
- **Status:** done
- **Agent/session:** contracts audit-readiness review session, started by the coordinator on Rafa's request (2026-11-17)
- **Roadmap row:** N26

## Intent

Answer one question with evidence: can the phase-one contracts, frozen at the tag `contracts-phase-one-1`, go to an outside auditor today? Check eight items (scope, a clean build and test run, properties, static analysis, the basics per function, documentation, the deployment record, and what an auditor asks for), mark each met, partly met or missing, close the gaps that are documents, tests or tooling, and list the gaps that need a source change for the next contract version. Non-goals: no change to `contracts/src/`, the deployment or any key; no exploit hunt.

## Context

- `docs/audit/` (the audit package), ADR-0031 (phase-one scope), ADR-0033 (money addresses).
- Roadmap rows N26, N114, N100, N24, N152.

## Acceptance criteria

- [ ] Each of the eight items has a state and the file or command that shows it.
- [ ] One start page for an auditor in `docs/audit/`.
- [ ] Gaps that are documents, tests or tooling are closed in one pull request.
- [ ] Findings that need a source change are listed with severity, file and line, and the smallest fix.

## Out of scope

- Any change to `contracts/src/`, any deployment, any key.
- Engaging an audit firm.

## Evidence

Run on 2026-11-17 against the tag `contracts-phase-one-1` (`27ab44e8`). Nothing under `contracts/src/`, no deployment and no key was touched; no transaction was sent.

| Item | Before this task | After | Shown by |
| --- | --- | --- | --- |
| 1. Scope | partly met: no line counts, no hashes, OZ and forge-std "not recorded", no addresses or verification links, a wrong sentence on the tag and the record's commit | met | `docs/audit/README.md` (start page, dated figures), `docs/audit/scope.md` |
| 2. Clean build and tests | met | met | clean clone at the tag: `forge build` passed; `forge test` 67 suites, 505 passed, 0 failed, 0 skipped [measured]; coverage with `--ir-minimum`: `HoldbackRules` 236/237 lines, 69/70 branches, the beacon and the types library 100% [measured] |
| 3. Properties | partly met: no recorded run; one invariant described wrongly; three model properties with no forge counterpart unstated | met | `docs/audit/invariants.md`: invariant suites 41 passed at the tag [measured]; `formal/check.sh`, every config, passed in CI on the tag's commit (run `43382656927`) [measured]; AtomicKey, NoCaptureAfterExpiry and ExpiryAfterCaptures marked "model only" with the unit tests that exist |
| 4. Static analysis | met at `c629d06` | met at the tag | Slither 0.11.6: 58 results, Aderyn 0.6.8: 8 classes, each triaged, none a defect [measured]; `forge lint` is not in Foundry 1.0.0 |
| 5. The basics by name | not written down per function | met | `docs/audit/functions.md`; no owner, pause, freeze, blacklist, proxy, `selfdestruct`, `delegatecall`, `receive` or `fallback` [measured by reading; `NoAdmin.fuzz.t.sol` passed] |
| 6. Documentation | partly met: stale "not run" lines, one wrong coverage claim, known issues missing four cuts, three recorded audit checks and three red-team limits | met, with two notes outside this task's paths (Handoff) | NatSpec on every external function and event except the beacon's `PERIOD` constant [measured] |
| 7. Deployment record | met | met | `deploy-sepolia.sh --check https://sepolia.gateway.tenderly.co` from `main`: "matches the chain and the build at 938c3fc6", exit 0 [measured]; all five Crow-deployed contracts are exact matches on Sourcify [measured]; constructor arguments in `sepolia.json` |
| 8. What an auditor asks for | partly met: no start page, diagram, contract glossary, test accounts or contact | met | `docs/audit/README.md`: diagrams, trust assumptions, glossary, build steps, test accounts, contact |

Wall times ran on a shared, loaded machine and are upper bounds: `forge build` 16 min, `forge test` 29 min 33 s, `--check` 5 min 23 s [measured].

## Decisions

- The figures that change with a redeploy (hashes, addresses, line counts, coverage) sit in one dated section of `docs/audit/README.md`; the standing pages keep pointing at the deployment record.
- Rafa decided the plan on 2026-11-17 (D77): the audit reads the phase-one contracts as deployed, Crow's own findings go to the auditor as known issues, and every fix lands in the next build on the contract lane. `docs/audit/engagement.md` is the note the audit deal's terms point to.
- The runtime size is the build artifact's and the chain's, 20,502 bytes. A `forge build --sizes --skip test --skip script` run reported 24,313 bytes; it does not match the artifact or the chain, so no page quotes it.

## Handoff

**Done:** items 1 to 8 are met; the doc fixes are in this task's pull request.

**Findings that need a source change** (for the next contract version; each is in `docs/audit/known-issues.md`, section 10): RR-1 (low) the fixed pairing gas in `DrandQuicknetBeacon.sol:65`; RR-2 to RR-5 (info): no code check on the constructor's addresses, no zero-address check on the signers and money addresses at funding, signature malleability through Solady, and `triggerFallback` after `fallbackBy`. Also info: `PERIOD` in `DrandQuicknetBeacon.sol:19` has no NatSpec of its own.

**Outside this task's paths, for a later docs change:**
- `contracts/README.md`: its shallow submodule recipe builds and tests but cannot run `deploy-sepolia.sh --check`, which needs the recursive set; and it does not say plain `forge coverage` fails (use `contracts/scripts/coverage.mjs`).
- `formal/README.md`: its contract line citations are pinned at `74fa299`, not the tag.
- `docs/operations.md` or the redeploy runbook: name an RPC for `--check` that serves old receipts; publicnode does not.

**Rafa's to decide:** whether to cut a docs tag for the package an auditor receives (the docs on `main` correct the ones at the code tag); the audit firm and its scope (roadmap rows N26, N114); and whether the auditor reads the phase-one contracts now or the rebuilt contracts that follow.
