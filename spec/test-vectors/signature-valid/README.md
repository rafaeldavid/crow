# Test vectors for `signature_valid`

Documents signed in Python, each with the result the `signature_valid` check must give. A standalone Node script verifies them.

**State:** the check kind is not built. [ADR-0045](../../../docs/decisions/ADR-0045-signature-valid-check.md) decides its rules. Its status is Proposed, and Rafa can overrule it. These vectors follow it. They are not part of the API contract in `spec/schemas/`.

**A float in the signed bytes passes** (ADR-0045, section 2). The check hashes the delivered bytes and never prints a number, so a signed part may hold decimals. The integers-only rule (ADR-0022) covers the terms, which are hashed. It does not cover the delivered document. An earlier plan line said a float in the signed part must fail; it came before the record.

| What holds a float | Result | Vector (under `p256/` and `ed25519/`) |
| --- | --- | --- |
| The signed bytes, unchanged since signing | pass | `good-decimals-in-signed-bytes` |
| The signed text, where someone respelled a number after signing (`1.0` to `1`, or `3` to `3.0`) | fail: the signature does not verify | `float-respelled-after-signing`, `float-introduced-after-signing` |
| The readable object, where it differs from the signed number | fail: differs at `jsonEquals` | `float-in-object-signed-integer` |
| The readable object, spelling the signed number another way | pass | `float-spelling-equal-under-jsonequals` |
| The check, which sits in the hashed terms (here, a float in place of a pointer) | refused | `float-in-check-parameters` |

## Files

| File | What it is |
| --- | --- |
| `vectors.json` | The committed vectors |
| `generate.py` | Writes `vectors.json` with Python's `cryptography` package |
| `requirements.txt` | The generator's pinned packages |
| `verify.mjs` | The standalone verifier. It imports Node built-ins and `@noble/curves` 1.9.1, nothing else |

`tests/signature-vectors.test.ts` runs the verifier over every vector in CI.

**Keys.** Every key in these vectors is a throwaway test key. The generator makes new keys in memory on each run and writes only the public keys. No private key is committed. Never trust one of these keys in a deal.

## Verify

Run from the repository root after `pnpm install`:

```bash
node spec/test-vectors/signature-valid/verify.mjs
```

The script prints one line per vector. It exits 0 when every vector gives its expected result, 1 when one does not, and 2 when it cannot read the file.

To test your own document before you deliver it, give the script the check from your terms and the file:

```bash
node spec/test-vectors/signature-valid/verify.mjs --check check.json delivery.json
```

It prints the result and exits 0 only on a pass. Outside this repository, the script needs `@noble/curves` 1.9.1 installed where Node can find it. It does not count the adjudicator's work budget.

## Regenerate

Use Python 3.12. Any file under `reports/scratch/` stays out of git.

```bash
python3.12 -m venv reports/scratch/venv-signature-vectors
```

```bash
reports/scratch/venv-signature-vectors/bin/pip install -r spec/test-vectors/signature-valid/requirements.txt
```

```bash
reports/scratch/venv-signature-vectors/bin/python spec/test-vectors/signature-valid/generate.py
```

Each run makes new keys and signatures, so the whole file changes. The vector names and expected results stay the same unless `generate.py` changes.

## Format

Each entry of `vectors` has these fields:

| Field | Meaning |
| --- | --- |
| `name` | `p256/…` or `ed25519/…` |
| `alg` | The algorithm family the vector belongs to |
| `case` | `good`, `wrong-key`, `flipped-byte`, `random-signature`, `float`, `oversize`, `unknown-algorithm`, `strictness` or `hostile` |
| `why` | What the vector shows |
| `check` | The check object, as the terms would carry it (ADR-0045, section 1) |
| `delivery` | The delivered file as a string. Its UTF-8 bytes are what the check reads. It is a string so that `1.0` and `1` stay different |
| `expect.outcome` | `pass`, `fail`, or `refused` (the check is malformed, so it is refused at offer time and never passes) |
| `expect.detail` | For `fail`, the exact detail line (ADR-0045, section 5) |

The cases that do not depend on the algorithm (broken JSON, pointers, PEM and base64) appear under `p256/` only.

## For the evaluator's builder

These facts come from `@noble/curves` 1.9.1. "Broken copy" means a copy of `verify.mjs` with that one change, run over the vectors.

- **Name `zip215: false` for Ed25519.** The library's default is `true`, the lenient rule. `ed25519/small-order-key` and `ed25519/non-canonical-r` fail a copy that uses `true` (measured, broken copy). A small-order key test added to the lenient rule is not enough: `non-canonical-r` still fails it (measured, broken copy).
- **Name `lowS: false` for P-256.** This version's `p256` already defaults to `false` (measured, `p256.CURVE.lowS`), while the library's generic curve code defaults to `true` (read in the source). ADR-0045, section 7, names the option so a changed default cannot change a result. `p256/good-high-s` and `p256/good-raw-high-s` fail a copy that requires a low s (measured, broken copy).
- **Name `format`, and check the DER form.** With no `format`, the library tries DER and then the raw form (read in the source). `p256/64-byte-der-in-raw-check` catches a missing `format`. `p256/raw-signature-in-der-check` catches the other direction when both the DER check and `format` are missing (measured, broken copies).
- **Refuse an empty DER integer.** The library reads one as zero (measured), so the verifier treats a zero from its reader as badly formed DER: `p256/der-empty-integers`.
- **Python can disagree on a hostile key.** Python's `cryptography` accepts the signature in `ed25519/small-order-key`, and the strict rule refuses it (measured, `cryptography` 50.0.2). A seller's preflight in Python can differ from the adjudicator on such a key.
- **Another library can differ on hostile signatures.** Under `zip215: false`, the library still clears the cofactor in its final equation (read in the source). A library that does not clear it can differ on a crafted signature (inferred). Keep one library in every adjudicator.

**Not covered here.** ADR-0045 also asks for these, and the evaluator's build adds them: a message signed by Node beside the Python ones, the Project Wycheproof cases, a message that spends the work budget (its rates are not fixed yet), the detail line's length limit, and the property and determinism tests.

## Open questions for ADR-0045

Where the record says nothing or allows two readings, these vectors take the narrower one or follow the numbered steps. Each needs an answer before the check ships.

| # | Question | What the vectors do |
| --- | --- | --- |
| 1 | Do the length limits count UTF-16 code units or Unicode code points? | The vectors use ASCII only. The verifier counts code units, the stricter of the two |
| 2 | May the signed bytes start with a byte order mark under `jsonEquals`? A text decoder strips it by default, so two verifiers can differ | `message: not JSON` |
| 3 | Which detail line applies when nothing sits at the `jsonEquals` pointer? | `message: differs from the value at jsonEquals` |
| 4 | Which line applies to a key with the right prefix and length whose point is not on P-256? | `publicKey: not a P-256 key` |
| 5 | Which line applies when r or s is zero or not below the curve order? In DER, the library's reader refuses the standard encoding of zero as badly formed (read in the source) | `signature does not verify`, tested in the raw form only |
| 6 | A malformed check has no detail line. What does a node say when it refuses one? | `refused`, with no line |
| 7 | Does `spki-pem` set a line width? | The vectors use 64 characters, as Python writes. The verifier accepts any width, and no vector tests it |
| 8 | When two things are wrong, which line wins among the three pointers? | Each vector breaks one thing. The verifier reads `publicKey`, then `message`, then `signature` |
| 9 | Section 4 reads the DER form at step 7, after the message bytes. Section 5 lists the DER line before the message lines. Which order holds? | The verifier follows section 4. No vector breaks both |
