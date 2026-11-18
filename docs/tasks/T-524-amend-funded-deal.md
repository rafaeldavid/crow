# T-524: decide how both parties change a funded deal's terms

- **Lane:** research
- **Phase:** 2
- **Depends on:** T-501 (a finished job delivered into a new deal), T-503 (a full refund both parties sign): the two workarounds the decision folds into one step
- **Paths this task may touch:** `docs/decisions/ADR-0039-amend-a-funded-deal.md` (new), `docs/research/2026-11-18-amending-a-funded-deal.md` and its folder (new), `docs/research/README.md` (one row), `docs/decisions-today.md` (D78), this file. Private: `strategy/2026-11-18-amendment-cases.md` in crow-private.
- **Human gate:** yes: ADR-0039's four open points are Rafa's. The record changes no code.
- **Status:** review
- **Agent/session:** the T-524 session (`amend-decision`), 2026-11-18, branch `t-524-amend-decision`.
- **Roadmap row:** N188
- **Change kind:** 10, research and decisions.

## Intent

Restated in my own words.

Twice a finished report failed the deal's signed checks while the deal was `Held`. Each fix took four moves: new terms, a seller redeploy, a second deal that takes over the job, and a full refund both parties sign. Rafa wants changes both parties agree to be a normal path of trade. He asked, the same day, for two paths to be weighed equally: an amendment in place, and an atomic transaction that refunds the old deal and funds a new one. He also decided the default tie between the two deals. This task decides what a change may touch, how it is signed, where it is enforced, what happens to work already done, what can go wrong, what others do, whether a bridge is needed, and what the build changes. It writes a decision record and a research note, runs at most one scratch test on a local chain, and writes no product code.

## Acceptance criteria

- [x] "What exists": how terms bind today, end to end, and which parts a change touches (ADR-0039, Context; the research note, section 2).
- [x] Questions 1 to 8 answered, with options, tradeoffs and one recommendation (ADR-0039, sections 1 to 8, Alternatives).
- [x] The atomic replacement weighed equally, with one local-chain test of whether the frozen contracts allow it (the research note, section 2a).
- [x] Rafa's decided tie recorded as decided, with the opt-out and the tension with D35 (ADR-0039, section 4; D78).
- [x] What the gate before signing removes, and what remains (ADR-0039, Context; the research note, section 1).
- [x] Desk research with sources (the research note, section 3).
- [x] D78 in `docs/decisions-today.md`, Status `needs Rafa`.
- [x] No partner, customer or deal ID in the public repository; those are in the private note.
- [ ] The pull request merged after CI and one review.

## The build that follows

A list a build session can start from, if Rafa takes the recommendation. Sizes are guessed.

**Replace in one transaction:** about 4 pull requests and 500k tokens by the change recipes' budgets, all before any contract build [guessed].
1. **Operators and the API contract** (kinds 4 and 6): `POST /v1/prepare/replacement {commitmentId, terms}` answers the new deal's messages, the old deal's refund with the tie in its `nonce`, and the differences. `POST /v1/commitments/{id}/replacement` takes every signature, checks each, and sends one Multicall3 `aggregate3` call with no failure allowed. Both are idempotent, as every mutation is. Refuse outside `Held` or after a posted delivery. Add the two routes to `spec/openapi/paths.json` in an additive version, composed of message schemas that already exist. `CommitmentTerms` and the EIP-712 domain stay as deployed.
2. **Seller adapter and hosted sellers** (kind 4): `POST /deals/{id}/replace` behind the ready credential, with a new acceptance block. It signs the refund and the new offer, and moves the finished job to the new deal (T-501's step), with no redeploy. The standalone refund (T-503) stays.
3. **Buyer and records** (kind 4): a new `examples/` command. It shows the differences and stops for the principal's yes, signs the refund, the agreement and the funding, and submits. `buy.mjs` stays pinned. `examples/deal-record.ts` and `examples/evidence.ts` read a refund whose `nonce` names a deal funded in the same transaction as one completed commitment.
4. **Guides** (kind 1): `site/ref/after-funding.txt` ("Replace before delivery"), one line in `site/llms.txt`, `docs/what-a-deal-can-do.md`, `site/ref/seller-adapter.txt`.
5. **Tests and fixtures:** the scratch test's four cases as a repository test under `contracts/test/unit/` (tests only; `contracts/src/` untouched), with the batch through a Multicall3 deployed in the test; `attack.replace-one-signature`, `attack.replace-split`, `attack.replace-after-delivery`, `attack.replace-after-reclaim`, `attack.replace-false-tie`, `attack.replace-pressure`; `neutrality.replace-operator-refuses`, `neutrality.replace-adjudicator-declines`; `neutrality.operator-lies-in-prepare` extended; rows in `docs/neutrality.md`.

**The in-place amendment,** only if replacements measure a cost: ADR-0039 section 8 holds the message, the contract function, the event and the forge tests for a later contract build (one contract pull request, kind 7, about 300k tokens plus its audit) [guessed].

**What it removes or makes rare:** T-503's refund as a restart and T-501's takeover as a separate step (both become steps inside the replacement); a seller redeploy to change one deal's checks.

## Decisions

- Recommended the atomic replacement over the in-place amendment: it works on the frozen contracts, changes any term and adds no signed type (ADR-0039, Alternatives).
- The tools offer a replacement only while the old deal is `Held` with no delivery posted. Open point 3 for Rafa.
- The tie travels in the refund's `nonce`, the one free field both original keys sign. The new terms cannot carry it: the commitment schema has no such field and allows no extra fields.

## Evidence

- Code read at `origin/main` `1c9ffacf` and at the tag `contracts-phase-one-1` (`27ab44e8`), with line references in the research note [measured].
- `forge test --match-contract ReplaceTest` in a scratch project linking the main checkout's `contracts/src/` (equal to the tag): 4 passed, 0 failed, 2026-11-18 [measured]. The test is in `docs/research/2026-11-18-amending-a-funded-deal/Replace.t.sol.txt`; the first run's two wrong assertions are described in the note.
- `eth_getCode` of Multicall3 on Sepolia through a public RPC: code present [measured].
- Two outside pages opened; others seen in search results only, each labelled in the note.
- Nothing built, deployed or sent.

## Handoff

- **Resume:** after Rafa answers ADR-0039's open points, record his answers in D78 and open the build's step 1 as its own task.
- **For the coordinator:** roadmap row N188 and the daily log are yours to update. Rafa's design direction for this task reached the session through the private log, not the brief.
