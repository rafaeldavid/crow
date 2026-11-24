# Proofs that travel with a delivery

**State: design note for T-582 (roadmap row N225), 2026-11-24. Research and a plan only: no schema, code or ADR changes with it. It ends in a recommendation Rafa can overrule.**

A seller's agent can attach a proof to its work: a signature from the device that recorded it, a hash of a larger file it keeps, a zero-knowledge proof, a quote from attested hardware. Today a Crow deal can carry such a proof inside the delivered file, but no check can verify one, so release cannot depend on it. This note answers the row's five questions and says what to add first.

Labels: **measured** (read from the repository at `b1fa6028`, or run, with the source), **documented** (a public page says so), **recalled** (from the model's knowledge, not opened that day), **inferred** (this note's reasoning), **guessed**.

## Summary

- **Recommendation: four new deterministic check kinds, and no proof field on the delivery yet.** The kinds are `signature_valid`, `passes_through`, `monotonic_column` and `equal_lengths`. Each is built-in code inside the adjudicator with its parameters in the terms. Nothing from the delivery runs.
- **The proof travels inside the delivered document.** It is encrypted with the work, opened only by the adjudicators and the buyer, and never reaches the chain or an operator in the clear (D35, rails and not a record-keeper).
- **Check kinds change one schema body and no contract.** A proof field on the delivery changes the signed `Delivery` message, which the rules contract hashes, so it needs a contract change and a redeploy [measured, section 3].
- **One check kind is enough to make release depend on a proof:** `signature_valid`. The other three tie the signed data to the buyer's order and close the two gaps a signature leaves open.
- **A signature proves who signed, not what happened.** It gives the buyer an attributable record for a court (D26, the law stays the backstop). It does not show that a robot moved.
- **The two-part release (row N226) does need a field on the delivery,** because its proof is about the key envelope, which sits outside the delivered document. This note reserves that field's shape so the two rows do not invent two (section 6).

## The worked example: a robotics laboratory's signed recording

A robotics laboratory sells one recorded run of a six-joint arm. Its own kit already produces a proof with each recording [reported by the laboratory; Crow has not run it against the live service]:

- **The buyer's order.** A JSON file with an order ID, a 128-bit nonce, an issue time, a speed factor and one to ten waypoints in joint degrees. The laboratory returns it byte for byte.
- **The telemetry.** A CSV at about 125 rows a second: controller and host clocks, joint positions, joint speeds, joint currents and the tool pose.
- **A manifest.** The SHA-256 of every file, the SHA-256 of the full controller stream the laboratory keeps, the order, robot metadata and statistics.
- **A signature.** ECDSA P-256 over the manifest in a canonical form, with the public key beside it.
- **A key fingerprint, pinned out of band.** The laboratory sends it once by a separate channel. The key is a software key today; the laboratory plans a hardware-held key later, with a new fingerprint.

The kit's own verifier checks the signature against the pinned key, every file hash, that the order is unchanged, that every waypoint is reached in order, that controller time increases strictly, the declared sample count, and the arm's limits. The buyer's agent can run that verifier itself today. That run decides nothing in the deal: release follows the agreed checks only.

**What today's checks can say about this delivery** [measured, `site/ref/checks.txt`, "Writing checks for a robot episode" and "Writing checks for a telemetry run"]: a `const` holds the nonce and the waypoints to the order, and a range bounds each value. The same page states the three gaps:

- "The check cannot verify the signature itself; it pins the public key and the signed message's format."
- "No check compares the order of rows or the step between them, or two columns."
- A seller states where the arm arrived; no check finds the waypoints in the recorded path.

So a delivery with 64 random bytes in place of the signature, shuffled rows and invented arrival points passes today [inferred from the three statements].

## 1. Which proofs a seller's agent can make

| Proof | What it shows | What it does not show | Cost to check | Verdict |
| --- | --- | --- | --- | --- |
| **A signature by a pinned key** over the work or a log of it | The key's holder signed exactly these bytes | That the bytes are true, or that the key sits in a device and not with the seller | One hash and one signature check: milliseconds [guessed] | **Support first** |
| **A hash commitment** to a file the seller keeps | The seller fixed that file's content at delivery time | Anything about the file until it is shown | A string compare | Works today: a `json_schema` pattern holds its shape, and the signature above covers it |
| **Signed sensor or robot telemetry** | The first row, plus data the checks can test against the buyer's order | That the motion happened | The signature check plus one pass over the data | **Support first**: it is the first row plus three data checks |
| **A zero-knowledge proof** about the delivery or its key envelope | A stated relation holds without showing the secret | Nothing beyond the relation | The prototype's proof took 2,813 s to make and 17 ms to check [reported in T-541's record, one run] | Later. The prototype is stopped and part of nothing deployed [measured, `docs/tasks/T-576-envelope-proof-advisories.md`] |
| **A quote from attested hardware** | A named program ran on a named chip family | That the program's inputs were honest | A certificate chain, vendor data that changes over time, and a clock [recalled] | Later. A check that reads vendor data fetched at judging time is not a function of the delivery and the terms alone |

