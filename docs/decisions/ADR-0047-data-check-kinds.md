# ADR-0047: Three check kinds read the recorded data: passes_through, monotonic_column and equal_lengths

- **Status:** Accepted, 2026-11-25 (D98). A decision Rafa can overrule.
- **Date:** 2026-11-25
- **Raised by:** T-610, plan item P-04, roadmap row N225. The research note `docs/research/2026-11-24-delivery-proofs.md` (T-582) sketched the three kinds beside `signature_valid`; ADR-0045 section 8 sent them to the next schema version.
- **Builds on:** ADR-0001 (neutrality), ADR-0006 (deterministic checks run first), ADR-0021 (checks read the bytes as delivered), ADR-0022 (no float in a hashed body), ADR-0036 (a deal is judged under the policy it bound), ADR-0045 (`signature_valid`, `checkKinds`, the decline for a kind a build lacks); D26, D28, D31, D32, D92.
- **Changes with this record:** schema v0.14, three evaluators in `packages/judgment/src/checks/`, their tests and fixtures (T-610). No signed type, contract or EIP-712 domain version changes.

Labels: **measured** (run or read on 2026-11-25 on this branch), **inferred**, **guessed**.

## Summary

1. **`passes_through`** passes when the recorded path passes through every waypoint the terms list, in order, within an integer tolerance on each axis.
2. **`monotonic_column`** passes when a series of integers never decreases, and each step from one row to the next lies between `minStep` (default 0) and `maxStep` (default none).
3. **`equal_lengths`** passes when every named JSON array has the same number of entries.
4. **Every value they read and every bound they take is an integer.** A delivered sample that is not an integer fails the check. A parameter that is not an integer is refused by the schema and by `validateCheck`.
5. **They are built-in code over data,** charged to the shared work budget, with no clock and no network. Two adjudicators reach the same result from the same delivery and terms.

## Context

- **What a robot deal needs.** P-03 (`signature_valid`, ADR-0045) proves that the lab's key signed a recording. It does not say what the recording shows. The buyer orders a path through its own waypoints; the delivery must show the arm passed through them, in time order, with one value per sample in every column.
- **What today's kinds can do** [measured, `site/ref/checks.txt`, "Duration, rate and gaps by counting"]. A CSV recording can hold a fixed time grid with three checks and a pattern. No kind holds rows in time order, compares two columns row by row, or counts entries of a JSON array.
- **The layout the research note proposed** [measured, the note, section 3]: one JSON document with the telemetry by column, `{"telemetry": {"t_ms": [...], "q1_mdeg": [...]}}`, integers in fixed units.

## Decision

### 1. A series

A series is one of two shapes, closed (`$defs/Series` in `commitment.schema.json`):

| Shape | Reads | Each entry must be |
| --- | --- | --- |
| `{ "pointer": "/telemetry/t_ms" }` | The JSON array at an RFC 6901 pointer in a JSON delivery, the same pointer `signature_valid` uses (`$defs/JsonPointer`, at most 512 characters) | A JSON number whose value is a safe integer (magnitude at most 2^53 - 1). `-0` reads as `0` |
| `{ "column": "t_ms" }` | One column of the tabular view: a CSV, or a JSON array of flat objects, as the other column checks read it | In a CSV, a cell spelled as one decimal integer: an optional minus, no leading zero, no plus, no space, no exponent, at most 16 digits, and a safe integer; `-0` and an empty cell fail. In a JSON table, a number cell is read as the pointer form reads it (so `-0`, `1.0` and `1e2` read as 0, 1 and 100), and a string cell by the CSV spelling |

- **The pointer form serves column-oriented JSON,** the layout a signed recording uses. The column form serves a CSV recording.
- **Nothing is rounded.** A decimal sample fails the check instead of being truncated, so a seller cannot move a sample across a bound by writing `10000.4`.
- **A JSON number is read by `JSON.parse`,** as every check reads it. `1.0` and `1e2` read as the integers 1 and 100. Above 2^52 a literal with a fraction can read as an integer, since binary64 holds no fraction there; every adjudicator reads it the same way [inferred: JSON reading is IEEE 754 round to nearest].
- **A column name the CSV header repeats fails the check.** Readers disagree on which of the two columns the name means.
- **A key repeated in a JSON object reads as its last value,** as `JSON.parse` reads it, for both forms.
- **A detail line never quotes a delivered value.** It names the series by its position (`series 2`) and the row by its number.

