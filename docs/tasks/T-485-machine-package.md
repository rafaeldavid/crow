# T-485: The machine package, part 1: the development host and a simulated party's machine

- **Lane:** infra
- **Phase:** 2
- **Depends on:** T-484 (the decision record, crow-private `strategy/2026-11-15-dev-infrastructure-decision.md`); T-480 (the keys' move to 1Password: `config/secrets/`, `scripts/secrets/`)
- **Paths this task may touch:** `infra/dev-host/`, `infra/party/`, `config/secrets/dev-host.refs`, `scripts/secrets/refs.mjs` and `scripts/secrets/copy.mjs` (one rule each: a second vault for `dev-host.refs` only; Decisions, 1), `tests/secrets-refs.test.ts`, `tests/infra-*.test.ts`, `docs/operations.md` (one section, "Machines"), this file. In crow-private: `company-ops/dev-host/README.md`, `company-ops/dev-host/keys.md`.
- **Human gate:** yes. Rafa reviews and approves both pull requests himself: he runs these files as administrator and with his keys. Agents do not merge them. Every real run (the Mac mini's setup, the team test, a party machine) is his.
- **Status:** review
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

- [ ] Both setup scripts and every secret-carrying command print the commit and the SHA-256 of each file they run, and stop unless the answer is `yes`.
- [ ] Tool versions are read at run time from `.nvmrc`, `package.json` and `.github/workflows/ci.yml`; no version is written twice.
- [ ] `up.mjs`, `down.mjs` and `sweep.mjs` read the DigitalOcean token from the environment only, refuse to run without the run's tag, and print the request under `--dry-run` without sending it. A test with a stubbed API shows a machine outside the tag is never deleted.
- [ ] `check.mjs` prints one line per check, names only, and exits non-zero when any attack succeeds, any control fails, or any line could not run. A test with stubbed probes shows one succeeding attack turns the result red.
- [ ] `config/secrets/dev-host.refs` passes T-480's references test, and names only the development host's vault.
- [ ] `docs/operations.md` has a "Machines" section with no counts, addresses or hashes.
- [ ] The crow-private runbook and key list exist, names only.
- [ ] Review and red-team findings are fixed or listed below as open.

## Out of scope

- `infra/own-agents/` and `examples/own-agents-service.md`: after the pilot and after the deploy workflow (record, step 11).
- The deploy workflow and the review rule on `infra/` (tier 3 and repository settings; Rafa's).
- The benchmark's remote mode (T-482), which builds on `infra/party/`.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
