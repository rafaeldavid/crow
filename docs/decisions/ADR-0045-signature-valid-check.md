# ADR-0045: A check verifies a signature by a key the terms pin

- **Status:** Proposed, 2026-11-25 (D90). Amended 2026-11-25 by D92: an adjudicator signs no decision on a kind it does not run, at any role. A decision Rafa can overrule. Design only: no code and no schema file changes with this record.
- **Date:** 2026-11-25
- **Raised by:** T-585, roadmap row N225. The research note `docs/research/2026-11-24-delivery-proofs.md` (T-582) recommends new check kinds over a proof field on the delivery, and `signature_valid` first.
- **Builds on:** ADR-0001 (neutrality), ADR-0006 (deterministic checks run first), ADR-0021 (checks read the bytes as delivered), ADR-0022 (no float in a hashed body), ADR-0031 (phase one: the first decision is final), ADR-0036 (a deal is judged under the policy it bound); D26, D28, D31, D32, D35.
- **Changes at acceptance:** this record, D90 and the task file. The build is its own task (kind 5 and kind 6 in `docs/team.md`, Change recipes): schema v0.13, one evaluator in `packages/judgment/src/checks/`, the vectors, `site/ref/checks.txt`.

Labels: **measured** (read at `origin/main` `9342f4f4` on 2026-11-25, with the source), **reported** (the laboratory's description of its kit; Crow has not run it against the live service), **recalled** (from the model's knowledge, not opened that day), **inferred**, **guessed**. Nothing was run for this record: no signature was checked.

## Summary

1. **`signature_valid` passes when the exact bytes at one place in the delivered JSON document carry a valid signature by the key whose fingerprint the terms pin.** It proves that the key's holder signed those bytes, and nothing more.
2. **The check signs exact bytes. It canonicalises nothing.** The message is a JSON string in the document, read as its UTF-8 bytes or decoded from base64. A signed part with decimals is fine, because the adjudicator never prints a number. RFC 8785 is not used.
3. **One optional parameter ties the signed bytes to an object the other checks can read.** `message.jsonEquals` names a second place in the document; the signed bytes must parse to the same JSON value. Without it, a seller can sign one manifest and show the checks another.
4. **Two algorithms, a closed list:** ECDSA P-256 with SHA-256, and Ed25519. The key is pinned by the SHA-256 of its DER `SubjectPublicKeyInfo`.
5. **Built-in code only.** The evaluator uses `@noble/curves` at the exact version the adjudicator app already pins [measured, `apps/adjudicator/package.json`]. Nothing from the delivery or the terms is executed, fetched or loaded.
6. **A malformed input or a bad signature fails the check; a required failed check refunds the buyer, as today.** The work budget is the only time limit, so two adjudicators reach the same result.
7. **Schema v0.13 adds the kind and a `checkKinds` list on each adjudicator's record.** No signed type changes, no contract changes, and the EIP-712 domain version stays [inferred].
8. **An adjudicator signs no decision on terms that name a kind it does not run (D92).** As primary it declines the offer. At a later turn, as fallback, appeal adjudicator or a primary whose build lost the kind, it refuses before stage 1 and the deal passes to the next adjudicator or its default. The offer then expires unfunded. The seller's and the buyer's own tools read the three named adjudicators' lists before they sign.

## Context

