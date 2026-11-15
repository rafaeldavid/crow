# T-488: The first way a seller goes live: a Worker on its own Cloudflare account, or a host with Node

- **Lane:** research (a decision and its research record; documents only)
- **Phase:** 2
- **Depends on:** nothing
- **Paths this task may touch:** `docs/research/2026-11-15-first-go-live-path.md` (new), `docs/research/README.md` (one row), `docs/decisions-today.md` (D75), `docs/tasks/T-477-setup-publish-own-host.md` and `docs/tasks/T-478-setup-own-cloudflare.md` (their header lines and Handoff), this file
- **Human gate:** no (documents only; nothing deployed, and no command that changes a Cloudflare account)
- **Status:** review
- **Agent/session:** a side session started by the coordinator on 2026-11-15
- **Roadmap row:** N160
- **Change kind:** 10 (research and decisions), with 2 (task files). No local checks beyond the documentation tests.
- **Review:** one `reviewer` pass.
- **Token budget:** a research pass at maximum effort, a target.

## Intent

Rafa asked on 2026-11-15 whether a seller's first way to go live, after its first local deal, should be one deploy of the seller Worker on its own Cloudflare account (T-478) rather than a Node service on a host it runs (T-477), since an assistant can drive a deploy more easily than a machine. This task answers from Cloudflare's own pages and the repository, records the answer as a decision, and changes the order and the dependencies of T-477 and T-478 to match. It builds and deploys nothing.

## Context

- The design: `docs/research/2026-11-15-setup-design.md`, "Where the signing part runs" and "Keys, secrets and limits".
- `docs/research/2026-11-15-blygger-study.md`, pattern 5; `docs/research/2026-11-15-setup-baseline.md`.
- The task files T-472, T-477, T-478, T-481 and T-483; `apps/hosted-sellers/` (read only).

## Acceptance criteria

- [x] A dated research record answers six questions, each claim labelled: what a vendor needs; where the seller lives without a domain on Cloudflare; what the person does by hand and what an assistant drives; who can read the key; whether a shell in new paths avoids the frozen paths; the new order.
- [x] A decision entry with the recommendation, adopted, which Rafa may overrule.
- [x] T-477's and T-478's dependencies, status and Handoff match the decision.
- [x] No `cf` or Wrangler command that changes a Cloudflare account.

## Out of scope

- Building T-477 or T-478, and any deploy.

## Evidence

- **Cloudflare's pages,** read 2026-11-15 through Cloudflare's documentation search: cited by address in the record (documented).
- **The Worker's bundle size** (measured): after `pnpm -r build`, `npx --yes wrangler@4.151.3 deploy --dry-run --outdir reports/scratch/t488-bundle --config apps/hosted-sellers/example/wrangler.jsonc` printed "Total Upload: 3805.28 KiB / gzip: 590.72 KiB". The dry run builds locally and exits; no account was read or changed.
- **A cold signature's time** (measured proxy): `node reports/scratch/t488-sign-cpu.mjs`, three runs on Node v22.22.2, Apple M1 Pro: the first EIP-712 signature 28.3, 29.8 and 32.4 ms of wall time, later ones 0.42 to 0.56 ms each. The script stays in `reports/scratch/`, uncommitted.
- **The frozen Worker's guard** (measured): `apps/hosted-sellers/src/worker.ts:161` refuses any seller address that is not `https://crow.direct`.
- **Documentation tests** (measured): `pnpm exec vitest run tests/decisions-status.test.ts tests/design-map.test.ts tests/cut-feature-alignment.test.ts tests/id-check.test.ts tests/secrets-refs.test.ts` passed, 5 files and 201 tests.

## Decisions

- D75 in `docs/decisions-today.md`.
- T-478 builds the parts of T-477 that need no host, since it now goes first, instead of a separate task: a separate task would run one at a time with both anyway, since each changes `site/setup.mjs` and its pinned hash.

## Handoff

The decision is recorded. The next work is T-483, then T-475 and T-476, then T-478, then T-477; the coordinator orders them. T-478's measured run needs a Cloudflare account that is not Crow's production account, free plan first, from Rafa.
