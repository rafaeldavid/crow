# Secrets inventory

Every environment variable that holds a secret in this repository's commands, scripts, Workers and docs, by name only. `docs/operations.md` (Secrets) says how each command gets its keys. T-480 and roadmap row N137 made this list on 2026-11-15.

**How it was made (measured).** A search of every tracked file for `process.env`, a Worker's `env.`, `--env-file`, the names that `wrangler secret bulk` receives in the deploy and secrets scripts, and the variable names in the docs and templates. No agent read the local `.env` file, so this list says what the code needs, not what the file holds.

**How sure (inferred).** High for the names the code reads: the search covered every tracked file. Lower for what Rafa's file holds beyond them. Two commands close that gap without showing a value: `node scripts/secrets/copy.mjs --dry-run` and the check (`scripts/secrets/check.mjs`) both name every variable in the local file that no references file names, by name only.

## Keys Rafa holds: they move to 1Password

Each has one item in the vault `Crow`, named in its references file in `config/secrets/`.

| Name | What it is | Commands that need it, and who runs them | Runtime copy | Serves several jobs today | Item (references file) |
| --- | --- | --- | --- | --- | --- |
| `HOLDBACK_ANTHROPIC_API_KEY` | The live judges' Anthropic key | `pnpm demo-cloud:secrets` and `pnpm demo --live`; Rafa | Worker secret on holdback-op1 | Yes: the operators' judges and the local live demo read one name (inferred) | `op1-judges-anthropic` (`judges.refs`) |
| `HOLDBACK_OPENAI_COMPATIBLE_API_KEY` | The live judges' DeepSeek key | the same; Rafa | Worker secret on holdback-op1 | Yes, as above | `op1-judges-deepseek` (`judges.refs`) |
| `HOLDBACK_AGENT_ANTHROPIC_API_KEY` | The benchmark agents' Anthropic key, never the judges' | `pnpm duet` and `tools/one-click/bench.mjs --live`; Rafa | none | Yes: both tools read it | `mac-agents-anthropic` (`agents.refs`) |
| `HOLDBACK_AGENT_OPENAI_COMPATIBLE_API_KEY` | The benchmark agents' DeepSeek key | `pnpm duet`; Rafa | none | No | `mac-agents-deepseek` (`agents.refs`) |
| `E2E_SEPOLIA_SEED` | The Sepolia-only seed every round key derives from | `examples/e2e-keys.ts`, `examples/e2e-round.ts` (`docs/redeploy-contracts.md`, step 7); Rafa | none | No: one job, its keys derived by role | `mac-e2e-sepolia-seed` (`e2e.refs`) |
| `HOLDBACK_FEEDBACK_SECRET_KEY` | Opens sealed feedback reports | `apps/demo-cloud/scripts/feedback.ts`; Rafa | none, by design | No. Not set up yet: the demo takes unsealed reports only (T-491, 2026-11-16) | `mac-feedback-sealing` (`feedback.refs`, optional) |
| `SEPOLIA_RPC_URL` | A Sepolia RPC URL; a secret when it carries a provider's key | the scripts in `examples/` that send to Sepolia; Rafa | none | Unknown: the same provider key may sit in `SEPOLIA_RPC_URLS` on holdback-op1 (guessed) | `mac-sepolia-rpc` (`sepolia-rpc.refs`, optional) |
| `CLOUDFLARE_API_TOKEN` | A Cloudflare token for Wrangler in place of its login | Wrangler; Rafa in place of OAuth, or an isolated environment | the isolated environment's own secret | Unknown | `mac-cloudflare-token` (`cloudflare.refs`, optional) |
| `CLOUDFLARE_ACCOUNT_ID` | Not a secret: an identifier, kept out of this public repository | Wrangler | none | not a key | `cloudflare-account-id` (`cloudflare.refs`, optional) |
| `GH_TOKEN` | A GitHub token for gh and git in place of gh's login | gh, git, and the private repository's console build; Rafa, or an isolated environment | the isolated environment's own secret; the private repository's Actions use their own secret | Yes, when set: this repository's gh and the private console build | `mac-github-token` (`github.refs`, optional) |