- **Stage 1 today** [measured, `packages/judgment/src/checks/index.ts`]. Nine kinds in a closed registry, each evaluated by built-in code over the text as delivered. A check that cannot be evaluated fails closed, an unknown type included (`validateCheck`). A check that runs out of the shared work budget (`CHECK_BUDGET`) is inconclusive, and the pipeline escalates instead of rejecting. A detail line is capped (`DETAIL_MAX`).
- **What no check can do today** [measured, `site/ref/checks.txt`, "Writing checks for a robot episode"]: "The check cannot verify the signature itself; it pins the public key and the signed message's format."
- **The research note's sketch** used `message.form` `string` or `jcs`, and required integers only under `jcs`. It left open whether the terms pin the key's hash or hold the whole key, and whether discovery lists a node's kinds.
- **The worked example: a robotics laboratory's signed episode** [reported]. Its kit writes a manifest (the hash of every file, the order, statistics, with joint values in decimal degrees), serializes it with sorted keys and no spaces in Python, and signs those bytes with ECDSA P-256 and SHA-256. The signature is DER, in base64. The public key is a PEM file. The laboratory sends the key's fingerprint by a separate channel: the SHA-256 of the DER `SubjectPublicKeyInfo`. For a Crow deal the delivery is one JSON document that holds the manifest as an object, the signature and the key as text, and the telemetry gzipped in base64.
- **Why the example decides the canonicalisation question.** The kit signs Python's printing of the manifest. Python prints `1.0` where RFC 8785 prints `1` [measured for Python and ECMAScript in ADR-0022]. So a TypeScript verifier that re-serializes the manifest object does not reproduce the signed bytes for any manifest with a whole-valued decimal [inferred]. The research note's `jcs` form with integers only would refuse this manifest outright.

## Decision

### 1. Parameters

```json
{ "id": "manifest-signature", "type": "signature_valid", "required": true,
  "alg": "ecdsa-p256-sha256",
  "publicKey": { "pointer": "/pubkey_pem", "format": "spki-pem", "spkiSha256": "sha256:<64 hex>" },
  "message": { "pointer": "/manifest_text", "encoding": "utf8", "jsonEquals": "/manifest" },
  "signature": { "pointer": "/manifest_sig", "encoding": "base64", "format": "der" } }
```

| Parameter | Values | Rule |
| --- | --- | --- |
| `alg` | `ecdsa-p256-sha256`, `ed25519` | A closed list. A new algorithm is an ADR and a schema bump |
| `publicKey.pointer` | An RFC 6901 JSON pointer, at most 512 characters | Must resolve to a JSON string of at most 1,024 characters |
| `publicKey.format` | `spki-pem`, `spki-base64` | The DER `SubjectPublicKeyInfo`, as a PEM block labelled `PUBLIC KEY` or as plain base64 |
| `publicKey.spkiSha256` | `sha256:` and 64 lowercase hex characters (`common.schema.json`, `Sha256`) | The SHA-256 of the DER bytes after decoding. `openssl pkey -pubin -outform DER \| sha256sum` prints the same digits [recalled] |
| `message.pointer` | A JSON pointer, at most 512 characters | Must resolve to a JSON string. Its only size limit is the delivery's |
| `message.encoding` | `utf8`, `base64` | `utf8`: the signed bytes are the UTF-8 encoding of the string. `base64`: the signed bytes are the decoded string |
| `message.jsonEquals` | Optional. A JSON pointer, at most 512 characters | The signed bytes must parse as JSON to a value equal to the value at this pointer (section 3) |
| `signature.pointer` | A JSON pointer, at most 512 characters | Must resolve to a JSON string of at most 256 characters |
| `signature.encoding` | `base64` | Standard alphabet with padding (RFC 4648, section 4) |
| `signature.format` | `der`, `raw` | ECDSA: `der`, or `raw` as r then s in 64 bytes. Ed25519: `raw` only, 64 bytes. `validateCheck` refuses `ed25519` with `der` at offer time |

- **Every parameter is a string.** No number enters the hashed terms, so ADR-0022 holds with nothing to check.
- **The delivery carries the key and the terms pin its fingerprint.** This is how a seller hands out a key: a short fingerprint by a separate channel. It also keeps a rotated key a one-string change in the next deal's terms. The cost is one more pointer and a decoder for two key formats. The check compares the fingerprint before any curve arithmetic.
- **The pointers read the document as `JSON.parse` returns it**, the same value `json_schema` reads today [measured, `checks/index.ts`]. The kind needs a JSON delivery; on any other format it fails.

