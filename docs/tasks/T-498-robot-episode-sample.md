# T-498: try-sell sells a robot episode in the LeRobot v3 layout

- **Lane:** demo (the goal commands)
- **Phase:** 2
- **Depends on:** T-469 (the goal commands and their bundles), T-496 (the bundle import pins in `tests/site-bundles.test.ts`)
- **Paths this task may touch:** `examples/try-sell.ts`, `examples/robot-episode.ts` (new), `examples/robot-episode.test.ts` (new), `apps/test-agents/src/try-goals.test.ts` (the robot-episode cases), `site/llms.txt` (one sentence in the sell goal), `site/sell.txt` (one line), `site/ref/checks.txt` (one recipe section), the files `node site/build.mjs` writes from them (`site/try-sell.mjs` and the filled `llms.txt`), this file.
- **Human gate:** the site deploy that publishes the new `try-sell.mjs` and its hash, Rafa's. The one live run on Sepolia comes after it.
- **Status:** merged on 2026-11-17 (PR 606); not done. The site deploy and the one live run on Sepolia wait for Rafa.
- **Agent/session:** planned by the robot-data research session, 2026-11-17, branch `t-498-robot-episode-sample` (this file only); built by a build session the same day, branch `t-498-robot-episode-build`.
- **Roadmap row:** T-240
- **Change kind:** 1 (copy and agent docs: the published command and its guides), with the examples' own tests for the code

## Intent

