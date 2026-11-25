# T-478: The seller Worker on the party's own Cloudflare account

- **Lane:** demo (a new app for the party's own seller Worker, beside the hosted seller adapter in `apps/hosted-sellers/`, which it imports and does not change)
- **Phase:** 2
- **Depends on:** T-483 (a seller's own API over HTTPS, which the Worker calls), T-474 (the card's schema). Runs after T-476, because each changes the setup bundle. It no longer waits for the pilot's deploy and no longer depends on T-477 (D75).
- **Paths this task may touch:** a new app for the party's own seller Worker (for example `apps/own-seller/`: its entry, its Durable Object class, its configuration writer, its tests and a README), the new app's `package.json` and `tsconfig.json`, its reference in the root `tsconfig.json`, `pnpm-lock.yaml`, `site/build.mjs` and `site/check.mjs` (to build and pin the prebuilt Worker beside `setup.mjs`), `examples/setup-publish.ts` (new: the card files and a `--cloudflare` mode), `examples/setup-publish*.test.ts` (new), `examples/setup-check.ts` (the card's local check and `check --published`), `examples/setup-leave.ts` (removing the Worker), one entry in `examples/setup.ts`'s command table, the "Publish" section of `site/setup.txt`, `site/setup.mjs` and the pinned Worker file beside it (generated), this file. It imports `examples/seller-adapter-core.ts` and `apps/hosted-sellers/src/` (`journalStore`, `checkBundle`, `bundleSha256`, `TEST_CHAINS`) and changes none of them: `apps/hosted-sellers`, `examples/seller-adapter-core.ts`, `examples/seller-adapter-api.ts` and `packages/` stay frozen until the pilot's sellers are deployed (D72, D73).
- **Human gate:** yes. A deploy to any Cloudflare account waits for the account's owner; the measured run needs a Cloudflare account that is not Crow's production account, free plan first, which is Rafa's to provide.
- **Status:** todo. The first way a seller goes live (D75); it starts after T-476 merges.
- **Agent/session:** not started
- **Roadmap row:** N160
- **Change kind:** 4, with 8 for the test deploy. Local checks: the new app's tests, `apps/hosted-sellers`' tests (unchanged, to show the pilot's code still passes), `pnpm exec vitest run examples/setup`, `node site/build.mjs && node site/check.mjs`.
- **Review:** one `red-teamer` pass (keys and secrets on a cloud account, the account choice, the new object's address input, and the attacks it takes over from T-477: a check that fetches addresses a stranger names, and a published seller open to the internet) and one `reviewer` pass.
- **Token budget:** 400,000 tokens, a target: 300,000 for the Worker and 100,000 for the parts it takes over from T-477 (D75).

## Intent

Restate this in your own words before writing code.

Rafa's bar is that setting Crow up is as simple as deploying a page on one's own site. For a seller that wants outside buyers, the nearest thing is one deploy on the party's own Cloudflare account: a Worker built on the same core as the one Crow runs for a design partner (ADR-0037), deployed by the party, at an address the party chose, with the party's own secrets. It is the first way a seller goes live; a host with Node (T-477) is the second (D75).

Today the hosted seller's Worker deploys only on Crow's account, on routes under crow.direct, refuses any other address (`apps/hosted-sellers/src/worker.ts:161`), and Crow's script makes and holds the seller's signing key (baseline). The pilot's freeze keeps that Worker unchanged, so this task writes a second shell in new paths around the same core:

- **First, what needs no host:** the card files, the card's local check, `check --published`, and the rule that a quote address is never open by default. T-477 reuses them.
- `node setup.mjs publish --cloudflare` asks which account, and whether the Worker lives at a `workers.dev` name or on a subdomain of a zone the party has on Cloudflare, and infers neither. It writes the deploy configuration for that address.
- The Worker gets a signing key of its own, not the folder's: made in memory on the party's machine and piped to the account's secret store on standard input. It is never printed, never an argument, never written to a file. The party's API key is typed by the person at the cloud tool's own prompt.
- The person runs the login and the deploy. The command then runs the check of the live card and quote address.
- `leave` removes the Worker and says what Cloudflare keeps.

Non-goals: Crow's account or Crow's domain in any step; a second runtime; a change to what the Worker does in a deal; any change to `apps/hosted-sellers`, `examples/seller-adapter-core.ts`, `examples/seller-adapter-api.ts` or `packages/` (D72, D73).

## Context

- The decision and its record: D75; `docs/research/2026-11-15-first-go-live-path.md`.
- The design: `docs/research/2026-11-15-setup-design.md`, "Where the signing part runs".
- The criteria this task takes over: `docs/tasks/T-477-setup-publish-own-host.md`, criteria 2 and 4 to 7; `docs/tasks/T-474-card-schema.md`, the size cap on a fetched card.
- The pattern: `docs/research/2026-11-15-blygger-study.md`, patterns 3, 4 and 5: the account is always asked, the secret is piped and never held, each step checks before it creates, and the deploy is a separate step.
- The Worker: ADR-0037; `apps/hosted-sellers/`; the runbook in `docs/operations.md`.
- Cloudflare tooling in this repository: `CLAUDE.md`, "Cloudflare tooling".

## Acceptance criteria

- [ ] **The card and its checks, first.** T-477's second, fourth, fifth, sixth and seventh criteria hold here, with their tests: the quote address is never open by default (a quote credential or `--open`, and the most quotes a day over all callers); the card's local check; `check --published` safe to point anywhere (HTTPS only, no redirect, the other-origin flag, no loopback, private or link-local address, a fixed reason per check, never the fetched text); its tests against a seller built by hand; no quote sent. The check caps the size of a whole card it fetches (T-474).
- [ ] From the folder T-472 made, `publish --cloudflare` prepares a deploy for an account the person named and an address the person chose: a `workers.dev` name, or a subdomain of a zone the party has on Cloudflare. With either answer missing it prints the question and exits 3. It drops the Node-only fields (`port`, `journal`, `events`) before the bundle's check. It checks that the account has a `workers.dev` subdomain before a first deploy there, and asks the person to set one if not. It refuses to run with an API token in the environment that would choose the account silently.
- [ ] The prepared deploy names no Crow account, zone or route. A test fails if a route, a zone or an account in the configuration it writes is Crow's; the operators' own addresses are the one place Crow's domain may appear.
- [ ] **The cloud tool is pinned.** The command runs one exact version of the deploy tool, since that tool carries the key on its way to the secret store.
- [ ] **What Cloudflare tells the operators is measured.** One test deal from the deployed Worker, with the operators' request log read by Rafa or a stand-in operator in the test: whether the Worker's outgoing requests carry a header that names its zone. The design and `setup.txt` then state what was found; until then they say it is inferred.
- [ ] **The guide states who can reach the key:** nobody is shown it after it is set; whoever holds the account's login can replace it or deploy code that reads it. It tells the person to log the cloud tool out after the deploy when an assistant shares the machine, and says that the limits are otherwise the assistant's to pass.
- [ ] **Test tokens only.** The new Durable Object class refuses to start on any chain outside `TEST_CHAINS`, as the hosted seller does; a test starts it against another chain and sees the refusal.
- [ ] The signing key reaches the account's secret store by standard input only. A test reads every printed line, every argument of every child process and every file outside `keys/`, and fails if the key's value is in one.
- [ ] Each step checks before it creates, and a rerun after a failure continues with no second Worker and no second key.
- [ ] After the deploy, `check --published` passes against the party's card and the Worker's address, and one deal with Crow's test buyer ends `Released` from the deployed Worker.
- [ ] The pilot's hosted sellers are unchanged: the diff touches no frozen path (a test or a CI step reads it), the hosted bundle's SHA-256 for the pilot's seller folders is the same before and after, measured as T-443 measured it, and so is the SHA-256 of the hosted Worker's dry-run upload, since the bundle's hash covers its configuration only.
- [ ] `leave` removes the Worker and its secrets from the party's account, after the export, and refuses while a deal is open.
- [ ] One measured run by hand on an account that is not Crow's production account: the commands, the person's steps (the account and its email, the login, the two answers, the API key typed at the prompt, the deploy) and the plan used, free first and the minutes, in Evidence.
- [ ] The red-team pass covers: a deploy to the wrong account; a secret in a log, a file or an argument; a card that names another party's quote address; the party's domain reaching the operators beside each deal key; a login left behind; jobs started at a published seller with no credential; its faucet grants used up from one address; `check --published` turned on a private address or made to print fetched text; an oversized card.

## Out of scope

- A deploy button or a hosted setup. A button cannot ask which account, and a hosted setup would hold the key.
- Other clouds. A host with Node is T-477.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- The measured run:

## Decisions

Choices made inside this task.

- **Narrowed on 2026-11-25 (the journeys session, on Rafa's "can you finish this?").** Standing offers (ADR-0040, T-548 to T-552) now serve a fixed file or a fixed job with nothing running. This task builds only what they do not serve: work whose terms name the buyer's own input, which "follows normal flow" (D82), so a program must answer each buyer's quote with a signed offer. Rafa chose the seller's own cloud account for that program on 2026-11-19 ("Yes, own account"). Nothing here is for a seller a standing offer already serves.
- **1. The Worker delivers itself; the work comes from the seller's own API.** The Worker answers each quote and signs each per-buyer offer from the seller's template and scope rules, then starts the job at the seller's own API over HTTPS and delivers the result, through the adapter's existing mapping (`sellerApi`, T-366). This is the hosted seller's flow (ADR-0037), on the seller's account. The folder's `deliver` does not deliver a Worker's deals: each deal's key is derived from the Worker's own key, which is on the account only, and a second copy in the folder would double who can sign for the deal. A seller whose per-buyer work is made by hand, with no API, has no path here; that is a follow-up for measured demand (a work inbox on the Worker), not built.
- **2. The command is `setup.mjs cloudflare`.** It names where the program goes. `publish` stays T-552's standing offer, which needs nothing running; `cloudflare` prepares a program that runs. `cloudflare` prepares the deploy; `cloudflare --key` puts the Worker's signing key in the account's secret store; `check --published <URL>` checks the live card; `leave` removes the Worker. T-477 takes `publish --host` or a name of its own.
- **3. What stays on the Worker.** Its own signing key, `HOLDBACK_KEY`: `cloudflare --key` makes it in memory and pipes it to `wrangler secret bulk` on standard input. It is never printed, never an argument, never written to a file, and the folder never holds it. The party's API key and the quote credentials are typed by the person at Wrangler's own hidden prompt (`wrangler secret put <NAME>`): the setup never sees them. The bundle beside the Worker holds the configuration, the template and the folder's public address, and no secret.
- **4. The folder's address is the owner.** `leave` proves it owns the Worker with a signature of the folder's own key over the Worker's host and the time; the Worker answers `GET /export` with its journal only to that signature, within 300 s. No extra secret exists for it.
- **5. The configuration comes from a file the person names.** `setup.mjs` makes no own-API folder yet (T-483 is not built), so `cloudflare --config <file>` takes an adapter configuration in the shape of `examples/seller-adapter.config.json`, with its template and mapping beside it. The command drops `port`, `journal` and `events`, sets the payout address from the folder, sets `quoteAuth` and `quoteRateLimit` from the person's answers (and refuses a file that sets them), and refuses any seller API address that is not `https`.
- **6. The workers.dev subdomain is part of the person's answer.** The account's `workers.dev` subdomain can be read only with the account's API token, which the setup never reads. So the address question asks for `<name>.<subdomain>.workers.dev` and says where the dashboard shows the subdomain, and how to set one when there is none. The deploy tool refuses an account with no subdomain, and `check --published` then fails. This replaces the criterion's check before the first deploy.
- **7. The Worker ships prebuilt.** `site/build.mjs` bundles `apps/own-seller/src/entry.ts` into `site/seller-worker.mjs` and writes its SHA-256 into `examples/seller-worker-pin.ts`, which `setup.mjs` carries. `cloudflare` takes the file from `--worker-file <path>` or from crow.direct, and refuses bytes with another SHA-256. Wrangler uploads it unbundled (`no_bundle`), with the seller's bundle as a text module beside it. Wrangler is pinned at `4.151.3`, the repository's one pin.
- **8. `setup.mjs` now starts one child process.** T-496's rule is that no published bundle loads code at run time. The criteria need the command itself to pipe the key into Wrangler and to check the secret store before it writes, so `cloudflare --key` and `leave` run `npx --yes wrangler@4.151.3`, and nothing else. The alternative, printing the key into a shell pipe, would put the key in any assistant's transcript that runs the command without the pipe. `tests/site-bundles.test.ts` names this one exception, and holds `setup.mjs` to one `spawn` call with the pinned version. It also lists `site/seller-worker.mjs`, which runs on Cloudflare and never under Node, with the child-process import its bundled settlement package carries and never calls. Rafa may overrule this; the fallback is to print the Wrangler commands for the person to run.

## Handoff

Not started; starts after T-476 merges. Read `docs/research/2026-11-15-first-go-live-path.md` and D75 first.

- **Build first what T-477 planned and needs no host,** so T-477 can reuse it: the card's local check against the card's schema, `check --published` with every rule in T-477's fifth, sixth and seventh criteria (HTTPS only, no redirect, no private address, the other-origin flag, a fixed reason per check, no fetched text, no quote sent), the rule that a quote address is never open by default (a quote credential or `--open`, and the most quotes a day over all callers), and the card files. Those criteria of T-477 become this task's; T-477 keeps the host's files.
- **The Worker is a second shell in new paths.** Today's Worker cannot serve another domain: `apps/hosted-sellers/src/worker.ts:161` refuses any address that is not `https://crow.direct`, `:204` writes that Crow runs the seller, and `deploy-plan.ts` fixes the zone and the routes. Write a new Durable Object class with the base address as an input, keeping the hosted seller's refusal of any chain outside `TEST_CHAINS`; import the core and the hosted seller's helpers; change no frozen path. The setup's configuration carries `port`, which `checkBundle` refuses (`bundle.ts:70`), so the configuration writer drops the Node-only fields first. The pilot's bundle SHA-256 then stays the same by construction, and the criterion that measures it still runs.
- **Ship the Worker prebuilt,** pinned by SHA-256 beside `setup.mjs`, with the seller's configuration uploaded beside it as a data module. Run one pinned Wrangler version from npm.
- **`workers.dev` by default,** a route on the party's own zone when the party asks. On `workers.dev`, TLS at the quote address proves only a Cloudflare account; the "Publish" section says the binding to the party comes from its card on its own domain, for a buyer that starts there. Check that the account has a `workers.dev` subdomain before the first deploy: Wrangler's own prompt for one cannot run without a terminal.
- **Measure on a free account first:** a cold quote and one full deal. The free plan allows 10 ms of CPU per request, and a cold signature took about 30 ms in Node (the research record). Evidence names the plan the guide states. Also measure the `CF-Worker` header on `workers.dev`.
- **After the pilot's deploy,** a later task may fold this Worker's class and the hosted seller's into one class with the address as a parameter.