**The rule that separates the first three rows from the last two** [inferred]: a proof kind fits stage 1 when its check is a pure function of two inputs, the delivered bytes and the terms. Two adjudicators then reach the same result, and so does the buyer's or the seller's own run before anything is signed. A signature check meets the rule. A zero-knowledge check meets it only with the verifier and the program pinned in the terms. A hardware quote does not meet it until the vendor data is pinned too.

## 2. Where each proof is checked

| Place | What it checks | Why there |
| --- | --- | --- |
| **The buyer's agent, before it agrees** | That the fingerprint in the terms is the one it received out of band; that the checks in the terms are the ones it wants; a trial run of the checks on a sample file with `examples/check-delivery.ts` | Agreed terms bind (D28). A buyer that skips this gets no protocol remedy (D32) |
| **The seller's agent, before it delivers** | The same checks on its own file, with the same command | A seller that would fail learns it before the deadline, and can deliver again within the terms |
| **The adjudicator, stage 1** | The four check kinds below, as built-in code | The only place a result changes release. Stage 1 already runs "built-in evaluators only" and fails closed [measured, `docs/judgment-and-defenses.md`, Stages; `packages/judgment/src/checks/index.ts`, header] |
| **The judge panel** | Nothing about a proof | Models cannot check a signature. A rubric criterion that asks them to would be a guess |
| **The chain** | Nothing new | It holds the delivery's hash and the adjudicator's signed decision today. The proof's content, the key and the result of each check stay off it (section 5) |

## 3. What the schema and API need

### Two options

| | A. New check kinds | B. A typed proof field on the delivery |
| --- | --- | --- |
| **Where the proof lives** | Inside the delivered document, at a JSON pointer the terms name | Beside the ciphertext, in the signed delivery record |
| **What changes** | `DeterministicCheck` in `spec/schemas/commitment.schema.json`, one evaluator per kind, the checks reference page | `spec/schemas/delivery.schema.json`, the EIP-712 `Delivery` type, the rules contract's delivery hash, the standing seller contract's type string, every signer |
| **Contract change** | None. The acceptance body is bound by its hash; the contract never reads a check [inferred from `packages/core/src/eip712.ts`: checks enter signatures through the acceptance hash] | Yes. `HoldbackRules._acceptDelivery` computes `H.deliveryHash(id, dv)` and requires the seller's signature over it; `HoldbackStandingSeller` spells the delivery's fields in a type string [measured, `contracts/src/` at `b1fa6028`] |
| **Privacy** | The proof is encrypted with the work. An operator sees ciphertext | The proof's bytes, or at least its hash and kind, sit in a record operators relay. A device key seen in two records links two deals |
| **Binding the proof to the work** | A check must do it: the signature covers the data in the same document | Free: the proof signs `plaintextSha256`, which intake already verifies |
| **Delivered file format** | Must be one JSON document that holds data and proof | Any format; a plain CSV stays a plain CSV |
| **Proofs about things outside the file** (the key envelope) | Cannot express them | Can |
| **Who can verify without opening the work** | No one | Anyone holding the record, the buyer before a waiver included |

**Recommendation: A now.** It is the smaller change by a wide margin, it keeps the proof private by default, and it covers every proof in section 1 that meets the stage-1 rule. B's two real advantages are proofs about the envelope and checks without opening the work. Both belong to the two-part release (N226), which changes the contract anyway. Section 6 says how to make that one change serve both rows.

**A's cost is the document format.** The data and the proof must sit in one JSON document, and the signed part must hold only integers and strings (below). The laboratory's kit signs a manifest of file hashes inside a zip, with decimal degrees. For a Crow deal its export step would write one document in the layout below and sign it with the same key. That is seller-side work, in the seller's own tooling. Crow publishes the layout and a test vector; it does not ask the adjudicator to read a zip or to re-canonicalize a manifest it did not define.

### The four kinds

Each takes `id` and `required` like every check. Every bound is an integer (ADR-0022: no float in a hashed body). A *series* is `{"pointer": "/signed/telemetry/t_ms"}` for a JSON array of numbers, or `{"column": "t_ms"}` in a CSV.