Teams that train robot policies exchange data in Hugging Face's LeRobot dataset layout, version 3 ([the format's documentation](https://huggingface.co/docs/lerobot/en/lerobot-dataset-v3)). Crow's one-command seller goal sells a robot run today only as a four-column CSV (`--sample robot-log`). This task adds a second robot sample, `--sample robot-episode`. It sells one synthetic arm episode in the LeRobot v3 layout to Crow's test buyer under ten deterministic checks, and `--outcome refund` delivers a copy that fails them.

Crow carries CSV or JSON of at most `limits.maxCiphertextBytes` (1,048,576 bytes on the public nodes), and its checks read those formats. LeRobot v3 stores Parquet and MP4 files. So the delivery is one JSON document that holds the same content section by section:

| Section | The LeRobot v3 file it stands for |
| --- | --- |
| `meta.info` | `meta/info.json`, field for field: `codebase_version` "v3.0", `robot_type`, `fps`, `features`, `splits`, the path templates |
| `meta.tasks` | the rows of `meta/tasks.parquet` |
| `meta.episodes` | the row of `meta/episodes/` for episode 0 |
| `meta.stats` | `meta/stats.json`: `min`, `max`, `mean`, `std`, `count` per feature |
| `data` | the frame table, one array per column: `observation.state`, `observation.velocity`, `observation.effort`, `action`, `timestamp`, `frame_index`, `episode_index`, `index`, `task_index` |
| `provenance` | what LeRobot has no field for: the robot's serial as a hash, the order's nonce and waypoints, the measured pose at each waypoint, the full recording's hash, and a device signature over the nonce and the hashes |

The sample is a 6-joint arm (`robot_type` `dobot_cr3a`, a collaborative arm whose controller reports its state every 8 ms) that runs from home through three waypoints and back, at 125 frames per second.

Non-goals: Parquet or MP4 output; a buyer that issues the order (Out of scope); new check kinds; real robot data.

## Context

- **A working prototype exists.** On 2026-11-17 a research session ran this deal end to end in process: the public demo's world from `apps/test-agents/src/test-world.ts`, Crow's test buyer from `apps/test-agents/src/buyer.ts`, and a simulated seller. A good episode was Released in 1.0 s; a copy with another order's nonce and a copy 5 degrees off one waypoint were each Refunded in 0.5 s, each by the check written for that fault [measured]. Its two files live outside this repository; the session that builds this task receives them in its brief.
- **Size:** 20 s at 125 Hz is about 452 KB [measured, four runs]. Use 10 s (1,250 frames, about 230 KB, inferred) so the live upload and the checks stay quick.
- **Bounds are whole numbers.** Only the terms are hashed and signed, so only the checks' bounds must be integers (ADR-0022). The data stays in degrees with decimals, as an arm controller reports it. In degrees the arm's limits are whole numbers: ±360 for five joints, ±155 for the third; joint speeds 180 and 223 degrees per second.
- **No `prefixItems`.** The `json_schema` subset (`site/ref/checks.txt`) has no `prefixItems`, so one bound holds for all six values of a LeRobot vector: ±360 degrees for positions, ±223 degrees per second for speeds.
- **The test buyer's rules** (`apps/test-agents/src/buyer-rules.ts`): 1 to 10 checks, at least one required; a price of at most 50 tUSDC; delivery within 86,400 s.
- **No new import.** `examples/goal-kit.ts` already bundles tweetnacl (`nacl.sign` is Ed25519) and has `sha256hex`. Use them for the device key and the hashes, so `tests/site-bundles.test.ts` pins the same imports and hosts.
- **The checks, as the prototype wrote them** (all required, all kinds Crow has): `lerobot-info` pins `info.json` (version, robot type, fps, `features` exactly, a frame-count range); `lerobot-meta` holds tasks, episodes and stats to their shape; `frames` bounds the per-frame columns; `joint-positions`, `joint-speeds` and `joint-currents` hold every vector to the arm's limits; `fresh-order` pins the serial hash, the nonce and the waypoints; `arrivals` holds each measured arrival within 1 degree of its waypoint; `device-key` pins the public key and the signed message's format; `hidden` refuses hidden characters. The prototype's first run found that `additionalProperties: false` at the top level must list every section, `data` and `provenance` included.

## Acceptance criteria

- [x] `node examples/try-sell.ts --sample robot-episode` against the in-process world ends Released with all ten checks passing; with `--outcome refund` it ends Refunded and names the failed checks (`apps/test-agents/src/try-goals.test.ts`).
- [x] `examples/robot-episode.test.ts` runs `examples/check-delivery.ts`'s code on the good episode (accept) and on at least three broken copies (another nonce, an arrival off its waypoint, a value past a joint limit), each rejected by its own check.
- [x] The `meta.info` section uses exactly the LeRobot v3 `info.json` field names; a test pins them.
- [x] The run prints, before it offers, that the seller drew the nonce and waypoints itself because the test buyer issues no orders yet.
- [x] `--sample robot-log` and benchmark scenario 6 behave as before.
- [x] `tests/site-bundles.test.ts` passes with no new package or host; `node site/build.mjs && node site/check.mjs` pass.
- [x] `site/llms.txt` names `--sample robot-episode` in one sentence; `site/ref/checks.txt` gains a short "Writing checks for a robot episode" section with the whole-number bounds and the `prefixItems` limit.
- [ ] After Rafa's site deploy: one run of the published command on Sepolia, recorded in Evidence with its commitment ID and outcome (change kind 9).

## Out of scope

- **A buyer-issued order.** Freshness is real only when the buyer draws the nonce and waypoints. That needs Crow's test buyer to issue an order (a change to `apps/test-agents`, a deployed agent), so it is a follow-up task after the first pilot.
- **Parquet and MP4.** Writing the LeRobot files is the buyer's step after settlement.
- **New check kinds:** signature validity, time increasing, equal column lengths, speed agreeing with position, and `prefixItems` in the `json_schema` subset. Notes for T-248.
- **Video and many episodes per deal.**

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results, all on this branch, 2026-11-17 [measured]:
  - `pnpm vitest run examples/robot-episode.test.ts`: 6 of 6 pass. The good episode is accepted by `checkDelivery`. Another order's nonce fails `fresh-order` and `device-key`; an arrival 5 degrees off w2 fails `arrivals`; a position of 400 degrees fails `joint-positions`. Each broken copy fails only those checks. One test pins the 13 `meta.info` field names of LeRobot v3 `info.json`, and one checks that every `minimum`, `maximum`, `minItems` and `maxItems` in the ten checks is an integer.
  - `pnpm vitest run src/try-goals.test.ts` in `apps/test-agents`: 13 of 13 pass in 56 s. Two are new. `--sample robot-episode` ends Released with all ten checks passing and decision accept. Its `offer` step prints the seller-drawn order (nonce and waypoints) before the offered line. `--outcome refund` ends Refunded with `fresh-order FAIL` and `device-key FAIL`. The s3, s6 (`robot-log`), refund, `--work`/`--terms` and wrong-call cases pass unchanged.
  - `node site/build.mjs && node site/check.mjs`: PASS. The seller's first-deal path (llms.txt + sell.txt) is 4,312 of 5,000 tokens (estimate). `pnpm vitest run tests/site-bundles.test.ts`: 10 of 10 pass, so `try-sell.mjs` has the same imports, requires, process members and hosts as before.
  - CI's first run failed `tests/site-guides.test.ts`: the plain-HTTP buyer's path was 9,452 tokens, over its 9,450 budget, because of the new llms.txt sentence. Shortened to "`--sample robot-episode` sells a LeRobot v3 robot episode."; the test passes locally.
  - `pnpm typecheck`: exit 0. `pnpm exec eslint` on the four changed code files: exit 0.
- Snapshot diffs: none. No scenario fixture changed.
- Metrics [measured]:
  - The 10 s episode is 228,464 bytes (1,250 frames at 125 Hz), built in 20 ms. The ten checks are 8,585 bytes of JSON.
  - `site/try-sell.mjs` grew from 362,902 to 377,547 bytes.
- Not yet run: the published command on Sepolia (the last criterion), after Rafa's site deploy.

## Decisions

- 2026-11-17: a second sample beside `robot-log`, not a replacement, so benchmark scenario 6 and its records stay comparable.
- 2026-11-17: one JSON document in the LeRobot v3 layout, because Crow's formats and checks are CSV and JSON.

## Handoff

Built; in review. `examples/robot-episode.ts` builds the order, the lab (serial hash and Ed25519 device key from tweetnacl), the episode and the ten checks; hashes use `goal-kit.ts`'s `sha256hex`. `try-sell.ts` builds the sample only when it is chosen, so `customers` and `robot-log` are unchanged. With `--outcome refund` it delivers the same run under another order's nonce.

The full recording's hash field is `provenance.recording_sha256`. It is simulated from the frame table.

Next, after merge: Rafa deploys the site (`docs/operations.md`), so `try-sell.mjs` and its hash in llms.txt go live together. Then one run: `--sample robot-episode` from the published command on Sepolia. Record its commitment ID and end state in Evidence (change kind 9). `site/ref/intake.txt` names only `--sample robot-log`; it is outside this task's paths, so it is left for a later docs batch.
