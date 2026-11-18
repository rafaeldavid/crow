# T-544: decide how a seller makes a standing offer

- **Lane:** research
- **Phase:** 2
- **Depends on:** none. It follows the private design study T-532 (roadmap row N196), where Rafa chose the direction on 2026-11-18.
- **Paths this task may touch:** `docs/decisions/ADR-0040-standing-offers.md` (new), `docs/research/2026-11-18-standing-offers.md` and its folder (new), `docs/research/README.md` (one row), `docs/decisions-today.md` (D82), this file, and the build's task files T-548 to T-552 (new). Scratch only under `reports/scratch/t-544/`.
- **Human gate:** yes: D82's two open points are Rafa's. The record changes no code.
- **Status:** review
- **Agent/session:** the T-544 session (`standing-offers-adr`, started by `local_f8b8041f`), 2026-11-18, branch `t-544-standing-offers`.
- **Roadmap row:** N196
- **Change kind:** 10, research and decisions.

## What exists

- **A seller signs once per buyer today.** The terms name the buyer, its payment address and its encryption key, and five fixed dates. The seller's signature over their hash is the offer (`contracts/src/HoldbackTypes.sol:36-70`). The delivery is signed for one deal (`contracts/src/HoldbackRules.sol:524-534`).
- **The always-on seller program** is the seller adapter: `examples/seller-adapter-core.ts`, `quote` at `:1454` and `offerFor` at `:1347`. Crow hosts it for a design partner (ADR-0037, `apps/hosted-sellers`).
- **A card can carry fixed terms,** unsigned (`site/card.schema.json`, D74). Nothing binds them.
- **The rules contract already takes a contract as a signer** (ERC-1271): `HoldbackRules.sol:567-571`, and the cross-check `contracts/test/crosscheck/Erc1271Roles.t.sol` (`test_sellerWallet_signsTermsAndDelivery_andIsPaid`).

So the contract side exists. What is missing is a seller contract that approves a template, an off-chain path that reads it, and a delivery that can stand for a fixed file. This task decides those and builds none of them.

## Intent

Restated in my own words.

Rafa wants a seller to publish one offer that any buyer can take, without a program that signs for each buyer. On 2026-11-18 he chose the way: a small contract on the seller's side, with the rules contract left as it is, which Crow may deploy for a seller. This task writes the decision record for that way. It answers ten questions with evidence: what the contract approves, delivery, work that depends on the buyer's input, deployment, the operators and tools, the adjudicator, mandates and revocation, what in the schemas or contracts must change, the attacks, and the build.

**Non-goals:** building the contract or any code; deploying; changing `roadmap/roadmap.json`, the daily log, `control/steering.json` or `control/links.json`; touching `examples/setup*.ts`, `site/setup.txt` or `site/sell.txt`, which another session is building; contacting anyone.

## Acceptance criteria

- [x] The ten questions answered, each with code lines or a stated test (ADR-0040, sections 1 to 10).
- [x] The research note's claims checked (the research note, section 1), with two corrections: the rules contract has about 4,000 bytes of headroom, and a standing delivery needs a core rule change.
- [x] Alternatives considered: a new signed message in the rules contract, delegated account code (EIP-7702), and the hosted per-buyer signer (ADR-0040, Alternatives).
- [x] One scratch test against the unchanged rules contract (the research note, section 2), kept as text in the research folder.
- [x] A red-team pass and a reviewer pass, each given the ADR, `CLAUDE.md`, the threat model and the related ADRs, and their findings fixed (Evidence).
- [x] D82 in `docs/decisions-today.md`.
- [x] The build's task files, T-548 to T-552, in build order with a testable done-when each.
- [x] Every claim labelled measured, documented, inferred or guessed.
- [ ] The pull request merged after CI.

## Out of scope

- Buyer-filled scope inside a template (ADR-0040 section 3): named as a later decision, on measured need.
- Seller bonds: phase one has none (ADR-0031).

## Evidence

- Code read at `origin/main` `21bb4e54` (contracts equal to the main checkout's `cf46c810`: `git diff --stat HEAD origin/main -- contracts/` is empty) [measured].
- `forge test --match-path 'test/spike/*'` in a scratch copy of `contracts/` that shares the main checkout's libraries: 10 passed, 0 failed, 2026-11-18 [measured]. The test and the spike contract are in `docs/research/2026-11-18-standing-offers/`.
- `eth_getCode` on Sepolia through `ethereum-sepolia-rpc.publicnode.com`, 2026-11-18: the deterministic deployment proxy at `0x4e59b44847b379578588920cA78FbF26c0B4956C` and Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11` both have code [measured].
- **Reviewer pass** (the `reviewer` agent, on `aed3f022`): ISSUES, with 3 findings to fix (private deals, the write budget, the deployment race), 6 Low and 2 Info. It reran the spike (10 passed) and the five docs tests (5 files, 258 tests passed), and confirmed about 45 cited line ranges [measured by it]. All fixed in `a0021afe`: standing offers are public deals only (D70); a take is stored only with the buyer's signature; the deployment goes alone before funding; each test has a place and an owner; T-499's size figure leads; two labels corrected; Context sections added.
- **Red-team pass** (the `red-teamer` agent, on `aed3f022`): 1 High, 4 Medium, 4 Low, 2 Info, with 7 attack tests run against the spike, kept as `docs/research/2026-11-18-standing-offers/RedTeam.t.sol.txt` [measured by it]. The High: a revoked template's file delivered and paid on a new template's take with equal terms. Fixed in the record: the terms' nonce is derived from the template's hash; a full EIP-712 template type; every seller-signature path of the node named; the worker may decline a take, and the adjudicator checks the buyer's key at acceptance; an operator deploys only for an admitted seller under a budget; the contract refuses a payout to itself and a template with ignored fields; a one-way `retire()`; the envelope and store limits; three labels.
- **The fix for the High, measured:** with the nonce derived in the spike's `termsOf`, `forge test --match-path 'test/spike/*'` gives the spike's 10 tests passed, and the red team's two attack tests, which assert that the old file lands, now fail with `BadSignature` at the old file's delivery: the attack is refused. The red team's other 5 tests still pass; they show behaviour the record now handles in the build (payout to the contract, ignored fields, the key path's scope, gas, and the early-accept revert). 2026-11-18 [measured].
- **Second review by another model family:** the reviewer recommends one, on the seller contract's three yes cases, the optional buyer envelope, deployment and privacy. Per the change recipes, that is Rafa's call; it is not run here.
- Nothing built, deployed or sent.

## Decisions

- Standing offers are public deals only in this decision (the reviewer's finding; D70).
- Each take's nonce is derived from the template's hash (the red team's High finding).
- The seller contract checks a template signed by the seller's key, carried with each take, and stores only revocations and a one-way `retired` flag. A template stored on chain would cost the seller a transaction per template.
- The template names the rules deployment, so a rules redeploy needs a new signature only, not a new seller contract.
- The take's authorization travels in `signatures.seller`, widened to any contract signature (schema v0.12). A separate take object was declined as more surface.
- Buyer-filled scope stays out: the pilot's scope sits in both the deliverable and the checks, and filling them on chain would mean building canonical JSON on chain.

## Handoff

- **Resume:** after Rafa answers D82's two open points, record his answers in D82, then open T-548.
- **For the coordinator:** roadmap row N196, the daily log and the waiting items are yours to update.