**`signature_valid`**: the bytes at one place carry a valid signature by the pinned key.

```json
{ "id": "device-signature", "type": "signature_valid", "required": true,
  "alg": "ecdsa-p256-sha256",
  "publicKey": { "pointer": "/publicKey", "spkiSha256": "sha256:<64 hex>" },
  "message": { "pointer": "/signed", "form": "jcs" },
  "signature": { "pointer": "/signature", "encoding": "base64", "format": "raw" } }
```

- **`alg`:** `ecdsa-p256-sha256` or `ed25519`. A closed list; a new algorithm is a schema change. The adjudicator app already pins `@noble/curves` [measured, `apps/adjudicator/package.json`], which implements both [recalled], so the kind likely adds no dependency [inferred].
- **`publicKey`:** the delivery carries the key (base64 of its DER `SubjectPublicKeyInfo`); the terms pin its SHA-256. This matches how a seller hands out a fingerprint. The check fails when the hash differs, before any curve arithmetic. The ADR may instead put the whole key in the terms, which removes one pointer; a P-256 key in that form is 91 bytes [recalled].
- **`message.form`:** `string` signs the UTF-8 bytes of the JSON string at the pointer. `jcs` signs the RFC 8785 serialization of the value at the pointer, and **fails when that value holds any number that is not a safe integer.** ADR-0022 measured why: Python and ECMAScript print `1.0` and `1e-07` differently, while integers below 2^53 print the same everywhere. With integers and strings only, a Python signer and a TypeScript verifier produce the same bytes [inferred; a cross-language test vector must show it before the kind ships].
- **`signature.format`:** `raw` (r then s, 64 bytes) or `der`. The check does not require low-s values: the signature is not an identifier, so a second valid encoding harms no one [inferred].
- **What it proves, in the page's words:** "the holder of the pinned key signed these bytes." Nothing more.

**`passes_through`**: the recorded path comes within a tolerance of each waypoint, in order.

```json
{ "id": "waypoints", "type": "passes_through", "required": true,
  "series": [ { "pointer": "/signed/telemetry/q1_mdeg" }, { "pointer": "/signed/telemetry/q2_mdeg" } ],
  "waypoints": [ [10000, -45000], [30000, -20000] ],
  "tolerance": 500, "ordered": true }
```

It passes when rows i1 < i2 < … exist such that, at row ik, every series is within `tolerance` of waypoint k. A single forward scan that takes the earliest match decides it [inferred: the earliest match never rules out a later one]. The waypoints are constants in the terms, as the nonce is today, so the buyer's order comes before the offer. The example is in millidegrees.

**`monotonic_column`**: a series only increases, and each step is inside a range.

```json
{ "id": "time", "type": "monotonic_column", "required": true,
  "series": { "pointer": "/signed/telemetry/t_ms" }, "strict": true, "minStep": 1, "maxStep": 16 }
```

It refuses shuffled, spliced or repeated rows, and a gap longer than `maxStep`. With `minStep` equal to `maxStep` it holds a fixed sample rate, which today takes three checks and a grid pattern [measured, `site/ref/checks.txt`, "Duration, rate and gaps by counting"].

**`equal_lengths`**: every named series has the same number of entries.

```json
{ "id": "lengths", "type": "equal_lengths", "required": true,
  "series": [ { "pointer": "/signed/telemetry/t_ms" }, { "pointer": "/signed/telemetry/q1_mdeg" } ] }
```

It matters only for JSON, where each column is its own array and `json_schema` bounds each one alone. A CSV's rows already tie its columns together.

### The document for the worked example

```json
{ "signed": {
    "layout": "signed-recording/1",
    "order": { "order_id": "…", "nonce": "…", "issued_at_utc": "…", "waypoints_mdeg": [[…], […]] },
    "raw_sha256": "sha256:…",
    "telemetry": { "t_ms": [0, 8, 16], "q1_mdeg": [0, 12, 31], "q2_mdeg": [-45000, -44990, -44972] } },
  "publicKey": "<base64>",
  "signature": "<base64>" }
```

One signature covers the order, the nonce, the data and the hash of the full stream the seller keeps. The checks then read:

| Check | Kind | Holds the delivery to |
| --- | --- | --- |
| `shape` | `json_schema` (today) | Exactly these sections; the order's nonce and waypoints by `const`; integer ranges per column |
| `device-signature` | `signature_valid` | The pinned key signed all of `signed` |
| `time` | `monotonic_column` | Time increases strictly, with no gap over 16 ms |
| `lengths` | `equal_lengths` | Every column has one value per sample |
| `waypoints` | `passes_through` | The recorded joints reach each ordered waypoint, in order |
| `hidden` | `hidden_characters_max` (today) | No invisible characters |