**Plain configuration, not a secret:** `HOLDBACK_OPENAI_COMPATIBLE_BASE_URL` and `HOLDBACK_AGENT_OPENAI_COMPATIBLE_BASE_URL` sit as plain values in their references files. `pnpm demo-cloud:secrets` still sends the first one to holdback-op1 as a secret, beside the keys.

**The private repository** has console commands that load this same local file today. Its own references file holds their names: `control/secrets/console.refs` there.

## Keys made where they work: nothing to move

Each is generated in memory by its script and piped to `wrangler secret bulk`; no copy exists anywhere else, and Cloudflare never shows it again.

| Name | Worker | Made by |
| --- | --- | --- |
| `SEPOLIA_RELAYER_KEY` | holdback-op1 | `apps/demo-cloud/scripts/relayer.mjs` |
| `TEST_AGENTS_SEED` | crow-test-agents; the test seller's and the test buyer's keys derive from it under their own labels | `apps/test-agents/scripts/seed.mjs` |
| `HOLDBACK_KEY` and the generated credentials of a hosted seller (the names its `adapter.json` gives) | crow-seller-`<slug>` | `apps/hosted-sellers/scripts/secrets.ts`. It also writes the three credentials to mode-0600 files in a folder outside every repository, for Rafa to hand over |
| The hosted seller's company API key (the name `sellerApi.auth.env` gives) | crow-seller-`<slug>` | typed by Rafa at a hidden prompt; the company holds the original |
| `SEPOLIA_RPC_URLS` (optional) | holdback-op1 | set by hand with Wrangler, when set |

## Keys given per run: no stored home

Whoever runs the one command gives the key for that run. If Rafa keeps one for reuse, it gets an item and a references line like the keys above.

- `TIMEOUT_SENDER_KEY`: `examples/send-timeout.ts`, a real send only.
- `CROW_REHEARSAL_PAYMENT_KEY`: `examples/audit-deal.ts --live`, a test key.
- `DEPLOY_CROSSCHECK_RPC`: `contracts/script/deploy-sepolia.sh`, a secret when keyed.
- `SEPOLIA_FORK_RPC`: the fork tests; CI passes a public node.
- A buyer's or a seller's own agent keys, in `examples/` and the site's guides: `HOLDBACK_KEY`, `HOLDBACK_ENCRYPTION_KEY`, `CROW_SIGNER_SELLING_KEY`, `CROW_SIGNER_BUYING_KEY`, `CROW_SIGNER_FLOAT_KEY`, `CROW_QUOTE_CREDENTIAL`, `HOLDBACK_QUOTE_CREDENTIALS`, `HOLDBACK_READY_CREDENTIALS`, `HOLDBACK_ALERT_SECRET`, `JOBS_API_KEY`. Each party sets its own.

## Logins outside the env file

The copy does not move these. Each sits in a file in Rafa's home folder that any process he runs can read, an agent's shell included (measured: the first two files exist; their content was not read).

- Wrangler's OAuth login (`wrangler login`): an account-wide token in plain text. `wrangler login --use-keyring` keeps it encrypted, with the key in the macOS Keychain (Cloudflare's Wrangler docs, read 2026-11-15).
- gh's login (`gh auth login`).
- The Sepolia deployer: a Foundry keystore and its password file (`docs/operations.md`, Sepolia contracts).
- The cost collector's own file, in its own clone, which only Rafa runs.

## Not Crow's, or no longer used

- `ANTHROPIC_API_KEY`: Claude Code's own key in an isolated environment. The one-click harness strips it from the agent it starts.
- `GITHUB_TOKEN`: GitHub Actions' token for one run. The workflows name no other secret (measured on `.github/workflows/`, 2026-11-15).
- `STRIPE_SECRET_KEY`: tests of the no-real-money guard only.
- `ETHERSCAN_API_KEY`: named only in the dated cutover record; Sourcify needs no key.
- `TESTNET_DEPLOYER_PRIVATE_KEY`, `CHAIN_RPC_URL`, `CHAIN_ID`: lines of the removed `config/keys.template`. The deployer is a keystore now.
