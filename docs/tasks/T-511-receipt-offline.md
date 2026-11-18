# T-511: one command checks a finished deal's record offline

- **Lane:** demo (`examples/`), with one paragraph in the agent docs (`site/ref/after-funding.txt`)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4 (an `examples/` command and its tests), with kind 1 for the agent-docs paragraph. The command reads signed settlement and judgment records, so it gets one `red-teamer` pass on the verifier's logic: a verifier that passes a false record is worse than none.
- **Depends on:** T-500 (the Released security-review deal on Sepolia that is the proof case), T-333 (the deal record, which reads the same routes online)
- **Paths this task may touch:** `examples/evidence.ts`, `examples/evidence.test.ts`, `fixtures/evidence/`, `site/ref/after-funding.txt`, one `HISTORY` line in `scripts/record-copies.mjs`, this file. Never: `contracts/src/`, `spec/schemas/`, the pinned bundles (`site/buy.mjs`, `site/try.mjs`, `site/setup.mjs` and their hash files), `.github/`, `CLAUDE.md`, `AGENTS.md`, `.claude/`.
- **Human gate:** no. Nothing here deploys. The agent-docs paragraph reaches crow.direct only with the next site deploy, which is Rafa's.
- **Status:** done with the merge of PR 634
- **Agent/session:** the T-511 session, 2026-11-18, branch `t-511-receipt-offline`
- **Roadmap row:** T-242

## Intent

A buyer, a seller, a court or any agent should be able to take one file for one finished deal and check, with no network, that the record is what the parties signed. The file holds what the API and the chain already serve for the deal. The command checks every signature against the key the terms name, every hash against the bytes it names, the terms against the commitment ID both parties signed, and the decision against the terms. It then prints, in plain words, what that proves and the one chain read that proves the rest: that the settlement transaction succeeded. Each case study Crow publishes can carry such a file.

Non-goals: no new route, no new schema, no new receipt format, no new glossary word. Only deals closed by an adjudicator's decision (Released or Refunded) in this slice; an early accept, a settlement by agreement and a timeout refund are named as not checked yet. Private and judgment-level deals are out: their terms need a ReadToken.

## What exists (surveyed 2026-11-18 on `origin/main` 4d7aacb5, before any design)

Measured by reading the live API for the T-500 Released deal `0x341562cc…2e9b` and the code.

| Piece | Where it comes from | Signed by | Offline today? |
| --- | --- | --- | --- |
| The terms and the seller's signature | `GET /v1/commitments/{id}/terms` | the seller (EIP-712 `CommitmentTerms`) | yes: the commitment ID is the terms' struct hash |
| The primary adjudicator's acceptance | the `adjudicator.accepted` event's payload | the adjudicator (`AdjudicatorAcceptance`) | yes |
| The event log | `GET /v1/commitments/{id}/events`: each event carries `hash` (keccak256 of its RFC 8785 JSON) and `prevHash` | the operator, through its receipts | yes |
| Operator receipts (`receipt.schema.json`) | `GET /v1/commitments/{id}/receipts`, one per event | the operator's receipt signer from `GET /v1/status` (EIP-712 `Receipt`) | yes, but they name only the operator's key |
| The judgment record | `GET /v1/commitments/{id}/judgment`: `recordHash` and `signature` | the adjudicator (EIP-191 over `recordHash`) | yes |
| The delivery's ciphertext | `GET /v1/ciphertext/<sha256>` | bound by the seller's signed delivery | yes, by its SHA-256 |
| The buyer's agreement, the funding authorization | the `agreeAndFund` transaction's calldata only | the buyer and its payment address | **no route serves them** |
| The seller's signed delivery | the `deliver` transaction's calldata only (the event carries its hash, not its signature) | the seller | **no route serves it** |
| The adjudicator's signed decision | the `decide` transaction's calldata only (the event carries the outcome and record hash, not the signature) | the adjudicator | **no route serves it** |
| That the settlement happened | the `decide` transaction's receipt on chain | the chain | needs one chain read |

- `GET /v1/commitments/{id}/evidence` is listed in `docs/api.md` as planned and answers 501 (D26).
- `examples/deal-record.ts` (T-333) reads the same routes from several operators and checks most of the rows above, online, writing a summary record. It does not keep the signed bytes, so its output cannot be checked again later without the network.

