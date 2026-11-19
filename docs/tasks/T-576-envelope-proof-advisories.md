# T-576: the dependency scan passes again after the proof prototype's Rust crates

- **Roadmap row:** N181
- **Status:** review
- **Kind:** 11-adjacent: dependency-scan configuration (`osv-scanner.toml` files) and docs; no `.github/` change, no code change, no lockfile change
- **Started:** 2026-11-19, by the coordinator, after PR 720 (T-569) failed the dependency scan

## Intent

The dependency scan has failed every pull request that touches a `package.json` since T-541 merged its proof prototype. All of its findings are in that prototype's two Rust lockfiles. This task settles each finding by evidence, in this order:

1. bump the crate to a fixed version where the prototype's own dependencies allow it;
2. otherwise, name the parent crate that pins it;
3. say whether the vulnerable code is reachable in what the prototype runs.

What cannot be fixed gets the narrowest ignore the scanner allows, each with a reason and an end date at most 60 days out. The docs then say where the prototype stands.

## Acceptance criteria

- [x] Each finding is either bumped, with `cargo check` passing, or recorded with the parent crate that pins it and its reachability, each labelled measured or inferred.
- [x] Ignores are scoped to the two lockfiles only, by ID, and each has a reason and an end date no later than 2027-01-18. There is no folder-wide ignore.
- [x] `tools/envelope-proof/README.md` and `docs/audit/known-issues.md` say that the prototype is stopped, is part of nothing deployed, and carries these advisories until their dates.
- [x] The dependency scan passes on this pull request.
- [x] No `.github/` change; the missing trigger is in the Handoff for Rafa.

## Evidence

### Why the scan failed (measured)

- PR 720's `dependency scan` job (run 44622290469, 2026-11-19 21:47 UTC) found 9 packages with 9 known vulnerabilities. Every finding was a crates.io package in `tools/envelope-proof/Cargo.lock` or `tools/envelope-proof/methods/guest/Cargo.lock`.
- T-541 added both lockfiles (`d7715672`, 2026-11-18 20:16 UTC).
- The scan's pull-request trigger lists only pnpm and npm files and `osv-scanner.toml` (`.github/workflows/dependency-scan.yml`, `on.pull_request.paths`). So T-541's PR never ran it, but the scan reads every lockfile (`scan source --recursive ./`).
- The scan reads the `osv-scanner.toml` in each lockfile's own directory, with no fallback to parent directories (documented: osv-scanner's configuration page). The CI log shows only the root file loaded, so nothing covered the Rust lockfiles.

### Per finding

The paths below come from `cargo tree -i <crate>`, run in each lockfile's folder, and the bump attempts from `cargo update -p <crate> --precise <fixed> --dry-run` (cargo 1.100.0, both measured).

| Advisory | Crate | Lockfiles | Fix | Can it move? | Reachable? |
| --- | --- | --- | --- | --- | --- |
| RUSTSEC-2023-0071 (CVE-2023-49092), Marvin timing side channel, CVSS 5.9 | `rsa` 0.9.10 | host | 0.10.0 | No (measured): `rzup` 0.5.2 requires `rsa ^0.9`, and `risc0-zkvm` 3.1.0 requires `rzup ^0.5.2` | No (inferred): `rzup` uses `rsa` to sign and verify its own toolchain downloads (`src/distribution/signature.rs`); the prototype holds no RSA private key |
| RUSTSEC-2025-0055 (CVE-2025-58160; alias GHSA-xwfj-jgwm-7wp5), ANSI escapes in logs, CVSS 2.3 | `tracing-subscriber` 0.2.25 | host, guest | 0.3.20 | No (measured): `ark-relations` 0.5.1 requires `^0.2`, through `ark-groth16` 0.5.0, then `risc0-groth16` 3.0.6, then `risc0-zkvm` 3.1.0 | No (inferred): it serves Groth16 constraint tracing. The host proves succinct receipts only (`ProverOpts::succinct()`), and neither the host nor the guest names tracing or Groth16 (measured, grep) |
| RUSTSEC-2025-0141, unmaintained | `bincode` 1.3.3 | host | none | No fixed version | Used: the host writes and reads its receipt files with it, and `risc0-zkvm` depends on it. An unmaintained notice names no vulnerability |
| RUSTSEC-2026-0543, unmaintained | `chrono` 0.4.45 | host | none | No fixed version | Not built (measured): only `serde_with` names it, as an optional dependency, and `cargo tree -i chrono --target all -e all` finds it in no target's build graph |
| RUSTSEC-2024-0388, unmaintained | `derivative` 2.2.0 | host, guest | none | No fixed version | Compile-time only: a proc-macro, from `ark-crypto-primitives` 0.5.0 |
| RUSTSEC-2024-0436, unmaintained | `paste` 1.0.15 | host, guest | none | No fixed version | Compile-time only: a proc-macro, from `ark-ff` 0.5.0 |

