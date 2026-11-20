# T-554: spend controls on chain, the contract an owner sets for its agent

- **Lane:** agent-access
- **Phase:** 2
- **Depends on:** D83 (the direction: hard spend controls in a contract Crow deploys and pays the gas for)
- **Paths this task may touch in holdback:** `docs/decisions/ADR-0041-spend-controls.md` (new: the boundary between Holdback and the spend-controls protocol); `docs/decisions-today.md` (D84, and D83's open point that it answers); `docs/architecture.md` (the paragraph "Spend controls"); `docs/research/2026-11-19-spend-controls.md` and its folder (new), and the research index; `site/ref/buyer-signer.txt` or `site/ref/limits.txt` (the owner's guide, one section and one pointer, on Rafa's word); since 2026-11-20 `site/vault.txt` and `site/guides.mjs` for the guide's own page, on his word; this file. No file under `contracts/`.
- **The protocol itself** lives in its own repository, https://github.com/rafaeldavid/crest, public since 2026-11-19: its design record, research, contracts, factory, tests and thin client. Its name stays undecided and off the site (Rafa, 2026-11-19).
- **Human gate:** yes, for six things only: the protocol's name, the repository's creation and settings, the fee, who pays the gas, any deploy to Sepolia, and the guide on the site beyond what PR 681 shipped. Real money stays forbidden.
- **Status:** in progress: the boundary record, the protocol's design record and contracts, and the Sepolia deploy are done; the Sepolia purchase evidence is open (2026-11-20)
- **Agent/session:** `spend-controls`, Opus 5.5
- **Roadmap row:** N204
- **Change kind:** 10 (the boundary record, this pull request), then 7 in the protocol's own repository, then 1 (the guide), in separate pull requests.

## What exists

- `examples/signer.ts` enforces the buying caps off chain (rule codes B3 to B14) and the selling caps (S2 to S5), with a stop flag (X1, X2). They hold only while the signer's machine stays out of the agent's reach (`site/ref/limits.txt`, "A signer with rules"; `site/ref/buyer-signer.txt`).
- ADR-0038: the spending limit is the payment address; the mandate is a permission the operators and the counterparty check, and the contracts read none.
- ADR-0040 and D82: a seller's address can be a small ERC-1271 contract; T-548 and T-549 build it.
- D83 (2026-11-19): card and bank money through regulated third parties; hard spend controls in a contract Crow deploys and pays the gas for, for a nominal fee.
- The rules contract checks every signature with Solady's `SignatureCheckerLib`, and funds only by ERC-3009 from the payment address (`contracts/src/HoldbackRules.sol:146-192`); Sepolia's tUSDC checks that signature the same way (`contracts/script/TestUSDC.sol:92`).

## Intent

Rafa, 2026-11-19: "the owner deploys a contract, funds it, and sets basic controls. The agent can then spend only inside those controls, enforced on chain where the agent cannot override them." And: "look at Link, Stripe, Ramp, etc. spend control frameworks in detailed research and then transfer that into smart-contract deployments with gas we cover, for a nominal fee etc. So it's hard controls."

Later the same day he moved it out of Holdback: "In general, we should classify this as a separate protocol. Holdback is escrow, but this we should call something else and add in another repo. We shouldn't entangle them but make them modular. Very likely you'll need a factory approach so each ephemeral agent gets their own spend controls." And: "So the design needs to deeply consider current procurement control patterns, but then translate that into smart-contracts and potential agent delegation patterns." He asked that existing audited primitives such as Hats Protocol and Safe be weighed before building from scratch, and that a thin wrapper make onboarding easy. And: "agent principal needs to be able to claw back money, and intervene,,, and the vault needs to be able to have approved merchants, but still use Crow (since you an prove money can go to end agent)." He chose a private GitHub repository, public later, and a name from candidates.

In my words: today an agent's caps are only as strong as the machine that holds the payment key. Move them into the payment address itself, as a protocol of its own that knows nothing of escrow. The owner's contract decides whether a funding may leave: within the most per deal and per day, the deals open at once, to a seller the owner listed and only at that seller's payout address, and never after the owner stops it. Each agent, and each agent's short-lived sub-agents, gets an allowance no wider than its parent's, and every spend counts against each level above it. The owner takes back anything not yet in a hold, and Crow and the operators gain no power over the money. Holdback is the protocol's first venue and changes nothing: it sees a payment address that funds a hold.

## Acceptance criteria

- [x] Research: the on-chain design and the spend-control and procurement products, each control mapped to an on-chain rule, by max-effort research agents. Holdback's side is in `docs/research/2026-11-19-spend-controls.md`; the protocol's own research goes to its repository.
- [x] ADR-0041, the boundary record: the split, the one-way dependency, the facts of Holdback's funding the protocol relies on, taking money back and stepping in, approved merchants through the escrow, the neutrality argument, and the open points for Rafa. D84 records it; the architecture paragraph follows.
- [x] The protocol's design record in its own repository: the base, after a second, independent comparison of existing standards; the name; the hierarchy and the factory.
- [x] The protocol's contracts in their own repository, with attack tests that fail, one per control: a funding above each cap, an unlisted seller, a listed seller with another payout address, after the stop, from the agent changing a control or withdrawing, a replayed approval, a third party exhausting a cap, the counts after a refund and across a UTC day. Holdback's `contracts/` is unchanged (`git diff origin/main -- contracts` is empty). One review and one red-team pass before merge.
- [ ] On Sepolia, on Rafa's word for the deploy: a funding above a cap refused on chain, and inside the caps purchases that end Released, each with its Etherscan transaction.
- [x] The owner's guide, on Rafa's word: one section in `site/ref/buyer-signer.txt` or `site/ref/limits.txt` and one pointer, no new page (on 2026-11-20 Rafa chose its own page, `vault.txt`), no on-ramp named; `node site/build.mjs && node site/check.mjs` passes and each first-deal path stays within 5,000 tokens. A fresh assistant given only the guide sets up a budgeted buyer.

**Done when** the ADR is merged, the Sepolia transactions are recorded here, and the guide passes the fresh-assistant run.

## Out of scope

- Any change to `contracts/`, the API's routes, signed messages or schemas without Rafa's word first.
- The seller contract itself (T-548, T-549).
- Real money, on-ramps, and naming an on-ramp.

## Evidence

- 2026-11-19, scratch spike [measured]: a budget contract that exposes the rules contract's own `agreeAndFund`, counts its caps, approves the exact ERC-3009 digest only during its own call and forwards the call funds inside its caps against the unchanged rules contract (438,729 gas, against 297,095 for a plain funding) and refuses above them with a named error. On anvil, the operator's `EvmSettlement` followed such a funding with one sync pass and no node change, and the deal ended Released. Kept as text in `docs/research/2026-11-19-spend-controls/`.
- 2026-11-19, the two research passes: the products and procurement controls (45 controls across 23 products and 15 procurement sources, 36 enforceable on chain) and the on-chain design with delegation patterns (a vault and a Holdback module passed 18 of 18 tests on a fork of Sepolia). Both notes stay in the session scratchpad, `reports/scratch/spend-controls/`, until the protocol's repository exists; they name private terms and stay out of this repository.
- 2026-11-19, a summary page for Rafa (private): the strategy, the architecture, the comparison of existing standards, and the decisions that are his.

- 2026-11-19 to 2026-11-20, the protocol's build [measured; each in Crest's pull requests and `docs/design.md`]:
  - **Merged:** Crest PRs 2 to 5, 7 to 9, 11, 13 and 15, each with a review, and a red team for contract code. Every Medium was fixed with a test before a hand merge.
  - **The build:** the vault and its grants, child vaults, the factory, the Holdback module, signed grants, the fee at the factory (rate 0 for now), approved merchants in a list contract, front-running tests (no timelock), and the vault as the deal's buyer, with a module flag that refuses the agent's own key as the buyer.
  - **Size:** the six reviewed contract files total 1,380 lines, and all ten 1,476.
  - **Holdback's `contracts/`** is unchanged.
