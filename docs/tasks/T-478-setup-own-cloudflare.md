# T-478: The seller Worker on the party's own Cloudflare account

- **Lane:** demo (the hosted seller adapter, `apps/hosted-sellers/`)
- **Phase:** 2
- **Depends on:** **the pilot's hosted sellers being deployed** (D72); T-477 (the card files and the check of a live address).
- **Paths this task may touch:** `apps/hosted-sellers/` (its deploy and secrets scripts, and a README), `examples/setup-publish.ts` (a `--cloudflare` mode), `examples/setup-leave.ts` (removing the Worker), the "Publish" section of `site/setup.txt`, `site/setup.mjs` (generated), `docs/operations.md` (the hosted seller's runbook), this file.
- **Human gate:** yes. A deploy to any Cloudflare account waits for the account's owner; the test deploy on Crow's own account is Rafa's.
- **Status:** todo, **waiting for the pilot's deploy**. It is the only task of this plan that changes `apps/hosted-sellers`, and any change there before the pilot's sellers are deployed forces another rehearsal.
- **Agent/session:** not started
- **Roadmap row:** N160
- **Change kind:** 4, with 8 for the test deploy. Local checks: `apps/hosted-sellers`' tests, `pnpm exec vitest run examples/setup`.
- **Review:** one `red-teamer` pass (keys and secrets on a cloud account, the account choice) and one `reviewer` pass.
- **Token budget:** 300,000 tokens, a target.

## Intent

Restate this in your own words before writing code.

Rafa's bar is that setting Crow up is as simple as deploying a page on one's own site. For a seller that wants outside buyers, the nearest thing is one deploy on the party's own Cloudflare account: the Worker Crow already runs for a design partner (ADR-0037), deployed by the party, on the party's own subdomain, with the party's own secrets.

Today that Worker deploys only on Crow's account, on routes under crow.direct, and Crow's script makes and holds the seller's signing key (baseline). This task makes the same Worker deployable by its owner:

- `node setup.mjs publish --cloudflare` asks which account and which domain, and infers neither. It writes the deploy configuration for a route on the party's own subdomain.
- The Worker gets a signing key of its own, not the folder's: made in memory on the party's machine and piped to the account's secret store on standard input. It is never printed, never an argument, never written to a file. The party's API key is typed by the person at the cloud tool's own prompt.
- The person runs the login and the deploy. The command then runs the check of the live card and quote address (T-477).
- `leave` removes the Worker and says what Cloudflare keeps.

Non-goals: Crow's account or Crow's domain in any step; a second runtime; a change to what the Worker does in a deal.

## Context

- The design: `docs/research/2026-11-15-setup-design.md`, "Where the signing part runs".
- The pattern: `docs/research/2026-11-15-blygger-study.md`, patterns 3, 4 and 5: the account is always asked, the secret is piped and never held, each step checks before it creates, and the deploy is a separate step.
- The Worker: ADR-0037; `apps/hosted-sellers/`; the runbook in `docs/operations.md`.
- Cloudflare tooling in this repository: `CLAUDE.md`, "Cloudflare tooling".

## Acceptance criteria

- [ ] From the folder T-472 made, `publish --cloudflare` prepares a deploy for an account and a subdomain the person named. With either missing it prints the question and exits 3. It refuses to run with an API token in the environment that would choose the account silently.
- [ ] The prepared deploy names no Crow account, zone or route. A test fails if a route, a zone or an account in the configuration it writes is Crow's; the operators' own addresses are the one place Crow's domain may appear.
- [ ] **The cloud tool is pinned.** The command runs one exact version of the deploy tool, since that tool carries the key on its way to the secret store.
- [ ] **What Cloudflare tells the operators is measured.** One test deal from the deployed Worker, with the operators' request log read by Rafa or a stand-in operator in the test: whether the Worker's outgoing requests carry a header that names its zone. The design and `setup.txt` then state what was found; until then they say it is inferred.
- [ ] **The guide states who can reach the key:** nobody is shown it after it is set; whoever holds the account's login can replace it or deploy code that reads it. It tells the person to log the cloud tool out after the deploy when an assistant shares the machine, and says that the limits are otherwise the assistant's to pass.
- [ ] The signing key reaches the account's secret store by standard input only. A test reads every printed line, every argument of every child process and every file outside `keys/`, and fails if the key's value is in one.
- [ ] Each step checks before it creates, and a rerun after a failure continues with no second Worker and no second key.
- [ ] After the deploy, the check of T-477 passes against the party's subdomain, and one deal with Crow's test buyer ends `Released` from the deployed Worker.
- [ ] The pilot's hosted sellers are unchanged: the hosted bundle's SHA-256 for the pilot's seller folders is the same before and after, measured as T-443 measured it.
- [ ] `leave` removes the Worker and its secrets from the party's account, after the export, and refuses while a deal is open.
- [ ] One measured run by hand on an account that is not Crow's production account: the commands, the person's steps (the login, the two answers, the deploy) and the minutes, in Evidence.
- [ ] The red-team pass covers: a deploy to the wrong account; a secret in a log, a file or an argument; a card that names another party's quote address; the party's domain reaching the operators beside each deal key; a login left behind.

## Out of scope

- A deploy button or a hosted setup. A button cannot ask which account, and a hosted setup would hold the key.
- Other clouds. A host with Node is T-477.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- The measured run:

## Decisions

Choices made inside this task.

## Handoff

Not started, and not to start until the coordinator says the pilot's hosted sellers are deployed. Then read `apps/hosted-sellers/scripts/deploy.ts` and `secrets.ts` first: the smallest change may be a second shell around the same Worker, with the routes and the account as inputs.
