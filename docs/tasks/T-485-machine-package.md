# T-485: The machine package, part 1: the development host and a simulated party's machine

- **Lane:** infra
- **Phase:** 2
- **Depends on:** T-484 (the decision record, crow-private `strategy/2026-11-15-dev-infrastructure-decision.md`); T-480 (the keys' move to 1Password: `config/secrets/`, `scripts/secrets/`)
- **Paths this task may touch:** `infra/dev-host/`, `infra/party/`, `config/secrets/dev-host.refs`, `scripts/secrets/refs.mjs` and `scripts/secrets/copy.mjs` (one rule each: a second vault for `dev-host.refs` only; Decisions, 1), `tests/secrets-refs.test.ts`, `tests/infra-*.test.ts`, `docs/operations.md` (one section, "Machines"), this file. In crow-private: `company-ops/dev-host/README.md`, `company-ops/dev-host/keys.md`.
- **Human gate:** yes. Rafa reviews and approves both pull requests himself: he runs these files as administrator and with his keys. Agents do not merge them. Every real run (the Mac mini's setup, the team test, a party machine) is his.
- **Status:** done (pull request 583, merged 2026-11-15 as `7bc91f05`, with crow-private pull request 88). The development host's check, the red-team pass and the audit's fixes are not done; how they get done is Rafa's decision (roadmap row N161)
- **Agent/session:** a sub-session of the coordinator, 2026-11-15
- **Roadmap row:** N161
- **Change kind:** infrastructure that carries secrets and access. Local checks: `shellcheck`, `bash -n`, `pnpm exec vitest run tests/infra-dev-host.test.ts tests/infra-party.test.ts tests/secrets-refs.test.ts tests/secrets-scripts.test.ts`, ESLint on the new files. One `reviewer` pass and one `red-teamer` pass.

## Intent

Today every agent session runs as Rafa's own macOS user, so each separation between an agent and his logins is a rule the agent is asked to follow (T-480's red team, measured). The decision record moves development to a Mac mini that holds only Crow, with sessions under a Standard user `crow`, and rents throwaway machines for simulated sellers and buyers at DigitalOcean. This task writes the files that make those separations real, so that Rafa's part is to read them, copy them at the commit he approved, and run them.

- **Inputs:** sections 2, 5 and 6 and "Not verified" of the decision record; T-480's references files and scripts; the tool versions the repository already pins (`.nvmrc`, `package.json`, `.github/workflows/ci.yml`).
- **Outputs:**
  - `infra/dev-host/`: the administrator's setup, the session user's setup (macOS, or Ubuntu 24.04 as the fallback host), the managed settings with deny rules, a wrapper that hands a command the host's keys, the nightly memory push, and `check.mjs`, which runs every "must fail", "must be absent" and "must pass" line of the record and exits non-zero when an attack works or a control fails.
  - `infra/party/`: the party machine's `cloud-init.yaml`, `up.mjs`, `down.mjs`, `sweep.mjs`, the party's check, and the two commands of move step 4 (the test that the `crow-parties` token stops at its own team).
  - `config/secrets/dev-host.refs`: the three items of the vault the development host reads, by name.
  - `docs/operations.md`, "Machines"; the runbook and key list in crow-private.
- **Every privileged file** prints the commit it came from and the SHA-256 of each file it runs, then waits for a typed `yes`. No file holds a secret, a real address, a workspace ID, a partner's name or Rafa's email.
- **Parameters, not assumptions:** the Mac mini's model and memory (measured by the script, with a floor), the network (home, guest or its own), the link (Ethernet or Wi-Fi), and the host's operating system.
- **Non-goals:** Crow's own two machines (`infra/own-agents/`, `examples/own-agents-service.md`); the deploy workflow; anything in `.github/`, `.claude/`, `CLAUDE.md`, `AGENTS.md`, `agent-ops/`, `.gitleaksignore`; the coordinator's prompt; the cost collector. No account, machine or cloud resource is created by this task.

## Acceptance criteria

- [x] Both setup scripts and every secret-carrying command print the commit and the SHA-256 of each file they run, and stop unless the answer is `yes`.
- [x] Tool versions are read at run time from `.nvmrc`, `package.json` and `.github/workflows/ci.yml`; no version is written twice.
- [x] `up.mjs`, `down.mjs` and `sweep.mjs` read the DigitalOcean token from the environment only, refuse to run without the run's tag, and print the request under `--dry-run` without sending it. A test with a stubbed API shows a machine outside the tag is never deleted.
- [ ] **Open:** `check.mjs` prints one line per check, names only, and exits non-zero when any attack succeeds, any control fails, or any line could not run. A test with stubbed probes shows one succeeding attack turns the result red.
- [x] `config/secrets/dev-host.refs` passes T-480's references test, and names only the development host's vault.
- [x] `docs/operations.md` has a "Machines" section with no counts, addresses or hashes.
- [x] The crow-private runbook and key list exist, names only.
- [ ] Review findings fixed (done); the red-team pass did not complete (Handoff).

## Out of scope

- `infra/own-agents/` and `examples/own-agents-service.md`: after the pilot and after the deploy workflow (record, step 11).
- The deploy workflow and the review rule on `infra/` (tier 3 and repository settings; Rafa's).
- The benchmark's remote mode (T-482), which builds on `infra/party/`.

## Evidence

- **Tests (measured, 2026-11-15, after the review fixes):** `pnpm exec vitest run tests/infra-party.test.ts tests/secrets-refs.test.ts tests/secrets-scripts.test.ts tests/design-map.test.ts`: 90 tests pass. The party tests drive `up`, `down`, `sweep`, the party check and the team test against a stub of DigitalOcean's API and a stub SSH. They show that a machine outside the run's tag is never deleted, even when the API returns it for the tag; that a failed party check destroys the machine; that a run holds one buyer and one seller and refuses a second of either; that cloud-init's exit 2 (recoverable warnings) goes on and exit 1 stops; that a dry run sends nothing and never shows the token; and that the attestation refuses without a terminal, without `yes`, and with an unknown commit. `tests/design-map.test.ts` passes with the new "Machines" section.
- **Static checks (measured, `/verify` after the review fixes):** `/bin/bash -n` (bash 3.2) and `shellcheck -s bash` are clean on every shell script; ESLint is clean on `infra/`, `scripts/secrets/` and the tests; `pnpm typecheck` passes. No snapshot changed: the change touches no fixture.
- **Frozen paths (measured):** `git diff origin/main` over `site/try.mjs`, `site/buy.mjs`, `apps/hosted-sellers`, `packages`, `contracts/src` and `examples` is empty.
- **Dry runs (measured):** `up.mjs --role seller --run demo1 --publish --dry-run` prints the key lookup, the tag listing, three tag requests and the create request with `user_data` shown as `<infra/party/cloud-init.yaml, 1490 bytes>` and the token as `<DIGITALOCEAN_ACCESS_TOKEN, not shown>`. `down.mjs --dry-run` and `sweep.mjs --dry-run` print their listing request and the deletion rule. Without `--run` or `--tag` each exits 2.
- **The commit in a copied file (measured):** `git archive` of the local commit wrote that commit into `setup-admin.sh` and `infra/lib/attest.mjs` (`infra/.gitattributes`, export-subst). From the extracted archive, `setup-admin.sh --hashes` and `setup-user.sh --hashes` print "(git archive)", the commit and each hash. `setup-admin.sh` with standard input not a terminal refuses before it changes anything.
- **Version pins (measured):** from the archive, the scripts read Node 22 (`.nvmrc`), Java 21 and Foundry v1.0.0 (`ci.yml`), and the vault `crow-agents` (`dev-host.refs`).
- **Review (2026-11-15, one `reviewer` pass, Opus):** ISSUES, with one High, three Medium and seven Low findings. All are fixed except Low 11, which only the first run settles: the cask names, corepack in Homebrew's Node, and Foundry's attestation.
  - **High, fixed:** as root, `setup-admin.sh` wrote into the session user's home, where a planted link could hand that user the managed settings' folder. Every write there now runs as the session user: the token hand-over, and the copy of the setup files as a `tar` stream that user's own process unpacks.
  - **Medium, fixed:** `up.mjs` refused a seller in a run that had a buyer; it now refuses only a second machine of the same role. The memory push could not find `gitleaks` under launchd's short PATH, and it took any scan failure for a finding; it now sets PATH and tells a finding (exit 3) from a scan that could not run. The task file's sections were empty at review time.
  - **Low, fixed:** the README's claims about the Wi-Fi name and the network choice; `--vault` dropped from `setup-user.sh` (the vault comes from `dev-host.refs`, and the runbook says what a second person's own vault needs); the tag count polled after `down`; cloud-init's exit 2; `DEFAULTS` reused in the team test; counts out of the "Machines" section; the memory folder's name for any project path; a dry run before the team test under `op run`; corepack and a working `java` checked.
- **Not tested here:** no Mac mini, no DigitalOcean token, no vault access and no container runtime on this Mac (`which docker colima orb` finds none), so neither setup script ran past its preconditions, and the Ubuntu path ran on no Ubuntu machine. Handoff lists what only the first real runs can prove.

## Decisions

1. **A second vault in T-480's parser.** `scripts/secrets/refs.mjs` accepted only the vault `crow`, so `dev-host.refs` could not pass the references test. `VAULTS` now lets `dev-host.refs`, and only that file, name `crow-agents`, and no other file may name it. `copy.mjs` copies only the `crow` vault's keys. This edits two files outside the brief's list; both sit on the record's list of paths that need Rafa's review.
2. **The vault is named `Crow-Agents`,** with a hyphen, in place of the record's `Crow Agents`: a reference cannot hold a space (T-480's rule), and 1Password matches names without regard to case. Rafa has not made the vault yet, so the rename costs nothing.
3. **The token's variable is `DIGITALOCEAN_ACCESS_TOKEN`,** doctl's own name, so `doctl` and the scripts read the same variable. The agents' GitHub token is `CROW_AGENTS_GITHUB_TOKEN`, because `GH_TOKEN` already points at another item in `github.refs`.
4. **Party software after the first SSH session.** `cloud-init.yaml` stays a fixed, reviewed file. Node at the `.nvmrc` major version and the assistant's tool come from `provision.sh`, so their versions follow the repository's pins without a second copy.
5. **The token hand-over goes through the administrator.** Rafa pipes the service account's token over SSH into the administrator's home; `setup-admin.sh --hand-over-token` moves it into the session user's folder; `setup-user.sh` moves it into the Keychain through `security -i` on standard input, so it is never a process argument. Remote Login stays administrator-only.
6. **The team test's snapshot line does not decide.** The token of move step 2 has no snapshot scope, so a refused snapshot cannot tell the team from the scope. List, read and delete decide. This is a gap in the record's step 4 as written.

