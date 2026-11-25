# T-620: December dependency pass

- **Lane:** infra
- **Phase:** 2
- **Depends on:** T-576 (the prototype's scan ignores), PR 782 (the dated `url` ignore)
- **Paths this task may touch:** `tools/envelope-proof/Cargo.lock`, `tools/envelope-proof/osv-scanner.toml`, this file
- **Human gate:** no. **Do not merge before 2026-12-04 23:03:07 UTC** (the 14-day rule). The pull request stays a draft until then.
- **Status:** review
- **Agent/session:** deps-december, 2026-11-25; branch `claude/deps-december-d1e0a7`
- **Roadmap row:** none (a dependency pass)

## What exists

Read on 2026-11-25 at `origin/main` `e0957759`.

- PR 782 let `RUSTSEC-2026-0592` through in `tools/envelope-proof/osv-scanner.toml` until 2026-12-05, because the fix was then 5 days old. The entry says to bump `url` to 2.5.9 and delete it.
- `url` is in one lockfile, `tools/envelope-proof/Cargo.lock`. No `Cargo.toml` names it. It arrives through `reqwest` and `tower-http`, under `bonsai-sdk`, under `risc0-zkvm` (`cargo tree -i url`). The guest's lockfile does not have it.
- Two low Dependabot alerts are open, 3 (host lockfile) and 4 (guest lockfile), both for `tracing-subscriber` 0.2.25. T-576 already ignores the advisory in both scan configs until 2027-01-18.
- The private log of 2026-11-25 (next steps, item 7) also asks for the pending Action and crate bumps that are 14 days old, and for an `id-check` exception proposal for Dependabot's pull requests.

## Intent

Move `url` to the fixed release and remove its dated ignore before it ends. For each open Dependabot alert, take the fix if it is 14 days old and can be installed. Otherwise record why it cannot move, and when to look again.

- **Inputs:** the two Rust lockfiles, the scan configs, the crates.io index, the OSV database.
- **Outputs:** a lockfile change, one ignore entry removed, this record.
- **Non-goals:** no workflow file change (`.github/` needs Rafa's word for each change); no change to the prototype's code or manifests; no other crate updates.

## Context

- The 14-day rule: `CLAUDE.md` (Cloudflare tooling), `pnpm-workspace.yaml` (`minimumReleaseAge`), `.github/dependabot.yml` (cooldown), PR 782.
- `tools/envelope-proof/README.md`: a prototype that is part of nothing deployed, stopped on 2026-11-19.

## Acceptance criteria

- [x] `url` is 2.5.9 in the only lockfile that has it, and no other crate moves except what 2.5.9 requires.
- [x] The `RUSTSEC-2026-0592` ignore is gone, and OSV reports no finding in either Rust lockfile that no ignore covers.
- [x] Each open Dependabot alert is bumped, or has a recorded reason and a date.
- [x] The Rust workspace builds and tests with the new lockfile.
- [x] `pnpm typecheck` and `pnpm test` pass.
- [ ] The merge happens at or after 2026-12-04 23:03:07 UTC.

## The merge date

| Crate | From | To | Published (crates.io index `pubtime`) | 14 days old |
| --- | --- | --- | --- | --- |
| `url` | 2.5.8 | 2.5.9 | 2026-11-20 23:03:07 UTC | 2026-12-04 23:03:07 UTC |
| `form_urlencoded` | 1.2.2 | 1.2.3 | 2026-11-20 23:02:49 UTC | 2026-12-04 23:02:49 UTC |

- On 2026-11-25 both releases are 5 days old, so this pass cannot reach `main` yet. `url` 2.5.9 requires `form_urlencoded` `^1.2.3`, so the two move together. 2.5.9 is the latest `url` release and the advisory's first fixed one (measured: crates.io index and OSV, 2026-11-25).
- The old ignore has `ignoreUntil = 2026-12-05`. If it ends at 00:00 UTC that day (inferred), a merge between 23:03:07 on 12-04 and 00:00 leaves no gap. That window is 57 minutes. A later merge is also safe for `main`, but from the end of the ignore until the merge, each pull request that runs the dependency scan fails on this finding.
- An earlier merge needs Rafa to overrule the 14-day rule for these two releases.

## Dependabot alerts 3 and 4: not bumped

`GHSA-xwfj-jgwm-7wp5` (low): `tracing-subscriber` below 0.3.20 can write ANSI escapes from untrusted input into logs.

- **The fix is old enough:** 0.3.20 was published on 2025-08-29 (measured, crates.io index).
- **It cannot be installed (measured, 2026-11-25).** `cargo update --dry-run -p tracing-subscriber@0.2.25 --precise 0.3.20` fails in both lockfiles. `ark-relations` 0.5.1 requires `^0.2`, through `ark-groth16` 0.5.0 and `risc0-groth16` 3.0.6 to `risc0-zkvm` 3.1.0.
- **No release moves it yet (measured, crates.io index, 2026-11-25).** `ark-relations` 0.6.0 (2026-04-26) requires `tracing-subscriber` `^0.3`, but the latest unyanked `risc0-groth16`, 3.0.6, requires `ark-groth16` `^0.5`. The latest unyanked `risc0-zkvm` is 3.1.0. The last 0.2 release is 0.2.25, so no patched 0.2 exists.
- **When:** at the end of the scan ignores, 2027-01-18, or earlier if RISC Zero releases a version on `ark-groth16` 0.6. The ignore entries and their reachability reasons stay as T-576 wrote them.
- Both alerts stay open on GitHub. Dismissing one changes repository state, so it is Rafa's.

## Out of scope

- Any `.github/` change.
- `picomatch` (`GHSA-fc5q-39xc-vjpf`, root `osv-scanner.toml`): no fixed release exists on 2026-11-25. The latest is 4.0.7, and OSV marks it affected (measured). That entry ends on 2026-12-18.
- The other `tools/envelope-proof` ignores, which end on 2027-01-18.

## Evidence

All on 2026-11-25, on the Mac.

- Measured: `cargo update -p url --precise 2.5.9` changed two packages, `url` and `form_urlencoded`: 4 lines added and 4 removed in `Cargo.lock` (versions and checksums).
- Measured: both new crates declare `build = false` and are not proc macros, so compiling them runs none of their code. `url` 2.5.8 and 2.5.9 differ under `src/` in `lib.rs`, `origin.rs`, `parser.rs` and `path_segments.rs`. A search of the changed lines for process, network, file, environment, FFI and `unsafe` constructs found none. `origin.rs` now takes a `blob:` URL's inner origin only for `http`, `https` and `file`. In `form_urlencoded`, `for_suffix` now clamps a too-large start position and no longer panics. Both crates name the same upstream commit, `ad1c66cb`. This was not a full audit of `lib.rs`, `parser.rs` or `path_segments.rs`.
- Measured: `cargo test --locked` in `tools/envelope-proof` exits 0 (cargo 1.100.0). It compiles `url` 2.5.9, the host, the statement and the guest. The three crates hold 0 tests, so this proves the build and nothing about behavior. No proof was generated: the README records 2,813 s for one, and the guest's lockfile did not change.
- Measured: a script asked OSV's `querybatch` about each registry package in both Cargo lockfiles and subtracted the ignored IDs. Host lockfile: 360 packages. Before the change, 8 findings, all ignored, `RUSTSEC-2026-0592` among them. After, 7 findings and 7 ignore entries, none uncovered, and no `url` finding. Guest lockfile: 174 packages, 4 findings, 4 ignore entries, unchanged.
- Not measured: OSV-Scanner itself. It is not installed on the Mac. The `dependency-scan` workflow's `paths` filter names no `Cargo.lock` and only the root `osv-scanner.toml`, so by its text this pull request does not start it (inferred).
- Measured: `pnpm typecheck`, `pnpm lint` and `pnpm validate:spec` pass.
- Measured: `pnpm test`: 314 test files passed and 28 skipped; 6,506 tests passed, 3 expected fail, 325 skipped, 0 failed. This run preceded this file. After writing it, the 6 test files that read task files, the design map or the prototype's folder passed (258 tests), and `scripts/id-check.mjs` passed.
- Not run: `forge test` (no contract changed) and the site build (no JavaScript dependency or bundle changed, so no pinned hash moves).
- Measured, GitHub Actions: no bump is pending. The releases pages of the 7 Action repositories CI uses show the pinned releases as the latest ones, with one exception: `actions/setup-java` is at 6.2.0, and Rafa closed the 6.3.0 bump (PR 616) as not needed. The pinned `foundry-toolchain` commit is both `v1` and `v1.9.2`.

## Decisions

- **Prepare the change now and hold the merge.** The alternative was to wait until 2026-12-04 and do the whole pass inside the 57-minute window. A draft pull request is ready ahead of it, and `main` takes nothing that is under 14 days old.
- **Compiling the new crates before day 14 was accepted** because neither runs code at build time. The crates' own code was not called on purpose: the test binaries hold no tests.
- **No other crate moves.** `cargo update` reports other dependencies behind their latest release. None has an uncovered finding, and the prototype is stopped.

## Handoff

- **State:** the change is complete and in a draft pull request. It waits for its date.
- **To resume:** at or after 2026-12-04 23:03:07 UTC, merge `main` into the branch if it moved, confirm that neither release was yanked (`https://index.crates.io/3/u/url` and `https://index.crates.io/fo/rm/form_urlencoded`) and that no newer advisory names either one, then mark the pull request ready and merge it after CI.
- **Proposal for Rafa 1, `id-check` and Dependabot (`.github/`).** Dependabot's pull requests name no task, so `id-check` fails them. Add to the `id-check` job in `.github/workflows/id-check.yml`: `if: github.event.pull_request.user.login != 'dependabot[bot]'`. It keys on the pull request's author, which a contributor's branch name or title cannot set. A person's commit pushed onto a Dependabot pull request would skip the check too.
- **Proposal for Rafa 2, the scan's path filter (`.github/`).** Add `'**/Cargo.lock'` and `'**/osv-scanner.toml'` to the `paths` of `.github/workflows/dependency-scan.yml`. Today a change to only a Rust lockfile or a nested scan config does not start the scan. A new Rust advisory appears only when an unrelated pull request starts it.
- **Later:** `picomatch`'s ignore ends on 2026-12-18; the Rust ignores end on 2027-01-18.
