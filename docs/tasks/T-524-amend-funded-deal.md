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

Twice a finished report failed the deal's signed checks while the deal was `Held`. Each fix took four moves: new terms, a seller redeploy, a second deal that takes over the job, and a full refund both parties sign. Rafa wants changes both parties agree to be a normal path of trade. The same day he asked for more, through the coordinator:
- weigh an atomic refund-and-refund transaction equally with an amendment;
- record his decided default tie between the two deals;
- challenge his own recommendation from trade practice and theory;
- say how a waiver is accounted for.

This task decides what a change may touch, how it is signed, where it is enforced, what happens to work already done, what can go wrong, what others do, whether a bridge is needed, and what the build changes. It writes a decision record and a research note, runs at most one scratch test on a local chain, and writes no product code.

## Acceptance criteria

- [x] "What exists": how terms bind today, end to end, and which parts a change touches (ADR-0039, Context; the research note, section 2).
- [x] Questions 1 to 8 answered, with options, tradeoffs and one recommendation (ADR-0039, sections 1 to 9, Alternatives).
- [x] The atomic replacement weighed equally, with one local-chain test of whether the frozen contracts allow it (the research note, section 2a).
- [x] The waiver: what it is, why neither pilot used it, the smallest change, and the note that records it (ADR-0039, sections 2 and 4; the note, section 2b).
- [x] Rafa's decided tie recorded as decided, with the opt-out and the tension with D35 (ADR-0039, section 4; D78).
- [x] The challenge from trade practice and theory, with a verdict on each point (ADR-0039, section 7; the note, section 2c).
- [x] What the gate before signing removes, and what remains (ADR-0039, Context; the note, section 1).
- [x] D78 in `docs/decisions-today.md`, Status `needs Rafa`.
- [x] No partner, customer or deal ID in the public repository; those are in the private note.
- [ ] The pull request merged after CI and one review.

## The build that follows

A list a build session can start from, if Rafa takes the recommendation. All of it lands before any contract build. Sizes are guessed: about 5 pull requests and 550k tokens by the change recipes' budgets.

1. **The note** (kind 6): `SettlementNote(string kind, bytes32 deliveryHash, string[] waivedChecks, bytes32 successor, bytes32 salt)` in `spec/schemas/messages.schema.json`, an additive `spec/` version, the EIP-712 vectors and examples. `prepare/settlement` takes `note` and sets `nonce` to its struct hash. `CommitmentTerms` and the domain stay as deployed.
2. **The waiver** (kind 4): the seller adapter keeps a refused delivery signed and unposted. `GET /deals/{id}/waiver` serves the failing checks, the delivery's fields with the envelope hashes (never the buyer's envelope) and the seller-signed settlement, as public as `/health`. `POST /deals/{id}/waiver` signs on the ready credential. A buyer command shows the failures, stops for the principal's yes and countersigns; `POST /deals/{id}/waiver/accept` takes that signature, and the seller submits with the envelope, so the key and the payment move together. Test: `attack.waiver-free-look`.
3. **The replacement** (kinds 4 and 6):
   - `POST /v1/prepare/replacement {commitmentId, terms}` answers the new deal's messages, the old deal's refund with its note, and the differences.
   - `POST /v1/commitments/{id}/replacement` checks every signature and sends one Multicall3 `aggregate3` call with no failure allowed. It includes the note's text as a call to the identity precompile.
   - The hosted seller's `POST /deals/{id}/replace` signs the refund and the new offer and moves the finished job.
   - The buyer command signs the funding only once it holds the seller's refund, and submits the whole batch itself.
4. **Records** (kind 4): `examples/deal-record.ts` and `examples/evidence.ts` read the note and report "settled under waiver of checks …", "replaced by" and "replaces".
5. **Guides** (kind 1): `site/ref/after-funding.txt` ("Waive a failing check", "Replace before delivery"), one line in `site/llms.txt`, `docs/what-a-deal-can-do.md`, `site/ref/seller-adapter.txt`.
6. **Tests and fixtures:**
   - The scratch test's four cases as a repository test under `contracts/test/unit/`, with a Multicall3 deployed in the test. Tests only: `contracts/src/` is untouched.
   - `attack.waiver-one-signature`, `attack.waiver-pressure`, `attack.replace-one-signature`, `attack.replace-split`, `attack.replace-after-delivery`, `attack.replace-after-reclaim`, `attack.replace-pressure`, `attack.note-forged`.
   - `neutrality.replace-operator-refuses`, `neutrality.replace-adjudicator-declines`, and `neutrality.operator-lies-in-prepare` extended.
   - Rows in `docs/neutrality.md`.

**The in-place variation,** only if measurements ask for it: ADR-0039 section 9 holds its message, contract function and event for a later contract build [guessed: one contract pull request, kind 7, about 300k tokens plus its audit].

**What it removes or makes rare:** T-503's refund as a restart and T-501's takeover as a separate step, both now steps inside the replacement; a seller redeploy to change one deal's checks.

## Decisions

- The order is waiver, then replacement, then the in-place variation only if measured. Rafa's replacement stays as the tool for a real change of terms.
- The tie and the waiver's record are one `SettlementNote`, whose hash sits in the settlement's `nonce`: the one free field both original keys sign. The new terms cannot carry it, since the commitment schema has no such field and allows no extra fields.
- In a replacement the seller signs first, and the buyer's signer releases the funding only inside the whole batch (the review's finding 1).

## Evidence

- Code read at `origin/main` `1c9ffacf` and at the tag `contracts-phase-one-1` (`27ab44e8`), with line references in the research note [measured].
- `forge test --match-contract ReplaceTest` in a scratch project linking the main checkout's `contracts/src/` (equal to the tag): 4 passed, 0 failed, 2026-11-18. The reviewer reran it in its own copy: 4 passed [measured]. The test is in `docs/research/2026-11-18-amending-a-funded-deal/Replace.t.sol.txt`.
- `eth_getCode` of Multicall3 on Sepolia through a public RPC: code present [measured].
- Review: one reviewer pass found no Critical or High finding, and four fixes (the split exposure, a label, a source label, the opt-out wording), all applied. It suggested a second review by another model family, focused on the two halves being sent apart. That is left to Rafa, per the change recipes.
- Nothing built, deployed or sent.

## Handoff

- **Resume:** after Rafa answers ADR-0039's open points, record his answers in D78 and open the build's step 1 as its own task.
- **For the coordinator:** roadmap row N188 and the daily log are yours to update. Rafa's directions for this task reached the session through the coordinator's messages and the private log.
