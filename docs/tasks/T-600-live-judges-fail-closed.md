# T-600: Live judges fail closed when a key is missing

- **Lane:** api
- **Phase:** 2
- **Depends on:** T-574, T-581
- **Paths this task may touch:** `apps/demo-cloud/src/` (judges.ts, world.ts and their tests), `docs/operations.md`, `docs/api.md`, `site/ref/limits.txt`
- **Human gate:** yes for the deploy only; the code is in-repo
- **Status:** review
- **Agent/session:** judges-fail-closed (side session of the coordinator, 2026-11-25)
- **Roadmap row:** N222

## What exists

A Fable review of the security pack found that `panelConfig` (`apps/demo-cloud/src/judges.ts`) runs scripted judges when any of the three live model variables is missing, on Sepolia too. New judged deals then get scripted verdicts and settle on chain. Nothing refused to start and nothing declined judged deals. This breaks the "defended multi-model judgment" test: a verdict must come from the pinned live models or not at all.

## Intent

Fail closed on every chain world, as a spent judge budget does (T-574). With the live judge variables incomplete on a world that settles on a chain:

- Crow's adjudicators decline a new deal that can need a panel, with reason `judges_unconfigured:` in the offer's notices.
- A judgment under way abstains on every seat, so it escalates; the appeal panel is not convened.
- `/` and discovery say so: `demo.judges.panel` is `unavailable`, `demo.judges.missing` names the variables, `demo.judges.judgedDeals.accepting` is false, and the notes carry the reason.
- The World logs one `console.warn` line at start, with names and no values.

SimChain and the local demo keep scripted judges, each verdict marked "[fake judge, no model ran]".

## Where the check runs

The configuration is decided once, when the World starts (`panelConfig`, option `failClosed`, set by `PublicWorldOptions.requireLiveJudges`, default true for a chain world). It is enforced at two points that every path crosses: Crow's acceptance (`judgedDealGate`, the same `offerGate` that enforces the spent budget, so it covers offers from the operators and offers sent straight to the settlement layer) and each model call (the closed provider abstains, so no path can score a scripted verdict). `appealPanelGate` keeps an appeal panel from being convened. The start only chooses and logs; refusing to start would also stop checks-only deals, which need no model.

## Evidence

- Tests, written first: `judges.test.ts` (closed config abstains and never scripts; the flag off keeps scripted; one warn line with no value) and `world.test.ts`, describe "live judges fail closed" (declined judged offer with reason in notices; accepted with all variables; SimChain scripted and marked; a judgment under way when the world restarts incomplete abstains and escalates).
- Check results are in the pull request.

## Handoff

Needs an Opus red team (settlement and judgment path) before merge. The deploy is Rafa's. After the deploy, read discovery `demo.judges.panel`: it must read `live` on both operators; `unavailable` means a secret is missing.
