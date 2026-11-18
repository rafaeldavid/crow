# Envelope proof: the buyer's key opens the held work (T-541)

**State: an optional prototype, not wired into any Crow tool, to harden before any use (roadmap row N200).** It answers one gap that case study 3 found in the waiver (ADR-0039 section 2). A buyer that countersigns a waiver has not seen the work, and cannot check before it pays that its key envelope opens it. The contract only checks that the released envelope is the one the delivery committed to (`contracts/src/HoldbackRules.sol`, `_requireKeyProof`).

## What it proves

The seller runs the prover; the buyer runs the verifier before it countersigns. The proof is a RISC Zero receipt of the guest program in `methods/guest/`. It states:

> There is a secret such that:
> - the buyer's envelope, named by its EIP-712 hash, opens under the buyer's encryption key to a content key;
> - that key decrypts the delivery's ciphertext, named by its SHA-256;
> - the result has the delivery's signed plaintext SHA-256.

The guest also requires the envelope's scheme to be `x25519-xsalsa20poly1305`. The secret is the one-time X25519 key the seller sealed the buyer's envelope with. X25519 is symmetric, so what opens under that secret and the buyer's public key opens for the buyer too. The receipt reveals neither the key nor the work.

Everything the buyer compares, it already holds before it countersigns (`expect.json`):
- the recipient address and encryption key, from its terms;
- the envelope hash, the ciphertext hash and the plaintext hash, from the waiver offer (`docs/research/2026-11-18-case-study-3/waiver.ts`).

The formats are today's, so there is no change to the contracts, to `spec/` or to the operators:
- the envelope scheme is `x25519-xsalsa20poly1305`;
- the ciphertext is AES-256-GCM with a 12-byte nonce;
- the EIP-712 type is `EncryptedKey` from `examples/verify.ts`.

## What it does not prove

- **That the work is good, or that it fails only the waived checks.** The checks run in TypeScript in `packages/judgment`. A proof of them needs a second implementation in the guest that must give the adjudicator's exact results. That is left out on purpose.
- **That the seller's report is honest.** It proves the buyer gets the bytes the seller signed, and no more.
- **Anything about the other envelopes,** the adjudicators'.
- **That the settlement releases this envelope.** The contract releases any envelope addressed to the buyer that the submitter names (`_requireKeyProof`), and the signed `MutualSettlement` does not name the envelope. So `verify` also requires the waiver offer to list exactly one envelope for the buyer (`envelopesForBuyer` in `expect.json`, which the buyer counts itself). Binding the envelope into what the buyer signs is a hardening step below.

## Run it

Rust and RISC Zero's toolchain (`rzup`, `cargo-risczero` 3.1.0) are needed; neither is part of the repository's setup or CI.

```
cd tools/envelope-proof && cargo build --release
node tools/envelope-proof/fixture.ts --report <report.json> --out <dir>
tools/envelope-proof/target/release/envelope-proof prove <dir>/input.json <dir>/receipt.bin
tools/envelope-proof/target/release/envelope-proof verify <dir>/receipt.bin <dir>/expect.json
tools/envelope-proof/target/release/envelope-proof image-id
```

`fixture.ts` seals a report the way `examples/agent.ts` `prepareDelivery` does, with a fresh buyer key. The one change is that it keeps the envelope's one-time secret, which today's tools discard. `--tamper wrong-key` and `--tamper wrong-secret` make inputs for which no proof exists.

## Measured

All on 2026-11-18, on the Mac: Apple M1 Pro, 16 GB, proving on the CPU, shared with other sessions at a load average of 18 to 61. Image ID `e3f804b63d4dbf142efd72a637cab4313dce58fa5e42345d1f0adb7b9902c055`, after the review's scheme check (rzup: cargo-risczero 3.1.0, r0vm 3.1.0, risc0 Rust 1.97.0; host Rust 1.100.0).

| Input | Cycles | Segments | Proving | Receipt | Verify |
| --- | --- | --- | --- | --- | --- |
| A 3,048-byte case-study report | 8,519,680 | 9 | 2,813 s wall, 8,809 s CPU, 4.62 GB peak memory | 224,410 bytes, succinct | 17 ms, all seven checks pass |
| A 26,151-byte case-study report | 22,020,096 (dev mode, no proof) | 21 | not run; about 2.6 times the cycles, so about 80 min on the same load (inferred) | | |

No proof exists for either tampered input. With a different key in the envelope, the guest stops at "the content key does not decrypt the ciphertext". With another secret, it stops where the secret does not match the envelope's ephemeral key. Each exits 1 before any proving and writes no receipt. The verifier refuses a real receipt checked against another delivery's envelope hash, an offer listing two envelopes for the buyer, and a dev-mode receipt even with `RISC0_DEV_MODE=1` set, exit 1 each. A label other than `x25519-xsalsa20poly1305` gives no proof. The first build, before the review, proved the same report in 1,915 s under image ID `db89f558…b381`.

The cycles are few for a zkVM; the time is the CPU prover on a loaded machine. RISC Zero's GPU prover and its accelerated crates (`sha2`, `curve25519-dalek`) are the first levers (inferred), and a proving service another.

## Before any integration (to harden)

- **Keep the secret.** `examples/agent.ts` `prepareDelivery` discards the ephemeral secret. A seller that wants to prove has to keep it, per delivery, as a secret.
- **Pin the image ID.** A buyer must pin the guest's image ID the way it pins `buy.mjs`. A rebuild with another toolchain or dependency changes it. The build should be reproducible (`cargo risczero build`, Docker), and the ID should be published.
- **Bind the envelope.** Until the settlement names the envelope it releases, the one-envelope-per-recipient rule is the whole defence against a second, bad envelope for the buyer. It holds in `packages/core` and in this verifier, not on chain.
- **Only a succinct receipt counts.** `verify` refuses any other kind before it verifies, because risc0's `verify()` accepts a fake receipt when `RISC0_DEV_MODE` is set in the verifier's environment. That is the review's blocking finding, fixed and tested with the variable set. A production verifier should also build with risc0's `disable-dev-mode` feature.
- **Review.** A second-family review of the guest's formats and the statement's completeness is needed, including the encoding match between `crypto_box` 0.9 and tweetnacl, and non-canonical base64url text. Recorded questions:
  - whether the buyer must also check the ciphertext's byte count and the `cipher` field;
  - whether the statement should bind the commitment ID and the delivery hash;
  - who submits, and the key proof.
- **Dependencies.** The guest uses `crypto_box`, `x25519-dalek`, `aes-gcm`, `sha2`, `tiny-keccak` and `base64` in pure Rust, without RISC Zero's accelerated forks. Faster versions exist; each needs its own review. `Cargo.lock` pins every version.
- **Where it plugs in.** The waiver offer that ADR-0039 plans (`GET /deals/{commitmentId}/waiver`) would carry the receipt. The buyer's countersign step would refuse to sign unless `verify` passes. Neither is built.
