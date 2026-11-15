# T-480: Every key has one home: the local .env moves to 1Password

- **Lane:** infra
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `config/secrets/`, `config/keys.template` (removed), `config/keys-dev-env.template`, `scripts/secrets/`, `tests/secrets-*.test.ts`, `docs/operations.md`, `docs/secrets-inventory.md`, `docs/demo.md`, `docs/api.md`, `docs/testing.md`, `docs/redeploy-contracts.md`, `package.json` (scripts), and the usage lines of `apps/demo/src/{bin,cli}.ts`, `apps/demo-cloud/scripts/feedback.ts`, `examples/e2e-{keys,round,settle}.ts`, `examples/send-timeout.ts`
- **Human gate:** yes: Rafa installs `op`, signs in, runs the copy and the check, pushes the runtime secrets, runs one test deal and removes the file. No agent runs `op` or reads the file.
- **Status:** in progress
- **Agent/session:** a sub-session of the coordinator, 2026-11-15
- **Roadmap row:** N137

## Intent

Today Rafa's keys sit in one `.env` file in the project folder, and every command that loads it with `--env-file` gets every key in it. Some keys serve several jobs. This task prepares the move of every key into 1Password, so that Rafa's part is to sign in and run a short list of commands. No agent sees a value at any point.

- **Inputs:** the code and docs, searched by variable name. The local file is never opened.
- **Outputs:** the inventory (`docs/secrets-inventory.md`); the design (below); one references file per job in `config/secrets/`, with a test that fails on a value; the copy and the check (`scripts/secrets/`), tested against a made-up file and a stub `op`; the operations doc's Secrets section rewritten; and Rafa's list (Handoff).
- **Non-goals:** issuing, rotating or revoking any key; changing anything on Cloudflare, GitHub or 1Password; deploys; files in `.github/`, `.claude/` or `CLAUDE.md` (tier 3: proposed in the Handoff).

## Acceptance criteria

- [x] The inventory names every secret the code and docs use, with its commands, who runs them, its runtime copy and whether it serves several jobs.
- [x] The references files hold `op://` references and plain configuration only; `tests/secrets-refs.test.ts` fails otherwise.
- [x] No package script loads an env file, and no standing doc or script tells anyone to load or fill `.env` (the same test).
- [x] The copy and the check print names and states only; tests prove no value reaches the output, an argument or a file (`tests/secrets-scripts.test.ts`).
- [x] `docs/operations.md` says how to run each command, add a key, push runtime secrets and answer an `op` prompt.
- [ ] Rafa has run the list in the Handoff (his part).

## Design

### One vault, one item per key

- **Vault:** `Crow`, in Rafa's 1Password account, for every key he holds for Crow. References match names without regard to case, so the files write `op://crow/…`.
- **Item:** one per key, category API Credential, the key in its one field `credential`. The title says where the key works and its job, in lower case with hyphens: `op1-judges-anthropic` works on holdback-op1 for the live judges, `mac-agents-deepseek` on Rafa's Mac for the benchmark agents. A title with only those characters needs no quoting in a reference (1Password's secret reference syntax).
- **Name:** each item serves one variable name, and a name points at one item in every file. `scripts/secrets/refs.mjs` refuses an item that serves two names.
- **One references file per job** (`config/secrets/<job>.refs`). A command gets only the keys of its job, where `--env-file=.env` gave every command every key. A file whose item does not exist stops `op run` ("could not resolve"), so the keys some setups lack sit in optional files of their own.
- **Where a key works twice today,** the item takes the name of its main job, and the inventory says so. Row N137's next step issues a key of its own for the second job.

### How each kind of command gets its keys