### 2. The signed bytes are exact bytes

The check never serializes JSON. The seller's tooling puts the bytes it signed into the document as a string, and the adjudicator hashes those bytes.

| | Exact bytes at a pointer (chosen) | RFC 8785 over the value at a pointer |
| --- | --- | --- |
| **Decimals in the signed part** | Fine: no number is printed | Only safe integers, or a signer that prints numbers as ECMAScript does |
| **Works with a signer that already exists** | Yes, whatever it signs: its own canonical form, a CSV, a binary file in base64 | Only a signer written to RFC 8785 |
| **Code in the adjudicator** | A UTF-8 encoder or a base64 decoder | A canonicaliser whose output every signer must match byte for byte |
| **Other checks can read the signed fields** | Only with `jsonEquals`, or by a pattern on the string | Yes, directly |
| **Document size** | The signed text appears twice when `jsonEquals` is used | Once |

**Decimals: decided.** A signed part may hold any JSON, decimals included. The laboratory's manifest keeps its decimal degrees and its kit signs what it signs today. The rule "integers only" stays where ADR-0022 put it: in the terms, which are hashed. The delivered document is not a hashed body [inferred: the delivery's hash covers its bytes, not a re-serialization].

- **`utf8`:** the string must be well-formed Unicode. A lone surrogate fails the check, because it has no UTF-8 encoding.
- **`base64`:** standard alphabet, padding required, no whitespace, no non-zero trailing bits. One byte string has one accepted spelling.

### 3. `jsonEquals` ties the signed bytes to a readable object

With `jsonEquals`, the evaluator parses the signed bytes as UTF-8 JSON and compares the result with the value at the named pointer. Both come from the same parser. Two values are equal when they have the same type and:

- objects have the same set of keys and equal values under each key, in any order;
- arrays have the same length and equal items in order;
- strings have the same code units;
- numbers are the same IEEE 754 double (so `1.0` in the signed text equals `1` in the object, and `-0` equals `0`);
- `true`, `false` and `null` match themselves.

Signed bytes that are not valid UTF-8 JSON fail the check. The comparison spends one budget unit per value visited.

**Why it is in the first version.** In the worked example, six of today's checks read fields of the manifest object: the buyer's nonce, the order's hash, the signer's fingerprint, the status, the sample count and the columns. Without `jsonEquals` the signature covers a string beside that object, and nothing says the two agree. With it, every `json_schema` check on the object reads signed fields. It is the one addition to the research note's sketch, and it replaces the note's `jcs` form. Rafa may cut it; the kind then proves a signature over an opaque string.

**Limit to state on the reference page:** a duplicated key inside the signed text is read as the parser reads it (the last one wins) [recalled for `JSON.parse`]. The seller holds the key and could sign any text, so this gives it nothing new.

### 4. How the adjudicator verifies it

In order, stopping at the first failure:

1. Parse the delivery once as JSON. Resolve the three pointers; each must be a string within its length limit.
2. Decode the key. `spki-pem`: one block, the label `PUBLIC KEY`, lines ended by LF or CRLF, an optional final line end, nothing before or after. `spki-base64`: the string, under the base64 rule above.
3. Hash the DER bytes with SHA-256 and compare with `spkiSha256`.
4. Match the DER bytes against the one accepted shape for the algorithm, by fixed prefix and length. No general ASN.1 reader runs on delivered bytes.
   - `ecdsa-p256-sha256`: 91 bytes, the 26-byte prefix for an `id-ecPublicKey` key on `prime256v1`, then `04` and the two 32-byte coordinates [recalled]. A compressed point is refused.
   - `ed25519`: 44 bytes, the 12-byte prefix for `id-Ed25519`, then the 32-byte key [recalled].