## Handoff

**Done:** the party machine (`infra/party/`), the development host's setup (`infra/dev-host/` without the check), `config/secrets/dev-host.refs`, the "Machines" section, and the crow-private runbook and key list (its own pull request).

**Not built: the development host's check, `infra/dev-host/check.mjs`.** A safety classifier stopped this session's writing of the file partway, and this session will not write it in any form. The coordinator will not write it either, and starts no other session to write it. How the check is done is Rafa's decision; the coordinator put it to him on 2026-11-15. The record's section 6 ("The check") lists its lines in words. The coordinator also asked for a free-disk-space control in it; the runbook names a guessed floor. **The move stops at step 6 until Rafa decides.**

**Not done: the red-team pass.** On 2026-11-15 it ran on what exists, with the first half of its question only: what a session running as the session user can still reach that the record says it cannot. A safety classifier stopped the `red-teamer` agent's answer too, and it returned no findings. Following the coordinator, the pass stopped there and was not narrowed or reworded to get past the stop. So the administrator files carry one `reviewer` pass and its fixes only, and no red-team pass. Rafa decides how that review is done, together with the check.

**Not done: the configuration audit's fixes.** On 2026-11-15, at Rafa's word, one reviewer audited the setup files against published hardening baselines. A safety classifier stopped the pass that applied its fixes, so none is applied. Its report is in the T-485 session's transcript and is not copied into either repository. Rafa decides whether and how the fixes are made.

