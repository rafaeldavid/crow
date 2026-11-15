# A simulated party's machine

A simulated seller or buyer runs on a throwaway Ubuntu machine of its own, in the DigitalOcean team `crow-parties`. Each machine has its own kernel, its own public address and nothing of Crow's on it: no repository, no document, no credential. It is made for one run and destroyed after it (decision record T-484, section 6; task T-485). The benchmark's remote mode (T-482) builds on these commands.

## The commands

Run them on the development host, as the session user, through `infra/dev-host/with-keys.sh`, which gives each command the `crow-parties` token from `config/secrets/dev-host.refs`. Each command prints the commit and the SHA-256 of the files it runs, and waits for a typed `yes`; a session passes `--yes`. Each one has `--dry-run`, which prints the requests and sends nothing.

| Command | What it does |
| --- | --- |
| `node infra/party/up.mjs --role <buyer\|seller> --run <id> [--publish]` | Makes `party-<id>-<role>` from `cloud-init.yaml` on a stock Ubuntu 24.04 image. It waits for SSH and cloud-init, then installs Node at the `.nvmrc` major version and the assistant's command-line tool (`provision.sh`). With `--publish` it also installs Caddy for a seller that publishes. Then it runs the party's check. A machine that fails its check is destroyed, unless `--keep` is given |
| `node infra/party/down.mjs --run <id>` | Destroys the run's machines, then checks that nothing carries the run's tag |
| `node infra/party/sweep.mjs --tag party --older-than <age>` | Destroys party machines older than the age (for example `6h`): what a killed run left behind |
| `node infra/party/check.mjs --run <id>` | The party's check, again |

**What may be deleted.** `down` and `sweep` delete a machine only when the cloud's own record of it carries the `party` tag and the stated tag, and its name starts with `party-` (`selectForDeletion` in `do.mjs`). The rehearsal pair, Crow's own machines and any machine made by hand carry no `party` tag, so these commands never reach them. A run's tag is required: no command deletes "everything".

**The token** comes from `DIGITALOCEAN_ACCESS_TOKEN` in the environment only, and is never printed. It never reaches a party's machine. The model key for a run goes to the machine in that run's SSH session only (T-482).

## The party's check

On the machine (`probe.sh`, run over SSH as the party user):
- the home holds the skeleton files and the SSH key only;
- no path holds a file of the project, by name or by content;
- no cloud token is in the environment or in the file the metadata service hands out;
- password and root logins are off;
- security updates install themselves;
- Node runs at the pinned major version, and the assistant's tool is installed.

From the development host:
- the machine's outbound address, as an address-echo service sees it, is its own public address in the cloud's record;
- it differs from the address of every other running party machine.

After `down`, no machine or record carries the run's tag.

## What Rafa sets up once, in DigitalOcean's page

- The team `crow-parties`, with its own billing and a machine limit.
- One firewall for the tag `party`: inbound 22, 80 and 443. The token never edits a firewall.
- The development host's public SSH key, which `setup-user.sh` prints.
- The token, with custom scopes: Droplets create, read and delete; tags create and read; SSH keys read; images read. It expires after 90 days.

## The team test (move step 4)

DigitalOcean's pages do not say whether a team's token stops at its team, so Rafa measures it before any machine reads the vault. On his own Mac, with the Claude desktop app quit, he makes one throwaway machine by hand in his default team. First, without the key, he runs `node infra/party/team-test.mjs probe --run <id> --other <ID> --dry-run` and compares its commit and hashes with the reviewed pull request: under `op run` the key is already in the process when the script asks for `yes`. Then he runs the two commands:

```bash
op run --env-file=config/secrets/dev-host.refs -- node infra/party/team-test.mjs make --run <id>
```

```bash
op run --env-file=config/secrets/dev-host.refs -- node infra/party/team-test.mjs probe --run <id> --other <the default team's machine's ID>
```

The probe tries, with the `crow-parties` token, to list, read by ID, snapshot and delete the other team's machine; each must be refused. It then lists, reads and deletes its own machine; each must succeed. The token has no snapshot scope, so the snapshot line cannot tell the team from the scope; the other three lines decide. When the boundary does not hold, the probe says so: the simulated parties then move to another provider or a second account (record, section 4). Rafa deletes the default team's throwaway machine in the page afterwards.

## Not measured yet

Only the first real runs can show these: the seconds from the create call to a working SSH session; that outbound traffic leaves from the machine's own address; whether the metadata service hands out the cloud-init file; and the team test itself. The tests in `tests/infra-party.test.ts` drive every command against a stub of the API.
