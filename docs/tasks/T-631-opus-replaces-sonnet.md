# T-631: The live judges are Opus 5.5, Gemini 4 Neon and DeepSeek V4 Pro

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** T-618 (agg-5, the default), the regression pass of 2026-11-26 (crow-ops-private `case-studies/2026-11-26-regression-pass/`, commit `9dc65d1`)
- **Paths this task may touch:** `config/judges-live-2.yaml`, `config/model-prices.json`, `apps/adjudicator/src/kept-policies.json`, `apps/adjudicator/src/test-adjudicator.ts`, `apps/adjudicator/src/service.ts` (the seat check), `apps/adjudicator/src/providers/`, the adjudicator tests, `packages/judgment/src/panel.ts`, `packages/judgment/src/pipeline.ts` (the duplicate-model check), `packages/judgment/src/providers/registry.ts`, the judgment and testkit tests, `apps/demo-cloud/src/judges.ts`, `apps/demo-cloud/src/world.ts` (the registry name in two notes), `apps/demo-cloud/scripts/embed.mjs`, the demo-cloud tests, the rebuilt `site/seller-worker.mjs`, `site/setup.mjs` and `examples/seller-worker-pin.ts`, `docs/decisions/registry-log.md`, `docs/decisions-today.md` (D111), this file
- **Human gate:** no for this pull request. Yes for the two deploys, carry and then flip, which are Rafa's, and for setting the Gemini key.
- **Status:** in review
- **Agent/session:** opus-swap, 2026-11-26; branch `t-631-opus-replaces-sonnet`
- **Roadmap row:** none (the stable milestone of 2026-11-26, step 4: the regression pass)

## What exists

