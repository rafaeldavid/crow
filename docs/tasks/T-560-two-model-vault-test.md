# T-560: a Claude agent and a DeepSeek agent buy from Crow through a Crest vault, on a local chain

- **Lane:** tools (the duet harness)
- **Phase:** 2
- **Kind:** 1 (a test harness option), with its test
- **Depends on:** T-391 (the duet harness), T-554 and ADR-0041 (spend controls are a protocol of their own; Holdback sees only a payment address that funds a hold)
- **Paths this task may touch:** `tools/duet/tools.ts`, `tools/duet/duet.test.ts`, `tools/duet/README.md`, this file. Never `contracts/`, `spec/schemas/`, the pinned bundles (`site/buy.mjs`, `site/try.mjs`, `site/setup.mjs`) or the operators.
- **Human gate:** the live runs spend on the agents' own model keys (Rafa's yes on the batch's cost ceiling); stage 2 (a Sepolia deploy of Crest) waits for Rafa's word
- **Status:** done (stage 1; the harness option merged in pull request 695)
- **Agent/session:** the T-560 session, started by the coordinator on 2026-11-19
- **Roadmap row:** N204

## Intent

Show that an outside agent can buy from Crow from the docs alone while a Crest vault pays within hard limits: ten settings of the limits, each run once with Claude as the buyer and once with DeepSeek, on a local chain with Holdback's own contracts and the operators' own code.

The test's client and runner live in the Crest repository (its thin client, `client/`). They use this repository's duet harness as a library. The one change here is generic: a `Toolbox` option for commands a company installs from outside this checkout, each with its own argument fence, their environment, and the part of the repository's commands the company installed. Nothing in this repository names the other project's code.

**Non-goals:** the operators relaying a vault's funding, the vault as the buyer, a fee, grants by signature, any API route or schema change.

## Acceptance

- `ToolboxOptions.installed` runs an installed command through its own check, refuses what the check refuses, builds the environment from nothing plus `installed.env`, limits the repository's commands to `installed.repository`, and records each call like any other.
- `pnpm duet` behaves as before.

## Evidence

- The two installed-command tests pass, with the whole duet suite (42 of 42) [measured, local]. A review found three medium holes in the first version and some smaller gaps: an unchecked script path, `--help` skipping the check, and the environment's secrets. Each is fixed with a test, and a re-review passed.
- Stage 1 ran with this option on 2026-11-19 [measured]. Claude Opus 5.5 and DeepSeek V4 Pro each made 18 purchases across ten scenarios through the installed payment command, on anvil with this repository's contracts and operators. All 20 scenario runs ended as expected, for USD 2.05 at list prices. The installed command's fence refused every call outside it, and no key reached a model or the record.

## Handoff

The results of the runs, and the record of each, are kept privately with the case study. Resume from the Crest repository's T-560 pull request and its `client/README.md`.