**No released upgrade fixes them (measured, crates.io index, 2026-11-19, from the review).** There is no `risc0-zkvm` 4.x. In 5.0.0-rc.1, `rzup` 0.6 still requires `rsa ^0.9`, and `risc0-groth16` still requires `ark-groth16 ^0.5`, which brings `tracing-subscriber` 0.2 back. The fix needs `rzup` on `rsa` 0.10 and `risc0-groth16` on `ark-groth16` 0.6, neither released. Any upgrade would also change the guest's image ID, which a buyer pins (README, "Pin the image ID"), and need a new proof, the last of which took 2,813 s. No lockfile changed, so there is no `cargo check` to show.

### The scan on this pull request (measured)

Run 44628705771 at `b279a9dc`: "Loaded filter from" the root `osv-scanner.toml`, `tools/envelope-proof/osv-scanner.toml` and `tools/envelope-proof/methods/guest/osv-scanner.toml`; "Filtered 11 vulnerabilities from output"; "No issues found". So each file applies to its own lockfile. The scan reported the `tracing-subscriber` finding under GHSA-xwfj-jgwm-7wp5, and listed the RUSTSEC-2025-0055 entries as unused; both stay, in case the database changes which ID it reports. The root file's GHSA-fc5q-39xc-vjpf (picomatch, T-518) also shows as unused, which is T-518's to check.

### Changes

- `tools/envelope-proof/osv-scanner.toml`: seven entries, for the host's lockfile only.
- `tools/envelope-proof/methods/guest/osv-scanner.toml`: four entries, for the guest's lockfile only.
- Every entry ends on 2027-01-18, 60 days from 2026-11-19.
- Root `osv-scanner.toml`: a comment only, which says where the prototype's ignores live. It also starts the scan on this pull request, since the trigger lists the root file.
- `tools/envelope-proof/README.md`: one sentence in the State line.
- `docs/audit/known-issues.md`: row D-1 in section 3.

## Handoff

- **For Rafa, the missing trigger.** One line in `.github/workflows/dependency-scan.yml`, under `on.pull_request.paths`, after `- '**/package.json'`: `      - '**/Cargo.lock'`. With it, a PR that adds or changes a Rust lockfile runs the scan, as T-541's did not. A `.github/` change, so it waits for his word.
- **On 2027-01-18** the scan fails again on any PR that triggers it. If the prototype is still stopped then, delete `tools/envelope-proof` or renew the entries with a fresh reason. If it restarts, check first whether a released `rzup` takes `rsa` 0.10 and a released `risc0-groth16` takes `ark-groth16` 0.6; neither did on 2026-11-19.
- **For Rafa, the workflow's comment.** The header of `.github/workflows/dependency-scan.yml` says an ignore goes in the root `osv-scanner.toml`. Since the scanner reads only the config beside each lockfile, that is incomplete. It should say: put the ignore in an `osv-scanner.toml` beside the lockfile it concerns. By the same rule the root file does not cover `tools/one-click/package-lock.json` (inferred). A `.github/` change, so it goes with the trigger line.
- `osv-scanner` is not installed on the Mac, so the scan's result on this PR is the test.
