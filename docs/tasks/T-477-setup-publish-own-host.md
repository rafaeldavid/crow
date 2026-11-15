# T-477: Publish a seller on the party's own host, and the check for a live quote address and card

- **Lane:** demo (agent access: the guides in `site/` and the reference tools in `examples/`)
- **Phase:** 2
- **Depends on:** T-478 (the card's local check, `check --published`, the quote-credential rule and the card files, which it builds first), T-483 (a seller's own API), T-474 (the card's schema). Runs after T-478, because each changes the setup bundle (D75).
- **Paths this task may touch:** `examples/setup-publish.ts` (new), `examples/setup-publish*.test.ts` (new), `examples/setup-check.ts` (the card's check and the check of a live address), `examples/setup-leave.ts` (stopping what `publish` wrote), one entry in `examples/setup.ts`'s command table, the "Publish" section of `site/setup.txt`, `site/setup.mjs` (generated), this file. It reads `examples/seller-adapter.service`, `examples/seller-adapter.Caddyfile` and `examples/seller-adapter-service.md` as templates and may correct the Node version the last one names. It imports the seller adapter and changes none of it.
- **Human gate:** yes: the site deploy is Rafa's, and the one measured run on a real host needs a host and a hostname, which are Rafa's to provide. The merge has no gate.
- **Status:** todo. The second way a seller goes live, after the Worker on its own Cloudflare account (D75).
- **Agent/session:** not started; starts after T-478 merges
- **Roadmap row:** N160
- **Change kind:** 4 is the nearest recipe, with 1. Local checks: `pnpm exec vitest run examples/setup`, `node site/build.mjs && node site/check.mjs`.
- **Review:** one `red-teamer` pass (a seller open to the internet: who can spend its work; a check that fetches addresses a stranger names) and one `reviewer` pass.
- **Token budget:** 150,000 tokens, a target.

## Intent

Restate this in your own words before writing code.

After a first deal from its own machine, a seller wants outside buyers. That takes a quote address they can reach over HTTPS and a card on a page of the seller's own domain. Today the recipe is a document with 5 install lines, 2 hand-written files, 4 service commands, and a card written by hand that the shipped proxy file answers 404 for (baseline).

This task makes it two steps on a host the party controls:

- **`node setup.mjs publish --host <hostname>`** writes, into the folder, the service unit, the proxy file with the card's paths served, and the card files for that hostname. It prints the exact commands that install them, for a person with root to run. It installs nothing itself.
- **`node setup.mjs check --published https://<hostname>/`** reads the live card and defaults and says whether an outside buyer finds what the party meant to publish. It also runs alone against any quote address and card, so a seller built from the spec can use it.

**A published seller gives real work to whoever can ask.** On the test service a buyer pays nothing real: anyone can take test tokens from the faucet and fund a deal, and the adapter starts a job at the party's API for every funded deal. With a fresh key for each deal, every quote also spends one of the seller's faucet grants. So `publish` never leaves the quote address open by default.

Non-goals: a deploy on a cloud account (T-478); DNS or certificates beyond what the proxy does by itself; service files for macOS or Windows (deferred).

## Context

- The design: `docs/research/2026-11-15-setup-design.md`, "Where the signing part runs", "Keys, secrets and limits", "The conformance check".
- Today's recipe and its gaps: `examples/seller-adapter-service.md`; `docs/research/2026-11-15-setup-baseline.md`, "Path a, step by step".
- The card and its schema: T-474; `site/ref/intake.txt`.

## Acceptance criteria

- [ ] `publish --host <hostname>` writes the service unit, the proxy file and the card files, with the hostname in each, and prints the install commands. The proxy file serves `agent.json` and the card page beside the quote and defaults addresses. Run again, it writes the same bytes.
- [ ] **The quote address is never left open by default.** `publish` exits 3 with the question until the person has chosen a quote credential for buyers, or passed `--open`. With either it also asks for the most quotes a day over all callers and writes that limit. With `--open` it prints what an open address costs: any caller can start jobs at the party's API with test tokens and can use up its faucet grants. The guide says the same.
- [ ] The service starts the seller from the folder T-472 made: the configuration, the key file, the journal. No file the command writes for the service holds a key's or a secret's value; a test reads them.
- [ ] **The card's local check.** `check` validates the folder's `agent.json` against the card's schema (T-474) and fails on a card that lists a quote address without HTTPS.
- [ ] **The check of a live address is safe to point anywhere.** `check --published <address>` fetches `agent.json` over HTTPS, never the HTML page. It follows no redirect. It refuses a quote or defaults address on another origin than the card's, unless the person names that origin with a flag (a page on a domain's apex with a Worker on a subdomain needs it). It refuses any address that resolves to a loopback, private or link-local address. It prints pass or fail with a fixed reason for each check, and never the fetched text.
- [ ] Against a seller built by hand (the test starts one from `ref/http-seller.txt`'s shapes), `check --published` passes a right card and fails, naming the cause: no quote address; a quote address on an unnamed other origin; a defaults address that redirects; a defaults answer that is not JSON; a plain-HTTP address; a hostname that resolves to a private address.
- [ ] The check sends no quote: asking for a price would make an offer and call the faucet. It says so, and points to `first-deal` for a deal.
- [ ] **`leave` after `publish`.** `leave` fetches the published quote address and exits with an error while it still answers, printing the commands a person with root runs to stop and remove the service. It removes the files `publish` wrote in the folder.
- [ ] Each deal record of a published seller keeps the card's address, the quote address and the SHA-256 of the card and of the defaults at the time of the offer.
- [ ] `site/setup.txt`'s "Publish" section fits in the file's 8,000-byte limit, and says what binds an offer to the party's domain: TLS at the quote address, and nothing else unless the card lists a standing address.
- [ ] One measured run on a real host, by hand: the commands, the person's steps and the minutes from `publish` to a passing `check --published`, in Evidence. If no host is available, Evidence says so and the task stays in review.
- [ ] The red-team pass tries to: start jobs at a published seller with no credential; use up its faucet grants from one address; turn `check --published` on a private address or get fetched text printed; point a card at a third party's quote address. Each fails, or the finding and its fix are in Evidence.

## Out of scope

- Limiting quotes per client address: the proxy's own setting, as today's recipe says.
- A quote credential's hand-over to a buyer. It stays out of band; the guide says how a person passes it without the chat.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- The measured run on a real host:

## Decisions

Choices made inside this task.

## Handoff

Not started. Starts after T-478 merges, because each changes the bundle `site/setup.mjs` and its pinned hash (D75; `docs/research/2026-11-15-first-go-live-path.md`).

- **T-478 builds the parts of this task that need no host,** and this task reuses them: the card's local check (the fourth criterion), `check --published` and its tests against a hand-built seller (the fifth, sixth and seventh), the rule that the quote address is never open by default (the second), and the card files. Check each of those criteria against T-478's merged code and mark it there; build only what is missing.
- **What stays here:** `publish --host` with the service unit, the proxy file with the card's paths, the printed root commands, the configuration the service starts from, `leave` after a service a person installed, the deal record's card fields if T-478 did not add them, the "Publish" section's host part, and the measured run on a real host.