**What the buyer has after a pass** [inferred]: a record, signed by a key it pinned, that names its own nonce and contains a path through its own waypoints. A seller with a software key can still compute such a path and sign it. It cannot reuse an old recording, and it cannot later deny the record. That is the bounded position D26 asks for: a deal that goes wrong leaves evidence a court can read.

**Limits to state on the reference page:**

- **Size.** The public nodes store at most 1,048,576 bytes of ciphertext [measured, `docs/api.md`]. A recording at about 125 rows a second with some 30 columns fills that in roughly half a minute [reported by the laboratory for its CSV; the JSON layout is not measured]. Longer runs wait for a larger store or fewer columns.
- **Work budget.** Each new kind is one pass over its series, and `signature_valid` is one hash of at most the stored size plus one curve check. All four fit the shared stage-1 budget [inferred; to measure on a full-size file]. A check that runs out is inconclusive and escalates; it does not refund [measured, `checks/index.ts`, header].
- **An adjudicator that lacks a kind.** Stage 1 fails an unknown type closed [measured, `validateCheck`]. An adjudicator must therefore decline an offer whose kinds it does not run, as it declines a reference file it cannot fetch. Discovery should list the kinds a node runs, so a seller's preflight catches it before the offer [inferred: no such list exists at `b1fa6028`].

### API

No new route and no new field in a request. The terms carry the checks, the delivery carries the document, and the judgment record names each check with pass or fail and a capped detail line, as today. The detail line for `signature_valid` says which step failed (key hash, encoding, signature) and never echoes the message or the key.

## 4. What stays out

| Left out | Why |
| --- | --- |
| **A remedy for a buyer that pinned the wrong fingerprint, or none** | D32: the buyer can check the fingerprint before it signs. The terms bind as agreed (D28) |
| **A dispute step for "the signature is valid and the data is false"** | D26: the signed record is the evidence, the price is the bound, and the owners go to court. No panel, bond or appeal is added for it |
| **A key registry, key rotation or revocation in the protocol** | D35: the rails need a key hash in one deal's terms, not an identity. A new key is a new fingerprint in the next deal |
| **Any trust in the key's custody** | The check cannot tell a hardware key from a software key. A seller that wants credit for hardware custody proves it outside the deal, or later with a hardware quote |
| **Physical consistency** (speed against position, tool pose against joints) | Real checks, and wanted, but each needs tolerances tuned on real data. They go to the triage list, not this change |
| **Hardware quotes and zero-knowledge verifiers in stage 1** | They fail the stage-1 rule in section 1 until their inputs are pinned. Rows N219 and N200 own them |
| **Reading a zip, or several files per delivery** | A format change with its own intake risks. The seller's export writes one document |
| **Canonicalizing a seller's own manifest format** | The adjudicator would have to match another program's number printing. `jcs` over integers, or `string`, avoids the question |
| **Code or a verifier supplied by a party** | Hard rule: no code execution from commitments or deliverables. A new proof kind is a schema change with built-in code, never a plug-in |
| **On-chain signature checks** | The chain settles on the adjudicator's decision. It gains nothing from checking a device key, and it would have to see the key |

## 5. What must never be stored on chain

The chain keeps what it keeps today: keys, hashes, amounts, the delivery's hash and the signed decision. For proofs, D35 means none of these reach it, an event log or an operator's clear-text store:

- the proof's bytes: the signature, the signed message, a manifest;
- the device's public key or its fingerprint. It is a stable identifier, and one seen in two deals links them;
- the buyer's order: the nonce, the waypoints, the issue time;
- the name of a check or the result of a single check. The decision is accept or reject; the reasons live in the judgment record the parties hold;
- any hash of low-entropy proof content that a third party could confirm by guessing.

At the `private` level all of this already travels as ciphertext, in the acceptance body and the delivery [measured, ADR-0024 as cited in `spec/schemas/common.schema.json`, `PrivateTerms`]. At `public` the parties chose to show it; that is their disclosure, not the protocol's.

## 6. What the two-part release (N226) needs from this

N226 makes release depend on two facts: the work passes, and the buyer's key envelope opens it.