**The gap, stated plainly.** Three of the deal's signatures (the buyer's agreement, the seller's delivery, the adjudicator's decision) are served by no API route; they exist only in the transactions' calldata. Nothing is missing from the protocol: the events name each transaction's hash, and a public Sepolia node serves each signed transaction's raw bytes (`eth_getRawTransactionByHash`, measured on `ethereum-sepolia-rpc.publicnode.com`). The raw bytes hash to the transaction hash, so a bundle that carries them is checkable offline. The smallest fix is therefore no product change: the command fetches the raw transactions beside the API answers.

## Design

**One file, two subcommands.** `examples/evidence.ts`:

- `fetch <commitmentId> [--out <file>]` reads one operator's public routes (terms, events, receipts, judgment, the ciphertext, `/v1/status`) and the raw signed transactions the events name from a Sepolia node, and writes the bundle. This is the only step that uses the network. Environment: `HOLDBACK_OPERATOR` (default `https://api.crow.direct`), `SEPOLIA_RPC_URL` (default a public Sepolia node).
- `check <bundle> [--receipt <file>]` reads the file and makes no network call. With `--receipt`, it also checks the chain read's answer, which the user fetched with the printed command.

**The bundle** (`holdback-evidence/1`) is the API's own answers, verbatim, plus the raw transactions. It has no field that no check covers: a changed byte in any value fails a check.

**The trust roots.** The EIP-712 domain comes from the pinned deployment in `examples/deployments.ts`, never from the bundle. The parties' keys come from the terms, which hash to the commitment ID. The operator's receipt signer comes from the bundle, so the receipts show only what that operator recorded; the command prints the address to compare with the operator's `GET /v1/status`.

**What `check` checks, in order** (each check names itself when it fails):