| Command | Runs it | How it authenticates today | After the move |
| --- | --- | --- | --- |
| `pnpm demo-cloud:secrets`, `pnpm demo --live`, `pnpm duet`, the one-click live bench, the e2e rounds, `feedback.ts` | Rafa | `--env-file` loads `.env` | `op run --env-file=config/secrets/<job>.refs -- <command>` in his terminal |
| The hosted sellers' `secrets.ts` | Rafa | the API key typed at a hidden prompt | unchanged; he can copy the key from its 1Password item into the prompt |
| `relayer.mjs`, `seed.mjs` | Rafa | generate their key in memory | unchanged: nothing to store |
| Site, operator, test-agent and early-access deploys | the coordinating session, on Rafa's word | Wrangler's OAuth login on the Mac | below |
| CI | GitHub Actions | `GITHUB_TOKEN` only; no repository secret (measured: the workflows name no other) | unchanged |

**The deploys are the hard part.** Wrangler's OAuth token sits in plain text in a file in Rafa's home folder, and covers the whole account (`wrangler login` asks for every scope; Cloudflare, "Authorization", read 2026-11-15). Any process Rafa runs can read it, every agent's shell included. The rule for this design: an agent's shell must not be able to read a key it has no business with, by construction and not by instruction.

| Option | Can an agent's shell read more than its job needs? | What Rafa approves each time |
| --- | --- | --- |
| **A. Wrangler's OAuth login (today)** | Yes: the token file is readable and the token is account-wide. Fails the rule. | Nothing enforced; his go-ahead is policy only |
| **B. `op run` in the agent's shell, Rafa approving with Touch ID** | Yes: once approved, `op` in that terminal session reads every item his account can see, for 10 idle minutes and up to 12 hours (1Password, "App integration security", read 2026-11-15). Fails the rule. | A Touch ID prompt per session, which does not say what will be read |
| **C. A 1Password service account limited to a vault `Crow Agents`** that holds only a Cloudflare token scoped to the named Workers | No: a service account reaches only the vaults granted at creation, and its access cannot change (1Password, "Service accounts", read 2026-11-15). The agent's shell holds the service account's token, which is as good as holding the scoped Cloudflare token. Passes. | Nothing per run; the go-ahead stays policy |
| **D. Deploys in GitHub Actions, behind an environment with Rafa as required reviewer** | No: no Cloudflare credential reaches an agent's shell at all. The token is an environment secret, released only to a job on `main` that Rafa approved. Passes. | One click, "Review deployments, Approve", on each deploy run; GitHub enforces it |

**Recommendation: D.** It turns Rafa's go-ahead, which he gives for every deploy today, into the one approval GitHub enforces, and it deploys the commit on `main` that CI tested. The token it holds is a Cloudflare API token scoped to the Workers it deploys ("Specified Workers", role Editor: deploy, versions, rollback and secret changes on those Workers only; Cloudflare, "Workers authorization", read 2026-11-15). Route changes also need Workers Routes on the zone, and creating a new Worker needs a wider token, which stays Rafa's.

- **What it needs, all Rafa's:** a workflow file in `.github/` and an environment with its reviewer rule (tier 3 and repository settings), and the scoped token issued in Cloudflare. This task builds none of it; the Handoff lists it.
- **Until it lands,** agents' deploys keep Wrangler's login (option A), a known gap. Once it lands, Rafa runs `wrangler logout` on the Mac and uses `config/secrets/cloudflare.refs` for his own Wrangler commands.
- **Option C is the fallback** for a deploy that cannot run on a GitHub runner.
- **What no option removes:** whoever may deploy a Worker can deploy code that reads that Worker's secrets. The deploy approval is therefore also the guard on the runtime secrets, which is one more reason to put a reviewed commit and an enforced click in front of it.

### Rafa's question: can Cloudflare hold the secrets?