Read on 2026-11-26 at `origin/main` `de49d194`, which is live build `e9b3bd1` plus a test.
- **The registry:** the live adjudicators bind `config/judges-live.yaml` (hash `0x6dc7342b…`), with five active judges: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-sonnet-5`, `deepseek-v4-pro` and `deepseek-flash`.
- **Panels:** a panel is a seeded shuffle of the active entries, and `selectPanel` refused a panel larger than the registry.
- **Escalations:** on Sepolia the appeal adjudicator decides escalations, with a panel of `appealPanelSize` 5.
- **The policy:** `demo-adjudicator-a/p1`, hash `0x84f76534…61af`. It names no models. The registry a deal binds is its own hash, `adjudication.registryHash`.
- **Floors on the escalation panel:** the schema sets `appealPanelSize` to at least 5, and the demo rulebook's `panelPolicyMin.appealPanelSize` is 5.

## Intent

Rafa, 2026-11-26: "change from Sonnet to Opus 5.5"; "To start, let's only do 3 judges: Opus, Gemini Neon, and Deepseek"; "5 seats, repeat models". New deals bind a registry of three judges from three families. A first-instance panel seats all three. An escalation seats five: all three, with two of them twice, picked by the seed. Deals already bound to the first live registry keep it.

1. `config/judges-live-2.yaml`: `claude-opus-5-5`, `gemini-4-neon` and `deepseek-v4-pro`, each pinned by a dated ID. It is carried in `kept-policies.json` and embedded in the Worker.
2. **Repeats:** `selectPanel` fills a panel larger than the registry, which it refused before. Each judge sits at most twice, under the seat id `<id>:2`, and a second seeded shuffle picks the repeats. The pipeline accepts a judge's own `:2` seat and refuses any other repeat. The service's seat check allows up to twice the registry.
3. **A `google` provider:** Gemini `generateContent`, with the key `HOLDBACK_GOOGLE_API_KEY`. A world needs a provider's variables only when its default registry seats that provider.
4. **Carry, deploy 1:** new deals still bind `config/judges-live.yaml`. The second registry is carried beside it, through the same live panel and budget.
5. **Flip, deploy 2, a separate commit:** `LIVE_DEFAULT_REGISTRY` becomes `config/judges-live-2.yaml`. The Google key becomes required, and the first live registry stays carried.

- **Non-goals:** no policy change, so the policy hash stays. No schema change. No rulebook change. No re-roll.

## Acceptance criteria

- [x] The new registry seats no Sonnet model, pins `claude-opus-5-5@2026-09-21`, and names exactly the three judges, one per family. Every first-instance panel seats all three, and every escalation panel of five seats all three families with two repeats (`live-registry-2.test.ts`, 512 seeds each).
- [x] A panel larger than the registry repeats judges, at most twice each, with the seed choosing which. Every pair repeats over 200 seeds. A repeat gets its own nonces. A panel the registry can fill is seated as before (`panel-repeats.test.ts`, `panel.test.ts`).
- [x] No decision rests on one family. One family's two seats agreeing, with no other valid verdict, is never an accept. Every accept or reject is carried by two families. A repeated seat never counts as a second family (`panel-repeats.test.ts`, at the live appeal thresholds).
- [x] The pipeline accepts a judge's `:2` seat and refuses the same model under another id, a repeat with no first seat, and a third seat (`panel-repeats.test.ts`).
- [x] Carry: the live world binds the first live registry and carries the second through the same panel, counted against the budget (`judges.test.ts`). It never carries the placeholder registry (`notice.test.ts`, attack H1).
- [x] Flip: a separate commit moves the default and requires the Google key, and the first live registry stays carried (`judges.test.ts`, `world.test.ts`, `worker.test.ts` at the flip commit).
- [x] Gemini, with a stubbed fetch (`providers.test.ts`, `attack.gemini.test.ts`):
  - The key goes in a header, never the URL, and is never echoed.
  - No tools or grounding, JSON output, low thinking.
  - Thought parts are never verdict text.
  - A blocked prompt, or a stop other than `STOP`, is an error.
  - No redirect is followed.
  - A google seat without the key abstains with no retry.
- [x] Red team: findings fixed or filed (Evidence).

## Evidence

**The unexpected key [measured, probe of 2026-11-26].** Live calls through `runPipeline` used template pair 2 (the default), agg-5, a 4-criterion rubric and a JSON kit. The probe script and raw output stay in the session scratchpad, not the repo. The public judgment records keep no raw output, so the key is not on record.

| Model | Pair 2, first instance | Pair 2, appeal | Pair 1, first instance | Pair 1, appeal | Extra criterion keys seen |
|---|---|---|---|---|---|
| claude-sonnet-5 | 2 of 2 voided | 2 of 2 voided | 0 of 3 | 3 of 3 voided | `evidence2`, `score_comment`, `injectionSuspected`; on pair 1 `score_reasoning`, `score_rationale`, `issues` |
| claude-sonnet-5-5 | 0 of 2 | 0 of 2 | | | none |
| claude-opus-5-5 | 0 of 3 | 0 of 3 | | | none |
| claude-haiku-5-5 | 0 of 2 | 0 of 2 | | | none |
| claude-fable-5-2 | 0 of 2 | 0 of 2 | | | none |
| claude-opus-5 | 1 of 2 voided | 2 of 2 voided | | | `score_note`, plus one output that is not JSON |
| claude-opus-4-8 | 1 of 2 voided | 1 of 2 voided | | | `score_note`, `evidence_note` |

- **Why [inferred]:** the model invents a field, and the name changes every time, so no template line asks for it. Pair 2's first-instance prompt draws it more often than pair 1's. A model output shift since 2026-11-25 is not ruled out, because no earlier raw output exists to compare. The samples are small: 2 to 4 calls a cell.
- **The other two judges:** `deepseek-v4-pro` returned a valid verdict in every live panel on record. `gemini-4-neon` is not yet measured: it gets one live call before the flip.

**Which models repeat [decision, with reasons].** None is fixed. In each escalation the seed picks two of the three, so the seller cannot know at delivery which model gets double weight. Fixing a pair, for example the two whose output is measured clean (Opus and V4 Pro), would let a seller tailor an attack to the double-weighted models.

**Cost [inferred from measured inputs].**
- **Inputs:** tokens per call are measured from today's live counts (`GET https://api.crow.direct/`, `demo.judges.tokensToday.byModel`, 2026-11-26): Opus about 7,400 in and 500 out, V4 Pro 3,529 and 297. Neon is assumed to use Opus's counts, with thinking at low [guessed]. Prices are list prices from `config/model-prices.json`, with DeepSeek at peak.
- **Per call (USD):** Opus 5.5 0.040, Gemini 4 Neon 0.030, DeepSeek V4 Pro 0.006.

| | First live registry (USD) | Second live registry (USD) |
|---|---|---|
| First-instance panel, 3 seats, mean | 0.049 | 0.075 (always all three) |
| Escalation panel, 5 seats, mean | 0.081 | 0.125 |
| Escalation panel, dearest | 0.081 | 0.144 (Opus and Neon repeat) |
| Escalation panel, cheapest | 0.081 | 0.111 (Neon and V4 Pro repeat) |
| Judged deal, no escalation | 0.049 | 0.075 |
| Judged deal with an escalation, mean | 0.130 | 0.200 |
| A day at the 100-call cap, first-instance panels only | 1.63 | 2.50 |
| A day at the cap, every panel the dearest escalation | 2.57 | 2.89 |