**Next tasks:**
- The host check (above): Rafa decides how it is done.
- Crow's own two machines: `infra/own-agents/` and `examples/own-agents-service.md`, after the pilot and after the deploy workflow (record, move step 11).
- T-482, the benchmark's remote mode, builds on `infra/party/` in place of its own create and destroy scripts.

**Only Rafa's first real runs can prove these:**
- The team test: whether the `crow-parties` token stops at its own team.
- On the Mac mini: Homebrew's package install and its signature line; `brew` cask names (`temurin@<n>`, `claude`, `1password-cli`); `airportd prefs` on macOS 26; Remote Login through `systemsetup` or `launchctl`; the access groups for SSH and Screen Sharing; `sysadminctl -password -` prompting for the new user's password; FileVault's enable prompt.
- The token: `security -i` reading `add-generic-password` from standard input; the Keychain item read back by `with-keys.sh` without a prompt.
- Foundry's release file name and `gh attestation verify` on it.
- The desktop app under a Standard user with the managed settings, and a coordinator starting a sub-session there (record, "What it rests on", item 2).
- On a party machine: the seconds from create to SSH; cloud-init's default user `party` receiving the request's SSH key; outbound traffic from the machine's own address; Node's tarball check; the assistant's tool; Caddy.
- On Ubuntu: every step of `setup-user.sh`.

**Open questions:** the network choice (question 5) is still open, and the setup takes it as `--network`.