1. **"The work passes" is the stage-1 result, proof checks included.** N226 should name it as one boolean the decision already encodes, and add nothing per proof kind.
2. **The key half cannot be a check kind.** The envelope sits in the delivery record, outside the delivered document, and an adjudicator can open only its own envelope. N226 needs option B's field for that proof.
3. **One shape for that field, reserved here:** a list `proofs`, each entry `{ kind, format, verifier, publicInputs, sha256 }`. `kind` comes from a closed list; `verifier` names pinned built-in code, never an address to call or code to load; `publicInputs` holds hashes only; `sha256` commits to proof bytes that travel as ciphertext. If a later deal needs a detached signature over `plaintextSha256` for a non-JSON file, it is one more `kind` in the same list.
4. **One contract change, not two.** A `proofs` hash in the `Delivery` type changes the rules contract and the standing seller contract. N226 changes the release rule in the same contracts. Do both in one ADR, one version bump and one redeploy.
5. **The same outcome rule.** A failed proof check is a failed required check: full refund, with the seller's deadline bounding the buyer's wait. An inconclusive one escalates. N226's "work passes, key fails" case should read the same way, so one sentence in the guides covers both.
6. **The same fixture pattern** (section 7): a deal whose proof check an adjudicator cannot or will not run still ends by its terms.
7. **Conformance vectors.** Phase one has no party appeals: the first decision is final on chain (D57). A wrong signature check has no in-protocol remedy, so each kind ships with pass and fail vectors that any adjudicator runs, the published edge-case vectors for the curve included [recalled: Project Wycheproof].

## 7. The worked example on Sepolia and the neutrality fixture

**The example, when built:** one deal between Crow's own buyer and seller agents on Sepolia with test tokens. The seller signs the document above with a P-256 test key made for the run; the terms pin its fingerprint; all six checks are required; the rubric is empty. Three deliveries show the result: a good file is accepted, a file with one changed sample is refunded by `device-signature`, and a correctly signed file with rows out of order is refunded by `time`. A run with the laboratory's real arm follows only after its export writes the layout, and after the checks pass on one real file.

**The neutrality fixture.** The verifier is built-in code in each adjudicator, so a proof adds no new party that can stop a deal. The fixture shows that, in two cases:

- `neutrality.proof-check-primary-offline`: the primary adjudicator never answers. After `judgeBy` the fallback opens its own envelope, runs the same checks from the same terms and decides. The deal settles as it would have.
- `neutrality.proof-check-both-offline`: neither answers. The deal ends by its default outcome at the deadline, as any undecided deal does. No funds stay locked.

A third fixture is not about neutrality and belongs with them: two independent runs of each kind on the same file and terms give the same result, byte for byte in the judgment record.

## Recommendation

1. **Add the four check kinds** (`signature_valid`, `passes_through`, `monotonic_column`, `equal_lengths`) through one ADR and one schema version bump. No contract change.
2. **Build `signature_valid` first.** It alone makes release depend on a seller-side proof. `monotonic_column` and `equal_lengths` are small; `passes_through` is the one that ties the data to the buyer's order.
3. **Do not add a proof field to the delivery now.** Reserve its shape (section 6, point 3) and add it with N226's contract change.
4. **Publish the `signed-recording/1` layout and a cross-language test vector** with the reference page, so a seller's own tooling can write and sign it.
5. **Keep hardware quotes, zero-knowledge checks and physical-consistency checks out** until a deal needs one and its inputs can be pinned in the terms.

## Open questions for the ADR

| Question | Owner |
| --- | --- |
| Pin the key's hash and carry the key in the delivery, or put the whole key in the terms? | The ADR's author |
| Does a Python `json.dumps` with sorted keys and compact separators match RFC 8785 for integers and ASCII strings? Run the vector before the layout is published | The build task |
| Should discovery list the check kinds a node runs? | The ADR's author, with the API lane |
| Do the four kinds fit the stage-1 work budget on a file at the store's size limit? Measure it | The build task |
| Will the laboratory's export write the layout, with integer units? | Rafa, who speaks for that buyer-side question in the pilot |

## Scope

- **Read:** `CLAUDE.md`; `site/ref/checks.txt`; `docs/decisions-today.md` (D26, D28, D32, D35); `docs/decisions/ADR-0022-integer-rates.md`; `docs/judgment-and-defenses.md` (Stages); `spec/schemas/delivery.schema.json` and `commitment.schema.json` (v0.12); `packages/judgment/src/checks/index.ts`; `packages/core/src/eip712.ts`; `contracts/src/HoldbackRules.sol` and `HoldbackStandingSeller.sol`, all at `b1fa6028`. The roadmap rows for seller proofs, the two-part release, the envelope proof and the attested adjudicator. The laboratory's description of its kit.
- **Not done:** nothing was run, no signature was checked, no outside page was opened. Every claim about RFC 8785, the curve library and hardware quotes is recalled or inferred and labelled so.