### 2. `passes_through`

```json
{ "id": "waypoints", "type": "passes_through", "required": true,
  "series": [ { "pointer": "/telemetry/q1_mdeg" }, { "pointer": "/telemetry/q2_mdeg" } ],
  "waypoints": [ [10000, -45000], [30000, -20000] ],
  "tolerance": 500 }
```

- **Rule.** It passes when rows r1 < r2 < ... < rn exist such that at row rk every series is within `tolerance` of waypoint k's coordinate for that series: `|value - coordinate| <= tolerance`. The distance is per axis (the largest axis decides), in the series' own integer units.
- **Order is strict.** Each waypoint needs its own row, later than the last one's. Two equal waypoints in a row need two matching rows.
- **One forward scan decides it.** It takes the earliest row for each waypoint in turn; an earlier match never rules out a later one [measured: a property test compares the scan with a full search on 500 random paths, `passes-through.test.ts`].
- **All series must have the same number of rows,** or the check fails. It reads samples by row, so a short column is a failure, not a truncation.
- **The waypoints are constants in the terms.** The buyer's order comes before the offer, as a nonce does today.
- **Parameters:** `series` 1 to 32 entries; `waypoints` 1 to 1,024 entries, each with exactly one coordinate per series (`validateCheck` checks the count, which the schema cannot express); `tolerance` an integer from 0 to 2^53 - 1.
- **Failure lines:** `reached 1 of 2 waypoints in order; waypoint 2 is not within tolerance after row 20`, or `... in any row` when none was reached.

### 3. `monotonic_column`

```json
{ "id": "time", "type": "monotonic_column", "required": true,
  "series": { "pointer": "/telemetry/t_ms" }, "minStep": 1, "maxStep": 16 }
```

- **Rule.** For each pair of consecutive rows, `minStep <= next - previous <= maxStep`. `minStep` defaults to 0, so a repeated value passes; `maxStep` defaults to no limit.
- **What each setting holds.** `minStep` 1: strictly increasing, which refuses a repeated row. `maxStep`: no gap longer than that. `minStep` equal to `maxStep`: a fixed sample rate, which today takes three checks and a pattern.
- **No `strict` flag.** For integers, strict increase is `minStep` 1, so a flag would be a second spelling of one rule.
- **No decreasing variant.** A series that must fall can be recorded with its sign flipped. A variant is one more optional parameter in a later version if a deal needs it.
- **An empty series and a single row pass.** `row_count_range` and `json_schema` govern how many rows there are, as for every column check.
- **Parameters:** `minStep` and `maxStep` integers from 0 to 2^53 - 1; `minStep` above `maxStep` is refused as self-contradictory.
- **Failure lines:** `row 3 is lower than row 2`, `row 3 steps less than minStep after row 2`, `row 4 steps more than maxStep after row 3`.

### 4. `equal_lengths`

```json
{ "id": "lengths", "type": "equal_lengths", "required": true,
  "series": [ { "pointer": "/telemetry/t_ms" }, { "pointer": "/telemetry/q1_mdeg" }, { "pointer": "/telemetry/q2_mdeg" } ] }
```

- **Rule.** Every pointer resolves to a JSON array, and all arrays have the same length.
- **Pointers only, 2 to 32 of them.** A CSV's parser already refuses a ragged row, and a JSON table's rows already share their keys [measured, `table.ts`, `csv.ts`], so a column form would always pass.
- **It reads lengths only,** not entries. The kinds that read values say what the values must be.
- **Failure line:** `series 3 has 39 entries; series 1 has 40`.

### 5. Limits and work

| Limit | Value | Why |
| --- | --- | --- |
| Series per check | 32 | Bounds `validateCheck` and the per-row comparison |
| Waypoints per check | 1,024 | Bounds `validateCheck`: at most 32,768 coordinates for each pass over the terms |
| Column name | 128 characters, counted in code points as the schema counts them | As every column check |
| Pointer | 512 characters | `$defs/JsonPointer`, as `signature_valid` |
| Delivered series | The delivery's own limit (the node's `limits.maxCiphertextBytes`) | No separate cap; the budget bounds the work |
| Work | 1 unit per entry read, 1 per coordinate or step compared, 1 per series whose length is read | This record |
| Wall clock | None | A timer would let two adjudicators differ on one delivery |

