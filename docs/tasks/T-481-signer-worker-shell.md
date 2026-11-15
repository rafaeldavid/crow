# T-481: The signer as a core with a Worker shell, on the party's own Cloudflare account

- **Lane:** demo (the signer, `examples/signer.ts`)
- **Phase:** 2
- **Depends on:** T-479 (the signer made usable by an outside party), T-478 (the seller Worker on the party's own Cloudflare account), and the live proof run of Crow's own agents (roadmap row N131) on the signer as it is today.
- **Paths this task may touch:** `examples/signer.ts` (becomes the Node shell), `examples/signer-core.ts` (new), `apps/signer/` (new: the Worker shell, its deploy and seed scripts, a README), `examples/signer*.test.ts`, `pnpm-workspace.yaml`, `examples/setup-signer.ts`, one section of `site/setup.txt`, `site/ref/buyer-signer.txt`, `docs/operations.md`, this file.
- **Human gate:** yes. The live test of step 1 changes a Cloudflare account, so it waits for Rafa, on a scratch account with test keys. Every deploy waits for the account's owner.
- **Status:** todo, **waiting** for T-479, T-478 and the own-agents proof run
- **Agent/session:** not started
- **Roadmap row:** N160
- **Change kind:** 4, with 8 for the test deploy. Local checks: `pnpm exec vitest run examples/signer`, the new app's tests.
- **Review:** one `red-teamer` pass, required: the code holds keys and decides what they sign, and the claim under test is that an agent cannot override it. One `reviewer` pass. A decision record before the build (step 2).
- **Token budget:** 300,000 tokens, a target.

## Intent

Restate this in your own words before writing code.

The signer gives a party limits its assistant cannot pass, as long as the assistant cannot reach the signer's keys or change its rules. Today that needs a second machine: the signer is a Node server with a ledger on disk (T-439, T-443). A party that set Crow up by deploying a Worker on its own Cloudflare account (T-478) has no second machine, and Crow's own agents need a host that is sustainable to develop on (Rafa, 2026-11-15).

This task makes the signer run in both places from one body of code:

- **A core** with no Node import: every rule, the ledger's logic and the write-before-sign order, behind a small store interface.
- **A Node shell,** today's `examples/signer.ts`, unchanged in behaviour.
- **A Worker shell:** its own Worker, a Durable Object for the ledger, the keys as Worker secrets, no public address, called through a service binding from the party's adapter Worker.

The Worker shell's claim rests on Cloudflare's per-Worker roles: the token the assistant deploys with carries a role on the adapter Worker only. Cloudflare's documentation supports that on paper and leaves four points open (the design, "Where the signer runs"). So the task starts with a live test of those points and stops if one fails.

Non-goals: hosting the assistant itself on Cloudflare; a contract wallet; moving Crow's own real signer, which is the own-agents lane's decision once this exists.

## Context

- The design: `docs/research/2026-11-15-setup-design.md`, "Where the signer runs: Crow's own two machines, and the same answer for a party".
- The signer: `examples/signer.ts`; `docs/tasks/T-439-signer-buying-half.md`, `docs/tasks/T-443-signer-selling-half.md`.
- The precedent for a core with two shells: ADR-0037, section 7; `examples/seller-adapter-core.ts`, `apps/hosted-sellers/src/worker.ts`.
- Cloudflare's pages, read 2026-11-15: the Workers authorization page (per-Worker roles), the changelog entry of 2026-09-15 on granular Worker permissions, service bindings, secrets, audit logs. Read them again before building; they change.
- Cloudflare tooling in this repository: `CLAUDE.md`, "Cloudflare tooling".

## Acceptance criteria

- [ ] **Step 1, the live test, before any port.** On a scratch account with test keys, with a token that holds the Editor role on one Worker only, each of these is tried and its result recorded: bind that Worker to a second Worker outside the token's scope; bind to the second Worker's Durable Object class; read a secret's value of either Worker through the API; overwrite a secret of the second Worker; deploy to the second Worker; read the second Worker's logs and stored data. Then, as the administrator: the audit log's lines for a secret overwrite and a deploy. If the token can change the second Worker or read its keys, the task stops and says so in Handoff.
- [ ] **Step 2, a decision record** states what the Worker shell's claim rests on, from step 1's results, and what breaks it: the account's administrators, a token with a role on the signer Worker, and any agent session that can read an administrator's token.
- [ ] The core imports no `node:` module. The Node shell passes every existing signer test unchanged.
- [ ] The Worker shell has no public address: the `workers.dev` address and preview addresses are off, and a test fails a configuration with either on.
- [ ] **Nothing an agent can call changes the rules.** The stop, the mandate's renewal and the revocations are not methods a bound Worker can call. They change by an administrator's deploy or an administrator-only path, and a test calls each from the adapter's side and is refused.
- [ ] The ledger is written before a signature leaves, on both shells. The ledger, stop and one-delivery attack tests of T-439 and T-443 run against the Worker shell and fail as they do on the Node shell, each beside a control that is signed.
- [ ] The rules are bundled at deploy; the Worker's status names their SHA-256, so the party can compare it with the file it approved.
- [ ] `node setup.mjs signer --cloudflare` prepares the signer Worker's deploy on the party's account, asks which account, and pipes the keys to the account's secret store on standard input. It prints, in plain words, which token the assistant may hold (a role on the adapter Worker only) and that the limits are hard only while that holds.
- [ ] **A rehearsal copy is a second account.** The guide says so, and the deploy refuses to prepare a rehearsal signer in an account that already holds a signer marked real.
- [ ] The red-team pass, acting as the assistant with the adapter's token, gets no signature outside the rules, no key and no change to the signer. Its findings and the fixes are in Evidence.

## Out of scope

- A shell for the assistant on Cloudflare (Containers or Sandbox). The assistant stays where the party runs it.
- Crow's own machines. The own-agents lane provisions its two VMs first (the design's recommendation).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Step 1's results, one line per attempt:
- Commands run and results:

## Decisions

Choices made inside this task.

## Handoff

Not started, and not to start until T-479 and T-478 are merged and the own-agents proof run is done. Step 1 needs Rafa: a scratch Cloudflare account, or his word to use a second account, and the token for it.