1. The terms carry only fields the commitment ID covers. Every event names this commitment, consecutive events link by `prevHash`, and every event has exactly one receipt, for this commitment.
2. **The deal record's own checks** (`examples/deal-record.ts`), run offline over the file: the terms hash to the commitment ID and the seller signed it, each event hashes to its `hash` and its receipt recovers to the receipt signer, the ciphertext hashes to its SHA-256 and length, the judgment record hashes to its `recordHash` and its adjudicator signed it. Each must pass and none may fail.
3. Each raw transaction hashes to the transaction hash the events name, is a call to the pinned rules contract on the pinned chain, and its calldata decodes to the function the event implies.
4. `agreeAndFund`: its terms view hashes to the commitment ID (the contract's own formula); the seller's, the primary adjudicator's and the buyer's signatures recover to the addresses the terms name; the funding authorization recovers to the buyer's payment address for exactly price plus fee; the acceptance in the calldata is the one in the event.
5. `deliver`: its terms hash to the commitment ID; the delivery's struct hash is the event's `deliveryHash`, its signature recovers to the seller, and its ciphertext and plaintext hashes are the event's; the ciphertext bytes hash to the recorded SHA-256 and length.
6. `decide`: its terms hash to the commitment ID; the decision names the posted delivery, a role and a final outcome, and its signature recovers to the adjudicator the terms name for that role (whose turn it was is the contract's check, which the chain read confirms); its seed hashes to the acceptance's seed commitment; its record hash is the judgment record's.
7. The judgment record (whose hash and signature step 2 checked) is the one the decision names, and it names this commitment, attempt, delivery, role, policy and seed. Its checks are exactly the terms' deterministic checks with the same `required` flags, and its decision is the decision's outcome. An accept has every required check passed and, when the terms have rubric criteria, a panel that ran.
8. The outcome the events record (Released or Refunded, the key released on an accept) is the decision's.

**What it proves and what it does not.** Offline, it proves who signed what and that the pieces match each other and the terms. It does not prove that the transactions were mined and succeeded; that is the one chain read, `eth_getTransactionReceipt` for the decide transaction, which the command prints exactly. It does not prove that the work itself passes the checks: the work is encrypted to the buyer and the adjudicators, and only a key holder can open it and rerun the checks with `examples/check-delivery.ts`.

## Acceptance criteria

- [ ] `node examples/evidence.ts check` passes the real Released deal's bundle with no network (measured, output below).
- [ ] It fails, naming the check, on: one changed byte in any value of the bundle; a signature from the wrong key; a receipt from another deal; a decision that does not match the terms' hash.
- [ ] The check subcommand makes no network call; a test proves it.
- [ ] One `red-teamer` pass on the verifier's logic; blocking findings fixed.
- [ ] The agent docs say how to run it; `node site/build.mjs && node site/check.mjs` passes; no pinned bundle changes.
- [ ] CI passes; merged by hand.

## Out of scope

- The planned `GET /v1/commitments/{id}/evidence` route: the bundle is assembled without it.
- Early accept, settlement by agreement, reclaim and default: named as not checked yet.
- Private and judgment-level deals.

## Evidence

All measured on 2026-11-18 in this branch's worktree unless marked otherwise.

- **The bundles.** `node examples/evidence.ts fetch <id> --out …` against `https://api.crow.direct` and `ethereum-sepolia-rpc.publicnode.com` wrote both T-500 deals: the Released one `0x341562cc…2e9b` (9 events, 3 transactions) and the Refunded one `0x9908966e…4272` (8 events, 3 transactions). The chain reads, fetched with the command the check prints, are beside them. They are kept gzipped in `fixtures/evidence/` because the repository's secret scanner flags the public test-token address keyed `token` (gitleaks `generic-api-key`, 20 findings on the plain JSON, none on the gzipped files), and this task may not edit `.gitleaksignore`.
- **The Released deal checks offline.** `node examples/evidence.ts check released.json`, exit 0. This was the run before the review's fixes and before the deal record's checks replaced this file's own (the next bullet has today's counts); no other line of this output changed:

```
PASSED  47 offline checks on commitment 0x341562ccb28591a4df09a0cfbabfeffec1fff011631585e0a020a177ec192e9b, chain 11155111, rules contract 0x3be45128565abbc35dbd4660716b703ff489f1b4.

What this file proves, with no network:
- The seller 0xfb9e32622dd4fe894a5d7e790a304387acd1ac98 signed these terms. They hash to the commitment ID, so no term can differ from what was signed.
- The buyer 0xd0a29422c5515a0ee31586a379a649803821dc29 signed its agreement to them, and its payment address 0xd0a29422c5515a0ee31586a379a649803821dc29 signed the transfer of 41.00 tUSDC into the escrow: the price 40.00 tUSDC and the adjudicator's fee.
- The primary adjudicator 0xa909f87a64fbe6982c838c1c1bf2973cda7823ed signed its acceptance of the case.
- The seller signed delivery 0x4714ce86…a27d; its encrypted work (6123 bytes, sha256:9cf…a2fa) is in this file.
- The primary adjudicator 0xa909f87a64fbe6982c838c1c1bf2973cda7823ed signed the decision "accept" on that delivery, citing judgment record 0xbdd591ce…55ea, which it also signed.
- That record ran exactly the terms' 5 deterministic checks: report passed, proof passed, scope passed, coverage passed, hidden passed, all required. No judge panel ran: the terms have no rubric criteria. Its reasons: all deterministic checks passed and the rubric is empty.
- These signed messages are in transactions 0xa4b544b5…01cd, 0x10d513b8…17f3, 0xe47168fa…ae96, whose bytes are in this file and hash to those transaction hashes.
- Operator 0x7BA5D158b503688E2c490aE62102e30685DdA526 signed a receipt for each of the 9 events it recorded. That is this operator's own account: compare the address with GET /v1/status of an operator you trust.

What it does not prove:
- That the transactions were mined and succeeded, so that the money moved. One chain read proves it: the receipt of the decide transaction 0xe47168fad7058cb2b164c7bceb297510cb3e2582a4ded02c6ffc88946194ae96. From a node you trust:
    curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0xe47168fad7058cb2b164c7bceb297510cb3e2582a4ded02c6ffc88946194ae96"]}' https://ethereum-sepolia-rpc.publicnode.com > receipt.json
  then run this check again with --receipt receipt.json.
- That the work itself passes the checks. The work is encrypted to the buyer and the adjudicators; a key holder can open it and rerun the checks with examples/check-delivery.ts.
```

- **Today's counts, after one check logic** (bundles refetched at 09:01 UTC on 2026-11-18 with the operator's discovery domain, which the record's domain check reads): the Released deal 54 offline checks and 57 with its chain read; the Refunded deal 56 with its chain read. A count is the checks that ran and passed; the record's checks that cannot run on a third party's copy (the buyer's plaintext, the seller's own delivery body, postings a chain's events do not carry) are not counted.
- **With the chain read.** `check released.json --receipt released.receipt.json`: exit 0, "Transaction 0xe47168fa…ae96 succeeded in block 12153293 on the chain the node serves: the rules contract recorded the decision "accept" and paid the price 40.00 tUSDC to the seller"; after the review it names the seller's payout address. The Refunded deal: 46 offline checks, 49 with its receipt, decision "reject", the `proof` check FAILED, "returned the price 40.00 tUSDC to the buyer".
- **Attack tests** (`examples/evidence.test.ts`, 13 tests after the review, all pass in about 6 s; `fetch` is stubbed to throw, so any network call on the check path fails them):
  - one changed value anywhere: every leaf and every key of the Released bundle (more than 300 positions) is changed one at a time, and the check fails on each. Its first run found one position the test did not change (a `null`), not a verifier gap; the test now changes `null` too;
  - a signature from the wrong key: the judgment record signed by another key, a receipt signed by another key, and the buyer's agreement in the funding calldata signed by another key inside a transaction the attacker built and its own operator recorded (fails at "buyer's agreement");
  - a receipt from another deal: a genuine receipt of the Refunded deal, as it is and renumbered to this deal's event;
  - a decision that does not match the terms' hash: the Refunded deal's genuine decide transaction (fails at "judgment.decided transaction is for these terms"); its signed decision inside a call with this deal's terms (fails at "adjudicator's signature on the decision"); this deal's decision with the outcome flipped; the Refunded deal's genuine judgment record;
  - the chain read: the other deal's receipt and a reverted receipt are refused.