5. Decode the signature from base64 and check its length: at most 72 bytes for `der`, exactly 64 for `raw`.
6. Produce the message bytes (section 2).
7. Verify.
   - ECDSA: SHA-256 of the message, then verification on P-256. The DER form is read strictly. r and s must lie between 1 and the curve order less 1. A high s is accepted: the signature is not an identifier, and common signers produce either [inferred].
   - Ed25519: plain Ed25519 as in RFC 8032, with no prehash and no context. Non-canonical encodings are refused; the build sets the library's strict option and not its ZIP 215 mode [recalled: `@noble/curves` offers both], so one signature has one result in every adjudicator.
8. When `jsonEquals` is set, compare (section 3).

The inputs are the delivered bytes and the terms. The evaluator opens no network connection, reads no clock, and loads no code. Two adjudicators, the buyer's tool and the seller's tool reach the same result from the same two inputs.

### 5. What a failure looks like

- **The check's outcome is `passed: false` with one detail line** that names the step and never quotes the message, the key or the signature:
  `not a JSON document`, `publicKey: nothing at the pointer`, `publicKey: not a string`, `publicKey: too long`, `publicKey: not a PEM public key`, `publicKey: not valid base64`, `publicKey: fingerprint differs from the terms`, `publicKey: not a P-256 key` (or `not an Ed25519 key`), `signature: not valid base64`, `signature: wrong length`, `signature: not valid DER`, `message: not valid base64`, `message: not well-formed text`, `signature does not verify`, `message: not JSON`, `message: differs from the value at jsonEquals`. The same step names apply to `signature:` and `message:` pointers that resolve to nothing or to a non-string.
- **A required check that fails rejects the delivery without the panel,** and the deal follows its terms for a failed check (a full refund under the default) [measured, `docs/judgment-and-defenses.md`, Short circuits]. With submissions left, the seller may deliver again inside its deadline.
- **Malformed input is a failure, not an escalation.** A seller that delivers bad base64 has not delivered the proof it agreed to.
- **Budget exhaustion is inconclusive and escalates,** as for every kind.
- **A malformed check in the terms** (an unknown `alg`, `ed25519` with `der`, a pointer that is not RFC 6901) is refused by `validateCheck` at offer time, and by the schema.

### 6. Size and time limits

| Limit | Value | Source |
| --- | --- | --- |
| Pointer | 512 characters | This record |
| Public key string | 1,024 characters (a P-256 key in PEM is about 180) | This record [recalled size] |
| Signature string | 256 characters (a DER P-256 signature in base64 is at most 96) | This record |
| Message | The delivery's own limit: the node's `limits.maxCiphertextBytes` | [measured, `docs/api.md`, Limits] |
| Work | 1 budget unit per message byte hashed or decoded, 200,000 units per signature verification, 1 unit per value compared | This record [guessed; the build measures and sets them before the kind ships] |
| Wall clock | None | A timer would let two adjudicators differ on one delivery |

The shared budget is `CHECK_BUDGET` [measured, `checks/index.ts`]. One check over a message at the public nodes' store limit spends about 2% of it at these rates [inferred]. The constants are part of the kind: once shipped, a change to them is a change to judgment and takes a new policy version (ADR-0036).

### 7. The library and its pinning

- **`@noble/curves`, added to `packages/judgment` as a direct dependency at the exact version `apps/adjudicator/package.json` names,** with no range. The lockfile's integrity hash pins the tarball. It implements P-256 and Ed25519 in plain JavaScript [recalled], so the same code runs in Node and in the Workers that host Crow's adjudicators [inferred].
- **SHA-256 comes from `@holdback/core/crypto`,** which stage 1 already imports [measured].
- **A version change re-runs every vector** (section 9) and is a judgment change (kind 5).
- **The build passes the strictness options by name** (`lowS: false` for P-256, the strict Ed25519 rule), so a changed library default cannot change a result silently.

### 8. Schema, version and discovery

