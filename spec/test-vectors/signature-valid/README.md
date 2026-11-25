# Test vectors for `signature_valid`

Documents signed in Python, each with the result the `signature_valid` check must give. A standalone Node script verifies them.

**State:** the check kind is proposed, not built. ADR-0045 (`docs/decisions/ADR-0045-signature-valid-check.md`) decides its rules. These vectors follow that record as pull request 775 had it at commit `31195a89`. The vectors are not part of the API contract in `spec/schemas/`.

**A float in the signed bytes passes.** ADR-0045, section 2, allows decimals there, because the check hashes the delivered bytes and never prints a number. The task asked that a float in the signed part fail. That rule belonged to an earlier design, which re-serialized the signed part. Open question 1 tracks it.

| What holds a float | Result | Vector (under `p256/` and `ed25519/`) |
| --- | --- | --- |
| The signed bytes, unchanged since signing | pass | `good-decimals-in-signed-bytes` |
| The signed text, where someone respelled a number after signing (`1.0` to `1`, or `3` to `3.0`) | fail: the signature does not verify | `float-respelled-after-signing`, `float-introduced-after-signing` |
| The readable object, where it differs from the signed number | fail: differs at `jsonEquals` | `float-in-object-signed-integer` |
| The readable object, spelling the signed number another way | pass | `float-spelling-equal-under-jsonequals` |
| The check itself, which the parties' signatures cover | refused | `float-in-check-parameters` |

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

These facts come from `@noble/curves` 1.9.1.

- **Name `zip215: false` for Ed25519.** The library's default is `true`, the lenient rule. `ed25519/small-order-key` fails a verifier that keeps the default (measured: the run with `true` failed that vector).
- **Name `lowS: false` for P-256.** The default requires a low s. `p256/good-high-s` and `p256/good-raw-high-s` fail a verifier that keeps it (measured the same way).
- **Check the DER form, and name `format`.** With no `format`, the library tries DER and then the raw form, so it accepts a raw signature in a `der` check (read in the source). `p256/raw-signature-in-der-check` covers this.
- **Python can disagree on a hostile key.** Python's `cryptography` accepts the signature in `ed25519/small-order-key`, and the strict rule refuses it (measured, `cryptography` 50.0.2). A seller's preflight in Python can differ from the adjudicator on such a key.
- **Another library can differ on hostile signatures.** Under `zip215: false`, the library still clears the cofactor in its final equation (read in the source). A library that does not clear it can differ on a crafted signature (inferred). Keep one library in every adjudicator.

**Not covered here.** ADR-0045 also asks for these, and the evaluator's build adds them: a message signed by Node beside the Python ones, the Project Wycheproof cases, a message that spends the work budget (its rates are not fixed yet), the detail line's length limit, and the property and determinism tests.

## Open questions for ADR-0045

Where the record says nothing or allows two readings, these vectors take the narrower one. Each needs an answer before the check ships.

| # | Question | What the vectors do |
| --- | --- | --- |
| 1 | The task and the plan say a float in the signed part fails. The record says a signed part may hold decimals. Which holds? | Follow the record |
| 2 | Do the length limits count UTF-16 code units or Unicode code points? | The vectors use ASCII only. The verifier counts code units, the stricter of the two |
| 3 | May the signed bytes start with a byte order mark under `jsonEquals`? A text decoder strips it by default, so two verifiers can differ | `message: not JSON` |
| 4 | Which detail line applies when nothing sits at the `jsonEquals` pointer? | `message: differs from the value at jsonEquals` |
| 5 | Which line applies to a key with the right prefix and length whose point is not on P-256? | `publicKey: not a P-256 key` |
| 6 | Which line applies when r or s is zero or not below the curve order? In DER, the library's reader refuses the standard encoding of zero as badly formed (read in the source) | `signature does not verify`, tested in the raw form only |
| 7 | A malformed check has no detail line. What does a node say when it refuses one? | `refused`, with no line |
| 8 | Does `spki-pem` set a line width? | The vectors use 64 characters, as Python writes. The verifier accepts any width, and no vector tests it |
| 9 | When two things are wrong, which line wins among the three pointers? | Each vector breaks one thing. The verifier reads `publicKey`, then `message`, then `signature` |