- **Red team** (one `red-teamer` pass, 2026-11-18, on commit `973d6b4a`): PASS. It found no bundle or receipt that makes the check print a false claim about what a party signed or how the deal settled. Its findings, all fixed in this PR with a test each:
  - Medium: the terms could carry extra fields that the commitment ID ignores (a note, a `disputeBy`), so the file could show terms nobody signed while it passed. Fix: the terms must have exactly the signed fields (`terms carry only signed fields`).
  - Low: a date that is not one, a `null` log or a missing block number crashed the check (exit 2) instead of failing it. Fix: any error while reading the bundle is the failed check `well-formed bundle`.
  - Low: the chain-receipt check matched the payment by deal and amount, not by who was paid. Fix: the payment must name the seller (on an accept) or the buyer (on a reject) the terms name.
  - Low: a deployment from `HOLDBACK_DEPLOYMENT` was trusted silently. Fix: the output says that the caller chose it, and the chain-read command names the pin's chain.
  - Info: whose turn it was is the contract's check, which the chain read confirms; the design text and the output now say so. Payments name the seller's payout address and the buyer's payment address.
  - Its attack files are in `reports/scratch/t511-redteam/` in the main checkout, which is not committed.
- **Local checks** (kind 4 and kind 1): `pnpm exec vitest run examples/evidence.test.ts examples/deployments.test.ts tests/design-map.test.ts tests/site-*.test.ts tests/guide-budget.test.ts`: 107 of 107 passed. `pnpm exec eslint examples/evidence.ts examples/evidence.test.ts` and `pnpm exec tsc -b examples`: clean. `node site/build.mjs && node site/check.mjs`: PASS; `site/try.mjs` keeps SHA-256 `fd7d9a4a…`, and no pinned bundle changed (`git status` shows only `site/ref/after-funding.txt` under `site/`).

## Decisions

