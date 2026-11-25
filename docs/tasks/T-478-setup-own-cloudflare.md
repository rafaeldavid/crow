# T-478: The seller Worker on the party's own Cloudflare account

- **Lane:** demo (a new app for the party's own seller Worker, beside the hosted seller adapter in `apps/hosted-sellers/`, which it imports and does not change)
- **Phase:** 2
- **Depends on:** T-483 (a seller's own API over HTTPS, which the Worker calls), T-474 (the card's schema). Runs after T-476, because each changes the setup bundle. It no longer waits for the pilot's deploy and no longer depends on T-477 (D75).
- **Paths this task may touch:** a new app for the party's own seller Worker (for example `apps/own-seller/`: its entry, its Durable Object class, its configuration writer, its tests and a README), the new app's `package.json` and `tsconfig.json`, its reference in the root `tsconfig.json`, `pnpm-lock.yaml`, `site/build.mjs` and `site/check.mjs` (to build and pin the prebuilt Worker beside `setup.mjs`), `examples/setup-publish.ts` (new: the card files and a `--cloudflare` mode), `examples/setup-publish*.test.ts` (new), `examples/setup-check.ts` (the card's local check and `check --published`), `examples/setup-leave.ts` (removing the Worker), one entry in `examples/setup.ts`'s command table, the "Publish" section of `site/setup.txt`, `site/setup.mjs` and the pinned Worker file beside it (generated), this file. It imports `examples/seller-adapter-core.ts` and `apps/hosted-sellers/src/` (`journalStore`, `checkBundle`, `bundleSha256`, `TEST_CHAINS`) and changes none of them: `apps/hosted-sellers`, `examples/seller-adapter-core.ts`, `examples/seller-adapter-api.ts` and `packages/` stay frozen until the pilot's sellers are deployed (D72, D73).
- **Human gate:** yes. A deploy to any Cloudflare account waits for the account's owner; the measured run needs a Cloudflare account that is not Crow's production account, free plan first, which is Rafa's to provide.
- **Status:** waiting for the account. Built, reviewed and merged; only the live deploy on a Cloudflare account that is not Crow's is left (Handoff).
- **Agent/session:** a side session of the journeys session, 2026-11-25 (branch `t-478-setup-own-cloudflare`)
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

Each item is labelled measured, inferred or guessed. Times are UTC, 2026-11-25.

- **Local checks** [measured]: `pnpm typecheck` exit 0; ESLint clean on the changed files; `node site/build.mjs && node site/check.mjs` PASS; `pnpm exec vitest run examples/setup apps/own-seller apps/hosted-sellers tests/site-bundles.test.ts tests/card-schema.test.ts tests/install-rules.test.ts` 19 files, 175 passed, 3 skipped (08:54); after merging `origin/main` (T-598, T-601), the same set with `examples/check-terms.test.ts`: 20 files, 222 passed, 3 skipped, and `site/check.mjs` PASS with `setup.txt` at 9,979 of 10,000 published bytes and the seller path at 4,991 of 5,000 tokens, estimated (08:57). `pnpm verify` was not run: it is for a deploy.
- **The frozen paths** [measured]: `git diff origin/main --stat -- apps/hosted-sellers examples/seller-adapter-core.ts examples/seller-adapter-api.ts packages` is empty, and `apps/own-seller/src/frozen.test.ts` reads it on every run. `site/buy.mjs`, `site/try.mjs` and `site/take.mjs` have the same bytes. The pilot's hosted bundle hashes are the same by construction, since no file they read changed [inferred]; they were not measured T-443's way, which needs the pilot's private folders.
- **The Worker under `wrangler dev --local`** [measured, 08:50]: the pinned `site/seller-worker.mjs`, uploaded unbundled, against a local SimChain world and the job stub. A quote with no credential answered 401; with it, an offer in 134 ms; the deal ended `Released` 1 s after the quote, with one job at the stub; `/export` answered 200 to the owner's signature and 401 unsigned; the key was in no line Wrangler printed.
- **One Sepolia deal with Crow's test buyer through the locally run Worker** [measured, 08:26 to 08:31]: commitment `0xc82ecc3f4cd9b738ca5208f84beec38bf5ff824f1624b75bbc2700c2c2aebb62`. The quote took 6,878 ms (the deal key's faucet grant and the offer's posts); the test buyer took the ID with 202; Offered at 7 s, AcceptedByAdjudicator 88 s, Agreed 98 s, Held 109 s, Delivered 119 s, Released 301 s. That run used the build before the red team's fixes, which Wrangler bundled again. **Rerun on the final, unbundled build** [measured, 08:54 to 08:55]: commitment `0x9a3ffc48f62fc8b6336456dd702360c8bb69893a6762696149e14a72f3a7048e`, quote 9,977 ms, Offered 10 s, Agreed 20 s, Held 31 s, Delivered 41 s, Released 51 s, one job at the stub, `/export` 200 signed and 401 unsigned, the key in no line Wrangler printed.
- **The deploy's size** [measured, dry run]: `wrangler deploy --dry-run`: 3,332.75 KiB, 629.22 KiB gzipped, with the uploaded `worker.mjs` byte for byte the pinned file (SHA-256 equal). The free plan's limit is 3 MB gzipped [documented].
- **The key's path** [measured, `examples/setup-cloudflare.test.ts` with a stand-in Wrangler]: the key is in no printed line, no argument of any run and no file outside `keys/` of the folder or the card folder; Wrangler gets an allowlisted environment, a sanitized log in a folder removed after the run, and the deploy folder as its working directory; a rerun after a failed store sets one key; a Worker with a key or secrets this folder did not set is refused. Wrangler's own log files were not read with the real Wrangler [inferred covered by the sanitize and the removed folder].
- **Not built, and why:** the card's local check validates the card's shape and its https addresses, not the whole card schema (`site/card.schema.json` is not in the setup bundle); T-477 may add it. A per-buyer job made by hand, with no API, has no path (Decision 1). The workers.dev subdomain is not checked before the first deploy (Decision 6).
- **The measured run on an account:** not done; it is the human gate (Handoff).

### Reviews

Both passes were given `CLAUDE.md`, ADR-0037, ADR-0040, ADR-0001, ADR-0002, ADR-0038, the operator threat model, D75, D82 and the task file, and not this session's conclusions.

**Red team** (14 findings; tests in the worktree's `reports/scratch/t478-redteam/`):
1. `HOLDBACK_KEY` sent to a host a `.env` file or `CLOUDFLARE_API_BASE_URL` named [measured]. Fixed: Wrangler runs in the deploy folder, refuses a `.env` there, gets an allowlisted environment, and the command refuses `CLOUDFLARE_API_BASE_URL`, `CF_API_BASE_URL` and Wrangler's log variables.
2. The key in Wrangler's log file [measured]. Fixed: `WRANGLER_LOG_SANITIZE=true` and a log folder of the run's own, removed when it ends.
3. A `--config` that names the folder's key as its template [measured]. Fixed: a template or mapping is a bare file name, never the key file by device and inode, and must be JSON. Tested.
4. The quotes-a-day limit reset by a restart of the object [measured]. Fixed: the Worker counts offers per UTC day in its storage. Tested across two restarts.
5. Wrangler bundled the pinned file again, so the upload was not the pinned bytes [measured]. Fixed: `no_bundle`, with stand-ins for the two Node modules the runtime lacks; the dry run's upload equals the pin, and the deal above ran on it.
6. `check --published` did not check that the live Worker is the folder's [measured]. Fixed: from a folder with a Worker it compares the live card's `configSha256` with the folder's bundle. Tested.
7. One caller may use up the faucet for every party's Worker, if Cloudflare gives all Workers' requests one `CF-Connecting-IP` and the operators count grants by it [guessed]. Open: the rehearsal now logs that header; for triage with the operators' limits.
8. IPv6 forms that carry IPv4 (SIIT, Teredo, `2001:10::/28`, `5f00::/16`, `64:ff9b:1::/48`) [measured]. Fixed and tested.
9. A ReferenceError in the getter's timer [measured, uncommitted code]. Fixed; the whole exchange now has one 15 s limit.
10. The text said a quote "starts nothing", and it asks the API for a price [inferred]. Fixed.
11. The export read with no size cap; a quote between the export and the removal [inferred]. The cap is fixed (64 MiB); the gap stays, bounded by the hold's expiry.
12. A rerun reuses the recorded answers [inferred]. Kept: they were asked once, and the line prints the account.
13. Crow's account ID cannot be refused, since it is not public [inferred]. Kept; the zones are refused.
14. npx resolves Wrangler's own dependencies with no lockfile [guessed]. Kept, as everywhere the repository runs `npx wrangler@4.151.3`.

**Reviewer** (ISSUES, 12 findings): a folder name the Worker refuses made a Worker that answers 503 to everything, `/export` included (fixed: the setup refuses the name first, and `/export` answers the owner even when the seller is refused; tested); Wrangler's `.env` loading (fixed, as red-team 1); a same-name Worker overwritten by the deploy (fixed: the question warns, and `--key` refuses a Worker with secrets its bundle does not name; tested); criteria not met (the card's local check, the size-cap test, the `--open` cost and the inferred zone header in `setup.txt`, the frozen-path test: each added; the subdomain check: Decision 6, Rafa's to accept); `no_bundle` (fixed, as red-team 5); scope (below); `leave` trusting Wrangler's exit (fixed: it reads `/health` after the removal); `setup.txt`'s stop line (fixed: it says to run `leave` first); the idle timeout and two IPv6 ranges (fixed); "On a machine you share" (restored); stray emitted files (deleted); the header's file name (fixed).

**Paths beyond the task's list:** `site/sell.txt` (the criterion names it), sections of `site/setup.txt` outside "Publish" (its byte limit forced cuts there, each listed in its `%%` note), `tests/site-bundles.test.ts` (the new bundle and the one child process), `examples/setup-bundle.test.ts` (the new `card` check line), `examples/setup-published.ts` and `apps/own-seller/scripts/rehearse.ts` (new).

## Decisions

Choices made inside this task.

- **Narrowed on 2026-11-25 (the journeys session, on Rafa's "can you finish this?").** Standing offers (ADR-0040, T-548 to T-552) now serve a fixed file or a fixed job with nothing running. This task builds only what they do not serve: work whose terms name the buyer's own input, which "follows normal flow" (D82), so a program must answer each buyer's quote with a signed offer. Rafa chose the seller's own cloud account for that program on 2026-11-19 ("Yes, own account"). Nothing here is for a seller a standing offer already serves.
- **1. The Worker delivers itself; the work comes from the seller's own API.** The Worker answers each quote and signs each per-buyer offer from the seller's template and scope rules, then starts the job at the seller's own API over HTTPS and delivers the result, through the adapter's existing mapping (`sellerApi`, T-366). This is the hosted seller's flow (ADR-0037), on the seller's account. The folder's `deliver` does not deliver a Worker's deals: each deal's key is derived from the Worker's own key, which is on the account only, and a second copy in the folder would double who can sign for the deal. A seller whose per-buyer work is made by hand, with no API, has no path here; that is a follow-up for measured demand (a work inbox on the Worker), not built.
- **2. The command is `setup.mjs cloudflare`.** It names where the program goes. `publish` stays T-552's standing offer, which needs nothing running; `cloudflare` prepares a program that runs. `cloudflare` prepares the deploy; `cloudflare --key` puts the Worker's signing key in the account's secret store; `check --published <URL>` checks the live card; `leave` removes the Worker. T-477 takes `publish --host` or a name of its own.
- **3. What stays on the Worker.** Its own signing key, `HOLDBACK_KEY`: `cloudflare --key` makes it in memory and pipes it to `wrangler secret bulk` on standard input. It is never printed, never an argument, never written to a file, and the folder never holds it. The party's API key and the quote credentials are typed by the person at Wrangler's own hidden prompt (`wrangler secret put <NAME>`): the setup never sees them. The bundle beside the Worker holds the configuration, the template and the folder's public address, and no secret.
- **4. The folder's address is the owner.** `leave` proves it owns the Worker with a signature of the folder's own key over the Worker's host and the time; the Worker answers `GET /export` with its journal only to that signature, within 300 s. No extra secret exists for it.
- **5. The configuration comes from a file the person names.** `setup.mjs` makes no own-API folder yet (T-483 is not built), so `cloudflare --config <file>` takes an adapter configuration in the shape of `examples/seller-adapter.config.json`, with its template and mapping beside it. The command drops `port`, `journal` and `events`, sets the payout address from the folder, sets `quoteAuth` and `quoteRateLimit` from the person's answers (and refuses a file that sets them), and refuses any seller API address that is not `https`.
- **6. The workers.dev subdomain is part of the person's answer.** The account's `workers.dev` subdomain can be read only with the account's API token, which the setup never reads. So the address question asks for `<name>.<subdomain>.workers.dev` and says where the dashboard shows the subdomain, and how to set one when there is none. The deploy tool refuses an account with no subdomain, and `check --published` then fails. This replaces the criterion's check before the first deploy.
- **7. The Worker ships prebuilt.** `site/build.mjs` bundles `apps/own-seller/src/entry.ts` into `site/seller-worker.mjs` and writes its SHA-256 into `examples/seller-worker-pin.ts`, which `setup.mjs` carries. `cloudflare` takes the file from `--worker-file <path>` or from crow.direct, and refuses bytes with another SHA-256. Wrangler uploads the pinned bytes as they are (`no_bundle`), with the seller's bundle beside them as a text module, so what runs is what the pin names. The bundle names two Node modules Cloudflare's runtime lacks (`node:child_process`, `node:net`, from a local chain's runner the Worker never calls); the build gives each a stand-in whose functions throw (red team, finding 5). Wrangler is pinned at `4.151.3`, the repository's one pin.
- **8. `setup.mjs` now starts one child process.** T-496's rule is that no published bundle loads code at run time. The criteria need the command itself to pipe the key into Wrangler and to check the secret store before it writes, so `cloudflare --key` and `leave` run `npx --yes wrangler@4.151.3`, and nothing else. The alternative, printing the key into a shell pipe, would put the key in any assistant's transcript that runs the command without the pipe. `tests/site-bundles.test.ts` names this one exception, and holds `setup.mjs` to one `spawn` call with the pinned version. It also lists `site/seller-worker.mjs`, which runs on Cloudflare and never under Node, with the child-process import its bundled settlement package carries and never calls. Rafa may overrule this; the fallback is to print the Wrangler commands for the person to run.

## Handoff

**Done:** the code, the tests, the two reviews and their fixes, and the guides. `setup.mjs` and `seller-worker.mjs` are rebuilt; the site deploy that publishes them is Rafa's or the coordinator's. Until then `cloudflare` needs `--worker-file <the repository's site/seller-worker.mjs>`.

**For Rafa: Decisions 6 and 8.** Decision 6 replaces the criterion's subdomain check with the person's answer; Decision 8 lets `setup.mjs` start one child process, the pinned Wrangler. Each is recorded here only; it belongs in `docs/decisions-today.md`, which this task does not edit.

**The human gate: one measured run on a Cloudflare account that is not Crow's production account, free plan first.** The account's owner runs every step that touches the account. From a checkout of `main` after the merge (`<repo>` below), with Node 22.18 or later and `cloudflared` for a quick tunnel (no account needed):

1. Make the account with its email, verify it, and set a `workers.dev` subdomain: dashboard, Workers & Pages, then the subdomain. Note the minutes from here on.
2. A seller folder, if there is none: `node <repo>/site/setup.mjs seller --template <a template file> --payout this-key --folder ~/.crow/rehearsal --name rehearsal`.
3. The stand-in seller API, reachable from Cloudflare: in one terminal `cloudflared tunnel --url http://127.0.0.1:8790`, and note its `https://...trycloudflare.com` address; in another, `node <repo>/apps/own-seller/scripts/rehearse.ts api --port 8790 --public <that address>`. It writes `<repo>/reports/rehearsal/adapter.json` and prints the stand-in's throwaway API key.
4. Log in: `npx --yes wrangler@4.151.3 login`, then `npx --yes wrangler@4.151.3 whoami` for the account ID.
5. Prepare: `node <repo>/site/setup.mjs cloudflare --folder ~/.crow/rehearsal --config <repo>/reports/rehearsal/adapter.json --account <ID> --at rehearsal.<subdomain>.workers.dev --open --quotes-per-day 5 --worker-file <repo>/site/seller-worker.mjs`. It prints the next commands.
6. Deploy: `cd ~/.crow/rehearsal/cloudflare && npx --yes wrangler@4.151.3 deploy --config wrangler.json`.
7. The key: `node <repo>/site/setup.mjs cloudflare --key --folder ~/.crow/rehearsal`. Then the API key, typed at Wrangler's prompt: `cd ~/.crow/rehearsal/cloudflare && npx --yes wrangler@4.151.3 secret put JOBS_API_KEY --config wrangler.json`.
8. The check: `node <repo>/site/setup.mjs check --published https://rehearsal.<subdomain>.workers.dev/ --folder ~/.crow/rehearsal`. Every line `"ok": true`.
9. One deal with Crow's test buyer: `node <repo>/apps/own-seller/scripts/rehearse.ts deal --at https://rehearsal.<subdomain>.workers.dev/`. It prints each state with its seconds; it should end `Released`. During it, the `api` terminal prints each request the Worker made to the stand-in API, with its `CF-Worker` and `CF-Connecting-IP` headers: those two answer criterion 5 and red-team finding 7.
10. Leave: `node <repo>/site/setup.mjs leave --folder ~/.crow/rehearsal`, then `npx --yes wrangler@4.151.3 logout`.

Record in Evidence: the plan, the minutes from step 1 to step 8, the deal's commitment ID and its states, both headers' values, and any `exceededCpu` the dashboard's Worker metrics show (the free plan allows 10 ms of CPU per request; a cold signature took about 30 ms in Node [measured as a proxy, D75]). If the free plan fails on CPU, repeat on Workers Paid and say so in `setup.txt`. Then set the status to done, and replace "(inferred)" on the zone header in `setup.txt` with what was found.

**For triage, none started:** red-team finding 7 (one faucet bucket for every Worker, if the header says so); a work inbox on the Worker for per-buyer work made by hand; the full card schema in the card's local check; folding this Worker's class and the hosted seller's into one after the pilot's deploy (D75).

**How to resume:** `pnpm install`, `pnpm build`, then `node site/build.mjs`; the tests are `apps/own-seller/src/*.test.ts` and `examples/setup-{cloudflare,published,leave}.test.ts`. The local run and the Sepolia run are throwaway scripts in the worktree's `reports/scratch/t478/` (`local-run.ts`, `sepolia-run.ts`).