- **Schema v0.13.** `commitment.schema.json`, `$defs/DeterministicCheck`, gains one branch for `signature_valid` with `additionalProperties: false`. `adjudicator.schema.json` gains `checkKinds`: an optional array of unique kind names. An absent list means the nine kinds of v0.12.
- **`checkKinds` sits beside `policy`, not in it.** `policyHash` is the hash of `policy` alone [measured, `docs/api.md`, "Offer"], so no registration and no bound policy changes. `GET /v1/adjudicators` and `GET /v1/adjudicators/{address}` serve the list as they serve the rest of the record.
- **No signed type changes.** Checks enter signatures through the acceptance hash, so the EIP-712 domain version stays and no contract changes [inferred from the research note's reading of `packages/core/src/eip712.ts`; the build confirms].
- **One bump per ready kind.** The research note proposed one bump for four kinds. This record takes `signature_valid` and `checkKinds` in v0.13. `passes_through`, `monotonic_column` and `equal_lengths` join v0.13 if their sections are decided before the schema pull request opens, and take the next version otherwise. With `checkKinds` in place a later kind costs one schema branch and no coordination, and while the version is 0.x every contract change bumps it [measured, `docs/api.md`, "Versions, in one place"].
- **An operator on v0.12 refuses a v0.13 offer as invalid terms** [inferred]. The party sends it to an operator on v0.13 or straight to the settlement layer (ADR-0005).

### 9. Test vectors

Published with the reference page, in one JSON file the build places under `spec/`:

- **Crow's own vectors,** each a document, a check and the expected outcome with its detail line: one valid delivery per algorithm, signature format, key format and message encoding, and the failures listed under "Tests the build must add". Each carries a public key, a message and a signature. No private key is committed.
- **A cross-language pair:** one message signed by Python's `cryptography` package and one by Node, both verified by the evaluator. This is the laboratory's path, so it runs before the reference page is published.
- **The published edge cases for both algorithms** from Project Wycheproof [recalled], copied at a named commit with its licence. Every vector's expected result must match. Where Wycheproof marks a result as acceptable either way, this record's rule decides (strict DER, high s accepted, strict Ed25519), and the file says which.
- **Any adjudicator can run the file.** Phase one has no party appeal, so a wrong signature check has no remedy inside the protocol (D57). The vectors are how a second adjudicator shows it runs the same kind.

### 10. Neutrality

- **The verifier is built-in code in each adjudicator,** so the kind adds no new party that can stop a deal [inferred].
- **At judging time an adjudicator that meets a kind it does not run signs nothing (D92, amending the first text).** It refuses the turn before stage 1, so it never accepts and never rejects on a check it did not run. Stage 1 still fails an unknown kind closed, as the last guard. Paying for work whose agreed proof nobody checked would break the buyer's terms (D28), and a reject would pay the fee for a check never run.
- **The real protection is before anyone signs.**
  - *The primary declines.* It posts no `AdjudicatorAcceptance` for an offer with a kind outside its `checkKinds`, or with a check `validateCheck` refuses, and says why in the offer's `notices`, as it does today for a reference file it cannot fetch [measured, `docs/api.md`, "Reference files"]. The offer expires unfunded. No hold exists.
  - *The parties read three lists.* The fallback and the appeal adjudicator sign nothing before the hold is funded [inferred]. So the seller's preflight and the buyer's check before agreeing read `checkKinds` for all three named adjudicators, from two operators, and refuse to sign when one lacks a kind in the terms. That is a check a party runs before signing (D32). The protocol adds no step for a party that skips it.
  - *An operator may warn, never refuse* (D31).
- **What a party loses if it skips the check** [inferred]: the primary goes offline, the fallback lacks the kind and signs nothing (D92), and the deal defaults. The buyer gets price and fee back and never receives the key. The seller loses the sale and its time, not money. The adjudicator that lacked the kind earns no fee. The loss is bounded (D26).
- **Fixtures the build adds:** `neutrality.adjudicator-lacks-check-kind` (the primary declines; the offer expires unfunded; no funds move; built in T-590, replaced in T-597 by the unit tests in `apps/adjudicator/src/check-kinds.test.ts` and by `neutrality.fallback-lacks-check-kind`), and the research note's `neutrality.proof-check-primary-offline` and `neutrality.proof-check-both-offline`. A fourth runs the kind twice on one delivery and compares the judgment records byte for byte.

### 11. Privacy

- **The proof travels inside the encrypted delivery.** An operator sees ciphertext; the chain sees the delivery's hash and the decision (D35).
- **The fingerprint sits in the terms.** At the `public` level anyone can read it, and the same key in two deals links them. That is the parties' disclosure. A seller that wants no link signs with a key made for the deal, or uses private terms once an adjudicator can open them.
- **The detail line never echoes delivered bytes,** so the judgment record leaks nothing the terms did not already say.

### 12. The worked example

The laboratory's document gains one field, `manifest_text`: the exact text its kit signed. Its kit, its key and its own verifier do not change; the export step that writes the document is seller-side tooling. The terms gain the check in section 1, with the fingerprint the laboratory sent.

| | Today's nine checks | With `signature_valid` and `jsonEquals` |
| --- | --- | --- |
| The manifest names the buyer's nonce and the order's hash | Checked, on an unsigned object | Checked, on fields the pinned key signed |
| The manifest was signed by the pinned key | A string names the fingerprint | Verified |
| 64 random bytes in place of the signature | Pass | Refund |
| The telemetry matches the hash in the manifest | Not checked | Not checked: no kind hashes one field and compares it with another. The buyer's own run of the kit's verifier covers it; a hash check goes to the triage list |
| The arm moved | Not provable | Not provable. The buyer holds a record the key's holder cannot deny (D26) |

## What N226 can reuse

1. **One verifier function.** `verifySignature(alg, spkiDer, message, signature, format)` is pure and lives apart from the pointer handling, so a `proofs` entry on the delivery can call it on `plaintextSha256` for a file that is not JSON.
2. **The algorithm names, the fingerprint encoding and the strict key shapes,** unchanged. A proof entry's `verifier` field names this kind and its version.
3. **The vectors file,** which a proof kind extends and does not copy.
4. **The discovery pattern.** A `proofKinds` list beside `checkKinds`, read by the same preflight.
5. **The outcome rule.** A failed proof is a failed required check; an inconclusive one escalates.
6. **The decline rule.** An adjudicator that cannot run a proof kind declines before funding.

N226 still needs its own field on the delivery and a contract change, as the research note says. Nothing here changes a contract.

## Rejected alternatives

| Alternative | Why not |
| --- | --- |
| **RFC 8785 over the value at a pointer, integers only** (the research note's `jcs`) | It refuses the worked example's manifest, and every signer must be rewritten to one canonical form. Exact bytes with `jsonEquals` gives the same binding with no canonicaliser |
| **RFC 8785 with decimals** | The adjudicator would have to match each signer's number printing. Python and ECMAScript differ (ADR-0022) |
| **Re-serializing in the seller kit's own canonical form** | The adjudicator would run a format a seller defined. That is a plug-in by another name |
| **The whole public key in the terms** | One pointer fewer, but a seller hands out a fingerprint, and the terms would carry key bytes in a second encoding to validate. Kept as a later `publicKey` option if a deal asks for it |
| **WebCrypto for verification** | Its Ed25519 support and its edge-case rules vary by runtime [recalled], and two adjudicators could differ |
| **A general ASN.1 or X.509 reader, or a certificate chain** | A large parser on untrusted bytes, and a chain needs a clock and outside data. A hardware-held key's certificate stays outside the check |
| **More algorithms now** (RSA, secp256k1, P-384) | No deal asks for one. The list is closed and grows by ADR |
| **A wall-clock limit per check** | Two adjudicators could differ on one delivery |
| **An adjudicator that lacks the kind fails the check and signs the reject** | Amended by D92, 2026-11-25: the money does not move the same way. A reject pays the fee to the adjudicator that decided and returns the price; a default returns price and fee. The service can refuse the turn before stage 1 runs, so no new outcome is needed. An adjudicator now signs nothing on a kind it does not run |
| **`checkKinds` inside `policy`** | It changes `policyHash`, so every adjudicator registers again and every bound policy moves, for a list a party can read without it |
| **A `json_schema` option that parses a string as JSON** | It changes a shipped kind's meaning. `jsonEquals` leaves the nine kinds as they are |
| **A typed proof field on the delivery now** | The research note's option B: a signed type and a contract change. It waits for N226 |

## Tests the build must add

Unit tests in `packages/judgment/src/checks/`, each also a vector:

| Case | Expected |
| --- | --- |
| **Valid:** each algorithm, with `der` and `raw`, `spki-pem` and `spki-base64`, `utf8` and `base64`; a high-s ECDSA signature; a message with decimals; `jsonEquals` with keys in another order | pass |
| **Wrong key:** a valid signature by a key whose fingerprint is not the pinned one | fail, `publicKey: fingerprint differs from the terms` |
| **Wrong message:** one byte of the message changed; and with `jsonEquals`, one value of the object changed | fail, `signature does not verify`; fail, `message: differs from the value at jsonEquals` |
| **Wrong algorithm:** `alg` `ed25519` with a pinned P-256 key, and the reverse; an Ed25519 check with `der` at offer time | fail, `publicKey: not an Ed25519 key` (or P-256); refused by `validateCheck` |
| **Malformed base64:** in the signature, the key and the message; whitespace, missing padding, the URL alphabet, non-zero trailing bits | fail, with the step's line |
| **Oversize:** a key string over 1,024 characters; a signature string over 256; a message that spends the whole budget | fail, `too long`; fail, `too long`; inconclusive |
| **Hostile shapes:** a pointer to nothing, to a number, to an object; a PEM with a second block or another label; a compressed point; a point not on the curve; r or s of zero; trailing bytes after the DER signature; a lone surrogate in a `utf8` message; a CSV delivery | fail, never a throw |
| **Detail lines** | at most `DETAIL_MAX` long; none holds a byte of the message, the key or the signature |
| **Property test** | any change to one byte of the message, the signature or the key turns a passing delivery into a failing one |
| **Determinism** | two runs give the same judgment record bytes |
| **Wycheproof** | every copied vector matches |
| **Schema** | `pnpm validate:spec` accepts the example terms and refuses an unknown `alg`, an extra property and a numeric parameter |
| **Scenario fixtures** | the three neutrality fixtures in section 10; one deal accepted, one refunded for a changed manifest |

## Consequences

- **Release can depend on a seller-side proof,** for any signer that can put its signed bytes into a JSON document.
- **A buyer still carries the burden** (D28): it pins the right fingerprint, writes `jsonEquals`, and writes the `json_schema` checks that hold the signed fields to its order.
- **The adjudicator gains two decoders and one dependency edge,** each covered by vectors.
- **The reference page must say what the kind does not prove:** that the bytes are true, or that the key sits in a device.

## Open questions

| Question | Owner |
| --- | --- |
| Keep `jsonEquals` in the first version, or ship the kind without it? | Rafa |
| Will the laboratory's export write `manifest_text` beside the manifest object? | Rafa, who speaks for that question in the pilot |
| Do the budget rates hold on a delivery at the store's limit? Measure, then fix them | The build task |
| Does the fallback or the appeal adjudicator sign anything before funding that could carry a decline? This record reads that they do not | The build task, with the API lane |
| Does `@noble/curves` at the pinned version pass every copied Wycheproof vector under the strict options? | The build task |
