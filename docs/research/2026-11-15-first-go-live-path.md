# The first way a seller goes live: a Worker on its own Cloudflare account, or a Node service on its own host

A dated record, 2026-11-15, for T-488 (roadmap row N160). It answers one question Rafa asked on 2026-11-15: should the first way a Crow seller goes live, after its first local deal, be one deploy of the seller Worker on its own Cloudflare account (T-478) rather than a Node service on a host it runs (T-477)? The decision it feeds is D75 in `docs/decisions-today.md`, where Rafa can overrule it. Nothing is built or deployed.

Labels: **measured** (run or read here today, with the command or the file), **documented** (Cloudflare's own page says so, cited), **inferred** (follows from measured or documented facts), **guessed**. Cloudflare's pages were read on 2026-11-15 through Cloudflare's documentation search; they change, so T-478 reads them again before it builds.

## Summary

**Recommendation: yes. The seller Worker on the party's own Cloudflare account becomes the first way to go live, built as a second shell in new paths so it starts without waiting for the pilot's deploy. The host with Node stays, as the second way.**

1. **An assistant can drive almost all of it.** The person does three things in a browser (makes a Cloudflare account, verifies its email, approves Wrangler's login), gives two answers (the account, and a `workers.dev` name or a subdomain) and types the party's API key at a prompt. Everything else takes flags, reads secrets on standard input and can write machine-readable output. A host needs root, DNS, a certificate and a service manager, and T-477 already plans to print root commands for a person to run (documented and inferred, questions 1 and 3).
2. **It runs on the free plan on paper, with one open risk.** SQLite-backed Durable Objects and their alarms are on Workers Free, inside daily limits the seller uses less than a third of while a deal is open. The free plan allows 10 ms of CPU per request, and the first signature in a cold process took 28 to 32 ms here. T-478's measured run settles whether the free plan holds or the guide names the paid plan, USD 5 a month with a card (documented, and measured as a proxy in Node, question 1).
3. **The frozen Worker cannot serve another domain, so the work goes in new paths.** `apps/hosted-sellers/src/worker.ts:161` refuses any seller address that is not `https://crow.direct`. A second Worker module that imports the shared core and the hosted seller's storage helpers, and changes none of them, needs no change to a frozen path and can start now (measured, question 5).

## Scope

The repository at `542d6552` (origin/main, 2026-11-15): `CLAUDE.md`, `docs/writing.md`, the design (`docs/research/2026-11-15-setup-design.md`), the Blygger study (pattern 5), the baseline, the task files T-472, T-477, T-478, T-481 and T-483, and `apps/hosted-sellers/` (read only). Cloudflare's documentation pages are cited by address. Two local measurements, below. No Cloudflare account was touched: no `cf` command, and one Wrangler command, `deploy --dry-run`, which builds locally and exits.

Left out: the signer's Worker shell (T-481, which decides its own boundary by a live test), other clouds, and Crow's own hosted sellers (ADR-0037), which this changes in no way.

## 1. What a vendor needs: an account, a plan, a card

| Need | Answer | Label and source |
| --- | --- | --- |
| An account | An email and a password at Cloudflare's sign-up page. Cloudflare then sends a message to verify the address | Documented: [Create account](https://developers.cloudflare.com/fundamentals/account/create-account/), [Verify email address](https://developers.cloudflare.com/fundamentals/user-profiles/verify-email-address/) |
| A plan | Workers Free by default. Workers Paid costs a minimum of USD 5 a month for the account | Documented: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| A card | None on the free plan: nothing in the free plan's pages asks for one. The paid plan bills monthly, so it needs a payment method | Inferred from the pricing page; no page read states "no card" for Free |
| A domain | None, with the `workers.dev` subdomain every account gets (question 2) | Documented: [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/) |

**The seller's Durable Object and its alarm on the free plan.** The hosted seller's configuration declares `new_sqlite_classes: ['HostedSeller']` (`apps/hosted-sellers/src/deploy-plan.ts:87`), the backend the free plan offers.

- **Available on Free:** "Only Durable Objects with SQLite storage backend are available" on Workers Free, since 2025-04-07 (documented: [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/); [release notes, 2025-04-07](https://developers.cloudflare.com/durable-objects/release-notes/)).
- **Free limits, per account, reset at 00:00 UTC:** 100,000 Durable Object requests a day, "alarm invocations" included; 13,000 GB-s of duration a day; 5 million rows read and 100,000 rows written a day, where every key-value `get`, `put` and `list` counts as rows and "each `setAlarm()` is billed as a single row written"; 5 GB of stored data in all, 1 GB per object. Past a limit, "further operations of that type will fail with an error" (documented: [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/); [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)).
- **What the seller uses (inferred).** The Worker keeps one object per seller (`apps/hosted-sellers/src/worker.ts:108`, `objectName`), and its alarm fires every `pollMs` while any deal is open. The setup writes `pollMs: 3000` (`examples/setup-seller.ts:341`): 28,800 alarm runs and at least 28,800 rows written a day while a deal is open, about 29% of each daily limit. The adapter's default of 5,000 ms gives 17,280. An object waiting on the network bills duration; at 128 MB, the free 13,000 GB-s is about 28 hours of active time a day, more than a day, so one seller's object cannot reach it. The limits are per account, so several sellers on one account add up (inferred; the pricing page bills duration "while the Durable Object is actively running", and its 128 MB rule).
- **Deferred code updates** (`code_update_strategy`, `apps/hosted-sellers/src/deploy-plan.ts:85`) carry no plan restriction on their page and are the default for every Durable Object since 2026-10-30 (documented: [Durable Objects code updates](https://developers.cloudflare.com/durable-objects/deployments/durable-objects-code-updates/)).

**The open risk: CPU per request.**

- Workers Free allows **10 ms of CPU per HTTP request**; Workers Paid allows 30 s by default (documented: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). The Durable Object limits page lists 30 s of CPU per request without naming a plan, and its FAQ says Durable Objects "have the same per invocation CPU limits as any Workers do" (documented: [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)). Which applies to an object on Free is not stated plainly.
- **Measured, as a proxy in Node.** One EIP-712 signature with the repository's viem 2.57.13, on Node v22.22.2, Apple M1 Pro: the first in a fresh process took 28.3, 29.8 and 32.4 ms of wall time in three runs, and the later ones a mean of 0.42 to 0.56 ms each over 200 per run (`reports/scratch/t488-sign-cpu.mjs`, not committed). The reviewer's rerun on the same machine gave 24.9 to 25.6 ms cold. A quote also verifies, hashes and encrypts. So a cold object's first quote may pass 10 ms; warm ones should not (inferred). The workers runtime is not Node, and Workers allow "some built-in flexibility" for occasional overruns (documented, Workers limits), so this is a risk to measure.
- **Measured: the bundle fits.** `npx --yes wrangler@4.151.3 deploy --dry-run --config apps/hosted-sellers/example/wrangler.jsonc` after `pnpm -r build` printed "Total Upload: 3805.28 KiB / gzip: 590.72 KiB". The limit is 64 MiB uncompressed on both plans since 2026-09-04 (documented: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), "Worker size").
- **Other free limits that apply:** 50 external subrequests per invocation, 100 Workers per account, 64 variables per Worker (documented: Workers limits). One alarm pass makes a few requests to the operators and the party's API (inferred); the limit binds only a seller with many deals moving at once.

**Conclusion (inferred).** A vendor needs an account with a verified email and nothing else to start. Whether it also needs the paid plan and a card depends on the CPU of a cold quote, which T-478's measured run on a free account answers. Until it does, the guide states both plans and the reason.

## 2. Where the seller lives without a domain on Cloudflare

| Address | What it needs | Label and source |
| --- | --- | --- |
| `<worker>.<account-subdomain>.workers.dev` | Nothing beyond the account. Cloudflare calls it "a Free website" "intended for personal or hobby projects", and recommends a route or custom domain for production | Documented: [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), [Routes and domains](https://developers.cloudflare.com/workers/configuration/routing/) |
| A route or custom domain on the party's own domain | "An active Cloudflare zone": the domain's DNS on Cloudflare. A custom domain cannot sit "on a zone you do not own" | Documented: [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) |

**What `workers.dev` does to "the domain is the party's identity for being found" (D74).** A buyer knows a seller by the origin that gave it the offer's ID. On `workers.dev` that origin is Cloudflare's domain with the party's chosen labels, and TLS there proves only that the address belongs to some Cloudflare account (inferred).

The card restores the binding. The card lives on a page of the party's own domain, wherever that is hosted, and names the quote and defaults addresses on the Worker. A buyer that starts from the party's page trusts the Worker's address because the party's own origin named it (inferred, D74). T-477 already plans this case: `check --published` "refuses a quote or defaults address on another origin than the card's, unless the person names that origin with a flag (a page on a domain's apex with a Worker on a subdomain needs it)" (`docs/tasks/T-477-setup-publish-own-host.md`). The same flag covers a `workers.dev` origin.

What it costs:

- **Without a card on the party's own domain,** the seller is known only by its `workers.dev` name, which anyone can imitate with a close label. That is enough for a test buyer that takes a commitment ID, and not for an outside buyer (inferred).
- **The guide says it.** T-477's "Publish" text names TLS at the quote address as what binds an offer to the domain; on `workers.dev` it binds only to a Cloudflare account, so the Cloudflare part of the section says the card on the party's domain does the binding.
- **A party whose domain is already on Cloudflare** can put the Worker on its own subdomain; the setup asks and infers nothing (T-478's first criterion).
- **The header Cloudflare adds.** Every `fetch()` from a Worker carries `CF-Worker`, "set to the name of the zone which owns the Worker" (documented: [Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/)). On the party's own zone that tells the operators the party's domain beside each deal key. On `workers.dev` the value is not documented; it may be `workers.dev` or the account's subdomain (guessed). T-478 already measures it.

## 3. What the person does by hand, and what an assistant drives

| Step | Who | How, and the label |
| --- | --- | --- |
| Make the account and verify the email | The person, in a browser | Documented: Create account. Cannot be driven by flags |
| Log Wrangler in | The person approves in a browser. `wrangler login --device` prints a URL and a short code, so the approval can happen on a phone or another machine, with no callback server | Documented: [wrangler login](https://developers.cloudflare.com/workers/wrangler/commands/general/#login); [changelog, 2026-08-04](https://developers.cloudflare.com/changelog/post/2026-08-04-wrangler-login-device-flow/) |
| Choose the account | The person names it; the setup writes it as `account_id`. With several accounts and none named, a non-interactive run fails and lists them rather than guessing | Documented: [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) (`account_id`, `CLOUDFLARE_ACCOUNT_ID`); [cf in CI](https://developers.cloudflare.com/cf/ci/) |
| Name the subdomain, or choose `workers.dev` | The person, as an answer to the setup's question | T-478, first criterion |
| A `workers.dev` subdomain on a new account | Wrangler "will prompt you during the publish process to set one up" when none exists. A prompt with no default fails in a non-interactive run, so the setup checks for one first and, if missing, asks the person to set it in the dashboard | Documented: [Get started guide](https://developers.cloudflare.com/workers/get-started/guide/); the failure is inferred from [cf in CI](https://developers.cloudflare.com/cf/ci/) |
| Deploy | The assistant: `wrangler deploy` with the setup's configuration. `WRANGLER_OUTPUT_FILE_PATH` makes Wrangler write ND-JSON with the version ID and the deployed addresses. `--dry-run` rehearses | Documented: [system environment variables](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/) |
| The signing key and the generated credentials | The assistant runs the setup, which makes them in memory and pipes them to `wrangler secret bulk` on standard input, as `apps/hosted-sellers/scripts/secrets.ts` does today | Documented: [wrangler secret bulk](https://developers.cloudflare.com/workers/wrangler/commands/workers/#secret-bulk) ("If omitted, Wrangler expects to receive input from stdin"); measured in the repository |
| The party's own API key | The person types it at `wrangler secret put`'s own prompt, which reads a terminal or a pipe | Documented: [wrangler secret put](https://developers.cloudflare.com/workers/wrangler/commands/workers/#secret-put) |
| The check of the live card and quote address | The assistant: `check --published` (T-477) | Planned |
| Log out | The person or the assistant: `wrangler logout` | Documented: wrangler login page |

**The repository's own `cf` rules.** `CLAUDE.md` puts deploys, secrets and rollbacks on Wrangler through the repository's scripts and bars `cf deploy` in this repository. They govern Crow's own account. A party's deploy follows the same split: the pinned Wrangler for the deploy and the secrets, and no `cf` (inferred).

**What the assistant must not hold.** An API token in the environment overrides every login and profile (documented: [Wrangler profiles](https://developers.cloudflare.com/workers/wrangler/profiles/)), which is why T-478 refuses to run with one, as Blygger's `init` does.

**Count, against the host path (inferred from T-477 and the baseline).** The Worker path has 3 steps in a browser (the account, its email, the login), 2 answers (the account, the address), 1 secret typed at a prompt, and 1 more step on a new account (the `workers.dev` subdomain). The host path needs a host with Node, a DNS record, root for the service unit and the proxy, and the person's own runs of the install commands: the baseline counts 5 install lines, 4 service commands and 2 files for today's recipe, and T-477 cuts that to commands a person with root runs.

## 4. Who can read the signing key

| | A Worker on the party's own account | A Node service on the party's own host |
| --- | --- | --- |
| Where the key sits | A Worker secret: "You cannot see secrets after you set them"; the value is hidden in Wrangler and the dashboard | A file of mode 0600 in the folder's `keys/` (D73) |
| Who can read it directly | Nobody through the dashboard, Wrangler or the API, as documented | Root, the service's user, and anyone with a shell as either |
| Who can read it indirectly | Whoever can deploy code to that Worker: a member or token with Editor on that Worker, or Admin over Workers, can deploy code that reads its environment and sends it out (inferred from the roles) | Whoever can change the service's code or start a process as its user |
| A login left on the party's machine | Wrangler's OAuth token, by default in a plaintext file in Wrangler's configuration folder; `wrangler login --use-keyring` moves it to an encrypted file with the key in the OS keychain | An SSH key or a console login to the host |
| The provider | Cloudflare runs the code and holds the secret | The host's provider can read the disk and the memory |

Sources: [Pages bindings, secrets](https://developers.cloudflare.com/pages/functions/bindings/) and [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/) (documented); `docs/operations.md`, "Runtime secrets reach the Workers without a file on disk" (measured on Crow's own account); [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/) (documented: Editor "can read, update, deploy"; per-Worker roles since 2026-09-15); [wrangler login, OS keychain](https://developers.cloudflare.com/workers/wrangler/commands/general/#login) (documented).

**Conclusion (inferred).** The two are the same rung. On both, whoever controls the deploy controls the key, and an assistant that shares the person's machine and its login can reach the key either way. The Worker is better in two ways: the key never sits on a disk the party manages, and no API returns it. The host is better in one: it adds no provider beyond the one the party already chose. So the guide says what T-478's fifth criterion already asks: log Wrangler out after the deploy when an assistant shares the machine, or log in with `--use-keyring`.

## 5. A second shell around the same Worker, without the frozen paths

**What blocks a deploy of today's Worker on another domain (measured, `apps/hosted-sellers/`):**

- `src/worker.ts:161` refuses any `SELLER_URL` whose host is not `crow.direct`, and `:158` any path but `/agents/<slug>`.
- `src/worker.ts:204` writes "Crow runs this seller for its company" into every card.
- `src/deploy-plan.ts:17-18, 73-81` fix the zone, the routes, the operators and `workers_dev: false`.
- `src/bundle.ts:70` refuses the Node-only fields `port`, `journal` and `events`, which the setup's configuration carries (`examples/setup-seller.ts:341` writes `port`).

So the Handoff's "second shell around the same Worker" cannot reuse the Worker's Durable Object class: its checks are inside a private method.

**What a new shell can reuse unchanged (measured, the exports):** the adapter's core (`examples/seller-adapter-core.ts`, `createSellerAdapter`), and from `apps/hosted-sellers/src/` the storage layer (`journalStore`), the bundle check (`checkBundle`, `bundleSha256`) and the test-chain list (`TEST_CHAINS`). The bundle check refuses `port`, which the setup writes, so the new configuration writer drops the Node-only fields before calling it. Importing does not change a file, so the pilot's bundle and its SHA-256 stay the same by construction (inferred; T-478 keeps its criterion that measures it).

**The shell, in new paths (inferred; a sketch that T-478 designs in full):**

- A new app, for example `apps/own-seller/`: its own entry, its own Durable Object class with the seller's base address as an input and the hosted seller's refusal of any chain outside `TEST_CHAINS`, a card whose `operatedBy` says the party runs it, and a configuration writer that takes the account, the address (a `workers.dev` name or a route on the party's zone) and the operators.
- About 150 lines repeat `HostedSellerObject`'s start, alarm and routing logic (`src/worker.ts:132-279`). After the pilot's deploy, one task folds the two into one class with the address as a parameter.
- **How the Worker reaches the party's machine.** `setup.mjs` installs nothing (D73), so it cannot build a Worker. The Worker ships prebuilt, as a second file pinned by SHA-256 beside `setup.mjs`, the pattern of Blygger's prebuilt archive with a checksum (Blygger study, pattern 5). The seller's own configuration goes up beside it as a data module, since the pilot's template is over the 5 KB limit of a variable (ADR-0037). Wrangler itself comes from npm at a pinned version, a new package fetch the privacy table names.
- **It needs a public API.** A Worker cannot reach the sample API that T-472 serves on the loopback address. The first seller on a Worker sells its own API over HTTPS, so the shell follows T-483.

## 6. The new order, and what T-478 needs from T-477 first

**What T-478 needs from T-477, all independent of any host (inferred from T-477's criteria):**

1. The card's local check against the card's schema (T-474), failing a quote address without HTTPS.
2. `check --published <address>`: HTTPS only, no redirect, no private or loopback address, the other-origin flag, a fixed reason per check, no fetched text printed, no quote sent.
3. The rule that a published quote address is never open by default: a quote credential or `--open`, and the most quotes a day over all callers.
4. The card files for a page of the party's own domain.

**What stays T-477's:** the service unit, the proxy file with the card's paths, the root commands, `leave` for a service a person installed, and the measured run on a real host.

**The split (recommended).** T-478 builds parts 1 to 4 as its first step, since it goes first. T-477 then builds the host's files on top of them. A separate task for the check would serialize with both anyway, since each changes `site/setup.mjs` and its pinned hash.

**The order:**

| Before | After |
| --- | --- |
| T-483, T-475, T-476, T-477, then T-478 after the pilot's deploy | T-483, T-475, T-476, **T-478** (the check, then the Worker), **T-477** (the host) |
| T-478 depends on T-477 and the pilot's deploy | T-478 depends on T-483 and T-474, and runs after T-476 for the bundle |
| T-477 depends on T-483 and T-474 | T-477 depends on T-478, for the check |
| T-481 waits for T-479 and T-478 | Unchanged |

The pilot's freeze (D72, D73) holds: no task changes `apps/hosted-sellers`, `examples/seller-adapter-core.ts`, `examples/seller-adapter-api.ts` or `packages/` before the pilot's sellers are deployed.

## Litmus tests

- **Neutrality.** Neither path needs Crow's account or permission. The Worker path adds Cloudflare as the party's chosen provider, as a host adds its provider. Crow's own operators and test agents also run on Cloudflare, so one Cloudflare outage stops both a Worker seller and Crow's operators; the deal still ends by its deadline and the contract's escape hatch (inferred). Keeping T-477 lets a party pick a host off Cloudflare.
- **The hold.** Unchanged: the seller signs over the public API on either path.
- **Defended judgment.** Unchanged.

## Findings for T-478 to carry (Info)

- **Info · The free plan's CPU limit is untested for this Worker.** Measure a cold quote and a full deal on a free account; state the plan the guide names from that run.
- **Info · `workers.dev` subdomain on a new account.** Check for it before the first deploy and ask the person to set it, since Wrangler's own prompt cannot run without a terminal.
- **Info · The `CF-Worker` value on `workers.dev`.** Measure it with the operators' log, as T-478's fourth criterion already asks for the party's zone.
- **Info · Wrangler's login is a plaintext file by default.** The guide offers `--use-keyring` or a logout after the deploy.

## Recommendations and open questions

- **Adopt D75:** the Worker on the party's own Cloudflare account is the first way to go live, in new paths, after T-476; the host with Node is the second. Owner: the coordinator orders the tasks; Rafa may overrule.
- **For Rafa, when T-478's measured run is due:** a Cloudflare account that is not Crow's production account, free plan first. It is the same gate T-477 has for a host.