1. **No route, no schema change.** The bundle is assembled from the public routes and the chain. The evidence route stays planned; when it is built it can serve this same file.
2. **The raw transactions carry the missing signatures.** Decoding calldata offline needs the rules contract's ABI, which `packages/settlement/evm/abis.json` already holds and keeps equal to the compiled contracts.
3. **The fixtures are dated records.** A redeploy's sweep (`scripts/record-copies.mjs`) rewrites old contract addresses in tracked files outside its `HISTORY` list; CI's first run failed `tests/record-copies.test.ts` on the two chain receipts. Rewriting them would break their hashes, so `fixtures/evidence/` joins `HISTORY` beside `tests/metrics/fixtures/`. After a redeploy the tests take the deals' deployment from its dated record through `HOLDBACK_DEPLOYMENT`, as a user would.
4. **The receipt signer is not pinned.** No pinned list of operator receipt signers exists in `examples/`. The parties' signatures bind the deal; the receipts only add the operator's own account. The command prints the address instead.

## Handoff

**Done.** The command, its tests and the agent-docs paragraph are in PR 634; the PR's `Closes T-511` line marks the task done when it merges.

**One way to prove a deal: one check logic now; one command after a re-pin of `buy.mjs`.** On 2026-11-18 the T-513 simplicity review, then the coordinator, asked for one way to check a finished deal.

- **What each checked, measured on the code.** The deal record reads every operator live, compares them, and checks the terms' ID and seller signature, event hashes, receipts, the ciphertext, the judgment record's hash and signature, the hold, the operator fee, and, with a party's own inputs, the buyer's plaintext, the seller's delivery body and a late-work settlement. This command checked the same first six again, plus what the record cannot see: the buyer's agreement and funding, the seller's delivery signature and the adjudicator's decision inside the transactions, and the decision and judgment record against the terms.
- **Done in this PR: one check logic.** `check` now runs the record's own `dealRecord()` offline: for that run, `fetch` answers the record's reads from the file and answers 404 to anything else. This file's own terms, event-hash, receipt-signature, ciphertext and judgment-hash checks are removed; it keeps only the shape checks and what the record does not check. The attack tests fail as before, the moved ones under the record's check names.
- **Not done: one command in every guide.** `site/ref/after-funding.txt` names this command for checking a finished deal. `buy.txt` step 11 (`node buy.mjs record`) and `sell.txt` step 10 (`examples/deal-record.ts`) still name the record for a party's live copy. Naming one command there needs a re-pin of `buy.mjs`, which this task may not do. What would change: `site/buy-entry.mjs` gains `record fetch` and `record check` (this file); `BUY_COMMANDS` in `site/build.mjs` gains the entry; this file must import the rules ABI so the bundle can inline it (it reads `abis.json` from disk today); `site/buy.mjs`'s SHA-256 changes, so `buy.txt` step 1's pinned hash changes, and the site deploy is Rafa's. The seller guide can switch too once `check` covers deals that close by early accept, settlement or timeout, which the record covers today.

- **Deploy:** none needed for the command, which runs from a clone. The paragraph in `site/ref/after-funding.txt` reaches crow.direct with the next site deploy (`pnpm site:deploy` from a fresh detached checkout of `origin/main`, as T-500's Handoff lists). That deploy is Rafa's.
- **For each case study:** run `node examples/evidence.ts fetch <id> --out <file>` once the deal closes, and publish the file beside the case. Anyone can then run `check` on it.
- **Not done, for the backlog** (none blocks this slice):
  - Early accept, settlement by agreement, reclaim and default are refused as not checked yet. Each needs its own call's checks (`earlyAccept`, `mutualSettle`, the timeouts).
  - A fallback or appeal adjudicator's beacon seed is not checked offline (the drand signature); the chain read covers it.
  - The operator's receipt signer is not pinned; a pinned list of Crow's operators' receipt signers would let the receipts count as more than one operator's account.
  - Old bundles after a redeploy: the command pins only the current deployment, so a case study's bundle from before a redeploy needs its dated record passed as `HOLDBACK_DEPLOYMENT`, and the output says so. Pinning every dated phase-one record in `examples/deployments.ts` would remove that step.
  - The planned `GET /v1/commitments/{id}/evidence` route could serve this same file, so an agent needs no Sepolia node to fetch it.
  - A public bundle in the repository trips gitleaks' generic rule on the test token's address; a published case study's file lives outside this repository or needs a `.gitleaksignore` entry from Rafa's lane.
