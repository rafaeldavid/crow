# Judge registry log

One entry per change to `config/judges.yaml`: candidate added, promotion, retirement. Each entry gives the date, judge ID, provider and family, pinned model ID, calibration report link, metrics (false-accept rate, false-reject rate, red-team auto-accepts, n), the decision and the approver.

Entries are added from T-009 onward. Promotions follow the rule in `docs/judgment-and-defenses.md` (Model registry).

## 2026-11-01: first live registry, `config/judges-live.yaml` v1 (T-028)

- **Decision:** a second registry file holds the first real pinned models; `config/judges.yaml` (placeholders, hash `0x8aa41fa9…`) is unchanged and stays the scripted registry for `pnpm demo`, `pnpm sim`, the fixtures and snapshots. A panel is a seeded shuffle of every active entry, so one registry mixing placeholders with real models would seat judges a live adjudicator cannot call. Live adjudicators (`pnpm demo --live`, the public demo when its keys are set) publish this registry instead; a commitment binds whichever registry its primary publishes.
- **Hash:** `0x6dc7342b9458a837ec3df4b86b4cbca6e5ac9629aa11be17fbb24d4248e001fd` (keccak256 of RFC 8785 JSON). A first draft with `claude-haiku-5-5@2026-10-07` in place of Opus (hash `0xbf318eb4…`) never left the branch: in two live runs of demo beat 3 (measured, 2026-11-01) Haiku 5.5's evidence ran to 301 and 309 characters, past the schema's 300, so the verdict filter abstained it both times.
- **Approver:** Rafa (keys added and live judging requested, 2026-11-01). **Not calibrated:** no calibration report, no metrics; this is a demo promotion at test scale, not the promotion rule. Calibration before any non-demo use (backlog).

| Judge ID | Provider | Family | Pinned model ID | Sent to the provider as | Status |
|---|---|---|---|---|---|
| claude-sonnet-5-5 | anthropic | claude | `claude-sonnet-5-5@2026-09-28` | `claude-sonnet-5-5` | active |
| claude-opus-5-5 | anthropic | claude | `claude-opus-5-5@2026-09-21` | `claude-opus-5-5` | active |
| claude-sonnet-5 | anthropic | claude | `claude-sonnet-5@2026-06-29` | `claude-sonnet-5` | active |
| deepseek-v4-pro | openai-compatible (api.deepseek.com) | deepseek | `deepseek-v4-pro@2026-11-01` | `deepseek-v4-pro` | active |
| deepseek-flash | openai-compatible (api.deepseek.com) | deepseek | `deepseek-flash@2026-11-01` | `deepseek-flash` | active |

- **ID form:** the registry loader requires a date or revision stamp, and these provider IDs carry none, so each ends in `@<date>` (Vertex AI's convention); the live provider strips it. Anthropic: the three IDs are Anthropic's snapshot IDs (no dated form exists for them); the date is each model's `created_at` from `GET /v1/models`, checked 2026-11-01. DeepSeek: `GET /models` on 2026-11-01 listed only `deepseek-flash` and `deepseek-v4-pro`. **Limit:** these are provider aliases; DeepSeek can change the model behind a name without a new ID, so the `@2026-11-01` date records when they were checked, not a snapshot. Drift is detectable only by re-running calibration (threat T7).
- **Why five:** the default policy's appeal panel is five judges; with two families the appeal family minimum is capped at two (the service already caps it at the families the registry has).
- **Request settings** (apps/adjudicator/src/providers/live.ts): output cap 8,192 tokens per call, reasoning included (at 2,048, deepseek-flash spent the whole budget reasoning and returned no text: measured); Anthropic with `output_config.effort: "low"` and no sampling parameters (current Claude models reject a non-default temperature); DeepSeek with temperature 0. Neither gets tools or URLs.

## 2026-11-26: second live registry, `config/judges-live-2.yaml` v1: three judges from three families (T-631)

- **Decision:** Rafa, 2026-11-26: "To start, let's only do 3 judges: Opus, Gemini Neon, and Deepseek", then "5 seats, repeat models". The new live registry seats `claude-opus-5-5`, `gemini-4-neon` and `deepseek-v4-pro`. A first-instance panel seats all three. The escalation panel stays at five seats (`appealPanelSize` 5, the rulebook's `panelPolicyMin`): all three judges, with two of them seated twice. The panel seed picks which two (`selectPanel`, T-631). A deal keeps the registry it bound (ADR-0036): deals bound to `config/judges-live.yaml` (hash `0x6dc7342b…`) are judged by it, and it stays carried. Ships in two deploys, carry and then flip.
- **Reason, measured:** in the regression pass of 2026-11-26 on build `e9b3bd1`, the schema filter voided `claude-sonnet-5`'s verdict in 7 of the 8 panels known to have seated it since 2026-11-25 22:31 UTC ("criteria[0]: 1 unexpected key"), and `claude-sonnet-5-5`'s in 1 of 3. Under `agg-5` one voided verdict escalates, so a held reject escalated instead of being held, and a delivery that passed 3 of 3 checks and 5 of 5 valid verdicts was refunded.
- **The key, measured in a probe of 2026-11-26** (live calls, a 4-criterion rubric and a JSON kit, outside the repo): on template pair 2, `claude-sonnet-5` added an extra key to a criterion in 4 of 4 calls, with a different name each time (`evidence2`, `score_comment`, `injectionSuspected`). On pair 1 its first-instance prompt was clean in 3 of 3, and its appeal prompt added a key in 3 of 3. **Inferred:** the model invents the field; pair 2 draws it more often. `claude-opus-5-5` was clean in 6 of 6 calls.
- **Hash:** `0xff7d5d1a72724248ab66877c7fc97484c9e8223a25145bae471f5904d2e50ac2` (keccak256 of RFC 8785 JSON).
- **Approver:** Rafa, 2026-11-26. **Not calibrated**, as for v1. `gemini-4-neon` was not probed before this entry: one live call through the pipeline confirms the request shape before the flip deploy.

| Judge ID | Provider | Family | Pinned model ID | Sent to the provider as | Status |
|---|---|---|---|---|---|
| claude-opus-5-5 | anthropic | claude | `claude-opus-5-5@2026-09-21` | `claude-opus-5-5` | active |
| gemini-4-neon | google (generativelanguage.googleapis.com) | gemini | `gemini-4-neon@2026-11-26` | `gemini-4-neon` | active |
| deepseek-v4-pro | openai-compatible (api.deepseek.com) | deepseek | `deepseek-v4-pro@2026-11-01` | `deepseek-v4-pro` | active |

- **ID form:** as for v1. `gemini-4-neon` is a provider alias with no dated snapshot. Its date is the day it was named, from Google's pricing page (recorded limit, as for DeepSeek). Google gives the model no Stable or Preview label.
- **Repeated seats:** a repeat is its own seat, `<id>:2`, with its own nonces, criteria order and sample, and the model's family. It never adds a family, and no decision rests on one family: at five seats a 2/3 decision needs four votes, and one model holds at most two.
- **Request settings for Gemini** (`apps/adjudicator/src/providers/live.ts`): `generateContent` with the key in the `x-goog-api-key` header; JSON output by MIME type; `thinkingLevel: "low"`; no tools or grounding; no redirect followed. A blocked prompt or a stop other than `STOP` is an error, never a verdict.
- **Cost:** see `docs/tasks/T-631-opus-replaces-sonnet.md` (Evidence).
