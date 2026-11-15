# T-479: Hard limits through the signer for an outside party

- **Lane:** demo (the signer, `examples/signer.ts`)
- **Phase:** 2
- **Depends on:** T-475 (the buyer's setup); **the live proof run of Crow's own agents** (roadmap row N131), which uses the signer as it is today.
- **Paths this task may touch:** `examples/signer.ts`, `examples/signer-rules.schema.json`, a new rules example beside `examples/signer-rules.v1.json`, `examples/signer*.test.ts`, `examples/setup-signer.ts` (new), one entry in `examples/setup.ts`'s command table, one section of `site/setup.txt`, `site/ref/buyer-signer.txt`, `site/setup.mjs` (generated), this file. Not `examples/seller-adapter-core.ts`: the adapter's signer hook exists (T-443) and stays as it is.
- **Human gate:** yes, for the site deploy. The merge has no gate.
- **Status:** todo, **waiting for the own-agents proof run**. That run needs the signer unchanged; this task changes it.
- **Agent/session:** not started
- **Roadmap row:** N160
- **Change kind:** 4. Local checks: `pnpm exec vitest run examples/signer examples/setup`.
- **Review:** one `red-teamer` pass, required: this is the code that holds a party's keys and decides what they sign. One `reviewer` pass.
- **Token budget:** 300,000 tokens, a target.

## Intent

Restate this in your own words before writing code.

The limits the setup writes (T-472, T-475) are enforced by the party's own tool on the party's own machine. An assistant that shares that machine can read the key and pass them: they are rung 4 on the ladder Crow's own agents use (T-443). The standing rule is that an agent's guardrails must hold where the agent cannot override them, and that the proof is an attack test that fails.

Crow's signer already does this for Crow's own agents: a separate process holds the keys and signs only inside a rules file. It cannot serve an outside party as it stands (baseline):

- its rules schema requires the buying half, so a seller cannot run it alone;
- its buying rules list each allowed seller with hashes of its deliverable and checks, which no tool computes;
- its selling rules fix one product at one price, where an outside seller quotes;
- it runs from a checkout of the repository, not from the pinned bundle;
- no command writes a rules file.

This task makes the signer usable by an outside party and wires it into the setup: `node setup.mjs signer` writes a rules file from the limits the person gave, and the buyer's or the seller's commands then sign through it.

Non-goals: a contract wallet that holds the limits on chain (the next step for Crow's own agents); the second machine itself, which is the party's to provide.

## Context

- The design: `docs/research/2026-11-15-setup-design.md`, "Keys, secrets and limits".
- The signer and its rungs: `docs/tasks/T-443-signer-selling-half.md`, `docs/tasks/T-439-signer-buying-half.md`; `site/ref/buyer-signer.txt`.
- Limits and what enforces them: ADR-0038; `site/ref/limits.txt`.

## Acceptance criteria

- [ ] The rules schema takes a buying half alone, a selling half alone, or both. Crow's own version 1 rules file still validates and behaves as before; its attack tests pass unchanged.
- [ ] **A buyer's rules without a seller list:** the most per deal, the most per day, the most open at once, the pinned adjudicators, club and token, and the windows. A listed seller stays an option.
- [ ] **A seller's rules for a quoted price:** a lowest price, the payout address, the offers an hour, the open deals, the template's deliverable and checks, and one delivery per funded deal of work that passes the deal's checks.
- [ ] `node setup.mjs signer` writes the rules file from the folder's limits and configuration, validates it, and prints its SHA-256 and where the signer must run for the limits to be hard: a machine or an account the assistant cannot reach, with only the assistant's machine able to reach the signer's port.
- [ ] **Each limit has an attack test that fails,** run as an agent with full control of its own process and no key: above the per-deal limit, above the day's limit, a payout address that is not the party's, a price under the floor, a second delivery, a failing delivery, a changed rules file. Each sits beside a control that is signed.
- [ ] A stop refuses new offers and new payments and never a funded deal's delivery, as today.
- [ ] The setup's output states the rung it reaches: 3 with the signer on another machine or account; still 4 on the same machine.
- [ ] The red-team pass gets no signature outside the rules from the assistant's side. Its findings and the fixes are in Evidence.

## Out of scope

- Limits on chain. They wait for the contract-wallet path (ADR-0038).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- The attack tests and their controls:

## Decisions

Choices made inside this task.

## Handoff

Not started, and not to start until the coordinator says the own-agents proof run is done or will not use `examples/signer.ts` in a way this task changes.
