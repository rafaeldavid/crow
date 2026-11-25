# T-606: a published seller command that runs from a config file

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-331, T-472
- **Paths this task may touch:** `examples/serve.ts`, `examples/serve.test.ts`, `site/serve-entry.mjs`, `site/serve.mjs`, `site/ref/serve.txt`, `site/build.mjs`, `site/check.mjs`, `site/llms.txt` (the Reference list), `site/ref/seller-adapter.txt` (one pointer), `tests/site-bundles.test.ts`, `eslint.config.js` (the ignore list); this file.
- **Human gate:** no. The site deploy waits for Rafa.
- **Status:** review
- **Agent/session:** p17-seller-config, 2026-11-25; branch `t-606-serve-command`
- **Roadmap row:** N167
- **Change kind:** 4 (a published client command and its guide); the local checks named by the brief, and one reviewer

## What exists

- `examples/seller-adapter.ts` runs the adapter from a config file (T-331), from a clone that is installed and built.
- `site/setup.mjs` carries the adapter, but no command in it takes a seller's config file. Its check accepts only its own loopback API and refuses `quoteAuth`, and its first line removes every `CROW_*` variable.
- `site/take.mjs` takes a standing offer, which cannot cover work that depends on the buyer's order.
- Still needed: one pinned file that runs the adapter from a config file.

## Intent

Publish `serve.mjs`: `node serve.mjs <seller.json>` runs the seller adapter, unchanged, from one hash-pinned download, with the adapter's own environment variables. It keeps every variable the config names and every start check, and it loads no code at run time. No existing pinned file changes. Non-goals: a new adapter setting, a change to the adapter, a deploy.

## Acceptance criteria

- [x] A configuration that a program generates for one order runs against the pinned file on a local world and ends Released.
- [x] No existing pinned hash changes.
- [x] The file loads no code at run time, keeps the config's token variables, and runs the adapter's own start checks.
- [x] The hash is pinned in the site check and in a guide, `site/ref/serve.txt`; both first-deal budgets still pass.

## Decisions

- A new entry, not a `setup.mjs` command, so `setup.mjs` keeps its hash. `seller-adapter.ts` is not edited, since `setup.mjs` bundles it.
- The file carries no deal template. A config without `template` is refused: the adapter's shipped template is a file beside its source, for one sample product.
- One check added: every pinned chain is Sepolia or 31337, as `take.mjs` does. The adapter alone accepts any chain `HOLDBACK_DEPLOYMENT` pins, and this file is published to run beside a seller's key.
- It removes `NODE_TLS_REJECT_UNAUTHORIZED`, as `take.mjs` does, and nothing else.
- No `--sim`: that mode needs a running `pnpm sim`, which needs the repository.
- The guide has a Windows PowerShell install line, since Windows has no `shasum`.
- No salt unless the file sets `reportSalt`. The adapter takes a template beside its own file for the shipped one, which inside one bundled file means the download folder.
- A call that starts nothing ends the process at once, as the adapter's own command line does.

## Evidence

EVIDENCE_PENDING

## Out of scope

- A check kind this tree does not evaluate yet: the file carries the check library as it is when built.
- The adapter's log line that names `node examples/seal.ts` for a delivery by hand: changing it changes `setup.mjs`'s hash. The guide says to set `redelivery`.

## Handoff

EVIDENCE_PENDING