- 2026-11-19, the Sepolia deploy, on Rafa's word [measured]: Crest `main` `36485df`, from the T-560 session's checkout. Its record is Crest's `deployments/11155111.json`, and its provenance is in `deployments/README.md`: commit, deployer, transactions, blocks and gas. It was checked read-only on two RPCs, and all four contracts are an exact match on Sourcify. Contract creation cost about 7 times forge's local estimate; the factory took 28,298,139 gas.
- 2026-11-20, the owner's guide [measured]: `site/vault.txt`, with a pointer row and a bullet in `ref/limits.txt`. The site's build and check pass: the buyer's path is 4,881 of its 5,000 tokens and the seller's 4,504, both unchanged.
- 2026-11-20, the fresh-assistant run [measured], on a local fork of Sepolia holding the deployed contracts:
  - Two fresh assistants were given only the page and a principal's budget: 26.5 tUSDC per deal, 53 a day, 2 open, 200 in total, one seller, 100 loaded.
  - Every read and dry run they made worked. They found twelve gaps in the page, all fixed.
  - The permission check refused their `cast send`, so they created nothing. On Rafa's word, this session then ran the page's six steps as written, from the fork's unlocked development account, with no key on any command line.
  - The vault and grant IDs equal the ones the fresh assistant computed from the page. The grant reads exactly that budget, the seller is listed, and the vault holds 100 tUSDC. A 26.5 tUSDC hold passes the dry run; one unit more is refused with `OverPerSpend`, and another payout address with `CounterpartyNotAllowed`.

## Decisions

- **The split** is Rafa's (D84). The boundary record follows his approval of its outline ("ok continue, looks good").
- **The base is held** until the coordinator's independent comparison of existing standards lands beside this session's, at the coordinator's request. (Since settled: the protocol is its own contracts on Solady's libraries, with no other project's contracts under it in the first version, on Rafa's word; Crest's `docs/design.md`, open item 7.)
- **The guide's page** is `vault.txt`, and the protocol stays unnamed in its prose, with one link to the repository (Rafa, 2026-11-20).

## Handoff

- **Open to close this task:** the Sepolia purchase evidence. That is a funding above a cap refused on chain, and purchases inside the caps that end Released, each with its Etherscan transaction. It comes from T-560's Sepolia stage on the deployed vault; record the transactions here.
- **Under way in its own session** (`crest-vault-buyer-live`): the client signing as the vault, now that T-549 has merged; the vault-as-buyer deploy as a new factory and module, on Rafa's word (about 49.1 million gas by a live estimate); and the T-560 rerun with the vault as the buyer, on his go.
- **Recommended, not run:** a second review of the contracts by a model from another family, and the outside review Rafa commissions, priced by lines.