- **Budget [measured: code search]:** the only judge cap in the code is the call cap (`LIVE_JUDGE_CALLS_PER_DAY`, default 100), and it is unchanged. The code holds no USD cap, so nothing in the code trips. A limit set at a provider's console is Rafa's.

**Gemini [facts from Google's pages, 2026-11-26].**
- **Price:** `gemini-4-neon` costs USD 3 per million input tokens and USD 15 per million output, thinking included.
- **Status:** Google gives it no Stable or Preview label, and no dated snapshot.
- **Data:** on the paid tier, prompts are not used for training, and they are logged "for a limited period" for abuse monitoring. The Developer API has no zero-retention mode; Google points to Vertex AI for that. So this provider is `providerPrivacy: standard`. The adapter uses no grounding or File API, both of which store data.
- **Unverified [guessed]:** Google's current docs lead with the Interactions API, while the adapter calls `v1beta/models/{model}:generateContent` with `thinkingConfig.thinkingLevel`. One live call with Rafa's key confirms the request shape before the flip.

**Red team [measured: its report, 2026-11-26; tests `apps/demo-cloud/src/attack.registry-carry.test.ts`, `apps/adjudicator/src/providers/attack.gemini.test.ts`].**
- **No High findings.**
- **L2, fixed:** a Gemini candidate stopped for safety returned its text as a verdict.
- **L3, fixed:** fetch followed a redirect and would resend the key header to another host. Every provider now refuses redirects.
- **M1, filed to triage:** after the flip, the deploy guard skips deals bound to the old registry, because it counts only the registry the adjudicators register on. Its trigger is a later deploy that retires `config/judges-live.yaml`. Two known-gap tests (`it.fails`) hold it. Filed at crow-ops-private `roadmap/triage/`.
- **L1, noted:** the guard does not check the deploy order of a registry default, so the order below is kept by hand.
- **L4, noted:** an outside primary can still bind the old registry, and Crow's fallback will judge under it. Both parties sign the registry hash (D28, D32).

**Checks [measured, 2026-11-26; `/verify`, judgment recipe].**
- **At the flip commit:**
  - `pnpm exec tsc -b`: pass. `pnpm lint`: exit 0. `pnpm validate:spec`: exit 0.
  - `pnpm snap`: 73 of 73 pass, with no snapshot diff. `node site/build.mjs && node site/check.mjs`: PASS.
  - `pnpm test`: 6,898 passed, 5 expected failures, 334 skipped, 1 failed. The expected failures are the frozen agg-4 KEPT GAP tests and the red team's two M1 known gaps. The one failure is `apps/own-seller/src/frozen.test.ts`, which refuses any change under `packages/` against a full local history; CI's test job checks out shallow and skips it, as it did for T-616's judgment changes [inferred].
- **At the carry commit:** the judgment, testkit, adjudicator, demo-cloud, metrics and site-bundle suites pass 2,693, with 5 expected failures. Typecheck and lint pass.

## Decisions

- **D111** (docs/decisions-today.md).
- **No policy change.** The escalation stays five seats, so the policy hash, the schema and the rulebook are unchanged. Only the registry new deals bind changes.

## Handoff

**Deploys, each one step Rafa approves.**
1. **Carry:** deploy the commit "feat(adjudicator): carry the second live registry (T-631)". New deals still bind `config/judges-live.yaml`. The build can judge deals bound to either registry. The Google key is not needed yet.
2. **Before the flip:**
   - Rafa adds `HOLDBACK_GOOGLE_API_KEY` to `/Users/rafa/Documents/escrow/.env`, and one live Gemini call through the pipeline confirms the request shape.
   - Rafa sets the Worker secret. Only `holdback-op1` needs it, because op2's Durable Object runs in op1 (`wrangler.op2.jsonc`, `script_name`). Wrangler prompts for the value:
     `npx -y wrangler@4.151.3 secret put HOLDBACK_GOOGLE_API_KEY --name holdback-op1`
3. **Flip:** deploy the commit "feat(demo-cloud)!: DEFAULT FLIP, new deals bind config/judges-live-2.yaml (T-631)". Without the secret the world fails closed on judged deals; checks-only deals still run. A rollback lands on the carry build, which carries both registries.
4. After the flip, the coordinator reruns regression items 5 and 6.

**Published bundles.** Seating `google` in the registry loader rebuilds `site/seller-worker.mjs` and its pin in `site/setup.mjs`. They go live with the next site deploy, which is separate and Rafa's.