- **Every unit is charged before the work it pays for,** and a series is paid for in full before its entries are read, so a refused series still spends its length.
- **A check that runs out of the shared budget is inconclusive** and escalates, as every kind does.
- **At the content store's limit the three kinds fit the budget by a wide margin.** The store keeps at most 10,485,760 bytes (`MAX_CIPHERTEXT_BYTES`). The red team ran a 15.7 MB delivery under the fixture terms: 8,400,002 units of `CHECK_BUDGET`'s 50 million, in 185 ms [measured]. Terms run out only when they read each entry about ten times over, for example many heavy checks on one large series; those checks are then inconclusive and escalate [measured by the red team: 18 of 20 such checks].
- **The limits are part of the kinds.** A change to them is a change to judgment and takes a new policy version (ADR-0036).

### 6. Schema, version and discovery

- **Schema v0.14** adds the three `DeterministicCheck` branches and `$defs/Series`, each closed (`additionalProperties: false`). Every integer has explicit bounds of the safe range.
- **Every `$id`, the `Holdback-Schema-Version` header and the OpenAPI version move to 0.14.** No typed-data struct changes, so the EIP-712 domain version and `commitment.schemaVersion` stay 0.8, and no signature or commitment ID moves. Every document valid under v0.13 is valid under v0.14.
- **`checkKinds` lists them on its own.** The reference adjudicator reads its list from stage 1's registry (ADR-0045 section 8), so a build with this change lists 13 kinds and a build without it declines terms that name them (D92).
- **An operator on v0.13 refuses a v0.14 offer that names a new kind** as invalid terms [inferred]. The party sends it to an operator on v0.14 or straight to the settlement layer (ADR-0005).

### 7. Neutrality

- **The kinds are built-in code in each adjudicator,** so they add no party that can stop a deal [inferred].
- **The same delivery and terms give the same result everywhere.** No clock, no network, no randomness; integer arithmetic only. `neutrality.data-checks-primary-offline` shows the fallback reaching the primary's result with the primary offline.
- **An adjudicator whose build lacks a kind signs no decision on it** (D92), and the parties read the three adjudicators' `checkKinds` before they sign (ADR-0045 section 10).
- **Exact integer comparison.** Two safe integers differ by at most 2^54 - 2. Above 2^53 the difference may round, but never to a value at or below a safe bound, so every comparison with a tolerance or a step bound is exact [inferred; the tests cover the ends of the safe range].

## What the kinds do not prove

| Not proved | Why |
| --- | --- |
| That the recording is real | A seller can compute a path through any waypoints: reverse the joint columns of a run that went the other way and keep its timestamps, or add one invented sample at the waypoint between two real ones. Every check passes on such a file [measured by the red team]. `signature_valid` with `message.jsonEquals` over the telemetry ties the recording to a pinned key, so the buyer holds a signed record the key's holder cannot deny (D26) |
| Physical consistency (speed against position, a tool pose against the joints) | Each needs tolerances tuned on real data. They stay on the triage list (research note, section 4) |
| A smooth path between samples | The check reads samples. A buyer that needs a dense recording bounds the gap with `maxStep` on time |
| Distance in joint space as one number | The tolerance is per axis. A Euclidean distance needs a square root or a squared bound; either is a later kind |

## Rejected alternatives

| Alternative | Why not |
| --- | --- |
| An `ordered: false` mode for `passes_through` | No deal needs it yet (no-bloat rule). It is one optional parameter later, additive |
| One tolerance per series | Different units on one path are possible, but the robot deal's joints share one unit. One more optional parameter later |
| A `strict` flag on `monotonic_column` | `minStep` 1 says the same for integers |
| Decimals with a fixed number of places | ADR-0022: no float in a hashed body. The parties choose the unit (millidegrees, milliseconds) |
| Truncating or rounding a decimal sample | It would let a seller move a sample across a bound. A failure is the honest answer |
| A column form for `equal_lengths` | A CSV and a JSON table already tie their columns together |
| One bump with `signature_valid` | ADR-0045 section 8 shipped that kind in v0.13 alone; these three were not decided in time |

## Consequences

- A buyer can write its order as waypoints and hold the delivery to them, in time order, with every column the same length.
- `site/ref/checks.txt` documents the kinds in P-18, the site docs batch for the proof checks. Until then the schema's descriptions and this record are the reference.
- The operators' next deploy serves schema 0.14. Until both nodes run it, `preflight.mjs` reports that their schemas differ and tells the agent not to sign [inferred from T-590's deploy notes].
