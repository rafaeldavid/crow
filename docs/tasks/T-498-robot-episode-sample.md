# T-498: try-sell sells a robot episode in the LeRobot v3 layout

- **Lane:** demo (the goal commands)
- **Phase:** 2
- **Depends on:** T-469 (the goal commands and their bundles), T-496 (the bundle import pins in `tests/site-bundles.test.ts`)
- **Paths this task may touch:** `examples/try-sell.ts`, `examples/robot-episode.ts` (new), `examples/robot-episode.test.ts` (new), `apps/test-agents/src/try-goals.test.ts` (the robot-episode cases), `site/llms.txt` (one sentence in the sell goal), `site/sell.txt` (one line), `site/ref/checks.txt` (one recipe section), the files `node site/build.mjs` writes from them (`site/try-sell.mjs` and the filled `llms.txt`), this file.
- **Human gate:** the site deploy that publishes the new `try-sell.mjs` and its hash, Rafa's. The one live run on Sepolia comes after it.
- **Status:** todo. Planned on 2026-11-17 at Rafa's word ("Yes, plan it"). The first pilot stays first (D72): a session picks this up when Rafa schedules it.
- **Agent/session:** planned by the robot-data research session, 2026-11-17, branch `t-498-robot-episode-sample` (this file only).
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

- [ ] `node examples/try-sell.ts --sample robot-episode` against the in-process world ends Released with all ten checks passing; with `--outcome refund` it ends Refunded and names the failed checks (`apps/test-agents/src/try-goals.test.ts`).
- [ ] `examples/robot-episode.test.ts` runs `examples/check-delivery.ts`'s code on the good episode (accept) and on at least three broken copies (another nonce, an arrival off its waypoint, a value past a joint limit), each rejected by its own check.
- [ ] The `meta.info` section uses exactly the LeRobot v3 `info.json` field names; a test pins them.
- [ ] The run prints, before it offers, that the seller drew the nonce and waypoints itself because the test buyer issues no orders yet.
- [ ] `--sample robot-log` and benchmark scenario 6 behave as before.
- [ ] `tests/site-bundles.test.ts` passes with no new package or host; `node site/build.mjs && node site/check.mjs` pass.
- [ ] `site/llms.txt` names `--sample robot-episode` in one sentence; `site/ref/checks.txt` gains a short "Writing checks for a robot episode" section with the whole-number bounds and the `prefixItems` limit.
- [ ] After Rafa's site deploy: one run of the published command on Sepolia, recorded in Evidence with its commitment ID and outcome (change kind 9).

## Out of scope

- **A buyer-issued order.** Freshness is real only when the buyer draws the nonce and waypoints. That needs Crow's test buyer to issue an order (a change to `apps/test-agents`, a deployed agent), so it is a follow-up task after the first pilot.
- **Parquet and MP4.** Writing the LeRobot files is the buyer's step after settlement.
- **New check kinds:** signature validity, time increasing, equal column lengths, speed agreeing with position, and `prefixItems` in the `json_schema` subset. Notes for T-248.
- **Video and many episodes per deal.**

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

- 2026-11-17: a second sample beside `robot-log`, not a replacement, so benchmark scenario 6 and its records stay comparable.
- 2026-11-17: one JSON document in the LeRobot v3 layout, because Crow's formats and checks are CSV and JSON.

## Handoff

Planned only. Nothing is built. Start from the prototype the brief carries; move its episode builder into `examples/robot-episode.ts` with tweetnacl in place of `node:crypto`, and add the sample to `try-sell.ts`'s `SAMPLES`.
