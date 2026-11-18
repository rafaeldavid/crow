# T-518: Install rules for dependencies

- **Lane:** infra
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `pnpm-workspace.yaml`, `tests/install-rules.test.ts`, the scripts and standing docs that run `npx wrangler`, `docs/team.md` (one Rules and checks row), this file; part 2 only: `.github/workflows/` in its own pull request
- **Human gate:** part 1 no; part 2 yes (a `.github/` change, Rafa's word per change)
- **Status:** in progress
- **Agent/session:** T-518 side session of the 2026-11-18 coordinator
- **Roadmap row:** N181

## Intent

The security review of 2026-11-18 found the largest gap in how outside code reaches Crow's build. A package version published a minute ago installs at once, and any dependency may run an install script. This task makes the package manager refuse both, by its own settings, with a test that fails if the settings go. It pins the one outside tool the deploy scripts fetched by major version only. Part 2 prepares, for Rafa's yes, a CI scan of every pull request that changes dependencies. Non-goals: no dependency upgrades, no lockfile change, no product code, no new tool where a setting does the job.

## Context

- Rafa, 2026-11-18: "The dependency checks are the largest gap from the security review. The install rules (a 14-day age limit and an install-script allowlist) can be built now. The scan workflow would come to you as a pull request, and the GitHub app is yours to install."
- The 14-day age already rules two other places: the `cf` pin (`CLAUDE.md`, Cloudflare tooling) and Dependabot's cooldown for Actions (T-504, PR 630).
- pnpm is pinned at 12.16.1 (`package.json`, `packageManager`). The setting names below come from that version's own `CHANGELOG.md` in the corepack cache, and each was proved by a run (Evidence).

## Inventory: where outside code enters, on 2026-11-18

| Where | What runs | Pinned? | After this task |
| --- | --- | --- | --- |
| CI `static`, `test` (4 shards) and `anvil` jobs, `walkthrough.yml` | `pnpm install --frozen-lockfile` | yes: the lockfile, 176 entries (measured, pnpm's own count), integrity hashes | the age rule and the script allowlist apply, lockfile included |
| pnpm itself | `pnpm/action-setup` reads `packageManager: pnpm@12.16.1`; corepack locally | yes, exact version | unchanged |
| GitHub Actions | 9 distinct Actions in 3 workflows | yes, each by commit; Dependabot waits 14 days (T-504) | unchanged |
| Foundry in CI | `foundry-rs/foundry-toolchain` with `version: v1.0.0` | yes, by version | unchanged |
| Contracts library | git submodule `contracts/lib/commerce-payments` | yes, by commit `6b0a5ef3` | unchanged |
| Deploy, secrets, dev and tail scripts (`scripts/deploy-lib.mjs`, `apps/demo-cloud/scripts/*`, `apps/early-access/deploy.mjs`, `apps/test-agents/scripts/*`, `site/deploy.mjs`, `tools/one-click/run.mjs`) | `npx -y wrangler@4 …`, with Rafa's Cloudflare login | **no: newest 4.x at each run** | `npx -y wrangler@4.151.3`, published 2026-10-20 (measured, npm registry), the version `apps/hosted-sellers` already used |
| Printed rollback hints and standing runbooks (`docs/operations.md`, `docs/cutover-phase-one.md`, `docs/redeploy-contracts.md`, `config/secrets/cloudflare.refs`, two code comments, `tools/one-click/README.md`) | `npx wrangler@4 …` commands Crow tells Rafa to run | no | pinned to `4.151.3`; dated task files and research keep their record as written |
| `pnpm cf` | `npx -y cf@1.0.0-beta.26` | yes, exact | unchanged |
| `apps/hosted-sellers` deploys and local runs | `npx --yes wrangler@4.151.3` | yes, exact | unchanged |
| `tools/one-click` (the One-Click harness, live runs only) | `npm ci --ignore-scripts --prefix tools/one-click`, outside the pnpm workspace, so pnpm's rules do not reach it | yes: its own `package-lock.json` (112 packages, measured) with `@anthropic-ai/claude-agent-sdk` at an exact version; scripts off | unchanged; part 2's scan reads this lockfile too |
| `apps/operator/scripts/mutants.mjs` | `npx vitest` | resolves the workspace's own vitest from `node_modules/.bin` (inferred) | unchanged |
| The site's buyer command (`site/build.mjs`) and `docs/redeploy-contracts.md` step | `npm install --ignore-scripts viem@<exact> tweetnacl@<exact>`, then `curl` of `buy.mjs` checked by SHA-256 | yes, exact versions, scripts off, file hash checked | unchanged |
| The site's try, goal and setup commands | `curl` of one `.mjs`, checked by SHA-256 before it runs | yes, by hash | unchanged |
| `formal/check.sh` | `curl` of `tla2tools.jar` v1.7.4 and a JRE | yes, each by SHA-256 | unchanged |
| `infra/party/provision.sh` | `curl` of a Node tarball and `SHASUMS256.txt` from the same host | the hash is checked, but the hash file comes from the same host and its signature is not checked | Handoff |
| `infra/dev-host/setup-admin.sh` | Homebrew's **latest** installer package | prints `pkgutil --check-signature`; the latest release, not a pinned one | Handoff |
| Piped into a shell | none in a script or a doc (measured: `git grep` for `curl … \| sh`, `wget … \| sh`); the one hit is test data in `apps/test-agents/src/try.test.ts` that checks an injected line is printed harmlessly | — | — |
| Install scripts in the lockfile | none: 0 packages with a `preinstall`, `install` or `postinstall` script or a `binding.gyp` among 152 installed packages (measured, a scan of `node_modules/.pnpm`). 16 packages carry a `prepare` script, which pnpm does not run for registry packages | — | the allowlist starts empty |

## Acceptance criteria

- [x] Inventory of every place the repo installs or runs outside code (above).
- [x] Installs refuse a version published less than 14 days ago, in pnpm's own settings; a younger security fix gets in by a named, dated exception. Proof: a planted too-new version is refused, and the current lockfile still installs with `--frozen-lockfile`.
- [x] Only named packages may run an install or build script. Proof: a planted package with an install script is refused and its script does not run.
- [x] The unpinned `npx wrangler@4` calls are pinned to one exact version.
- [x] One row in the Rules and checks table, and a test that fails if the settings are removed.
- [x] Part 2: a scan of dependency changes as its own pull request under `.github/` (PR 642), open and unmerged, for Rafa's yes.
- [x] Handoff: the two steps only Rafa can take.

## Out of scope

- Dependency upgrades and lockfile changes: none were needed (measured: `git diff` shows no change to `pnpm-lock.yaml`).
- `trustPolicy: no-downgrade` (refuses a version published with weaker provenance than earlier ones, the mark of a stolen publish token): a further pnpm setting, left for a later choice (Handoff).

## Evidence

All runs on Rafa's Mac on 2026-11-18 with pnpm 12.16.1 and Node 22.22.2, `CI=true` (no prompts, as in CI). The probes live under `reports/scratch/t-518/` (gitignored), each a standalone project with its own `pnpm-workspace.yaml` carrying the same settings as the repository's.

- **The age rule refuses a too-new version (measured).** Probe `age/` asks for `typescript-eslint@8.73.0`, published 2026-11-16T17:07Z, 2 days before the run. `pnpm install` exits 1 with `ERR_PNPM_NO_MATURE_MATCHING_VERSION`: "11 versions do not meet the minimumReleaseAge constraint", naming `typescript-eslint@8.73.0` and its ten `@typescript-eslint/*@8.73.0` packages against the cutoff 2026-11-04T10:11Z.
- **The exception path works (measured).** The same probe with those 11 exact `name@version` entries under `minimumReleaseAgeExclude` exits 0 and installs `typescript-eslint 8.73.0`. A name pattern with a version (`'@typescript-eslint/*@8.73.0'`) is refused by pnpm itself: "Name patterns are not allowed with version unions".
- **The current lockfile still installs (measured).** In this worktree, with `node_modules` removed and an empty cache directory: `pnpm install --frozen-lockfile` exits 0. pnpm prints "Lockfile passes supply-chain policies (176 entries in 4.7s)" and installs 152 packages in 5.4 s wall time. `pnpm-lock.yaml` is unchanged.
- **The allowlist refuses an install script, registry package (measured).** Probe `reg/` asks for `esbuild@0.20.2`, which has a `postinstall` script. `pnpm install` exits 1 with `ERR_PNPM_IGNORED_BUILDS`: "Ignored build scripts: esbuild@0.20.2".
- **The allowlist refuses an install script, planted package (measured).** Probe `build/` depends on a local package `planted` whose `postinstall` writes a file named `SCRIPT-RAN`. `pnpm install` exits 1 with `ERR_PNPM_IGNORED_BUILDS` ("Ignored build scripts: planted@file:planted"), and no `SCRIPT-RAN` file exists. With `'planted@file:planted': true` under `allowBuilds`, the install exits 0 and `SCRIPT-RAN` appears: the allowlist is the only way in.
- **pnpm 12's defaults already refuse unapproved builds (measured):** the first `build/` run, with only `minimumReleaseAge` set, failed the same way. `strictDepBuilds: true` is written anyway, so a change of default in a later pnpm cannot open it, and the test can hold it.
- **The test bites (measured).** `pnpm exec vitest run tests/install-rules.test.ts`: 7 of 7 pass on the branch. Its own cases remove `minimumReleaseAge`, lower it to 1,440 minutes, remove `strictDepBuilds` or `allowBuilds`, add `dangerouslyAllowAllBuilds` or `minimumReleaseAgeStrict: false`, and add a bare-name, range or pattern exception; each is reported. It accepts only six top-level keys and one line shape under each, so a quoted or indented `dangerouslyAllowAllBuilds`, a flow-style block, `trustLockfile`, `minimumReleaseAgeIgnoreMissingTime` or `pnpmfile` fails it, and it fails if a pnpmfile exists. The review found the first version passing with a quoted key and with `trustLockfile: true`, and failing on its own `docs/team.md` row; both are fixed.
- **Nothing the pin touches broke (measured).** After `pnpm typecheck` (which builds): the deploy and deploy-plan tests (`apps/test-agents/src/deploy.test.ts`, `tests/early-access-deploy.test.ts`, `tests/site-deploy.test.ts`, `apps/demo-cloud/src/deploy-preflight.test.ts`, `apps/hosted-sellers`), `examples/e2e-scenarios-direct.test.ts` and the new test: 9 files, 119 tests passed, 4 skipped, in 67.8 s.
- **Part 2's scan fails on a planted bad package and passes without it (measured, PR 642).** Run 44285712932 on a commit that planted a lockfile naming `flatmap-stream@0.1.1` and `lodash@4.17.20` failed (exit code 1). It reported "2 packages affected by 7 known vulnerabilities", including `MAL-2025-20690` (malicious code in flatmap-stream) and 4 lodash advisories. Run 44286139129, after the plant was removed, passed: 191 packages in `pnpm-lock.yaml` and 109 in `tools/one-click/package-lock.json`, 1 finding filtered by `osv-scanner.toml`, "No issues found". A first plant under `reports/` was not read, because the scanner skips gitignored paths (measured, run 44285360646).
- **Cost (inferred):** CI has no verification cache, so each of its 6 `pnpm install` runs adds about 5 s for the lockfile check, from the 4.7 s measured locally.

## Decisions

1. **pnpm's own settings, no new tool.** `minimumReleaseAge: 20160` (14 days in minutes) and `strictDepBuilds: true` with `allowBuilds: {}`. Setting `minimumReleaseAge` explicitly makes pnpm strict (changelog, 12.x: "`minimumReleaseAgeStrict` now defaults to `true` when `minimumReleaseAge` is explicitly configured"); the built-in 1,440-minute default is not strict.
2. **Exceptions are exact `name@version` entries with a dated comment,** removed once the version turns 14 days old. The test refuses bare names, ranges and patterns, since a bare name would exempt every future version.
3. **`allowBuilds`, not `permissions`.** pnpm 12.11 added `permissions`, which takes precedence over `allowBuilds`; the test refuses a `permissions` key so the allowlist stays in one place.
4. **Wrangler at 4.151.3,** the exact version the hosted-seller deploys already ran, public for 29 days. One version in every file, held by the test; the newest version older than 14 days was 4.157.0, a move left for a deploy session to make and test.
5. **Part 2 uses OSV-Scanner, not GitHub's dependency review action.** OSV's database carries the OpenSSF malicious-packages records for npm (`MAL-…` IDs; measured: a query for `flatmap-stream@0.1.1` returns `MAL-2025-20690` beside two GitHub advisories). The dependency review action's README (v5.0.1) does not mention malicious packages. OSV-Scanner also reads both lockfiles directly and needs no account or token. The repository allows only selected Actions, which refused a Docker step at startup (measured: runs 44285104293 and 44285129764), so the workflow downloads the v2.7.0 release binary and refuses it unless its SHA-256 matches the pinned hash; the release's `SHA256SUMS` and GitHub's asset digest give the same hash (measured).
6. **One existing finding is ignored, with an end date.** The first scan of `main` found GHSA-fc5q-39xc-vjpf, a High ReDoS in `picomatch` 4.0.7 that GitHub reviewed on 2026-11-17, with no fixed version. Only ESLint and vitest reach it, matching globs this repository writes (measured: `pnpm why picomatch`). Part 2's `osv-scanner.toml` lets it through until 2026-12-18, with that reason, and the scan fails again after that date.

## Handoff

**Done:** part 1 (PR 641). **Open:** part 2, PR 642, a draft for Rafa's yes. It adds `.github/workflows/dependency-scan.yml` and `osv-scanner.toml`. It is not a required check; adding it to the `main` ruleset is a separate settings change.

**Rafa's two steps:**

1. **Socket's GitHub app (recommend: yes, after part 2 has run for a week).** What it adds over part 2: OSV only knows a package once someone has reported it. Socket reads each new or changed package when a pull request adds it and flags behaviour before any advisory exists. Its alerts include malware, possible typo-squats, install scripts, telemetry, native code, bin-script shell injection, git and HTTP dependencies, obfuscated code and use of shell, network, filesystem or environment variables (https://docs.socket.dev/docs/socket-for-github-installation.md, https://docs.socket.dev/docs/socket-for-github). Access, from https://docs.socket.dev/docs/permissions.md: on the repository, **contents read and write**, **pull requests read and write**, checks read and write, issues read, merge queues read, metadata read; members read on the organization; email addresses read on the account. Contents and pull-request write exist for Socket's patch pull requests, and the page says Socket never reads, collects or analyzes source code. That write access is wider than the scan needs; the `main` ruleset (pull request required, no bypass) still stops it from changing `main` by itself (inferred). The GitHub Marketplace page lists a free plan. Steps: open https://github.com/apps/socket-security/installations/new, pick **Only select repositories**, choose `rafaeldavid/holdback`, compare GitHub's approval screen with the list above, approve. The pages read do not say whether a Socket account is needed.
2. **OpenSSF Scorecard (recommend: no for now).** It publishes a public score of the repository's protections, such as branch protection, pinned Actions, token permissions and review. Its workflow needs `security-events: write` and `id-token: write` to publish, wider than the read-only rule, and `publish_results: true` sends the result to the Scorecard API (https://api.scorecard.dev), replacing OpenSSF's own weekly scan of the repository (https://github.com/ossf/scorecard-action). It is free for public repositories. Crow already passes most of its checks under its own rules (inferred). Revisit before a public audit or a mainnet launch. If yes: say so, and a session adds `ossf/scorecard-action` pinned by commit in its own pull request, for your word.

**Follow-ups found, not done (for the triage file):**
- `infra/party/provision.sh` checks the Node tarball against `SHASUMS256.txt` from the same host; checking the signed `SHASUMS256.txt.asc` would make it a real authenticity check.
- `infra/dev-host/setup-admin.sh` installs Homebrew's **latest** release and prints its signature; pin a version, or fail unless the signature names Homebrew's developer ID.
- `trustPolicy: no-downgrade` in pnpm would refuse a version published with weaker provenance than the versions before it.
- Wrangler 4.151.3 can move to a newer version once a deploy session tests it; change every file at once.

**To resume:** nothing is half done in part 1. For part 2, see its pull request.
