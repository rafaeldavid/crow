# T-541: a seller's proof that the buyer's key envelope opens the held work, optional and not integrated

- **Lane:** security (prototype)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 10 (research), with a prototype in `tools/` that no tool calls; local checks: the prototype's own build and runs; review by one reviewer agent
- **Depends on:** T-535 (case study 3, the waiver run as ADR-0039 describes it)
- **Paths this task may touch:** `tools/envelope-proof/` (new), this file
- **Human gate:** no (no deploy; Rafa approved installing Rust and RISC Zero's toolchain on the Mac on 2026-11-18)
- **Status:** done with the merge of pull request 669 on 2026-11-18, after CI passed and the review's findings were fixed (PASS on the re-review); the prototype stays optional and not integrated
- **Agent/session:** the T-534 session, 2026-11-18, branch `t-541-envelope-proof`
- **Roadmap row:** N200

## What exists

- **The waiver** (`docs/what-a-deal-can-do.md`, "Settling late work"; ADR-0039 section 2; `docs/research/2026-11-18-case-study-3/waiver.ts`) lets a buyer accept work that fails a check without seeing it first.
- **Today's checks stop short of the envelope.** The buyer can check the delivery's hash from its fields and envelope hashes. The contract checks only that the released envelope is the committed one (`_requireKeyProof`). Neither shows that the envelope opens.
- **Nothing in the repository proves anything about encrypted content.** This prototype is new.

## Intent

Rafa, 2026-11-18: "build it out as an optional feature we need to harden later. Add to roadmap, build, and leave as not integrated yet." Build a seller-side zero-knowledge proof, checked by the buyer before it countersigns a waiver, that the buyer's envelope opens to a key that decrypts the held ciphertext to the signed plaintext hash. It works on today's formats, with no change to the contracts, `spec/` or the operators.

Non-goals:
- wiring it into the seller adapter, the hosted seller, the buyer signer or any page;
- proving the declarative checks;
- CI for Rust;
- a deploy.

## Acceptance criteria

- [x] A guest program and a prover and verifier command, in `tools/envelope-proof/`, on today's envelope scheme and ciphertext format.
- [x] A fixture that seals a real report as `prepareDelivery` does, keeping the envelope's one-time secret.
- [x] A real proof (not dev mode) on a case-study report, verified, with its time, cycle count and receipt size measured.
- [x] Two tampered inputs (a wrong key in the envelope, a wrong secret) for which no proof exists.
- [x] A README with what it proves, what it does not, and what to harden before any use.
- [x] Not called by any Crow tool, and no change outside `tools/envelope-proof/` and this file.

## Evidence

Measured on 2026-11-18. The setup:
- The toolchain: Rust 1.100.0 by rustup, and RISC Zero by rzup (`cargo-risczero` 3.1.0, `r0vm` 3.1.0, risc0 Rust 1.97.0), about 2.1 GB in `~/.rustup`, `~/.cargo` and `~/.risc0`. Installed from the official installers after Rafa's yes.
- The build: `cargo build --release` in `tools/envelope-proof/`, first try, in 2 min 37 s. Image ID `db89f5589567929f697d81389f6332425de67750a5c3ac39e4a1ede0ceb5b381` before the review; `e3f804b63d4dbf142efd72a637cab4313dce58fa5e42345d1f0adb7b9902c055` after its scheme check.
- The inputs: `fixture.ts` on two converted case-study reports, `shieldify-l5` (3,048 bytes) and `shieldify-l3` (26,151 bytes), each sealed as `prepareDelivery` seals it. The fixture's own check opened each envelope with the buyer's secret and decrypted the report.

The proof of the 3,048-byte report, not dev mode, under the final image ID:
- 8,519,680 cycles in 9 segments;
- 2,813 s of wall time and 8,809 s of CPU, 4.62 GB peak memory, at a load average of 18 to 53 from other sessions;
- a succinct receipt of 224,410 bytes.

The first build's proof of the same report took 1,915 s at a load average of 30 to 61.

`verify` passed all seven checks, in 17 ms of receipt verification:
- the receipt, succinct;
- one envelope for the buyer in the offer;
- the recipient;
- the buyer's key;
- the envelope hash;
- the ciphertext hash;
- the plaintext hash.

The 26,151-byte report: 22,020,096 cycles in 21 segments in dev mode, with no proof made. A real proof is about 2.6 times the first (inferred), and was not run.

What fails as it should:
- A wrong key in the envelope: the guest stops, "the content key does not decrypt the ciphertext", exit 1, no receipt.
- A wrong secret: the guest stops at the ephemeral-key check, exit 1, no receipt.
- The verifier given another delivery's envelope hash: FAIL, "do not countersign", exit 1.
- A dev-mode receipt, verified with and without `RISC0_DEV_MODE=1` set: FAIL on the receipt, exit 1.
- An offer listing two envelopes for the buyer: FAIL, exit 1.
- An envelope labelled with another scheme: the guest stops, no proof, exit 1.

`pnpm exec eslint tools/envelope-proof/fixture.ts`: clean. CI does not build Rust, so CI covers only the fixture's lint.

## Decisions

- **RISC Zero, proving locally.** Rafa chose it on 2026-11-18, over SP1, whose usual route sends inputs to a proving network.
- **The statement covers the match only:** envelope, key, ciphertext and plaintext hash. Proving the checks too needs a second implementation of `packages/judgment` that must equal the adjudicator's, which is real risk and upkeep.
- **The envelope is named by its EIP-712 hash,** the one a waiver offer shows. The buyer compares the hash it already holds, so the proof needs no new field.
- **The review (one reviewer agent, 2026-11-18): ISSUES, one blocking, all fixed.**
  - Blocking, fixed: `verify` accepted a dev-mode receipt when `RISC0_DEV_MODE` was set in the buyer's shell, measured by the reviewer. It now refuses any receipt that is not succinct before it verifies. Retested with the variable set: FAIL, exit 1.
  - Fixed: the contract releases any envelope addressed to the buyer that the submitter names, so `verify` now requires the waiver offer to list exactly one, and the PASSED line no longer overstates. Binding the envelope into the signed settlement is on the hardening list.
  - Fixed: the guest now asserts the scheme. Another label gives no proof, which changed the image ID to `e3f804b63d4dbf142efd72a637cab4313dce58fa5e42345d1f0adb7b9902c055`.
- **Pure-Rust crates, without RISC Zero's accelerated forks,** to keep the first build's dependencies plain. That makes the proof slower.

## Handoff

- Done: the prototype, its runs, the measurements. Not integrated: no Crow tool calls it, and no page names it.
- To resume: `tools/envelope-proof/README.md`, "Run it".
- To harden before any use, in order: the README's list (keep the ephemeral secret in `prepareDelivery` behind an option; a reproducible build and a published image ID; GPU proving and the accelerated crates; a second-family review of the formats and the statement); then where it plugs in, the waiver offer of ADR-0039 and the buyer's countersign.
- Open for review: whether the statement should also bind the commitment ID, the delivery hash, the byte count and the `cipher` field.
