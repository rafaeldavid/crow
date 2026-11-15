# T-477: Publish a seller on the party's own host, and the check for a live quote address and card

- **Lane:** demo (agent access: the guides in `site/` and the reference tools in `examples/`)
- **Phase:** 2
- **Depends on:** T-472 (the setup command), T-474 (the card's schema). Runs after T-476, because each changes the setup bundle.
- **Paths this task may touch:** `examples/setup-publish.ts` (new), `examples/setup-publish*.test.ts` (new), `examples/setup-check.ts` (the check of a live address), one entry in `examples/setup.ts`'s command table, the "Publish" section of `site/setup.txt`, `site/setup.mjs` (generated), this file. It reads `examples/seller-adapter.service`, `examples/seller-adapter.Caddyfile` and `examples/seller-adapter-service.md` as templates and may correct the Node version the last one names. It imports the seller adapter and changes none of it.
- **Human gate:** yes: the site deploy is Rafa's, and the one measured run on a real host needs a host and a hostname, which are Rafa's to provide. The merge has no gate.
- **Status:** todo
- **Agent/session:** not started; starts after T-476 merges
- **Roadmap row:** N160
- **Change kind:** 4 with 1. Local checks: `pnpm exec vitest run examples/setup`, `node site/build.mjs && node site/check.mjs`.
- **Review:** one `reviewer` pass. The task holds no new key path: the service reads the key file T-472 made. If it adds one, it takes a red-team pass too.
- **Token budget:** 150,000 tokens, a target.

## Intent

Restate this in your own words before writing code.

After a first deal from its own machine, a seller wants outside buyers. That takes a quote address they can reach over HTTPS and a card on a page of the seller's own domain. Today the recipe is a document with 5 install lines, 2 hand-written files, 4 service commands, and a card written by hand that the shipped proxy file answers 404 for (baseline).

This task makes it two steps on a host the party controls:

- **`node setup.mjs publish --host <hostname>`** writes, into the folder, the service unit, the proxy file with the card's paths served, and the card files for that hostname. It prints the exact commands that install them, for a person with root to run. It installs nothing itself.
- **`node setup.mjs check --published https://<hostname>/`** reads the live card and defaults and says whether an outside buyer finds what the party meant to publish. It also runs alone against any quote address and card, so a seller built from the spec can use it.

Non-goals: a deploy on a cloud account (T-478); DNS or certificates beyond what the proxy does by itself; service files for macOS or Windows (deferred).

## Context

- The design: `docs/research/2026-11-15-setup-design.md`, "Where the signing part runs", "The conformance check".
- Today's recipe and its gaps: `examples/seller-adapter-service.md`; `docs/research/2026-11-15-setup-baseline.md`, "Path a, step by step".
- The card and its schema: T-474; `site/ref/intake.txt`.

## Acceptance criteria

- [ ] `publish --host <hostname>` writes the service unit, the proxy file and the card files, with the hostname in each, and prints the install commands. The proxy file serves the card page and `agent.json` beside `/quote` and `/defaults`. Run again, it writes the same bytes.
- [ ] The service starts the seller from the folder T-472 made: the configuration, the key file (never an environment line with the key in a file the assistant wrote), and the journal. The command names a payout address the person gave, or says that none is set and what that means.
- [ ] `check --published <address>` fetches the card over HTTPS, checks it against the card's schema, fetches `defaults`, and compares it with the local configuration. It follows no redirect to another host. It prints one JSON line per check.
- [ ] Against a seller built by hand (the test starts one from `ref/http-seller.txt`'s shapes), `check --published` passes a right card and fails, naming the cause: a card with no quote address, a quote address on another host than the card's, a `defaults` that is not JSON, a plain-HTTP address.
- [ ] The check sends no quote: asking for a price would make an offer and call the faucet. It says so, and points to `first-deal` for a deal.
- [ ] `site/setup.txt`'s "Publish" section fits in the file's 8,000-byte limit.
- [ ] One measured run on a real host, by hand: the commands, the person's steps and the minutes from `publish` to a passing `check --published`, in Evidence. If no host is available, Evidence says so and the task stays in review.

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

Not started. Starts after T-476 merges, because each changes the bundle `site/setup.mjs` and its pinned hash.
