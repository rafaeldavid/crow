# T-511: one command checks a finished deal's record offline

- **Lane:** demo (`examples/`), with one paragraph in the agent docs (`site/ref/after-funding.txt`)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 4 (an `examples/` command and its tests), with kind 1 for the agent-docs paragraph. The command reads signed settlement and judgment records, so it gets one `red-teamer` pass on the verifier's logic: a verifier that passes a false record is worse than none.
- **Depends on:** T-500 (the Released security-review deal on Sepolia that is the proof case), T-333 (the deal record, which reads the same routes online)
- **Paths this task may touch:** `examples/evidence.ts`, `examples/evidence.test.ts`, `fixtures/evidence/`, `site/ref/after-funding.txt`, this file. Never: `contracts/src/`, `spec/schemas/`, the pinned bundles (`site/buy.mjs`, `site/try.mjs`, `site/setup.mjs` and their hash files), `.github/`, `CLAUDE.md`, `AGENTS.md`, `.claude/`.
- **Human gate:** no. Nothing here deploys. The agent-docs paragraph reaches crow.direct only with the next site deploy, which is Rafa's.
- **Status:** in progress
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

1. The terms hash to the commitment ID, and the seller's signature recovers to the seller they name.
2. Every event names this commitment and hashes to its `hash`; consecutive events link by `prevHash`; every event has exactly one receipt, for this commitment, that recovers to the receipt signer.
3. Each raw transaction hashes to the transaction hash the events name, is a call to the pinned rules contract on the pinned chain, and its calldata decodes to the function the event implies.
4. `agreeAndFund`: its terms view hashes to the commitment ID (the contract's own formula); the seller's, the primary adjudicator's and the buyer's signatures recover to the addresses the terms name; the funding authorization recovers to the buyer's payment address for exactly price plus fee; the acceptance in the calldata is the one in the event.
5. `deliver`: its terms hash to the commitment ID; the delivery's struct hash is the event's `deliveryHash`, its signature recovers to the seller, and its ciphertext and plaintext hashes are the event's; the ciphertext bytes hash to the recorded SHA-256 and length.
6. `decide`: its terms hash to the commitment ID; the decision names the posted delivery, the role whose turn it was and an outcome, and its signature recovers to the adjudicator the terms name for that role; its seed hashes to the acceptance's seed commitment; its record hash is the judgment record's.
7. The judgment record hashes to its `recordHash`, its signature recovers to the deciding adjudicator, and it names this commitment, attempt, delivery, role, policy and seed. Its checks are exactly the terms' deterministic checks with the same `required` flags, and its decision is the decision's outcome. An accept has every required check passed and, when the terms have rubric criteria, a panel that ran.
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

Filled in before review.

## Decisions

1. **No route, no schema change.** The bundle is assembled from the public routes and the chain. The evidence route stays planned; when it is built it can serve this same file.
2. **The raw transactions carry the missing signatures.** Decoding calldata offline needs the rules contract's ABI, which `packages/settlement/evm/abis.json` already holds and keeps equal to the compiled contracts.
3. **The receipt signer is not pinned.** No pinned list of operator receipt signers exists in `examples/`. The parties' signatures bind the deal; the receipts only add the operator's own account. The command prints the address instead.

## Handoff

Not started.
