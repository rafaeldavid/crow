# The development host

The development host is a computer that holds only Crow. Agent sessions run there as a Standard user, `crow` by default, under a Claude account that holds only Crow. Rafa's files, browser, password manager, cloud logins and contract keystore stay on his own Mac. The decision record (crow-private `strategy/2026-11-15-dev-infrastructure-decision.md`, task T-484) sets out why; this folder holds the files that set the host up (T-485). The runbook for setup, restart and rebuild is crow-private `company-ops/dev-host/README.md`.

## The rule for every privileged file

Rafa runs an administrator script, or a command that carries a secret, only at a commit whose pull request he approved. Each such file prints the commit it came from and the SHA-256 of each file it runs or reads, then waits for a typed `yes`. He copies the files from his own Mac with `git archive`, which writes the commit into each script (`infra/.gitattributes`). He never runs a file from the session user's folder as the administrator.

To compare, he runs the same file with `--hashes` on his own Mac and on the host: both print the same commit and the same hashes, or he stops.

## The files

| File | Run by | What it does |
| --- | --- | --- |
| `setup-admin.sh` | the administrator (macOS) | Measures the Mac and refuses one below the floors (`--min-memory-gb`, `--min-macos`, Apple silicon). Installs Apple's command-line tools, Homebrew, and Node, `gh`, `gitleaks`, `doctl`, the 1Password command-line tool, Java and the Claude desktop app. Installs the managed settings. Closes the administrator's home to other users. Sets sleep off, restart after a power failure, FileVault and the firewall. Creates the session user as a Standard user. Turns on Remote Login (and, with `--screen-sharing`, Screen Sharing) for the administrator only. Turns Wi-Fi off, or keeps one network, and requires an administrator to change it. With `--hand-over-token` it moves the service account's token into the session user's folder |
| `setup-user.sh` | the session user (macOS or Ubuntu 24.04) | Installs pnpm through corepack and Foundry at the version CI pins. Makes the SSH key for party machines. Moves the service account's token into the user's Keychain (macOS) or a file only the user reads (Ubuntu). Checks that the service account sees one vault, signs `gh` in as the agents' account from that vault, clones both repositories, installs the permission file and the nightly memory push |
| `managed-settings.json` | read by every session | Deny rules that apply in every permission mode. The administrator installs it root-owned, so the session user cannot change it. It is one layer: the hard limits are what is absent from the machine and the account |
| `with-keys.sh` | the session user | Runs one command with the host's three keys from `config/secrets/dev-host.refs`. The command never sees the service account's token |
| `memory-push.sh` | the session user, nightly | Pushes the agents' memory folder to the branch `memory/dev-host` of crow-private after a secret scan, so each change is one reviewable diff |
| `settings.local.json` | read by sessions in the project | Bypass mode, as today |

Tool versions come from the repository's own pins: Node's major version from `.nvmrc`, its floor from `package.json` (`engines`), Java and Foundry from `.github/workflows/ci.yml`.

## Parameters, not assumptions

- **The Mac's model and memory:** the script measures them and prints them. The floors are options with the record's values as defaults.
- **The network:** `--network home`, `guest` or `own` (the record's question 5, still open). The setup prints the choice at its end. The home network keeps the gap the record names: the host can reach the home's devices and router.
- **The link:** `--link ethernet` turns Wi-Fi off. `--link wifi --wifi-ssid <name>` keeps one network and removes every other remembered one, for a router whose guest network is on Wi-Fi only. The name is an option, so it lands in the administrator's shell history and in no file.
- **The person:** the session user's name (`--session-user`) and the project path (`--project`) are options. Nothing assumes one person or a shared login. A second person gets their own session user, Claude account, GitHub account and 1Password access.
- **The operating system:** macOS, or Ubuntu 24.04 for a rented host (below).

## Set up the Mac mini

The runbook has the steps in order, with the commands. In short:

1. Erase the Mac and install macOS. Create the administrator account.
2. On Rafa's own Mac, at the reviewed commit: `git archive` of `infra`, `.nvmrc`, `package.json`, `.github/workflows/ci.yml`, `config/secrets/dev-host.refs` and `scripts/secrets/refs.mjs`, copied into the administrator's home.
3. As the administrator: `bash setup-admin.sh --hashes`, compared with the same command on his own Mac; then `bash setup-admin.sh --network <choice> --link <choice> --authorized-key-file <his public key>`.
4. Log in as the session user at the Mac's screen and run `bash ~/crow-setup/infra/dev-host/setup-user.sh --agents-login <login>`. The first pass stops before the keys.
5. **Hand over the token.** On his own Mac, with the Claude desktop app quit, Rafa pipes the service account's token from his vault to the administrator over SSH. Then he runs `bash setup-admin.sh --hand-over-token` as the administrator. Nothing is typed or shown.
6. Run `setup-user.sh` again as the session user. Sign the desktop app in to the Crow account, turn on "Keep computer awake", and add the app as a login item.
7. Run the host check (below) before any agent session exists on the machine.

## The check

The record's check (section 6, "The check") lists what must fail, what must be absent and what must pass on the host. Each line runs as the session user and prints its name only. **It is not in this folder yet.** T-485 built the setup and the party machine; the host check is the next piece of work, and the move stops at step 6 until it exists. The party's own check is in `infra/party/check.mjs`.

## Ubuntu instead

On a rented Ubuntu 24.04 host, `setup-admin.sh` does not run. Whoever administers the host, as root, installs `git`, Node at the `.nvmrc` major version, `gh`, `gitleaks`, the 1Password command-line tool, Java at the CI version and `curl`. They create the session user without sudo rights, and install `managed-settings.json` root-owned at `/etc/claude-code/managed-settings.json`. The provider's firewall takes the place of the macOS firewall. Then `setup-user.sh` runs as on macOS. It keeps the token in `~/.config/crow/op-service-account`, mode 600, and uses a systemd user timer for the memory push.