- **What Cloudflare holds today:** each Worker's runtime secrets. holdback-op1 holds the judges' keys, the relayer key and the optional keyed RPC URLs (its Durable Object runs op1's environment, so holdback-op2 holds none). crow-test-agents holds its seed; each hosted seller holds its own. Nobody can read a Worker secret's value back, in the dashboard or in Wrangler (Cloudflare, "Secrets", https://developers.cloudflare.com/workers/configuration/secrets/, read 2026-11-15).
- **What Secrets Store would add:** one account-level secret bound to several Workers, changed in one place for all of them, with roles that split who creates a secret from who binds it (https://developers.cloudflare.com/secrets-store/ and https://developers.cloudflare.com/secrets-store/access-control/, read 2026-11-15). It is in open beta: one store per account, 100 secrets, 64 KiB a value. A Worker reads one with `await env.<BINDING>.get()`, so the code changes.
- **Why it cannot replace the password manager:** a Secrets Store value "can no longer be decrypted or accessed via API or on the dashboard" once created (Cloudflare, "Manage secrets", read 2026-11-15). The commands on the Mac need the value itself in a local process: the live demo, the benchmarks, the e2e rounds, the feedback key, and the push to the Workers. Secrets Store holds runtime copies only, so the source copy stays in 1Password.
- **Recommendation: later, not now.** Today each runtime secret lives on exactly one Worker, so there is no duplicate to merge. Adopt it when one key must serve several Workers, such as a provider key shared by hosted sellers, or the judges on more nodes. Binding it also needs the Secrets Store Edit permission on the deploy token, which widens the token option D uses. Nothing was changed on the account.

## Evidence

- **Search (measured):** `git grep` over every tracked file, with `.env*` and `.dev.vars*` excluded by pathspec, for `process.env`, `env.`, `--env-file`, `dotenv` and the secret-shaped names; the Wrangler secret names in `apps/*/scripts` and `apps/hosted-sellers/src/deploy-plan.ts`; `secrets.` in `.github/workflows/` (only `GITHUB_TOKEN`). In crow-private, the same search on `origin/main` found its console commands loading the same file.
- **The local files (measured, by path only):** `find /Users/rafa/Documents/escrow -name '.env*'` lists one local env file besides the committed `.env.example`: `/Users/rafa/Documents/escrow/.env`. No `.dev.vars*` file exists.
- **Tests (measured, 2026-11-15):** `pnpm exec vitest run tests/secrets-refs.test.ts tests/secrets-scripts.test.ts`: 21 tests pass. With `examples/send-timeout.test.ts`, `examples/e2e-round.test.ts` and `apps/demo/src/cli.test.ts` after `pnpm build`: pass. `pnpm typecheck` and ESLint on the changed files: clean.
- **Not verified (no `op`, no value):** that `op item template get "API Credential"` names its secret field `credential`. The copy checks it first and stops, creating nothing, if not. That `op run` takes `--env-file` more than once is inferred from its reference page (the flag is a `stringArray`, and "the last environment file takes precedence"); the copy prints one command per file set, so a single file always works.

## Decisions

1. **One references file per job,** not one file for all: a command gets only its job's keys, and a missing optional item breaks only its own job.
2. **One field name, `credential`, in every item,** so a reference never depends on a category's field layout.
3. **Values reach `op` as a JSON item template on standard input** (`op item create --vault <id> --format json -`), never as an argument: 1Password's own advice is a template for sensitive values (`op item` reference, read 2026-11-15).
4. **The copy reads item titles with `op item list`,** which returns no field values, and never `op item get`.
5. **The package scripts no longer load `.env` at all,** where `--env-file-if-exists` could have stayed: then nothing loads the file if it comes back.
6. **`config/keys.template` is removed;** the references files replace it. `config/keys-dev-env.template` stays, for isolated environments, without the step that appended it to `.env`.

## Handoff

### Rafa's list, in order

Run each command in your own terminal, from any folder. Each block is one command.

1. **Install the 1Password command-line tool.** It prints a line ending "was successfully installed!".

```bash
brew install 1password-cli
```

2. **Turn on one setting in the 1Password app:** Settings, then Developer, then "Integrate with 1Password CLI". Turn on Touch ID in Settings, Security, if it is off.

3. **Sign in.** Touch ID asks once; then `op whoami` prints your account's URL and email.

```bash
op signin
```

```bash
op whoami
```

4. **Create the vault.** Skip this if a vault named Crow already exists. It prints the new vault's ID and name.

```bash
op vault create Crow
```

5. **Bring the main checkout up to date** once this pull request has merged. It prints the files it fast-forwarded.

```bash
git -C /Users/rafa/Documents/escrow pull --ff-only
```

6. **Preview the copy.** It reads the file, calls no `op`, and lists each name as "would be copied", "missing in the file" or "in the file, not in the inventory". Send the coordinator the names of the last kind, names only. The private repository's folder joins once its own references file has merged.

```bash
node /Users/rafa/Documents/escrow/scripts/secrets/copy.mjs --dry-run --refs /Users/rafa/Documents/escrow/config/secrets --refs /Users/rafa/Documents/escrow/reports/crow-private/control/secrets
```

7. **Run the copy.** It lists each name as "created", "exists, left alone" or "missing in the file", and ends with the check's command for the files whose items all exist. A failure stops it with what to do; running it again leaves the items already made alone.

```bash
node /Users/rafa/Documents/escrow/scripts/secrets/copy.mjs --refs /Users/rafa/Documents/escrow/config/secrets --refs /Users/rafa/Documents/escrow/reports/crow-private/control/secrets
```

8. **Run the check** the copy printed, from the same folder. For the live judges alone it reads as below. Each line should say "plausible; same as the local file", and the last line "check: every name is set."

```bash
op run --env-file=/Users/rafa/Documents/escrow/config/secrets/judges.refs -- node /Users/rafa/Documents/escrow/scripts/secrets/check.mjs /Users/rafa/Documents/escrow/config/secrets/judges.refs
```

9. **Push the judges' keys to holdback-op1 from 1Password.** The values are the same as today's, so the live judges do not change. It prints "Set HOLDBACK_ANTHROPIC_API_KEY, HOLDBACK_OPENAI_COMPATIBLE_API_KEY, HOLDBACK_OPENAI_COMPATIBLE_BASE_URL on holdback-op1."

```bash
op run --env-file=/Users/rafa/Documents/escrow/config/secrets/judges.refs -- pnpm -C /Users/rafa/Documents/escrow demo-cloud:secrets
```

10. **Run one test deal** against the live operators and the test seller. It ends with the deal released.

```bash
node /Users/rafa/Documents/escrow/site/try.mjs --seller https://crow.direct/agents/test-seller
```

11. **Only then, remove the file:** move `/Users/rafa/Documents/escrow/.env` to the Trash in Finder (Go, then Go to Folder, the path above; hidden files show with Command-Shift-Period). After that, `ls -a /Users/rafa/Documents/escrow` lists no `.env`.

### What row N137 still needs from Rafa afterwards

- **New keys, one per job and machine,** each with a spend cap at its provider, each in its own item: the live demo's Anthropic and DeepSeek keys apart from holdback-op1's (`mac-demo-judges-anthropic`, `mac-demo-judges-deepseek`, then a `demo-live.refs`), and the one-click bench's Anthropic key apart from duet's. Push holdback-op1's new keys with step 9, and run one deal (step 10).
- **Revoke the old keys** at Anthropic and DeepSeek once the new ones work, then empty the Trash.
- **The deploy design (option D):** a Cloudflare API token scoped to the deployed Workers; a GitHub environment `deploy` with Rafa as required reviewer and `main` as its only branch; then `wrangler logout` on the Mac.
- **`.env.example`,** committed from the starter kit and named by `.gitignore`. No agent may open it to reword it, so Rafa deletes or rewrites it himself. Nothing reads it (measured: `git grep` finds no reference).

### Proposed tier 3 changes (Rafa's files)

- `.github/workflows/deploy.yml` for option D, and the environment rule.
- `.github/CODEOWNERS`: Rafa as owner of `scripts/secrets/` and `config/secrets/`, since he runs those scripts with his keys and agents merge pull requests.
- `.claude/settings.json`: deny `Bash(op:*)`, `Bash(op *)` and Bash reads of `.env*`, beside today's Read rules, which cover the Read tool only.

### Open questions

- Whether a vault named Crow already holds `CROW_CONTROL_KEK` ("also in 1Password", crow-private `control/README.md`). The copy then makes a second item for it in `Crow`; delete one.
