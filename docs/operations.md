# Operations: what is live and how to change it

The public demo of Crow (the Holdback protocol): what runs where, how to deploy it, and the record of each deploy. Test tokens only; nothing here moves real money. Read `CLAUDE.md` first.

The standing runbook comes first and points to the source of each value: the deployment record `contracts/deployments/sepolia.json`, discovery and `/v1/status` on each node, and the wrangler files. The last section, "Deploy record", keeps one dated entry per deploy, newest first, with the versions and hashes measured at the time.

## What is live

| Address | What | Source | Deployed by |
| --- | --- | --- | --- |
| https://crow.direct (and `www.`) | The site: the landing page from Rafa's mock (D56), early access, the Try line; agent docs at `/llms.txt` | `site/` (`site/llms.txt` is the one source; `site/build.mjs` renders the page) | Cloudflare Worker `crow-site`, static assets behind `apps/site/worker.js` (`apps/site/wrangler.jsonc`) |
| https://api.crow.direct | Operator node 1, home of the World Durable Object (the faucet, the adjudicators and the operators' view), which settles on Ethereum Sepolia since 2026-11-03 (D41; SimChain on a rollback) | `apps/demo-cloud/` (wraps `apps/operator`, `packages/settlement/sim`, `apps/adjudicator`) | Worker `holdback-op1` (`apps/demo-cloud/wrangler.op1.jsonc`) |
| https://api2.crow.direct | Operator node 2, same world, own receipt key | same | Worker `holdback-op2` (`wrangler.op2.jsonc`) |
| https://join.crow.direct | Early-access email sign-ups (KV `EMAILS`: address, time, page; nothing else). Since 2026-11-15 also `/listing` (T-486), which takes a party's website after its first deal, in the same store; the request carries the website and nothing else | `apps/early-access/` | Worker `crow-early-access`, one KV namespace for both hostnames |
| https://crow.direct/agents/test-seller | Crow's test seller (D47, T-222): a standing party that sells one test dataset over the operators' public API. Live since 2026-11-04 (T-222 Evidence). Since T-489 it also answers quotes at `/agents/test-seller/quote`, with its terms at `/defaults`, for a buyer that follows `buy.txt` (the setup's sample product, 1 tUSDC, checks only), live since the deploy of 2026-11-16. Beside it, at `/agents/test-buyer`, Crow's test buyer (T-239), live since 2026-11-11 | `apps/test-agents/` (reuses `examples/agent.ts` and `verify.ts`) | Worker `crow-test-agents` on the route `crow.direct/agents/test-seller*` (`apps/test-agents/wrangler.jsonc`) |
| https://crow.direct/agents/pilot-scan-1 and `/agents/pilot-scan-2` | The first pilot's two hosted sellers (ADR-0037, T-435, T-436), each a Worker with one Durable Object; `/health` reads `operational` with its configuration's SHA-256 and the deals in flight | `apps/hosted-sellers/`, built from a frozen seller folder | Workers `crow-seller-pilot-scan-1` and `crow-seller-pilot-scan-2` (`apps/hosted-sellers/scripts/deploy.ts`) |
| Ethereum Sepolia (chain 11155111) | The phase-one contracts and their tUSDC test token, which the live demo settles on: first deployed in the cutover of 2026-11-13 (below), and in their fixed version since 2026-11-19. Earlier deployments still settle the deals opened on them | `contracts/src/` at the record's `commit`; addresses and margins in `contracts/deployments/sepolia.json`, the EIP-712 domain in each node's `/v1/status`; earlier deployments in the dated records beside it (`sepolia-<date>-domain-<version>.json`) | `contracts/script/deploy-sepolia.sh` (T-206, T-383), with a throwaway deployer key |
| escrow.stream, www.escrow.stream, join.escrow.stream, escrow.stream/agents/test-seller | The old hostnames, kept while the forwarding runs (T-312): the site answers with a 301 to the same path on crow.direct, sign-ups and the test seller with a 308 (a browser sign-up from an old page is served in place). api.escrow.stream and api2.escrow.stream are not redirected: the operators serve both hostnames | `apps/site/worker.js`, `apps/early-access/worker.js`, `apps/test-agents/src/worker.ts` | the same Workers, with the old hostnames as extra Custom Domains and routes |
| npc.here.now/escrow | Old address; a redirect to escrow.stream, which forwards to crow.direct | `reports/redirect/` (not in git) | here.now; no further publishing needed |

All on Rafa's Cloudflare account (its ID is the 1Password item that `config/secrets/cloudflare.refs` names for `CLOUDFLARE_ACCOUNT_ID`). The domains `escrow.stream` and `crow.direct` (Rafa, 2026-11-10) were bought on Cloudflare; crow.direct is the canonical home since T-312's deploy, and Crow Control lives at control.crow.direct since 2026-11-11 (below).

**Demo settings** (vars in `apps/demo-cloud/wrangler.op1.jsonc`): the minimum window (`MIN_WINDOW_SEC`) and the operator fee (`OPERATOR_FEE_BPS`, `OPERATOR_FEE_MIN`, `OPERATOR_FEE_GAS`, optional `OPERATOR_FEE_MAX`; D33, ADR-0023). For the first pilots all three are 0, and Crow's relayer pays the gas (T-389). Read the live values in discovery (`demo.minWindowSec`, `fees.operator`). Live judges: Anthropic and DeepSeek, pinned in `config/judges-live.yaml`, capped at 100 calls a day across both nodes (`LIVE_JUDGE_CALLS_PER_DAY`; 30 before Rafa's decision of 2026-11-24); past the cap, Crow's adjudicators decline new judged deals until the next UTC day, and a deal already being judged gets no stand-in verdict (pull request 741; Rafa, 2026-11-20); without keys, panels are scripted and every verdict says so.

**Abuse limits and quick stops** (T-581, N222). The World object reads its limits from holdback-op1's variables, for both nodes; each is an operator's configuration with a default, never a protocol rule (D31). A refused request changes nothing about the deal: the caller can retry the next UTC day, use another operator, or submit to the rules contract itself.

| Variable | Default | What it limits |
| --- | --- | --- |
| `LIVE_JUDGE_CALLS_PER_DAY` | 100 | Live judge calls a UTC day across the demo, one budget for both nodes |
| `JUDGED_DEALS_PER_PAIR_PER_DAY` | 3 | Deals that can need a panel that Crow's adjudicators take per seller and buyer pair a day, while live judges run |
| `FUNDED_DEALS_PER_CLIENT_PER_DAY` | 100 | Deals the relayer funds per client per node a day |
| `FUNDED_DEALS_PER_DAY` | 200 | Deals the relayer funds a day across every client and both nodes |

A client is an IPv4 address or an IPv6 /64. The faucet's per-client count (50 grants an hour) is kept in the World's storage, so a restart no longer resets it. The sign-up Worker allows 5 writes per 60 s per client (binding `SIGNUP_LIMIT` in `apps/early-access/wrangler.jsonc`). The operators and the sign-up Worker answer on their custom hostnames only (`workers_dev: false`).

To stop spending fast, set one of these to `0` on holdback-op1: `LIVE_JUDGE_CALLS_PER_DAY=0` stops live judging (Crow declines new judged deals), `FUNDED_DEALS_PER_DAY=0` stops every relayer-funded deal, and `JUDGED_DEALS_PER_PAIR_PER_DAY=0` makes Crow's adjudicators decline every judged deal, leaving the budget unspent. `FUNDED_DEALS_PER_CLIENT_PER_DAY=0` also stops relayer funding for every client. Saving a variable in the Cloudflare dashboard makes a new version of the Worker; the World object reads its limits when it starts, so the value applies once the World restarts on that version [inferred]. The next deploy writes the values in `apps/demo-cloud/wrangler.op1.jsonc` and drops the dashboard's, so put the value in that file too. A malformed value of any of these variables stops the World from starting.

**The judged-deal limit sits with Crow's adjudicators, not the operators** (Rafa, 2026-11-24). Crow counts the judged deals it takes per seller and buyer pair (from the signed terms) and UTC day, in the World's storage.

- **As primary,** it counts at acceptance and declines the fourth offer before anyone can agree or fund it. The count holds however the offer reached the settlement layer, through the operators or straight to the rules contract.
- **As fallback or appeal** for an outside primary, it counts the turn before convening a panel. Over the limit, no panel runs and the deal ends by its own deadlines.
- **A declined offer** stays unaccepted and expires by its terms with nothing held, and no relayer gas is spent on it (D29; fixture `neutrality.adjudicator-never-accepts`). The parties can name another adjudicator.
- **Why per pair, not per buyer:** the seller alone signs an offer, so counting per buyer let a stranger's offers lock a buyer out (Opus red team, 2026-11-25). Per pair, a stranger's offers spend only the stranger's own count.

What the limits do not stop [inferred]: addresses cost nothing on a test network, so the per-pair limit only slows a stranger. A judged deal reserves 6 calls once funded, but one that escalates to the appeal panel spends 8, and retries can double that. So 3 deals from one pair can spend up to 48 of the 100 calls a day, and about 3 pairs can hold the whole budget. The hard ceiling is the budget itself: 100 calls a day, one budget for both nodes [measured from the code: the World builds one panel budget (`panelConfig` in `world.ts`), and holdback-op2 serves the same World object]. `LIVE_JUDGE_CALLS_PER_DAY=0` is the stop.

The budget of 100 raises the most a day of live judging can cost about threefold over the 30 before [inferred: spend scales with calls, at most 8,192 output tokens a call]. A provider-side spend limit, item 1 of Rafa's checklist in the security review of 2026-11-21, is the only cap that holds if this code is wrong; with this budget it matters more.

**Schema and domain:** main and the live demo share one schema version and one EIP-712 domain, the domain of the contracts in `contracts/deployments/sepolia.json`. Read the live values in `/v1/status` (`schemaVersion`, `domain`); the build's are in `packages/core/src/eip712.ts` and `spec/schemas/`.

> **A build and the contracts it settles on must share one EIP-712 domain.** A contract change that moves the domain ships as a new deployment: deploy it, update `contracts/deployments/sepolia.json` (and its copy in `examples/deployments.ts`, and the pins in `site/llms.txt`), and only then deploy the Workers and the site. The Sepolia world refuses to start against a contract under another domain (`LiveChain.verify`, `domainMismatch`); the SimChain world and the site have no such check. ADR-0029 §8 has the steps. A new rules contract also means a new world (D49): the Sepolia world refuses to open against another rules address (`apps/demo-cloud/src/world.ts`).

## Secrets

**Every key Rafa holds lives in 1Password, in the vault `Crow`, one item per key** (T-480, roadmap row N137). No command in this repository loads a local env file into its environment. Only the one-time copy and the check read the old `.env`, inside their own process and while it exists, and they print names only. `docs/secrets-inventory.md` lists every variable that holds a secret: who runs the commands that need it, where its runtime copy lives, and which keys serve several jobs today.

- **A references file per job** sits in `config/secrets/`: `judges.refs`, `agents.refs`, `e2e.refs`, and the optional `sepolia-rpc.refs`, `feedback.refs`, `cloudflare.refs` and `github.refs`. Each line is `NAME=op://crow/<item>/credential`, or plain configuration such as a base URL. No line holds a value: `tests/secrets-refs.test.ts` fails on one. A references file never has a name starting with `.env`.
- **Items:** one per key, category API Credential, the key in its field `credential`. The title says where the item's value works and its job. So `op1-judges-anthropic` holds the live judges' Anthropic key on holdback-op1, and `mac-agents-deepseek` holds the benchmark agents' DeepSeek key on Rafa's Mac. References match names without regard to case, so the vault may be called `Crow`.
- **Rafa runs a command that needs keys** in his own terminal, through 1Password's command-line tool `op`: `op run --env-file=config/secrets/<job>.refs -- <command>`. `op` resolves each reference, gives the values to that one command as environment variables, and hides them in its output. The first `op` command in a terminal asks for Touch ID; the approval holds for that terminal until it has been idle 10 minutes, and 12 hours at most. Several jobs: repeat `--env-file`. A file whose item does not exist stops `op run`, so add an optional file only once its item exists.
  - The live judges' keys to holdback-op1: `op run --env-file=config/secrets/judges.refs -- pnpm demo-cloud:secrets`. It builds the JSON in memory and pipes it to `wrangler secret bulk`; nothing is printed or written.
  - The local live demo: `op run --env-file=config/secrets/judges.refs -- pnpm demo --live`.
  - The benchmark agents: `op run --env-file=config/secrets/agents.refs -- pnpm duet run …`, and the same file for `node tools/one-click/bench.mjs … --live`.
  - The Sepolia rounds: `op run --env-file=config/secrets/e2e.refs -- node examples/e2e-round.ts …`, and the same for `examples/e2e-keys.ts`.
- **Agents never run `op`.** An `op` that Rafa has approved in a terminal can read every item his account can see, so it runs only in his own terminal, never in an agent's shell. When an agent needs a command that takes a key, it writes the command for Rafa and stops there. This is policy today: agents run as Rafa's macOS user, so they can also read the environment of a command he runs under `op run` while it runs. T-480's design names the two separations that make it hold by construction.
- **To add a key:** create the item in the 1Password app (vault `Crow`, category API Credential, the key in `credential`, the title by the rule above). Then add its line to the job's references file, or a new `<job>.refs`, in a pull request. A key the code generates, such as a Worker's signing key, never passes through 1Password: the script that makes it pipes it straight to the Worker (below).
- **The check:** `op run --env-file=<file> -- node scripts/secrets/check.mjs <file>` prints, per name, whether the variable is set and whether it is short or plausible, never the value. While the old `.env` exists it also says whether 1Password's value is the same as the file's, and names the file's variables that no references file lists. It exits 1 when a name is not set.
- **The move from the local file, once:** `node scripts/secrets/copy.mjs` creates the item for each key the local `.env` holds and the references name, passes each value to `op` on standard input, prints names only and never changes an existing item. Rafa runs it himself; T-480's Handoff has the steps.
- **When `op` asks for approval:** a Touch ID prompt from 1Password names the terminal app that asked. Approve it only for a command you started yourself. A prompt you did not expect means some process in that terminal session called `op`: deny it.
- **The Sepolia relayer key** (D41, ADR-0028) is the Worker secret `SEPOLIA_RELAYER_KEY` on holdback-op1, made by `node apps/demo-cloud/scripts/relayer.mjs`: it generates a fresh key in memory, pipes it to `wrangler secret bulk` and prints only the public addresses. It is a Sepolia-only gas payer with no role in any contract, and it refuses to replace an existing key (`--replace` overrides; the old lanes' Sepolia ETH would be stranded). Set 2026-11-03; its funding lane is `0x601137a8DE7E195E1426f57C053aFa49B20Ef555` (Rafa funds this one; Crow Control reads this line when discovery is down), and the world tops up its deal lanes from it. Discovery lists both under `demo.relayer` (`fundingLane`, `dealLanes`). Optional secret `SEPOLIA_RPC_URLS` (comma-separated keyed URLs, tried before the public ones); optional variable `SEPOLIA_MAX_FEE_GWEI` (default 20).
- **The test seller's secret** (D47, T-222) is the Worker secret `TEST_AGENTS_SEED` on crow-test-agents, made by `node apps/test-agents/scripts/seed.mjs`: it generates 32 random bytes in memory, pipes them to `wrangler secret bulk` and prints only the intake's public encryption key. Every key the seller uses derives from it (`apps/test-agents/src/keys.ts`). It is Sepolia-only, holds no ETH (the operators pay the gas) and guards worthless test tokens; it refuses to replace an existing secret (`--replace` overrides, which gives the seller a new address and a new intake key).
- `wrangler` uses Rafa's OAuth login on his Mac, or `CLOUDFLARE_API_TOKEN` (scoped to Workers and KV) in an isolated environment. On the Mac the token can come from 1Password instead: `op run --env-file=config/secrets/cloudflare.refs -- npx wrangler@4.151.3 …`. The OAuth login keeps its token in a file in Rafa's home folder that any process he runs can read, agents' shells included; T-480's design moves agents' deploys off it.
- **Runtime secrets reach the Workers without a file on disk.** Each script builds its secrets in memory and pipes them to `wrangler secret bulk` on standard input: `pnpm demo-cloud:secrets` (the judges' keys, from `op run`), `relayer.mjs` and `seed.mjs` (generated in memory), and the hosted sellers' `secrets.ts` (the API key typed at a hidden prompt). Cloudflare never shows a Worker secret's value again, in the dashboard or in Wrangler, so 1Password holds the copy of every key that comes from outside, and a generated key has no copy at all: replacing it means a new key.

## Deploy

Always build and check before deploying; deploy only what changed. Deploys run as whoever runs them: an agent with Rafa's go-ahead (or within an approved task), using wrangler's OAuth login on Rafa's Mac or `CLOUDFLARE_API_TOKEN` in an isolated environment. Wrangler is pinned to one exact version, `npx wrangler@4.151.3`, in every script and command (T-518): the old major-only pin ran whatever 4.x was newest that minute, with the Cloudflare login. Move the pin only to a version public for 14 days or more, in all files at once (`tests/install-rules.test.ts` refuses a mix).

```sh
# the site: builds, runs site/check.mjs, deploys, checks the live page, llms.txt and try.mjs, and rolls back on its own
pnpm site:deploy

# the operators (op1 first: it defines the Durable Object); keeps the custom domains in the wrangler files.
# It checks itself with one test deal and rolls back on its own: "A demo deploy", below
pnpm demo-cloud:deploy

# a live end-to-end deal against the deployed nodes (the deploy runs one; deal.ts runs on SimChain only)
HOLDBACK_OPERATORS=https://api.crow.direct,https://api2.crow.direct node examples/try.ts

# early-access sign-ups (T-413): deploys, waits for join.crow.direct/version.json to name the commit, and rolls back on its own
node apps/early-access/deploy.mjs
npx wrangler@4.151.3 kv key list --binding EMAILS --config apps/early-access/wrangler.jsonc --remote

# the list of who uses Crow (T-486, D76): the same Worker and the same store, under the prefix listing:, once the
# Worker is deployed with POST /listing. A person reads the listed websites out, then checks each for a Crow card.
# The list is private: write the file under reports/, which git ignores, or outside the repository.
# Type the prefix exactly, "listing:". The same store holds the sign-up emails under "email:", and a read-out with
# no prefix, or a mistyped one, writes people's email addresses into the file. The script refuses such a file whole:
# it says how many entries are not listed websites, checks none, echoes none and exits 1. Then delete the file.
# A run shows each listed site this machine's IP address and the time of the run.
npx wrangler@4.151.3 kv key list --binding EMAILS --config apps/early-access/wrangler.jsonc --remote --prefix listing: > reports/listing-keys.json
node scripts/listing-check.mjs reports/listing-keys.json

# Crow's test seller (T-222): deploys, waits for /health to read operational, and rolls back on its own
node apps/test-agents/scripts/deploy.mjs

# Crow's test buyer (T-239): the same Worker and the same command; then check the buyer and run one deal
node apps/test-agents/scripts/deploy.mjs
curl -s https://crow.direct/agents/test-buyer/health
node apps/test-agents/scripts/sell-to-test-buyer.mjs
```

**Every deploy script ends by asking for a Crow Control build** (N166, `scripts/deploy-lib.mjs` `finishDeploy`): after a deploy that may have changed what runs, it starts the console's workflow by hand (`gh workflow run control-hourly.yml --repo rafaeldavid/crow-ops-private --ref main`), which always builds. So the page shows the deploy within about 5 minutes, not after its two-hour wait between automatic builds. Without `gh` or access it says so in one line and the deploy's exit code stays the same. A refusal before upload, a dry run and a check-only run ask for none.

**Every deploy script starts with a pre-flight** (T-313, `scripts/deploy-lib.mjs`). It refuses, with exit code 2 and before any build or upload, a checkout whose tracked files differ from its commit, and one that lacks origin/main's commits after a fresh fetch. So a deploy uploads the commit its record line names, and never an old wrangler file. Untracked files are fine.

**A demo deploy** (T-234; Rafa's go-ahead first, as for every deploy):

1. From main at the commit to deploy, run `pnpm demo-cloud:deploy`. It builds, reads each Worker's live version (its rollback target), deploys holdback-op1 then holdback-op2, and waits until both nodes answer `/v1/status` 200. It then runs one `examples/try.ts` deal against both operators, which must end Released within 180 s.
2. It exits 0 on a pass. It exits 1 when an upload is refused or a later step fails, after it rolls back each Worker that changed. It exits 2, before any upload, when the deal guard refuses (below).

**The deal guard** (ADR-0036, T-377) runs after the build and before any upload. It reads the commit the live build names in discovery (`demo.build.commit`), that commit's `apps/adjudicator/src/kept-policies.json` (a commit from before the file carries exactly its registered defaults), and the open deals through the public reads: `GET /v1/adjudicators`, each adjudicator's deals from its acceptance until no adjudicator can decide them (`GET /v1/commitments?party=<address>&role=adjudicator&escrowState=…`, a Released or Refunded deal while its appeal is open), and each deal's `/terms` for its policy and registry hashes. Then:
- it refuses, with exit code 2, a deploy after which an open deal the live build can judge could no longer be judged, and prints each such deal with its state and next deadline;
- it refuses a new default the live build does not carry. **A new default ships in two deploys:** the first carries the new version or registry, a later one makes it the default in `kept-policies.json`, so an automatic rollback always lands on a build that can judge every open deal;
- it warns and goes on when it cannot read the open deals: the deploy may be the fix for the outage that broke the read, and the static check (`apps/adjudicator/src/bound-policy.test.ts`) has passed in CI;
- it counts a Released or Refunded deal as open while its appeal is open or may still be filed;
- it counts only the registries the live adjudicators use, since a deploy keeps the Worker's secrets;
- it reports, and does not check, a deal an outside primary accepted under a policy this operator never registered, and refuses a deal its own primary accepted under a policy it cannot index (add the released policy's other fields to `policyParams` in `kept-policies.json`).

So any open deal no longer blocks a deploy: only a deploy that drops what an open deal needs does. **The one override** is `HOLDBACK_DEPLOY_WITHDRAWN=<version or registry hash>`, for a version withdrawn by a recorded decision (ADR-0036 §2): `kept-policies.json` must mark it `withdrawn` with the decision and the reason, and `docs/decisions-today.md` records the deals it leaves unjudged. The guard then lets through only the deals orphaned by that withdrawal, lists them in the record line, and still refuses every other orphan. Under the override the script does not roll back on its own, since the rollback targets would judge under the withdrawn version.
3. Paste the Markdown line it prints into this file's deploy record (the last section), under a heading for the task, newest first. The line gives the date, the commit and its branch, each new version and its rollback target, the smoke deal's ID and time, and pass or fail.

**A deploy that changes the screen version needs no wait for open deals** (ADR-0036, built by T-377): the build keeps each released screen version in `apps/adjudicator/src/kept-policies.json`, and the deal guard above refuses a build that drops one an open deal needs. A new default screen still ships in two deploys.

**To roll back by hand**, use the rollback targets the line names, both operators together:
- `npx wrangler@4.151.3 rollback <holdback-op1 target> --name holdback-op1`
- `npx wrangler@4.151.3 rollback <holdback-op2 target> --name holdback-op2`

**Crow's test seller, the first deploy** (D47; Rafa's go-ahead first). Done on 2026-11-04. Since T-313 the script reads the live version before it uploads, so a Worker that was never deployed takes its first upload from `npx wrangler@4.151.3 deploy --config apps/test-agents/wrangler.jsonc` by hand; every later deploy uses the script. The site's one command buys from the test seller, so the seller goes live before the site that names it:

1. `node apps/test-agents/scripts/deploy.mjs`: the Worker, its Durable Object and its routes `crow.direct/agents/test-seller*` and `escrow.stream/agents/test-seller*`. The route takes that path before crow-site's Custom Domain, as Cloudflare documents. If it does not, switch the route to the Custom Domain `agents.crow.direct`, and change `SELLER_URL` and `TEST_SELLER_URL` in `site/build.mjs` to match.
2. `node apps/test-agents/scripts/seed.mjs`: sets `TEST_AGENTS_SEED`.
3. Check that `https://crow.direct/agents/test-seller/health` reads `operational`, and that `https://crow.direct/` is still the site.
4. Measure which client IP the operators see for the seller's calls: the seller and the operators share the zone, so `cf-connecting-ip` follows `x-real-ip`, which the seller never sets (research note, section 5). It needs the faucet about once a month, so a shared bucket does not bind.
5. Run one deal: `node site/try.mjs --seller https://crow.direct/agents/test-seller`, then once with `--outcome refund`. Record the transactions in T-222's Evidence.
6. Publish the site (above).

If the seller is down or busy, `try.mjs` plays both sides and says so, so a site published first still completes a deal. **The mandate runs out after 30 days.** The seller asks the faucet for a fresh one 2 hours before. With T-223 (PR 191) each grant signs a new 30-day mandate. Operators that do not yet run T-223 return the address's existing mandate (D47), so the seller marks itself degraded and its health line reads `degraded`. In that case Rafa deploys the operators, or rotates the secret with `seed.mjs --replace`; a world reset also clears it.

**Crow's test buyer, the first deploy** (T-239; Rafa's go-ahead first). The buyer runs in crow-test-agents beside the seller, on the route `crow.direct/agents/test-buyer*` with `BUYER_URL` set (`apps/test-agents/wrangler.jsonc`). Its key derives from `TEST_AGENTS_SEED` under its own label, so it needs no new secret. It takes its test tUSDC and its mandate from the faucet, and holds no ETH.

1. `node apps/test-agents/scripts/deploy.mjs`: uploads the Worker with the new route. The script's checks read the seller's health only.
2. `curl -s https://crow.direct/agents/test-buyer/health` should read `"status": "operational"`, and `https://crow.direct/agents/test-buyer/agent.json` a `crow-buyer` card.
3. `node apps/test-agents/scripts/sell-to-test-buyer.mjs` plays an outside seller with fresh keys and should end `released`; add `--outcome refund` to see a refund. Record the transactions in T-239's Evidence.

**Hosted sellers, the first deploy of one** (T-436, ADR-0037; Rafa's go-ahead first, and the secrets are his). Each hosted seller is its own Worker, `crow-seller-<slug>`, on the routes `crow.direct/agents/<slug>` and `crow.direct/agents/<slug>/*`, with one Durable Object that holds its deals. Its configuration lives in a private folder, never in this repository: `hosted.json` (the slug and the card), `adapter.json` (the adapter configuration) and the files `adapter.json` names. `apps/hosted-sellers/example/seller/` shows the shape for a made-up seller. Run every command from a detached worktree of the public repository at `origin/main`, built with `pnpm install --frozen-lockfile && pnpm -r build`. `<folder>` is the seller's private folder, `<id>` the account the configuration pins (`sellerApi.workspace.id`, or `none`), and `<out>` a directory outside every repository, made with `mkdir -m 700`.

1. `node apps/hosted-sellers/scripts/local-run.ts`: one whole deal in Cloudflare's local runtime against the job stub, with nothing leaving the machine. It should end `local-run: pass`.
2. `node apps/hosted-sellers/scripts/deploy.ts --seller <folder> --workspace <id> --dry-run`: checks the folder and the account, prints the bundle's SHA-256, and bundles with Wrangler without uploading.
3. `node apps/hosted-sellers/scripts/deploy.ts --seller <folder> --workspace <id> --first`: creates the Worker and its routes. It passes once `/health` answers for this bundle, degraded, since the Worker has no secrets yet. If it fails after the upload, the Worker stays up with no secrets and no deals: go on to step 4, or remove the Worker with Wrangler and start again.
4. `read -rs 'API_KEY?API key: ' && printf %s "$API_KEY" | node apps/hosted-sellers/scripts/secrets.ts --seller <folder> --credentials-out <out>; unset API_KEY`: zsh asks "API key:" and shows nothing you type, and the key stays out of the history and the process list. It sets, in one `wrangler secret bulk`:
   - `HOLDBACK_KEY`, a fresh signing key generated in memory and never shown (it prints the address);
   - the company's API key, under the variable `sellerApi.auth.env` names, from what you typed;
   - fresh values for `quoteAuth.env`, `redelivery.readyAuth.env` and `alerts.secretEnv`, each also written to `<out>/<slug>.*.credential` (mode 0600).
   It refuses to replace a secret that is already set. `--replace` overrides, gives the seller a new address, and waits for a seller with no open deal. It also refuses when a credential file is already in `<out>`, before writing any.
5. `node apps/hosted-sellers/scripts/deploy.ts --seller <folder> --workspace <id> --check-only`: passes when `/health` reads operational for this bundle and `/agent.json` serves the seller's card. Right after step 4 it can take up to 7 minutes, since an active object keeps its old code for up to 300 s. Then `curl -s https://crow.direct/agents/<slug>/health` shows the same SHA-256 that step 2 printed.
6. Hand the buyer the page `https://crow.direct/agents/<slug>` and the quote credential from `<out>`, outside any shared channel. The ready credential is Rafa's: it opens `POST /deals/<id>/ready` and `/job` (`site/ref/seller-adapter.txt`). The alert secret, when the configuration names one, goes to whoever runs the alert callback. The seller's address is in the card, and its payout address in the configuration.
7. Add the record line each deploy prints to "Deploy record" below.

A later deploy is step 5's command without `--check-only`. It refuses while a deal is at `starting` (the deal guard), or when the live seller does not answer three reads. Then it uploads with deferred code updates, checks the seller for up to 7 minutes, and rolls back on a failed check. A hosted seller keeps its open deals across deploys: its object's name does not change. Before a contracts cutover, read each hosted seller's `/health` for open deals.

**A world changes in place (D49).** The Sepolia world replays nothing on open, and each deal's book carries its own rulebook. So a rulebook change, an additive schema bump or a code deploy keeps the world names as they are, and deals open at the deploy continue. A new world is for a new rules contract or another chain only; record the switch in the deploy record (below). The SimChain world still replays its journal on open, so a rulebook change there needs a new `sim` name (2026-11-02: v0.8 refused v0.7's offers with `rulebook_unknown`). Check `schemaVersion` in `/v1/status` after a deploy, and run `npx wrangler@4.151.3 tail holdback-op1 --format json` if it is wrong.

**When a world changes** (D49): Rafa approves the redeploy. Switch while no deal is open on the old world, or send its permissionless timeouts afterwards and record them. Record in the deploy record (below) the old world's name, rules address and deployment file, the new world's, and the Worker versions. Never delete a world's storage: a rollback of both Workers serves it again.

Workers rules learned the hard way (T-029, T-233): generate no code, at startup or inside a request. Core's validators are compiled ahead of time (T-233): a compile inside a request fails with error 1101, and one at startup spends the 1 s startup CPU limit (code 10021). A failed Durable Object alarm must be re-armed. Deploy only from a branch that has merged main, or a deploy can drop the custom domains.

## Security headers (T-451, T-462)

**Each public Worker sets its security headers in one function, on every answer on its way out.** The site's is `secured()` in `apps/site/headers.js`: HSTS, nosniff, `X-Frame-Options: DENY`, a referrer policy and a permissions policy on every answer, and on HTML pages a content security policy and the cross-origin opener and resource policies. The policy allows scripts and styles from the site and the inline ones the build wrote: `site/csp.mjs` hashes them into `csp-hashes.json` at the build's root, the Worker reads that file once per instance, and `site/check.mjs` (group 18) fails a build whose pages carry inline code the policy would block. A page that adds an inline script needs no edit here: the next build hashes it. A page that calls a new outside origin, or loads a script or stylesheet from one, needs that origin added in `headers.js`. The operators' is `secured()` in `apps/demo-cloud/src/headers.ts`: HSTS, nosniff, no framing, no referrer and a same-origin resource policy, with CORS and `Cache-Control` left as the World writes them. Neither touches a body, so the pinned bundles keep their hashes. `docs/tasks/T-451-security-headers.md` has the headers as measured before and after.

**The test agents and early access use the operators' set, imported and not copied (T-462).** crow-test-agents (`apps/test-agents/src/headers.ts`) and crow-early-access (`apps/early-access/worker.js`) pass every answer through a `secured()` that sets `API_HEADERS` from `apps/demo-cloud/src/headers.ts`, so a change to the operators' set reaches both. The test seller's and test buyer's HTML cards also get their own content security policy, which allows their one inline style (`CARD_STYLE`) by its hash and nothing else, and a same-origin opener policy. Each Worker's CORS, `Cache-Control`, statuses and bodies are unchanged: crow.direct's pages still post sign-ups to early access across origins. `docs/tasks/T-462-security-headers-other-workers.md` has the measurements.

**Plain HTTP is redirected, never served.** The operators, the test agents and early access answer a plain-HTTP request with a 301 to the same path and query over HTTPS for a read (GET, HEAD) and a 308 for a write, which a client follows with the same method and body or not at all. The site answers every plain-HTTP request with a 301, straight to crow.direct for the old hostnames. Local runs (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`) stay on HTTP.

## Settlement: SimChain or Sepolia (D41, ADR-0028)

Each operator Worker has a variable `SETTLEMENT`, `sim` or `sepolia`, in its wrangler file. It picks the world the Worker forwards to, by `WORLD_NAMES` in `apps/demo-cloud/src/worker.ts`: the SimChain world by its fixed name, and the Sepolia world named by the record's rules address (`holdback-public-demo-sepolia-<rules>`, since T-383), so the Sepolia name moves with a new rules contract and with nothing else (D49). The earlier worlds keep their storage for a rollback of both Workers; each cutover's entry below names them. The two worlds never share storage. The Sepolia world runs the phase-one contracts: no party appeals and no bonds. A new SimChain world runs the phase-one rules too unless it is created with the full protocol (`simProfile` in `apps/demo-cloud/src/world.ts`), and it keeps the profile it was created with. A world records its settlement when it is created and keeps it; the Durable Object always runs holdback-op1's code and environment, so the Sepolia secrets live on holdback-op1 whichever Worker a request came through.

**One domain per build:** the build signs under the EIP-712 domain in `packages/core/src/eip712.ts` and settles on the deployment `contracts/deployments/sepolia.json` names. A Sepolia world started against a contract under another domain refuses to start (on 2026-11-04 it read "the rules contract signs under EIP-712 domain "Holdback" 0.6, this build under "Holdback" 0.7"). Deals opened on an earlier deployment finish on it: every timeout there is permissionless. The dated records of the earlier deployments sit beside `sepolia.json` (`sepolia-<date>-domain-<version>.json`).

**What the Sepolia world needs before any Worker flips:** `contracts/deployments/sepolia.json` on main (T-206; the build embeds it), its copy in `examples/deployments.ts`, the relayer secret on holdback-op1 (above), and Sepolia ETH on the funding lane. On its first passes the world checks the RPC and the contract, then tops up the deal lanes. It bonds no one: the phase-one contracts have no bond vault (ADR-0031 §8).

**A redeploy of the contracts** follows the runbook [`redeploy-contracts.md`](redeploy-contracts.md), drawn from the phase-one cutover of 2026-11-13, whose dated record is [`cutover-phase-one.md`](cutover-phase-one.md).

**A rollback to SimChain** follows the procedure of the 2026-11-03 cutover (the Deploy record, T-213, "Rollback"): set `SETTLEMENT` back to `sim` on both wrangler files and run `pnpm demo-cloud:deploy`, then deploy the previous site build.

**Watching it:** `/v1/status` reports `settlement: {kind: "chain", chainId: …}` with the record's chain and the domain's `verifyingContract`; discovery's notes name the contracts, the funding lane and the explorer, and `demo.relayer` lists the funding lane and the deal lanes. Relayer balances are public on Etherscan. When a lane runs out of gas, writes on it answer `relay_refused` (the signed message stays valid elsewhere) and the faucet stops minting; top up the funding lane. Each money step waits for a block, so a test deal takes about a minute; a write that waits more than three minutes for its receipt answers 500. If its transaction lands later, T-219's in-flight row and T-218's log sync bring the operators' view of that deal up within a pass (live since T-220's deploy; the chain, not the view, holds the money).

## Telemetry (T-031)

The operator nodes keep only what they already see (ADR-0024 §1, D39), in the World Durable Object and the account's Workers Logs. Nothing is served or published; publishing any aggregate (a status or stats page) is Rafa's gate. Code: `apps/demo-cloud/src/telemetry.ts`.

- **Request log:** one line per request: Request-Id, time, node, method, route template, status, problem type, milliseconds. Never a body, a header value, an IP address, or the path (it carries addresses and IDs). Kept in World storage under `rl:<UTC hour>` for seven days, then deleted. `world.telemetry.lookup(requestId)` finds a line; the nodes' notes tell agents to quote the Request-Id.
- **Summary lines:** a `telemetry: "hour"` line when each hour ends and a `telemetry: "day"` line when each UTC day ends, written with `console.log` by the World. The World flushes at most once a minute, and an idle instance flushes waiting log lines on a timer. A line is written at the first flush after its hour ends, so a quiet hour's line can come late, at the next wake.
- **Quota warnings:** an `alert: "durable-object-quota"` line (`console.warn`) when today's use passes 80% and again at 95% of a Free-tier daily limit. The account is on Workers Paid, where those numbers are not limits, so the line is an activity signal, not a cost or outage one. Adjudicator passes run only while a case waits for one, or while a Sepolia world's setup is unfinished ("Durable Object use" below).
- **No invocation logs:** both wrangler files set `observability.logs.invocation_logs` to false, because Cloudflare's invocation logs record every request's headers, which carry `Authorization` (ReadTokens) and the caller's IP. Console lines and uncaught exceptions are still kept. `wrangler tail` still shows live requests, headers included, and stores nothing.

Read the lines in the dashboard: Workers & Pages, then holdback-op1, then Observability (or Durable Objects, then the World namespace, then Observability), and filter on `telemetry` or `alert`. Live: `npx wrangler@4.151.3 tail holdback-op1 --format json`. Workers Logs keeps them 7 days on Workers Paid.

| # | Metric | Field (hour and day lines unless noted) |
| --- | --- | --- |
| 1 | Requests per route | `routes["<METHOD> <route>"].requests` |
| 2 | Errors per route | `routes[…].clientErrors` (4xx), `serverErrors` (5xx) |
| 3 | Latency per route | `routes[…].p50Ms`, `p95Ms` |
| 4 | Problems by type | `routes[…].problems` |
| 5 | 429s by bucket | `throttled.read`, `write`, `faucet` |
| 6 | Durable Object use against the Free-tier daily numbers (an activity signal on Workers Paid) | `usage.requests`, `rowsRead`, `rowsWritten` as `{used, limit, percent}` (day); `usageToday` (hour) |
| 7 | Journal size and replay cost | `journalEntries` (day); `usage.wakes`, `replayRowsRead`, `replayMs` |
| 8 | Live judge calls and tokens | `liveJudges` (day); today's count is also in discovery, `demo.judges` |
| 9 | Deal funnel | `deals.offered`, `funded`, `delivered`, `decided` (a judgment or an early accept), `final` (settled and final: at the decision on a phase-one world, past every appeal on SimChain under the full protocol; an expired offer counts under `outcomes`): `.deals`, deals reaching the stage that day (day) |
| 10 | Time per stage | `deals.<stage>.medianSecFromPrevious` (day) |
| 11 | Outcomes | `outcomes.released`, `refunded`, `reclaimed`, `settled`, `expired`, `escalated`, `appealed` (SimChain under the full protocol only), `defaulted` (day) |
| 12 | Prepare against submit | `conversion.<kind>.prepared`, `submitted` (2xx only) |
| 13 | First-try success | `signers.firstDealCompleted` of `signers.fresh`: parties whose first signed event was that day, and how many of their first deals have settled and are final (day) |
| 14 | Active signers | `signers.active`: parties that signed that day, a count (day) |

Funnel and signer numbers come from settlement events and each deal's finality only; no address leaves the computation.

**Durable Object use.** The account is on Workers Paid (since 2026-11-02, per Rafa). Each month that includes 1 million Durable Object requests (alarm invocations count), 400,000 GB-s of duration, 25 billion SQLite rows read and 50 million rows written, account-wide; use past that is billed (about $0.15 per million requests, $12.50 per million GB-s, $0.001 per million rows read, $1.00 per million rows written), not refused (Cloudflare pricing, read 2026-11-03). As a daily pace that is about 33,000 requests, 13,000 GB-s, 833 million rows read and 1.7 million rows written. The World still measures its use against the Free tier's daily numbers (100,000 requests, 5,000,000 rows read, 100,000 rows written), which no longer stop anything and do not match the paid pace: requests pass the paid pace well before the 80% alert, and the row alerts fire at a small fraction of it. Before T-057, the SimChain world's per-second alarm, active all day, would have used the month's included requests in about 12 days and about 324,000 of the 400,000 GB-s (inferred: one request a second, 128 MB). Since T-057 either world, SimChain or Sepolia, runs an adjudicator pass only while a case awaits a demo adjudicator or a Sepolia world's setup is left (next list; ADR-0028 §5 as amended). The World counts every key a `get`, `list`, `put` or `delete` touches and every `setAlarm` as one row, as Cloudflare bills them. Internal rows are not counted, so the estimate is a lower bound.

- Daily while the demo is in use: search Workers Logs for `durable-object-quota`, and compare with the authoritative numbers in the dashboard (Storage & databases, then Durable Objects: account usage; the World namespace's Metrics tab), or the GraphQL Analytics API datasets `durableObjectsInvocationsAdaptiveGroups`, `durableObjectsPeriodicGroups` and `durableObjectsStorageGroups`.
- Near a limit: read the day line's `usage`. Each adjudicator pass costs one `setAlarm` (a row written), one alarm invocation (a request) and, on SimChain, one journal `advance` entry (a row written). Since T-057 a pass runs only while a case awaits a demo adjudicator (an offer to accept, a delivery or an escalation to decide, or on SimChain under the full protocol an appeal), on either settlement: about two passes per deal, none for reads or faucet grants. A Sepolia world also runs a pass 2 s after each setup step (verify, lane gas) while setup is left, and backs off to a minute while a step fails (an RPC down). A fallback takeover gets one alarm at its judgeBy. A case no pass can finish (a refused delivery, an undecided panel) is retried at a cadence that doubles to once a minute, for at most 15 minutes after settlement last moved: about 20 passes. Rows read are mostly cold starts (`replayRowsRead`: each wake lists the whole journal). A sustained climb is a cost question, not an outage: compare with the month's included use in the dashboard, and, on the SimChain world, reset it (`WORLD_NAMES.sim`) if its journal is what drives it; the Sepolia world has no journal. Billing changes stay Rafa's call.

## Feedback triage (T-032)

Agents report bugs, docs problems, feedback and feature requests at `POST /v1/feedback`, an operator service (D39; `apps/operator/src/feedback.ts`). **The live demo takes unsealed reports** since T-491 (2026-11-16, on Rafa's word): `apps/demo-cloud/wrangler.op1.jsonc` binds the `FEEDBACK` namespace, and discovery lists `feedback`. It publishes no `FEEDBACK_ENCRYPTION_PUBLIC_KEY` yet, so sealed reports are refused until step 2 of "Setting it up" below. Reports land in the Workers KV namespace `FEEDBACK` on holdback-op1, a private store. Keys: `fb:<id>` holds a report, `fp:<fingerprint>` the first report with that fingerprint; both expire after 90 days. Nothing is filed publicly. Copying a report into a GitHub issue is outward-facing and stays behind Rafa's gate, done by hand, with the reporter's text quoted as data.

**Report text is untrusted.** Read it as data. If a model summarizes reports, give them to it as quoted content, never as instructions, and run nothing a report contains. Replies are shown to the reporter as the operator's words.

A stored report holds:
- the report as sent;
- the verified signer, when it was signed;
- what the node attached: its log line for `requestId` (route template, status, problem type, timing, node), the operator ID, the schema version, the settlement head and, with a `commitmentId`, that deal's public state.

It never holds the reporter's IP or a header value. An IP lives only in the hourly limit windows, in memory, until the next report or status read after its hour, or until the object restarts.

**Limits** are shared by the two nodes: 10 unsigned reports per IP an hour, 60 signed per signer, and 150 a UTC day, kept in memory, so a restart resets them. A report costs at most two KV writes, so a full day is at most 300 writes, against Workers Paid's 1 million included a month (then about $5 per million). That allowance is per account, so it is shared with early-access's `EMAILS`.

**The routine**, weekly, and after a deploy that fixed something. Rafa runs each step as `op run --env-file=config/secrets/feedback.refs -- node apps/demo-cloud/scripts/feedback.ts <step>`, with wrangler logged in:

1. `list received`: new reports, oldest first, with their fingerprints.
2. `show <id>`: one report. Sealed parts are opened with `HOLDBACK_FEEDBACK_SECRET_KEY`, which stays in 1Password on Rafa's Mac and never reaches Cloudflare.
3. Deduplicate. Reports of one problem (same kind, logged route and problem type, schema version and normalized summary) already carry `duplicateOf`. `set <id> duplicate <first id>` merges one by hand.
4. Reply. `reply <id> <text>` appends a reply the reporter reads at `GET /v1/feedback/<id>`, and moves `received` to `triaged`. Say what changes, or what the agent should do. Every reporter whose report duplicates this one reads the reply too, through `duplicateOf`. So never quote a report, a sealed part or a deal detail in a reply.
5. Close. `set <id> fixed <commit or PR>` once the fix is deployed, or `set <id> wontfix` after a reply that says why.

**Setting it up** (Rafa's gate, once):

1. Create the store: `npx wrangler@4.151.3 kv namespace create FEEDBACK`. Add `"kv_namespaces": [{ "binding": "FEEDBACK", "id": "<id>" }]` to `apps/demo-cloud/wrangler.op1.jsonc`.
2. For sealed reports, create the 1Password item `mac-feedback-sealing` (Secrets, above) and let 1Password generate its `credential`: 43 characters, letters and digits only. That string is 32 bytes in base64url, the form the script needs (measured with Node's decoder). `op run --env-file=config/secrets/feedback.refs -- node apps/demo-cloud/scripts/feedback.ts public-key` prints the public key; set it as the var `FEEDBACK_ENCRYPTION_PUBLIC_KEY` in `wrangler.op1.jsonc`. It is public, and discovery serves it as `feedback.encryptionPublicKey`.
3. `pnpm demo-cloud:deploy`.

Without the binding, `/v1/feedback` answers 404 `not_found` and discovery has no `feedback`. Without the key, the nodes take unsealed reports only.

## Sepolia contracts (T-206)

The fixed version of the phase-one contracts is deployed on Ethereum Sepolia since 2026-11-19, a public testnet whose coins are worthless; the record's `chainId` names the chain. Models from two families reviewed them; an outside firm's automated scan read the first version and its fix review read the fixed version; no human audit has run (`docs/audit/scope.md`, `docs/audit/outside-scan.md`). Addresses, transaction hashes, blocks, constructor arguments, the commit and the compiler settings are in `contracts/deployments/sepolia.json`. Read them from there, not from this page. The live demo settles on them (T-213, behind the `SETTLEMENT` flag).

- **What the script deploys** (the phase-one contracts, ADR-0031, ADR-0032 and ADR-0033):
  - Commerce Payments' `AuthCaptureEscrow` with its ERC-3009 collector, the only funding path (ADR-0031 §3).
  - `DrandQuicknetBeacon`.
  - A new tUSDC test token (below).
  - `HoldbackRules`, with its six constructor arguments: the escrow, the collector, the expiry margin, the beacon, the one token, and the beacon margin (ADR-0032); the record names both margins (`expiryMarginSec`, `beaconMarginSec`) and the script sets each once. All are fixed at deploy, and the constructor refuses a zero address.
  - Multicall3 is the canonical contract already on Sepolia, and the script checks its code hash; the collector uses it.
  - None of these contracts has an owner, pause or upgrade path, so the deployer key has no power over them.
- **Token.** `TestUSDC` ("Crow Test USDC", tUSDC, 6 decimals, EIP-712 version "1"; D42). It has USDC's ERC-3009 interface and anyone can mint it. It is not Circle's USDC.
- **How.** `DEPLOY_CROSSCHECK_RPC=<second-rpc-url> contracts/script/deploy-sepolia.sh <rpc-url> <keystore-file> <password-file>` runs one `forge create --broadcast` per contract, with no `forge script` and no `cast send`. It:
  - refuses any chain except Sepolia;
  - refuses a `contracts/src`, `lib`, build config or `script/TestUSDC.sol` that differs from the commit;
  - checks that each transaction succeeded, came from the deployer, and carried this build's creation code with its encoded constructor arguments;
  - checks every wiring getter, in the rules contract (`ERC3009_COLLECTOR`, `EXPIRY_MARGIN`, `BEACON_MARGIN` among them) and the collector;
  - checks that the beacon's code hash matches the compiled `DrandQuicknetBeacon`;
  - checks that the beacon verifies drand round 1000, and refuses a signature outside G1 or another round's signature with `InvalidSignature`;
  - checks the token's EIP-712 domain;
  - on Sepolia, refuses to start without `DEPLOY_CROSSCHECK_RPC`, a second RPC from another provider, which must hold each creation as final before the record is written (T-410);
  - writes the JSON.
- **Check it.** `contracts/script/deploy-sepolia.sh --check <rpc-url>` deploys nothing and is read-only. It runs the same checks from the recorded addresses and the checkout's build. It ties each address to the transaction that created it. Then it fails unless the record it derives equals `contracts/deployments/sepolia.json`. Run it from a checkout whose build inputs equal the recorded commit's. Every check fails closed: an RPC error is a failure, never a pass.
- **Rehearse first** on a fork: `anvil --fork-url <sepolia-rpc> --fork-block-number <a recent block> --hardfork prague`. Without `--hardfork prague` the fork lacks EIP-2537 and the beacon check fails.
- **The deployer.** A key used only on Sepolia, whose address is in the JSON. Since 2026-11-19 it is a new key (Rafa: "New key"), in an encrypted Foundry keystore in a 0700 folder outside every repository on Rafa's Mac, with its password in a 0600 file next to it; a session may pass both to the deploy script by path, never read them. The first version's deployer stays in `~/.foundry/keystores/`, Rafa's own. It only pays gas. Never print the key or the password, and never put either in `.env*`.
- **Source verification.** `contracts/script/deploy-sepolia.sh --verify <rpc-url>` runs `--check` first, then verifies the five contracts' source on Sourcify through its API v2 (`scripts/sourcify-verify.mjs`, T-410), with no key and no account. `VERIFY_DRY_RUN=1` runs the check and sends nothing. Etherscan is not part of `--verify`: forge 1.0.0 names only Etherscan's retired API, and the script no longer calls it. The steps and what each must show are in [`redeploy-contracts.md`](redeploy-contracts.md), step 3. The deployment of 2026-11-04 is not verified. The JSON records the commit and compiler settings, so anyone can rebuild and compare the bytecode.
- **Redeploying.** A contract fix ships as a new deployment that new deals opt into. Deals already open keep the contracts they started with. Deploying again, to Sepolia or anywhere else, is a gate (below), and follows [`redeploy-contracts.md`](redeploy-contracts.md).
- **Earlier deployments** keep their records beside `sepolia.json` under dated names (`sepolia-<date>-domain-<version>.json`). To check one, copy it over `sepolia.json` in a checkout at its `commit` and run `deploy-sepolia.sh --check`. The dated record below says when each went live.

## Costs

The maintainers keep the cost notes privately (`docs/private-materials.md`).

## Headline metrics (T-066)

The maintainers keep the notes on the console's headline metrics privately (`docs/private-materials.md`). The scripts that compute them are in `scripts/metrics/`.

## Machines

Development is moving off Rafa's own Mac to a development host that holds only Crow (decision record T-484, in the private repository; T-485 built the first files). Until the move's switch, sessions still run on his Mac as they do today.

| Machine | Runs | Built from | Rebuild |
| --- | --- | --- | --- |
| **The development host** (a Mac mini) | Agent sessions, worktrees, builds and tests, as a Standard user under a Claude account that holds only Crow. It holds both repositories and reads one vault, `Crow-Agents`, through a 1Password service account | `infra/dev-host/`: the administrator's setup, the session user's setup, the managed settings. Keys: `config/secrets/dev-host.refs` | Erase, run the setup scripts from the reviewed commit, and hand over the Claude sign-in, the service account's token, and the memory branch after Rafa reads its diff. The private runbook has the steps |
| **A simulated party's machine** (DigitalOcean, team `crow-parties`) | One simulated seller or buyer, for one run | `infra/party/`: `up.mjs` makes it from `cloud-init.yaml`, `down.mjs` destroys it, `sweep.mjs` removes what a killed run left | None: each run makes a new one |
| **Rafa's own Mac** | His accounts, the contract keystore, the hosted sellers' deploys, and every deploy until the deploy workflow exists | His own setup | His own |

- **The rule for every privileged file:** Rafa runs an administrator script, or a command that carries a secret, only at a commit whose pull request he approved. Each such file prints its commit and the SHA-256 of the files it runs, and waits for a typed `yes` (`infra/dev-host/README.md`).
- **What the development host holds no credential for:** Cloudflare, Crow's own agents' machines, the keystore, the pilot's credentials and the cost collector. Deploys stay on Rafa's Mac until the deploy workflow exists (record, move step 10).
- **The team test** comes before any machine reads the vault: `infra/party/team-test.mjs` measures whether the `crow-parties` token stops at its own team (`infra/party/README.md`).
- **Crow's own machines** (the agents' machine and the signer's, team `crow-own`) come after the pilot and after the deploy workflow. Their files are not built yet.

## Gates (ask Rafa first)

These wait for the maintainer's go-ahead:

- a deploy to any public target or public chain. A mainnet deploy also needs an audit and his written approval;
- real keys or real money;
- anything published or sent to other people;
- force pushes, history rewrites and repository settings.

## Working without permission prompts

The maintainers keep the notes on agent sessions and permission prompts privately (`docs/private-materials.md`).

## Deploy record

Each entry records one deploy as it ran: the date and time in UTC, the commit, each Worker's new version and its rollback target, and what was measured after it. The deploy scripts print the entry's first line (`pnpm demo-cloud:deploy`, `pnpm site:deploy`, `node apps/test-agents/scripts/deploy.mjs`). The values are true for their date: for what runs now, read "What is live" above and each node's discovery.

### The demo's opening conversation and the drifting use cases (deployed 2026-11-24, 11:27 UTC)

Rafa, 2026-11-24: "Yes, deploy". The site deploy carries pull request 764: the homepage demo opens with an earlier conversation already in place (single sign-on and a new payment flow, tagged v0.4.2, then "let's get it audited"), the roles row under the window's title is removed, and the use-case line becomes one row of about three to four items drifting right to left with faded edges (a CSS animation; still under reduced motion). It ran from a clean worktree at `dc4fea4` after `main`'s own checks passed there [measured].

**Site deploy 2026-11-24 11:27 UTC, commit `dc4fea4` on a detached HEAD: pass.** crow-site `a0145536-2799-4c9f-8549-9677d6539da5` (rollback target `61783442-d9c4-4212-b2c1-a402f44e171b`).

After the deploy, version.json names `dc4fea4`, fresh copies of home.js and home.css carry the new conversation and the drift with no roles row, and every sitemap address answers 200 [measured].

### The use-case line under the early-access form (deployed 2026-11-24, 11:03 UTC)

Rafa, 2026-11-24: "Yes, deploy". The site deploy carries pull request 763: one quiet line under the homepage's email form shows one of 14 example deals at a time (3 s each, a 0.4 s fade), with no lead-in and no pause control; it stops while the tab is hidden and does not rotate under reduced motion, and screen readers get the list once. It ran from a clean worktree at `034e70e` after `main`'s own checks passed there [measured].

**Site deploy 2026-11-24 11:03 UTC, commit `034e70e` on a detached HEAD: pass.** crow-site `61783442-d9c4-4212-b2c1-a402f44e171b` (rollback target `a5b34cbb-c278-4ca6-b61d-f473a61e4466`).

After the deploy, version.json names `034e70e`, a fresh home.js carries the list, and every sitemap address answers 200 [measured].

### The homepage paragraph, the Trust page trims and no fee promises (deployed 2026-11-24, 10:14 UTC)

Rafa, 2026-11-24: "Yes, deploy". The site deploy carries pull requests 759 (the homepage summary: agents make deals on their own, and the buyer's payment is locked until the work is done), 760 (the Trust page drops "Each answer stands alone and ends with its source." and the redundant "Is real money involved?" answer; its tUSDC Etherscan link moves to the token-freeze answer) and 761 (no promise of no fees: the homepage card, the README and llms.txt; no monetization stated). It ran from a clean worktree at `c6e22ea` after `main`'s own checks passed there [measured].

**Site deploy 2026-11-24 10:14 UTC, commit `c6e22ea` on a detached HEAD: pass.** crow-site `a5b34cbb-c278-4ca6-b61d-f473a61e4466` (rollback target `d3bcb19d-26f5-4cfb-bfcf-5abde5be3ac5`).

After the deploy, fresh copies (with a cache-busting query) of the homepage, home.js, the Trust page and llms.txt carry the new text and none of the removed text; a first check without the query read cached copies. Every sitemap address answers 200 [measured].

### The demo's seller name on phones (deployed 2026-11-23, 17:07 UTC)

Rafa, 2026-11-23: the name "Seller · Alpha Security" looked cramped on phones; "Yes, deploy". The site deploy carries pull request 757: on screens up to 600 px the demo's header row puts Buyer and Seller on one line and the example label below. It ran from a clean worktree at `d47ad1d` after `main`'s own checks passed there [measured].

**Site deploy 2026-11-23 17:07 UTC, commit `d47ad1d` on a detached HEAD: pass.** crow-site `d3bcb19d-26f5-4cfb-bfcf-5abde5be3ac5` (rollback target `794bbf8b-fb38-4596-8078-76fda277eb89`).

After the deploy, the live home.css carries the new phone layout and every sitemap address answers 200 [measured].

### The homepage audit demo (deployed 2026-11-23, 16:37 UTC)

Rafa, 2026-11-23: "review with Sonnet then deploy". The site deploy carries pull request 755: the homepage shows an illustrative conversation in which a buyer's agent books a security audit and pays through a payment hold, replacing the links to the demo page on the homepage. A Sonnet review found a lint failure in the sign-up drawer script and three wording issues, fixed on the branch before the merge. It ran from a clean worktree at `4b8ac68` after `main`'s own checks passed there [measured].

**Site deploy 2026-11-23 16:37 UTC, commit `4b8ac68` on a detached HEAD: pass.** crow-site `794bbf8b-fb38-4596-8078-76fda277eb89` (rollback target `8da33680-d256-4c03-b4c0-c5df51e4a784`).

After the deploy, the live home.js carries the demo with its "Illustrative example" label, the homepage sends its content security policy, /demo/ still answers 200, and every sitemap address answers 200 [measured].

### The vocabulary fixes and the guide lines (deployed 2026-11-21, 12:11 UTC)

Rafa, 2026-11-21: "Yes, deploy". The site deploy carries pull requests 748 (the public pages follow the agreed vocabulary and link the renamed repositories) and 749 (roadmap row N213: the guide lines the approvals runs lacked, a seller's own terms and deal record in `ref/intake.txt`, and which quote address takes a POST). No bundle changes. It ran from a clean worktree at `3d74a765` after `main`'s own checks passed there [measured].

**Site deploy 2026-11-21 12:11 UTC, commit `3d74a76` on a detached HEAD: pass.** crow-site `8da33680-d256-4c03-b4c0-c5df51e4a784` (rollback target `c6158ed6-27bd-444a-9a37-ca83c9d3d865`).

After the deploy, the live guides carry the new lines, link `rafaeldavid/crow` and no old repository address, `vault.txt` links `crow-agent-vault`, the visual demo names neither the logomark nor the old host, and all 57 sitemap addresses answer 200 [measured].

### The sitemap and robots.txt (deployed 2026-11-21, 07:14 UTC)

Rafa, 2026-11-21: crow.direct had no sitemap, and robots.txt carried only Cloudflare's managed comments; "build it as real thing". The site deploy carries pull requests 745 (the publish build writes `sitemap.xml` and `robots.txt`; site check 21) and 746 (the sitemap adds `reference.txt` and lists the problem pages at their served addresses). It ran from a clean worktree at `a6e3fd7d` after `main`'s own checks passed there [measured].

**Site deploy 2026-11-21 07:14 UTC, commit `a6e3fd7` on a detached HEAD: pass.** crow-site `c6158ed6-27bd-444a-9a37-ca83c9d3d865` (rollback target `d277e49b-14f8-42bf-9ee1-f059b28fd81f`).

Afterwards [measured at about 07:15 UTC]: `/sitemap.xml` answered 200 as `application/xml` with 57 entries, none ending in `.html`, and every entry answered 200; `/robots.txt` reads `User-agent: *`, `Allow: /` and `Sitemap: https://crow.direct/sitemap.xml` beneath Cloudflare's managed comments. The operators were not redeployed: nothing in these pull requests touches them.

### The home page's "Autonomous Adjudication" card and the judge cap (deployed 2026-11-21, 06:27 to 06:35 UTC)

Rafa's words: "On https://crow.direct/, change Frontier AI Verification to \"Autonomous Adjudication\"…", then "Yes deploy the site". The site deploy carries pull request 743 (the card's new wording) and the site pages changed since the last site deploy: the seller's funding paragraph in `site/ref/http-seller.txt` (740) and the judge-cap lines in `site/ref/limits.txt` and `site/ref/intake.txt` (741). It ran from a clean worktree at `15a7881f` after `main`'s own checks passed there [measured].

**Site deploy 2026-11-21 06:27 UTC, commit `15a7881` on a detached HEAD: pass.** crow-site `d277e49b-14f8-42bf-9ee1-f059b28fd81f` (rollback target `18dccf5f-ac36-48f7-b0af-bcec0d986eaa`).

Afterwards [measured at about 06:28 UTC]: the home page reads "Autonomous Adjudication" and "Request an AI of your choice to review the work before payment."; the seller page names `hold.funded`; the five pinned bundles match their SHA-256 in `llms.txt`.

**Then the operators, on Rafa's word ("go ahead and deploy", 2026-11-21),** so the guides and the live service match. They carry pull request 741: past the daily live-judge budget, Crow's adjudicators decline new judged deals until the next UTC day, a first-instance panel already under way abstains, and an appeal panel does not convene. `pnpm demo-cloud:e2e` passed in 8 s before the deploy, and `wrangler tail` ran on both operators beside it [measured].

**Deploy 2026-11-21 06:29 UTC, commit `15a7881` on a detached HEAD: pass.** holdback-op1 `1f856e81-7f5a-428b-af22-6733a847a140` (rollback target `ed5c8b4c-3fcf-46c5-b84d-b5c566b25db8`), holdback-op2 `092d7ac7-a91c-47e4-9e70-681f25926749` (rollback target `20979440-d207-49a0-b1f9-4719ebfeac71`). Smoke deal `0x032cc811db0a02f1c5227e63a98b54be504cb3bfa664358e55ffa7e2a0cf4afa` Released in 49 s, against commit `15a7881` (both nodes' discovery named it 259 s after /v1/status answered).

Afterwards [measured at about 06:35 UTC]: both nodes' discovery named `15a7881f` with schema `0.12`; the tails saw 187 events and no exception, and one event on holdback-op1 ended `canceled`.

### Standing-offer takes and the owner's vault guide (deployed 2026-11-20, 08:52 to 08:58 UTC)

Rafa's word: "Can you finish any hanging deploys?" The round puts live the operators' take rules for a standing offer (T-549, pull request 736) and, on the site, the owner's guide to a spend-controls vault at `vault.txt` with its two pointers in `ref/limits.txt` (T-554, pull request 738). The demo script (720) and the deploy record (737) change no deployed code. It ran from a clean worktree at `6bf21cdc` after `main`'s own checks passed there (15 passed, 2 skipped; a Dependabot update run for `tools/envelope-proof` failed, which is not a check of the code), after `pnpm demo-cloud:e2e` passed in 8 s, with `wrangler tail` on both operators beside it [measured].

**Deploy 2026-11-20 08:52 UTC, commit `6bf21cd` on a detached HEAD: pass.** holdback-op1 `ed5c8b4c-3fcf-46c5-b84d-b5c566b25db8` (rollback target `4087b4a7-8d75-4dd2-b219-0e77048be02f`), holdback-op2 `20979440-d207-49a0-b1f9-4719ebfeac71` (rollback target `204f24bb-c8b4-4e04-a2f6-39eab9905d1d`). Smoke deal `0x3d117156c3c4a3a7a100b35e1237f0311926342d40455c417833b5a3ce81e6ee` Released in 72 s, against commit `6bf21cd` (both nodes' discovery named it 255 s after /v1/status answered).

**Site deploy 2026-11-20 08:58 UTC, commit `6bf21cd` on a detached HEAD: pass.** crow-site `18dccf5f-ac36-48f7-b0af-bcec0d986eaa` (rollback target `440d6785-fec5-4d37-aa10-a798ab1ac347`).

Afterwards [measured at about 09:02 UTC]: both nodes' discovery named `6bf21cdc` with schema `0.12`; `vault.txt` answered 200 (5,970 bytes) and `ref/limits.txt` names it twice; the five pinned bundles match their SHA-256 in `llms.txt`; the tails saw 185 events and no exception.

**Not deployed in this round:** the test agents and the two hosted sellers (no change to their code since their last deploy); `agg-4` as the default aggregation, which Rafa delayed to next week ("Delay the stricter rule on judge panels, we can revisit next week"); Crest's vault-as-buyer build, tabled by Rafa until next week.

### Schema v0.12 and the changes merged overnight (deployed 2026-11-20, 07:28 to 07:35 UTC)

Rafa's word: "Yes, deploy". The round puts live schema v0.12 with a contract buyer and seller (pull requests 713 and 715), the pipeline fixes (722), the service keeping the panel's result (729), the demo judges live or scripted as a whole (728), three small operator fixes (726: a read ceiling before a 413, one rule for "no appeal ground", `security.txt` on the API hostnames), agg-4 as a kept version that is not the default (730), the clearer schema error (732) and, on the site, the telemetry section (718) and the new `setup.mjs` with the deliver command (714, re-pinned once with 732).

**The first attempt failed and rolled back on its own.** It ran from a clean worktree at `b136a02c`, whose parent's own checks on `main` had passed.

**Deploy 2026-11-20 06:33 UTC, commit `b136a02` on a detached HEAD: FAIL, the smoke deal did not end Released within 180 s.** holdback-op1 `679d084a-e906-4a8f-b35a-ff49ddb595e8` (rollback target `dae6100a-a9a5-40d9-83be-0fa5089fc60b`, rolled back), holdback-op2 `c7fa57ae-e16a-4b26-8a7f-7a021773c5fe` (rollback target `761b9dbb-a2ac-4176-aedf-bf5ba3b96306`, rolled back).

The smoke deal stalled after the faucet's mint, which landed on chain at 06:35:12 UTC [reported by the diagnosis agent]. One cause was found and reproduced: pull request 726 had exported `SECURITY_TXT_URL` from the Worker's entry module, and workerd refuses a named export that is not a handler or a class, so `pnpm demo-cloud:e2e` failed in 4 s on `main` [measured by T-574's session]. Production accepted the upload, so whether that export alone stalled the live smoke deal is not known; the operators' Workers logs for those minutes were not readable with the session token (403 on the telemetry query) [measured]. The fix, pull request 734 (T-574, merged as `db8be818`), moves the constant to `headers.ts` and adds a test that fails when the entry exports anything but its default handler and the Durable Object classes its wrangler configs name. CI does not run `pnpm demo-cloud:e2e`; the coordinator ran it in the deploy worktree before the retry: it passed in 28 s [measured].

**The retry, from a clean worktree at `db8be818`, after `main`'s own checks passed there (every check passed or skipped), with `wrangler tail` on both operators beside it.**

**Deploy 2026-11-20 07:28 UTC, commit `db8be81` on a detached HEAD: pass.** holdback-op1 `4087b4a7-8d75-4dd2-b219-0e77048be02f` (rollback target `dae6100a-a9a5-40d9-83be-0fa5089fc60b`), holdback-op2 `204f24bb-c8b4-4e04-a2f6-39eab9905d1d` (rollback target `761b9dbb-a2ac-4176-aedf-bf5ba3b96306`). Smoke deal `0x252292f16db1a99775ef717b128fdce05ef666ba53093cbd83a6361c2d90120f` Released in 49 s, against commit `db8be81` (both nodes' discovery named it 282 s after /v1/status answered).

**Test seller deploy 2026-11-20 07:34 UTC, commit `db8be81`: pass.** crow-test-agents `b78888a8-029f-4808-82d1-b3a6aa847cf8` (rollback target `80b7d270-6218-40e2-bcee-175952947768`).

**Site deploy 2026-11-20 07:35 UTC, commit `db8be81` on a detached HEAD: pass.** crow-site `440d6785-fec5-4d37-aa10-a798ab1ac347` (rollback target `0b288408-7a56-47f9-95fd-40cff9f81dd4`).

Afterwards [measured at about 07:37 UTC]: both nodes' discovery named `db8be818` with schema `0.12`; `/.well-known/security.txt` on both API hostnames answered 301 to `https://crow.direct/.well-known/security.txt`, which serves the contact; a 1.2 MB POST to `/v1/feedback` answered 413 on both; `try.mjs`, `try-sell.mjs`, `try-judged.mjs`, `try-reclaim.mjs` and `preflight.mjs` match their SHA-256 in `llms.txt`, and `setup.mjs` matches the hash `setup.txt` lists (`19234ae2…`). The tails saw 282 events and no exception; 2 events on holdback-op1 ended `canceled`. A judged deal's panel labelled live was not checked in this round; the demo script's runs check it.

**Not deployed in this round:** the two hosted sellers (no change since the cutover touches `apps/hosted-sellers` or the seller adapter), and agg-4 as the default aggregation, which is a second deploy on Rafa's word.

### The day's merged changes after the contract cutover (deployed 2026-11-19, 20:50 to 21:13 UTC)

Rafa's words for these were "Yes, go ahead and deploy when ready" and "Remember you need to redeploy everything once this round of updates is complete". The coordinator ran each script from a clean worktree of `main`, after `pnpm install --frozen-lockfile` and `pnpm build`, in two rounds. Each round ran at a commit whose own checks on `main` had all passed [measured].

**Round 1, commit `fd24eb7`.** It carries the operators' two early refusals (T-559, pull request 702), the buyer guide's lines on example providers (T-556, 698), the seller's invoice and credit note pages (T-565, 701) and the legal notice with the home page's demo line (T-564, 705).

**Deploy 2026-11-19 20:50 UTC, commit `fd24eb7` on a detached HEAD: pass.** holdback-op1 `685595fd-f7ad-4ae8-8de6-dcb1d61d536d` (rollback target `ac7bde81-d718-4735-aa08-3bd04869b74c`), holdback-op2 `f0e4b493-6d62-4923-a3da-e7cb801d1d04` (rollback target `cb68f2b0-4d4c-48e7-86a5-a680358e0892`). Smoke deal `0xc9afb4fca53b49b4a38123afe2f22989c3ff401e34f0f205c09711f1f81715da` Released in 51 s.

**Test seller deploy 2026-11-19 20:56 UTC, commit `fd24eb7`: pass.** crow-test-agents `80b7d270-6218-40e2-bcee-175952947768` (rollback target `a94bf8db-b454-4be4-99eb-014f8a0d66fa`).

**Site deploy 2026-11-19 20:57 UTC, commit `fd24eb7` on a detached HEAD: pass.** crow-site `0b288408-7a56-47f9-95fd-40cff9f81dd4` (rollback target `808f9744-2bc9-4787-af1b-f461495d4c74`).

Afterwards [measured at about 20:58 UTC]: both nodes' discovery named `fd24eb75`; `/legal` and `/legal.txt` answered 200 and the home page carried "Available today for demo only"; `/ref/limits.txt`, `/sell.txt` and `/ref/after-funding.txt` answered 200; the test seller read `operational` with 0 open deals; a JSON body of 300,000 bytes posted to `/v1/feedback` got 413.

**Round 2, commit `c20ba52`, the operators only.** It carries a standing delivery without the buyer's envelope (T-550, pull request 703), which changes core, the operators and the adjudicator and nothing on the site.

**Deploy 2026-11-19 21:12 UTC, commit `c20ba52` on a detached HEAD: pass.** holdback-op1 `dae6100a-a9a5-40d9-83be-0fa5089fc60b` (rollback target `685595fd-f7ad-4ae8-8de6-dcb1d61d536d`), holdback-op2 `761b9dbb-a2ac-4176-aedf-bf5ba3b96306` (rollback target `f0e4b493-6d62-4923-a3da-e7cb801d1d04`). Smoke deal `0x869583e70ab663856128479be5a2314e61846e5d23356fed7ccc460aeaa69b31` Released in 47 s, against commit `c20ba52` (both nodes' discovery named it 284 s after /v1/status answered).

Afterwards [measured at about 21:20 UTC]: both nodes' discovery named `c20ba520` and `/v1/status` answered 200; the test seller read `operational`.

**Not deployed in these rounds:**
- **The test agents in round 2.** The script refused before any upload, because `main` had moved past `c20ba52` by then and a detached checkout that lacks commits from `origin/main` can drop the custom domains. The test agents stay on round 1's build; pull request 703 does not touch their code [measured: `git diff --name-only fd24eb75 c20ba520 -- apps/test-agents examples site` prints nothing].
- **The two hosted sellers.** No change merged since their deploy in the cutover touches `apps/hosted-sellers` or the seller adapter [measured with `git diff --name-only`].
- **Schema v0.12** (T-549, pull request 713) merged after round 2 and is not live.

### The fixed contract version: new contracts, a new world (deployed 2026-11-19, T-563)

The fixed version of the phase-one contracts, with an outside scan's fixes, replaced the first version on Sepolia by `docs/redeploy-contracts.md`. Rafa's word was "You need to deplot the fixed version of the contracts and update the piping and everything to point to the fixed contracts", and for the deployer "New key". The session ran every step from the worktree `t-563-cutover`, after `pnpm install --frozen-lockfile` and `pnpm build`. Every value here is measured unless marked.

- **The frozen commit:** `1adfa55b7b6dabe94325b7731cbd3760f518e01d`, the lane's tip after pull request 690 brought `main` into it. `contracts/src` tree `c4edcfb1185a34f5a205d9170e0ae690c758c157`, the same as `d621291e`, which the outside firm's fix review read. Runtime hashes at that commit and on chain: HoldbackRules 20,786 bytes `208704ee…2721`, DrandQuicknetBeacon 3,491 bytes `5b99156c…d8d8`.
- **The rehearsals:** on anvil, 8 steps passed. On a fork of Sepolia, from the live first-build record to a fixed-build record, every check passed once the copies were committed before the site rebuild: `site/try.mjs` names its source commit only then (the runbook now says so, step 3.1).
- **The deployer:** a new key used only on Sepolia, `0xa27Cd8A0cF6D15559aF9E6Ff9ebd885da57C3E6a`, funded with 0.5 ETH by Rafa from the previous deployer (transaction `0x84a64b86…3b1a`). Fresh estimates on live Sepolia matched the receipts of 2026-11-13 within 3%.
- **The contracts,** created from block 12,169,902, 62,076,765 gas in all (about 0.0055 ETH): rules `0xaAF8A86e54B1Cb867c00BD452c78981664153d56`, beacon `0xae2742A788C4c4689A75fCd25d54d12641A14a57` (`PAIRING_GAS` 250,000, read back on chain), token `0xf1A4B68b201e9Eddef8a054FB6a931b849d18504`, escrow `0x7FaE06D96c739F6DA6F40610b34998d8cf83D5d9`, collector `0x54169Df23Be4B7De17dc6b7B47B9B09394443D8A`. `--check` matched the chain and the build; all five are an exact match on Sourcify, runtime and creation. No orphan contract.
- **The old world:** rules `0x3BE45128565ABBc35DbD4660716b703Ff489f1b4`, record kept as `contracts/deployments/sepolia-2026-11-13T0532Z-domain-0.8.json`. Its storage stays for a rollback. Left on it: four offers from T-399's postdated case (`0x41e1508f…`, `0x82bfcadd…`, `0x5d9bf6b1…`, `0xb28a359b…`), accepted by the primary, never agreed or funded, expiring in 2031; nothing is held for them. Its rules contract emitted no event in the 500 blocks before the switch.
- **The quiet:** at 18:22 UTC `head.eventSeq` stayed 883 on both nodes for 30 s, and every seller read `open: 0`.

**Deploy 2026-11-19 18:22 UTC, commit `81f8ea2` on branch `cutover-contracts-phase-one-2`: pass.** holdback-op1 `ac7bde81-d718-4735-aa08-3bd04869b74c` (rollback target `b9e5d82e-d929-4bf8-b9cf-b723c878174e`), holdback-op2 `cb68f2b0-4d4c-48e7-86a5-a680358e0892` (rollback target `35c7b17d-8861-4d0e-991e-658db56e8bf2`). Smoke deal `0x30a1ced18c1ebbf3d31113219422b76cf65b09591d762edd6f29ff5002f446ed` Released in 45 s.

Gas on Sepolia: fund 581,630, deliver 173,940, decide 525,183, total 1,280,753

**Test seller deploy 2026-11-19 18:24 UTC, commit `81f8ea2`: pass.** crow-test-agents `a94bf8db-b454-4be4-99eb-014f8a0d66fa` (rollback target `135683f8-e481-4c2d-8657-c4967126f047`).

**Hosted seller pilot-scan-1 deploy 2026-11-19 18:28 UTC, commit `81f8ea2` on branch `cutover-contracts-phase-one-2`: pass.** crow-seller-pilot-scan-1 `42a4ca54-af35-481e-8151-8ed72b98db14` (rollback target `2e297344-58c2-4905-9910-6fdb2b0114fe`).

**Hosted seller pilot-scan-2 deploy 2026-11-19 18:29 UTC, commit `81f8ea2` on branch `cutover-contracts-phase-one-2`: pass.** crow-seller-pilot-scan-2 `14902608-9a18-4b51-a2b7-3c914ef5ab3f` (rollback target `30b5e98f-2fc2-4c13-b72b-e296c589422c`).

**Site deploy 2026-11-19 19:11 UTC, commit `978aa38` on a detached HEAD: pass.** crow-site `ec794cfa-c95f-41e7-949e-85f1f17039f2` (rollback target `1d90ca19-101f-4d1e-ba1e-5d0dcda82328`).

After the deploys:

- **Discovery** on both nodes names chain 11155111, rules `0xaaf8…3d56`, domain 0.8, schema 0.11, the new token and build `81f8ea29`. The club's `rulebookHash` is new, and the three demo adjudicators are new, each with bond `none`.
- **Deals on the new world:** the test seller sold to a buyer running the new `try.mjs` from an empty folder, `0xdda3276f0dadd1ec667938707072b477c997a0eabc19fe1c600b15d21dcb75c5` Released and `0x6e4273973d66dc125e7c41a52d6a64fbed1b1499269bc4db4977e6e2248e23d2` Refunded; a sale to the test buyer, `0xd83ae52796d955b387d40c2dfb809ac4758f93dfc17ef651506028b7224805dc`, released. The live rounds ran with a throwaway seed made in memory, since 1Password is not set up on the Mac: 5b (an escalation, decided by the appeal adjudicator's five-seat panel), `0x1cc5f352c946290ab4c8a989b6c546223f6a12e105246232ceb4a7d0319764e2` Released; 12 (two money addresses), `0xad6f3c4c821bdd14c412a6e56731200b611be7bd3d4358537b5212a803ee1211` Released and `0x78ffbb44cae8e7a9fe92b35e452f472369f6d9800771f30e864f1dc374ff349c` Refunded, once its payment address took its tokens from the faucet (pull request 706). The first try of round 12 left one unfunded offer, `0x4ce4ab77…494a`.
- **The newly refused message:** both operators answered 400 `invalid_terms` "a primary adjudicator's decision carries no beacon …" to a primary decision with a beacon, before any transaction.
- **The hosted sellers** read `operational`, `open: 0`, with the new token in their folders: configuration SHA-256 `86c53a74…` (pilot-scan-1) and `9e8e090d…` (pilot-scan-2).
- **The site:** `try.mjs` and `buy.mjs` match their hashes live and name the new rules contract and token, not the old; the home page is 7,890 bytes and names `/llms.txt` in its head; the three guides match the build. The demo page's three ending deals were on the old world, so their record links answered 404: they were recorded again on the new world and published with these records (`tools/duet/endings.json`).
- **Not run:** `pnpm verify` (step 3.8): CI ran its parts on the merged commit. `drand-fork.test.ts` could not fork the public node ("block not found"), and passed through the gateway, as the runbook says.

### Crow's own seller, pilot-scan-2, sells a fix review (deployed 2026-11-19, 08:13 UTC)

Rafa ran the deploy for T-553 from a clean detached worktree. The seller folder added a fix-review offer: the job type, the parent job, the review mode as a scope field and its own report mapping. The seller code did not change.

**Hosted seller pilot-scan-2 deploy 2026-11-19 08:13 UTC, commit `07e00f6` on a detached HEAD: pass.** crow-seller-pilot-scan-2 `30b5e98f-2fc2-4c13-b72b-e296c589422c` (rollback target `744ec8c6-13a9-44fe-83c4-25fbe1e5b339`).

Afterwards `/health` read `operational` with `open: 0` and config SHA-256 `2158055a1dcfae202b11217274b7ae93e8256d4d4cc9be16d2f46a116fbfae8d` [measured]. The fix-review deal it served, `0x5533006ae164c48e5d4894f7313abe77a125b3fcb0268f0e0478fa24f2bd913a`, was Released on both operators at 10:58:12 UTC [measured].

### Spend Controls on the home page (site deployed 2026-11-19, 06:21 UTC)

Rafa's word was "Merge and deploy". Pull request 681 (T-542) merged at 06:21 UTC once every check had passed. The session ran the script from a clean worktree of `main` at that merge, after `pnpm install --frozen-lockfile` and `pnpm build`.

**Site deploy 2026-11-19 06:21 UTC, commit `8f34c6e` on a detached HEAD: pass.** crow-site `ed7a837e-21b0-440f-bdb5-1d0896b3c207` (rollback target `59feed8a-d0a0-4cb1-ad09-2f1040954681`).

The live site served the built `llms.txt` and the pinned `try.mjs` 0 s after the upload [measured by the script]. The live home page shows "Spend Controls · soon" in place of "Your Existing Rails". The live `ref/limits.txt`, `buy.txt` and `reference.txt` each had the SHA-256 of the built file [measured 06:21 UTC]. The site now carries T-542: the value prop, and the limits reference's section "Spend controls: what to tell your principal".

### The test agents, the site and both operators at one commit (deployed 2026-11-19, 05:24 to 05:31 UTC)

Rafa's word for these was "Yes, after it merges", to "Run the deploy round once the template change has merged?"; pull request 673 (T-543) merged at 05:23 UTC. The coordinator ran each script from a clean worktree of `main` at that merge, after `pnpm install --frozen-lockfile` and `pnpm build`, one after the other. Before the operators' deploy, the two hosted sellers, the test seller and the test buyer each read `operational` with `open: 0` [measured 05:25 UTC], and no judging code had changed since the operators' last build.

**Test seller deploy 2026-11-19 05:24 UTC, commit `b177167`: pass.** crow-test-agents `135683f8-e481-4c2d-8657-c4967126f047` (rollback target `bba72a2f-54aa-410d-a965-ffca3875aa47`).

The seller read `operational` and served its agent card, and the buyer read `operational`, 1 s after the upload [measured by the script]. The test buyer now pays up to 1,000 tUSDC for work due within 7 days (T-545).

**Site deploy 2026-11-19 05:24 UTC, commit `b177167` on a detached HEAD: pass.** crow-site `59feed8a-d0a0-4cb1-ad09-2f1040954681` (rollback target `db0fbf7b-b0f7-48f3-924e-9855e18dfba9`).

The live site served the built `llms.txt` and the pinned `try.mjs` 0 s after the upload [measured by the script]. Afterwards `sell.txt`, `trust.txt`, `setup.mjs`, `ref/intake.txt` and `ref/checks.txt` each had the SHA-256 of the file at the commit, and the live `setup.txt` named the live `setup.mjs`'s SHA-256 [measured 05:32 UTC]. The site now carries T-547 (the seller's guide, the agent guide, the trust page's contact answer and three references), T-543 (the setup command sells work from a template; a new pinned `setup.mjs`), T-545's `ref/intake.txt` and T-538's command in the agent docs.

**Deploy 2026-11-19 05:25 UTC, commit `b177167` on a detached HEAD: pass.** holdback-op1 `b9e5d82e-d929-4bf8-b9cf-b723c878174e` (rollback target `2e88e9df-1999-4b9e-902c-f5b005ed7aa3`), holdback-op2 `35c7b17d-8861-4d0e-991e-658db56e8bf2` (rollback target `15e6d48f-3544-4597-a942-b38fd9e4e22e`). Smoke deal `0x40b0828362f59392d0d1615eccc6eab891ec2e72c02b264bc93ebace22b48574` Released in 46 s, against commit `b177167` (both nodes' discovery named it 285 s after /v1/status answered).

The deal guard checked 4 open deals at the demo adjudicators against the new build's kept policies; none would lose its judge [measured by the script]. Both nodes' discovery named the commit and a delivery limit of 1,048,576 bytes [measured 05:32 UTC]. The operators now carry T-540's first item (the beacon's errors reach an agent by name) and T-547's upload fix (an oversized delivery is read to the protocol's ceiling, kept past no node's limit and refused, so the connection is no longer reset).

### The site, the sign-up Worker, the test agents and both operators at one commit (deployed 2026-11-18, 17:39 to 17:48 UTC)

Rafa's word for these was "go ahead, merge all ready, deploy all ready". The coordinator ran each script from a clean worktree of `main`, one after the other. Before the operators' deploy, the two hosted sellers and the test seller each read `open: 0` [measured 17:41 UTC], and the judging screen's version had not changed since the operators' last build.

**Site deploy 2026-11-18 17:39 UTC, commit `9c5bf8a` on a detached HEAD: pass.** crow-site `db0fbf7b-b0f7-48f3-924e-9855e18dfba9` (rollback target `dbca411c-76f1-4fc0-89d7-af0887cde1be`).

A first run one minute earlier failed before any upload: the fresh worktree had not built the workspace packages, so the site's build could not resolve one and stopped on its own stale-file check. After `pnpm build` the same command passed. The live site served the built `llms.txt` and the pinned `try.mjs` 0 s after the upload [measured by the script].

**Early access deploy 2026-11-18 17:40 UTC, commit `f48afab` on a detached HEAD: pass.** crow-early-access `d42c03c9-66e1-4bc2-8634-9fb2c8aefdb9` (rollback target `ddd45aa9-c8f8-4036-a41e-890e487eae59`).

`join.crow.direct/version.json` named the commit 0 s after the upload [measured by the script]. The change it carries is in its deploy script and one comment; the Worker behaves as before.

**Test seller deploy 2026-11-18 17:41 UTC, commit `f48afab`: pass.** crow-test-agents `bba72a2f-54aa-410d-a965-ffca3875aa47` (rollback target `1adabc54-953c-4b18-9c7a-ac2833f1ac1b`).

The seller read `operational` and served its agent card, and the buyer read `operational`, both with `open: 0` [measured 17:41 UTC].

**Deploy 2026-11-18 17:41 UTC, commit `f48afab` on a detached HEAD: pass.** holdback-op1 `2e88e9df-1999-4b9e-902c-f5b005ed7aa3` (rollback target `dc0373ee-f2b2-4c38-84de-98349e4c2dee`), holdback-op2 `15e6d48f-3544-4597-a942-b38fd9e4e22e` (rollback target `14f9d594-cde1-477f-9198-7f5102538eab`).

The deploy's own test deal, `0xce923bfb1836b5732eb83065bf949a8b47cd19c90a86f1949bf4cb1da39d517c`, was Released in 41 s with all three checks passing [measured by the script]. The operators now carry T-530 (the adjudicator keeps a judged result across a restart), T-526 (a delivery travels inside a decision only for an accept, D79) and T-537 (the state read tells both parties when an adjudicator cannot open its envelope).

### Crow's own seller, pilot-scan-2, with its corrected folder and the refusal's reason (deployed 2026-11-17, 16:41 and 19:16 UTC)

**Hosted seller pilot-scan-2 deploy 2026-11-17 16:41 UTC, commit `bd72c2e` on a detached HEAD: pass.** crow-seller-pilot-scan-2 `1bee49c8-2554-4dec-98cd-0d003056427f` (rollback target `b5cab689-f6fa-49b3-bc01-f78cd617479a`).

Rafa ran it from a clean worktree with Crow's corrected seller folder, the one that passes all five checks on the partner's export. The deal guard read 0 open deals. Afterwards `/health` read `operational` with bundle SHA-256 `39d9d34a288f1373e1cee1d910d6d85fca3723eff5471ff7be41ec2af4f55f75` and `open: 0` [measured 16:42 UTC]. This line was written from the private kit's evidence file; the deploy's own printout was not kept here.

**Hosted seller pilot-scan-2 deploy 2026-11-17 19:16 UTC, commit `67da35b` on a detached HEAD: pass.** crow-seller-pilot-scan-2 `9e8963d8-72ef-4ca9-aa9a-b6233a456938` (rollback target `1bee49c8-2554-4dec-98cd-0d003056427f`).

It carries T-502 (pull request 621) with the same folder, so the bundle SHA-256 is unchanged; the T-502 session ran it on Rafa's word. The deal guard read 0 open deals. The deploy's own check passes as soon as the fingerprint matches, which it already did, so the new code was confirmed separately: at 19:17 UTC `/health` read `operational`, `39d9d34a…5f75`, and the new field `"refused": []`, and `GET /deals/<id>` answered 404 for a deal the seller does not hold [measured]. `pilot-scan-1` was not deployed.

### The seller's signed refund: pilot-scan-1 with T-503 (deployed 2026-11-18, 08:08 UTC)

**Hosted seller pilot-scan-1 deploy 2026-11-18 08:08 UTC, commit `4d7aacb` on a detached HEAD: pass.** crow-seller-pilot-scan-1 `2e297344-58c2-4905-9910-6fdb2b0114fe` (rollback target `096d7162-224b-4181-af84-fd52355139df`).

It carries T-503 (pull request 627): `POST /deals/<id>/refund`, behind the ready credential, makes the seller sign a full refund of a deal it delivered nothing into. The folder is unchanged, so the bundle SHA-256 stays `042fd6b9…8308`. Rafa ran it from a clean worktree. The deal guard read 0 open deals. At 08:08 UTC `/health` read `operational` with 0 open deals and `"refused": []`, and the refund route answered 401 to a request with no credential, so the new code serves [measured]. `pilot-scan-2` keeps its earlier version.

### The pilot's second deal: pilot-scan-1 with the artifacts call and an existing job (deployed 2026-11-17, 16:10 UTC)

**Hosted seller pilot-scan-1 deploy 2026-11-17 16:10 UTC, commit `dc6238f` on a detached HEAD: pass.** crow-seller-pilot-scan-1 `096d7162-224b-4181-af84-fd52355139df` (rollback target `26ca51fd-7fe3-48d7-aa5e-96a65ab9e156`).

It carries T-501 (pull request 617) and T-497's retry, with a corrected seller folder; Rafa reviewed its fingerprint and ran it from a clean worktree. The deal guard found 1 open deal, none at `starting`. Afterwards `/health` read `operational` with that deal still `refused` [measured]. At 16:22:36 UTC the pilot's second deal on this seller was Released, delivering the scan that had already finished, with no new start. `pilot-scan-2` keeps its earlier version.

### The demo page's security-review deal (site deployed 2026-11-17, 09:46 UTC)

**Site deploy 2026-11-17 09:46 UTC, commit `a7cf276` on a detached HEAD: pass.** crow-site `fe12f7a0-6d72-4b1f-a47a-dd6a12dfa243` (rollback target `d0511744-178a-40e9-be86-8b6f5737d5d9`).

It published T-500 (pull request 610): the demo page shows a security-review deal of the kind Crow's first pilot runs, from three live test deals with Crow's test buyer. Rafa ran it from his terminal; the permission classifier refused the session's own run. Wrangler uploaded 4 changed files: `demo/index.html`, `version.json`, `csp-hashes.json` and `guide-budget.json`. Before it, the 26 guides and bundles built from `origin/main` (`buy.txt`, `llms.txt`, the `ref/` pages and every `.mjs` bundle) matched what crow.direct served, byte for byte. Measured after it (plain GETs, 09:48 UTC): `version.json` names commit `a7cf2761` and version `fe12f7a0…`; `https://crow.direct/demo/` answers 200 and carries the deal box, the pilot sentence, the sentence on what the checks prove, the three cards (41 s, 51 s, 5 min 21 s) and their three settlement transactions; `try.mjs` hashes to `fd7d9a4a…` and `buy.mjs` to `ce610626…`, both unchanged.

### The robot-episode sample and the retry in the test agents (deployed 2026-11-17, 09:37 and 09:39 UTC)

**Site deploy 2026-11-17 09:37 UTC, commit `711fbd7` on branch `main`: pass.** crow-site `d0511744-178a-40e9-be86-8b6f5737d5d9` (rollback target `388eb4be-2f72-4401-a6d4-738d93a47e9d`). It published T-498's `try-sell.mjs` with `--sample robot-episode`. One run of the published command was Released in 57 s (T-498 Evidence).

**Test seller deploy 2026-11-17 09:39 UTC, commit `711fbd7`: pass.** crow-test-agents `1adabc54-953c-4b18-9c7a-ac2833f1ac1b` (rollback target `6d849e88-c10d-461e-a88c-5a5a06e7b9ab`). It carries T-497's retry into the test seller and buyer. The seller and the buyer read `operational` 2 s after the upload, and a `buy.txt` deal against the seller was Released (T-489 Evidence).

Not deployed, on purpose: the operators and the sign-up Worker. Since their last deploys, `main` changed only their deploy scripts and tests. The two hosted sellers also wait: `pilot-scan-1` holds the pilot's first real deal, so they take the retry after that deal ends.

### The lost-answer retry and the try path's fixes (site deployed 2026-11-17, 05:51 UTC)

**Site deploy 2026-11-17 05:51 UTC, commit `7a75f7d8`: pass.** crow-site `388eb4be-2f72-4401-a6d4-738d93a47e9d` (rollback target `ce62448c-7bbe-42c9-86e4-0bec01bd85cc`).

It published T-497's retry (`buy.mjs` changed hash on Rafa's word) and carried T-495's and T-496's try path (pull requests 600 and 602). Measured after it: all seven bundles on crow.direct hash as on `main`, and `version.json` names `7a75f7d8` (T-497 Evidence). The rollback target `ce62448c` is a site version deployed between 2026-11-16 09:56 UTC and this deploy; no record line was kept for it.

### The preflight, the deal-record fix, the report route and the self-report form (deployed 2026-11-16)

**Site deploy 2026-11-16 06:32 UTC, commit `39b2d1c` on branch `main`: pass.** crow-site `6a5976d7-db12-4715-9c42-a6c5fa493af9` (rollback target `e1459b15-d49a-4bee-a4a0-ac38c5fe8416`). It published T-491's preflight and T-489's `buy.txt`.

**Site deploy 2026-11-16 07:43 UTC, commit `32cf4fe` on branch `main`: pass.** crow-site `6bebc651-5d60-405f-a2ad-9b03bfcffd22` (rollback target `6a5976d7-db12-4715-9c42-a6c5fa493af9`). It published T-492's deal-record fix.

**Deploy 2026-11-16 07:55 UTC, commit `52d4f19` on branch `main`: pass.** holdback-op1 `dc0373ee-f2b2-4c38-84de-98349e4c2dee` (rollback target `c153aaad-b36f-4e37-ad57-7220cfc56ccf`), holdback-op2 `14f9d594-cde1-477f-9198-7f5102538eab` (rollback target `19869e39-396f-4a3c-a0f2-14901b125e26`). It binds the `FEEDBACK` store on operator 1 (T-491, pull request 594). A smoke deal Released in 42 s; discovery lists `feedback`, and one test report was received and listed.

**Site deploy 2026-11-16 08:02 UTC, commit `52d4f19` on branch `main`: pass.** crow-site `f09588d7-6abf-465d-9bf3-a96882523b8e` (read from `crow.direct/version.json`).

**Test seller deploy 2026-11-16 08:27 UTC, commit `52d4f19`: pass.** crow-test-agents `6d849e88-c10d-461e-a88c-5a5a06e7b9ab` (rollback target `46286cb7-c7f8-41a1-99bd-d42c3517dedd`). It published T-489's quote route. The seller and the buyer read `operational` 1 s after the upload.

**Site deploy 2026-11-16 09:56 UTC, commit `ee3adb3` on branch `main`: pass.** crow-site `bef9ceb9-041e-4518-b31c-c5794f667891` (rollback target `f09588d7-6abf-465d-9bf3-a96882523b8e`). It published T-493's self-report form in `ref/limits.txt`.

### The listing route on the sign-up Worker (deployed 2026-11-15, 15:29 UTC)

**Sign-up Worker deploy 2026-11-15 15:29 UTC, commit `0b2bf7b`: pass.** crow-early-access `ddd45aa9-c8f8-4036-a41e-890e487eae59`, read from `join.crow.direct/version.json`; no rollback target was recorded. Measured on 2026-11-17: `/listing` answers 405 with `allow: POST`, as T-486's Handoff expects. The site version `e1459b15`, live before 2026-11-16 06:32 UTC, has no record line.

### The two pilot hosted sellers, pilot-scan-1 and pilot-scan-2 (first deploys 2026-11-15, 12:23 and 12:24 UTC; secrets 2026-11-16)

**Hosted seller pilot-scan-1 deploy 2026-11-15 12:23 UTC, commit `542d655` on a detached HEAD: pass.** crow-seller-pilot-scan-1 `c61b5fbd-7dbf-4f5b-9bc0-5f6b9f6f2939` (rollback target `unknown`).

**Hosted seller pilot-scan-2 deploy 2026-11-15 12:24 UTC, commit `542d655` on a detached HEAD: pass.** crow-seller-pilot-scan-2 `2ed2be96-f6c4-4efd-bc89-f54efa4ebe73` (rollback target `unknown`).

Rafa ran both first deploys from a detached worktree at `542d655` and set each seller's secrets on 2026-11-16. A first deploy has no earlier version, so its rollback target is `unknown`. On 2026-11-16 both `deploy.ts --check-only` runs exit 0. Each `/health` reads `operational` with its bundle SHA-256: `pilot-scan-1` `42a97401c3a330f1c77b9f6862810acb7f9cc63748c715a59da28d28b0fcc059` and `pilot-scan-2` `655a09b319e33a440ae86eb442b38e533646dec13c8573a99c4e17f205b7d0b9`. Each serves a `crow-agent` card with one quoted offer [measured]. No deal had started.

### The setup page and its command, the card's schema and the goal bundles (site deployed 2026-11-15, 11:24 UTC)

**Site deploy 2026-11-15 11:24 UTC, commit `d72490b` on a detached HEAD: pass.** crow-site `e80d56bd-8954-4d20-9d74-177a3ca8d114` (rollback target `60513ef3-a367-474a-a0a7-b9d440ccf810`).

Rafa ran it, and it published `setup.txt`, `setup.mjs`, `card.schema.json`, the three goal bundles and the new top of `llms.txt`.

### Deploys owed on 2026-11-14: the faucet allowance, the test seller and the site (operators 14:54 UTC, test seller and site 16:06 UTC)

**Site deploy 2026-11-14 16:06 UTC, commit `8c465bb` on a detached HEAD: pass.** crow-site `a8ca3320-b0a9-42ce-a6a1-a2ce2fdfd1ee` (rollback target `2282f633-7bc9-4794-9a67-c61406685562`).

**Test seller deploy 2026-11-14 16:06 UTC, commit `8c465bb`: pass.** crow-test-agents `d3dce65d-ab02-4b19-a8eb-7d1031c23d0a` (rollback target `0efca4f1-12ce-4249-bcaf-c3c716825ff8`).

**Deploy 2026-11-14 14:54 UTC, commit `011ce6a` on a detached HEAD: pass.** holdback-op1 `ceb012e0-20d1-43fa-b872-e7291cdb5b52` (rollback target `0a1a18b4-72a7-491d-9a94-cbf2d683fc56`), holdback-op2 `ee98fcab-27e5-42ba-90f4-237be7776319` (rollback target `ee971afd-efb1-4648-b0aa-3f768fa009ee`). Smoke deal `0xf17e06270220ca429e0f42175e2ae758d7d38eb027bbdcd5eaabca14dd7638c0` Released in 44 s, against commit `011ce6a` (both nodes' discovery named it 286 s after /v1/status answered).

A deploy session ran all three on Rafa's word ("Go ahead and deploy anything hanging", 2026-11-14), after Crow Control's "Deploys owed" signal. The operators waited for the benchmark batch (s2 to s6), whose last deal settled at 14:39:54 UTC.
- The operators carry PR 534: the faucet grants 50 new addresses per client an hour, up from 10. No world, contract or schema changed. The deal guard checked 4 open deals and found that none would lose its judge.
- The test seller carries the operator change and `apps/test-agents/scripts/play-offers.ts`.
- The site carries PR 552 (T-433): `ref/limits.txt` changed, the only site file since `0250676`. The build uploaded `/version.json`, `/guide-budget.json` and `/ref/limits.txt`, with 72 files already uploaded.
- CI's `ci` run passed on `011ce6a` for the operators and on `b9df8c8` for the test seller and the site. The commits from `b9df8c8` to `8c465bb` change only `docs/`, `scripts/id-check.mjs` and `tests/`, outside every Worker's paths, so the deploy went ahead at main's tip without a further CI wait.
- Earlier tries stopped before any upload: the test seller's pre-flight refused `011ce6a` because `origin/main` had moved.

Measured after the deploys, at 16:07 UTC:
- `https://crow.direct/version.json` and `https://crow.direct/agents/test-seller/version.json` name `8c465bb`;
- both nodes' discovery (`demo.build.commit`) names `011ce6a`;
- `https://crow.direct/guide-budget.json` names `8c465bb` and puts the buyer's first-deal path at 4,544 of 5,000 tokens and the seller's at 4,156 (estimates);
- the test seller and the test buyer read operational 2 s after the upload.

**Earlier site deploys the same day.** Two deploys carried no record line here; their versions come from `npx wrangler@4.151.3 deployments list --name crow-site`:
- 12:17 UTC, commit `a6b9472` (PR 529, T-421's Coming soon notice): crow-site `b0c3a3d3-448d-40dd-a112-38e0cce332de` (rollback target `68d33780-5033-4053-a46e-fe3fdfff1e83`).
- 14:18 UTC, commit `0250676` (PR 548): crow-site `2282f633-7bc9-4794-9a67-c61406685562` (rollback target `3f6b27aa-be9e-472e-9771-aef718c855a8`).

The deployment list also shows site versions at 13:14, 13:30, 13:46 and 14:06 UTC with no entry here; the sessions that ran them hold their record lines.

### The seller guide's fresh-key line (site deployed 2026-11-14, 14:14 UTC)

**Site deploy 2026-11-14 14:14 UTC, commit `0250676` on a detached HEAD: pass.** crow-site `3f6b27aa-be9e-472e-9771-aef718c855a8` (rollback target `49d9faa2-af62-4f80-ba18-eced852bb792`).

The T-399 session ran it on Rafa's word ("Yes, deploy"). It carries PR 546 (T-432): `ref/seller-adapter.txt` gains "A fresh key for each deal". The build uploaded three changed files (`/version.json`, `/guide-budget.json`, `/ref/seller-adapter.txt`), with 72 already uploaded. Two earlier tries, from `2db4e8f` and `46c03a4`, were refused before any upload, because `origin/main` had moved; the script refuses a checkout that lacks commits from `origin/main`.

Measured after the deploy:
- the script's own live check passed 0 s after the upload: the live site serves the built `llms.txt` and the pinned `try.mjs`;
- `https://crow.direct/version.json` names commit `0250676` and version `3f6b27aa-…`;
- the live `ref/seller-adapter.txt` holds both "A salt in each report" (T-431) and "A fresh key for each deal" (T-432).

### Rafa's four site fixes (site deployed 2026-11-13, 08:05 UTC)

**Site deploy 2026-11-13 08:05 UTC, commit `15fedc8` on a detached HEAD: pass.** crow-site `80cdc3da-2376-40b5-9ac5-94dc2b4ecc47` (rollback target `ea7ecc24-ceb2-4368-b208-d6f36526292a`).

The coordinating session ran it on Rafa's word ("Yes, deploy it"). It carries PR 480 (T-391): the pages are light in either system mode, the demo page's header matches the home page's, the home page's hero holds its height, and the demo page has two columns on desktop. Since the 07:01 UTC deploy only `site/build.mjs`, `site/demo/index.html` and `site/home.css` changed among the site's files; `try.mjs`, `buy.mjs` and the guides are unchanged. The live checks passed at 08:05 UTC: the live version names `15fedc8`, both downloads equal `main`'s with their hashes in the install lines, `/demo` and its links answer, a missing path answers 404, and the three guides equal the build's [measured by the coordinating session].

### The phase-one cutover: new contracts, a new world (deployed 2026-11-13)

**The operators have been live on the phase-one contracts since 2026-11-13, 06:46 UTC; the test agents since 06:49 UTC; the site since 07:01 UTC.** The coordinating session ran [`cutover-phase-one.md`](cutover-phase-one.md) and its day sheet (T-383, Handoff) on Rafa's word: "When you're ready go ahead and execute the deployments and switchover" (about 02:20 UTC), then "ok when ready merge and deploy and complete the switchover plan" (about 06:42 UTC). Each step's output is kept in Rafa's `reports/cutover-phase-one/` folder. All values below are measured unless marked.

**The contracts.** Rafa deployed them at 05:32 UTC from the frozen commit `938c3fc`, whose `contracts/src` equals `0180a39`'s, through `https://sepolia.gateway.tenderly.co`. The record is `contracts/deployments/sepolia.json`: its `commit`, `deployedAt`, `fromBlock`, addresses and margins. The rules contract signs under "Holdback" 0.8. Its runtime code, and the beacon's, with the immutables zeroed and the metadata cut, hash to the reviewed figures (the runbook, step 3.2). `deploy-sepolia.sh --check` passed from the cutover branch and again from `main` after the merge. All five contracts are verified on Sourcify, runtime and creation `exact_match`. Sourcify was reached through its v2 API (T-383): `deploy-sepolia.sh --verify` with forge 1.0.0 failed with "error decoding response body".

**An orphan escrow.** The first deploy attempt, through publicnode at about 05:25 UTC, created one `AuthCaptureEscrow`, `0x5E692f62B9e16e56942FadE1d111c6FaFea5Df6f`, then failed with "replacement transaction underpriced" before its second create. The script wrote nothing. No record names that escrow, and nothing uses it.

**The worlds.** The old world, `holdback-public-demo-sepolia-2026-11-04`, settles on the 0.7 contracts (rules `0xf38287e5c5c1f20c6d03be500edbf8a244f27cfa`; record `contracts/deployments/sepolia-2026-11-04T0830Z-domain-0.7.json`). Its storage stays: never delete it, because a rollback of both operators serves it again. The new world is named by the new rules address (`WORLD_NAMES`, above). After step 6 both nodes served chain 11155111, the record's rules address under domain 0.8, schema 0.11, the record's token, an operator fee of 0 bps, three new demo adjudicators each with `observed.bond` `none`, a new `rulebookHash` for `demo-club`, and the build `3cb9428`.

**The new world bonds no one.** Phase one has no bonds on chain (D57, ADR-0031). The old vault, the 0.7 deployment's `HoldbackBonds` (not in phase one), still holds the three demo adjudicators' deposits of 25,000 tUSDC each. They are test tokens, and the world has no path to withdraw them (gap 12 of T-363).

**The versions,** and the rollback target of each, the version live before the cutover:

| Worker | Deployed | From | Rollback target |
| --- | --- | --- | --- |
| holdback-op1 | `3f3709b7-3801-41fa-8d8e-1c336da14eb9` | `3cb9428`, branch `cutover-phase-one` | `e54f7b7f-000a-4ada-9202-fc58cc404c8c` |
| holdback-op2 | `efbe9a77-a4d7-48aa-98f1-f56abecf0177` | `3cb9428`, branch `cutover-phase-one` | `4acf9fcc-7b6a-4e62-aaa6-f0eb4bb8ffc7` |
| crow-test-agents | `4b675edd-e6bb-4b61-b473-b8305b1b0303` | `3cb9428`, branch `cutover-phase-one` | `6d3b1cb7-dcd3-4ad9-81b8-7042693b9d21` |
| crow-site | `ea7ecc24-ceb2-4368-b208-d6f36526292a` | `27ab44e`, `main` | `0bf253cd-b694-4bf2-890d-1e8d78cf48de` |

Roll back the operators together, the test agents only with them, and the site only with all three: each old client works only against the old world. After step 9 a rollback leaves every deal opened on the new world without an operator; fix forward instead.

**The record lines,** as the scripts printed them:

**Deploy 2026-11-13 06:46 UTC, commit `3cb9428` on branch `cutover-phase-one`: pass.** holdback-op1 `3f3709b7-3801-41fa-8d8e-1c336da14eb9` (rollback target `e54f7b7f-000a-4ada-9202-fc58cc404c8c`), holdback-op2 `efbe9a77-a4d7-48aa-98f1-f56abecf0177` (rollback target `4acf9fcc-7b6a-4e62-aaa6-f0eb4bb8ffc7`). Smoke deal `0xfabd72c67175c291693b58ca634c112a29646ed25487ccd439a10983110f7056` Released in 65 s, against commit `3cb9428` (both nodes' discovery named it 0 s after /v1/status answered).

**Site deploy 2026-11-13 07:01 UTC, commit `27ab44e` on a detached HEAD: pass.** crow-site `ea7ecc24-ceb2-4368-b208-d6f36526292a` (rollback target `0bf253cd-b694-4bf2-890d-1e8d78cf48de`).

**The deals,** each on the new contracts:

- **The smoke deal of step 6,** `0xfabd72c6…7056`: Released. The buyer paid 26 tUSDC (the price of 25 and the adjudication fee of 1), with no operator fee; the balances read buyer 974 tUSDC, seller 1025 tUSDC. Its three transactions went to the rules contract at 1 gwei: funded [`0xe6185e65…86c7`](https://sepolia.etherscan.io/tx/0xe6185e65cfcee20041d71fcf23d2be52affbddfbf56948387b1e8a40885c86c7), 581,420 gas; delivered [`0x63a4491e…eca4`](https://sepolia.etherscan.io/tx/0x63a4491eb06b68d156a2c047c31f26b291174cbe468f0a0f94b8a6139040eca4), 174,012 gas; decided [`0x65a98137…692c`](https://sepolia.etherscan.io/tx/0x65a98137e20600988cffc4c0cef6f980a4016e03e888575221f1426c80ca692c), 524,804 gas. Gas on Sepolia: fund 581,420, deliver 174,012, decide 524,804, total 1,280,236 (the contract stack page reads this line).
- **One escalation, step 7,** by Rafa, 06:57 to 07:00 UTC: scenario 5b of the Sepolia round passed 21 of 21 checks, deal `0xcaf7b15d4027d70bdf9f5e74388de01d9907ea6f5657c31882ad5b30189c12e1`. The primary escalated, and the appeal adjudicator's panel of five live models decided; the operators relayed every step. Gas: funded [`0x8cb6748d…f7af`](https://sepolia.etherscan.io/tx/0x8cb6748d7307789410c83118fa84f89cc1a542ad601fb37cd7ee3b292e39f7af) 581,408; delivered [`0x1b9d1bae…6bb9`](https://sepolia.etherscan.io/tx/0x1b9d1bae6821cd608aa16c9063023e6a7566b4e6b4f944ec037541b40d756bb9) 174,012; the primary's escalation [`0x9807421d…ff38`](https://sepolia.etherscan.io/tx/0x9807421d2392ca06589b9fab5a68a201e944c1b630cbfa6d5c6908a9cb3eff38) 158,616; the appeal adjudicator's decision, with the release and the key, [`0x9f130ba4…7004`](https://sepolia.etherscan.io/tx/0x9f130ba4a3d7cc23401b3c5758670fa5c06a7eab0920b4a683a36ed3a0227004) 460,349. A later appeal was refused with `invalid_state`. So the operators' estimate for an escalation's decision holds on Sepolia (the runbook, step 7). Evidence: the round's `summary.md` under `reports/e2e-round-1/2026-11-13T065749Z/` (not in git).
- **The two money addresses, step 7 (scenario 12),** by Rafa, twice; each run passed 31 of 31 checks (`results: 12 pass`). The price reached the seller's payout address (25 tUSDC). The buyer's payment address paid 26 tUSDC, and got 25 back on the refund. No signing address moved a token, no operator fee moved, and the funding named both money addresses on chain.
  - At 07:00 UTC: Released `0xe1c396aaf7064c7332289263b4cc06032bb9f0b54569d0089a763550bd2305cd` (funded 572,704 gas, block 12124339; delivered 174,024; decided with the release and the key 259,861). Refunded `0xdc7b669cdd40f31be302c03dd155356f6114ec1f28eef68566a8c0622ebbe586` (funded 572,680; delivered 174,024; decided with the refund 257,316). Evidence: `reports/e2e-round-1/2026-11-13T070017Z/summary.md` (not in git).
  - At 07:07 UTC: Released `0x1de26ed23171fe9de27d4f2fb35f3249e38fcb205079e1e5c67103f1fc620932` (decided with the release 170,904 gas). Refunded `0x5da6d3a31d4afb027896cbaa0dbaab8daefdb7a63fd95d950459cfd1563bfbf3` (decided with the refund 257,292 gas). Evidence: `reports/e2e-round-1/2026-11-13T070720Z/` (not in git).
- **The test agents, step 8,** 06:49 UTC onward: bought from the test seller, Released in 110 s, `0xd6f600c4c64ac13ba262bd4a76915b05b1e1af29e10f370db75dfcfee72cb3cd`; bought with `--outcome refund`, Refunded in 89 s, `0x0769170da592217bce0ed20f5e65b6576deaaf6957fa970a9cbb1f8decf47e95`; sold to the test buyer, released, `0xcbdef2636fea3b820541d2bfaf46479f59c20f379577ebc5efe34c05c58c8981`.
- **The site's one command, step 9,** run as a stranger would: `try.mjs: OK`, then `0x5c5270f77a1e376685e348cc6ac7d07c6438984584da70f597f68ac09451bdaa` Released in 112 s. The five checks of the live site passed: the two scripts and their install hashes, the demo page's links, the 404 page, the home page's weight and pointer, and the three guides equal to the build.

**The window.** From the operators' deploy at 06:46 UTC to the site's at 07:01 UTC, about 15 minutes, the public one command failed, because the site's bundle still pinned the old contracts. From 06:46 to 06:49 UTC the live test agents refused to sign for the same reason [inferred from the runbook, step 6; not measured].

**Deals left on the old contracts: none that holds money.** At step 1 and again at step 5 (06:44 to 06:46 UTC) each node held 88 deals, none holding money, and `head.eventSeq` read 886 twice, 30 s apart. Both test agents read `"open": 0`. Two deals listed with no final time: `0x137ccb0d…3049` and `0x71f767f8…1197`. Both have been `Settled` on the old contract since 2026-11-06; each node is behind the chain for them (their deliveries did not pass through it), so its record has no settle time. They are final, not left behind. The old rules contract logged no event in the 60 blocks around the switch, and the deal guard counted 0 open deals.

**The freeze.** Rafa pushed the annotated tag `contracts-phase-one-1` at 07:10 UTC. It points at `27ab44e`, the merge of PR 475 into `main`. Both of the auditor's checks print `0` (the runbook, step 11.3): the tagged `contracts/src` equals the record's `commit` (`938c3fc`), and equals `0180a39`'s. The audit pages name the frozen commit by this tag ([`audit/scope.md`](audit/scope.md)).

**What `main` gained with this cutover** (PR 475, merged at 07:00 UTC as `27ab44e`, whose tree equals `3cb9428`'s):
- the contract lane, `contracts-audit-ready`, at its frozen commit;
- the new record, with every copy that `scripts/record-copies.mjs` writes;
- the record's type naming `beaconMarginSec`;
- `tests/record-copies.test.ts` taking the kept 2026-11-04 record for its pairing tests;
- `site/walkthrough.mjs` following the phase-one guides;
- `examples/e2e-chain.test.ts`'s fee-cap test approving the escrow instead of the cut vault;
- two CodeQL alerts fixed in test and check code.

**What changed for agents:** a new rules address, a new token (the faucet mints it, and every balance starts at zero), new demo adjudicator addresses, a new `rulebookHash` for `demo-club`, schema 0.11 under domain 0.8, and new SHA-256 hashes for `try.mjs` and `buy.mjs`. Anyone who pinned the old values reads discovery again.

### T-377: a deal is judged under the policy it bound (operators and site deployed 2026-11-12, 09:44 UTC)

The coordinating session ran both deploys on Rafa's word ("Yes, deploy both"), from `899a670`. The operators carry T-377 (PRs 395 and 397, ADR-0036): a build keeps the earlier screen beside the new one and judges a deal under the policy it bound, and the state read names an adjudicator that cannot judge. The site upload carried `sell.txt` and `version.json`; the live `version.json` names `899a670` and the live `sell.txt` equals main's [measured by the coordinating session]. The record lines, as that session captured them:

**Deploy 2026-11-12 09:44 UTC, commit `899a670` on branch `main`: pass.** holdback-op1 `e54f7b7f-000a-4ada-9202-fc58cc404c8c` (rollback target `226e7887-b48e-49db-8595-5daf1cf45141`), holdback-op2 `4acf9fcc-7b6a-4e62-aaa6-f0eb4bb8ffc7` (rollback target `2bc6bd1a-a304-4e50-90f8-826074dd3207`).

**Site deploy 2026-11-12 09:44 UTC, commit `899a670` on branch `main`: pass.** crow-site `0bf253cd-b694-4bf2-890d-1e8d78cf48de` (rollback target `3564b317-b922-435f-9e7f-9c1b09ddec55`).

PR 419 (no "arbitration" on the site; "Frontier AI Verification" and "Private Delivery" on the home page) merged after these deploys, as `039a7c4`, and is not live until the next site deploy.

### T-372 and PR 393: the hung store read, and a deploy that waits for its commit (operators deployed 2026-11-12)

The coordinating session ran this deploy on Rafa's word. It carries T-372 (PR 389) and PR 393, which makes the deploy script wait until both nodes' discovery names the deployed commit before the smoke deal. The record line below is as the coordinating session captured it: its output filter cut each line at 300 characters, so the line's tail is missing and is not reconstructed here.

**Deploy 2026-11-12 07:22 UTC, commit `ec498d9` on branch `main`: pass.** holdback-op1 `226e7887-b48e-49db-8595-5daf1cf45141` (rollback target `d8545ef2-7c4a-427c-ac3e-c17b9f4df039`), holdback-op2 `2bc6bd1a-a304-4e50-90f8-826074dd3207` (rollback target `2599701e-9ffe-4788-b694-8d2d8dfa4ef7`).

What the coordinating session measured: the smoke deal `0xdb4baa7f9449304720a1b6764c99908e23af87f704f8ecd25a99d4d7baaf3890` ended Released in 54 s, and the script finished at 07:28:40 UTC after it waited for discovery to name the commit, the first live run of PR 393's wait. At 07:28 UTC both operators answer `demo.build.commit` `ec498d9`. Adjudicator a still registers `screen-1` with the same policy hash as before, so this deploy changed no judging policy.

### T-367: the screen change (operators and site deployed 2026-11-12)

Rafa ran the operator deploy, from `8d20405`, the commit that holds PR 386 (T-367), and the site deploy of 06:57 UTC, which uploaded `sell.txt`, `llms.txt` and `version.json`. The coordinating session ran the site deploy of 07:00 UTC on Rafa's word; it changed no asset.

**Deploy 2026-11-12 06:55 UTC, commit `8d20405` on branch `main`: pass.** holdback-op1 `d8545ef2-7c4a-427c-ac3e-c17b9f4df039` (rollback target `08524578-c766-4633-8b95-e9dc9e153b72`), holdback-op2 `2599701e-9ffe-4788-b694-8d2d8dfa4ef7` (rollback target `c3c15379-fedb-4533-8941-0ac762d61a2a`). Smoke deal `0x4a3c63f95360cfa13493a6c6295c52745ed63ec95eccf9f7d826072eb1b7d0af` Released in 50 s.

**Site deploy 2026-11-12 06:57 UTC, commit `8d20405` on branch `main`: pass.** crow-site `a806e65b-fff0-470a-9bc9-d4039a14b087` (rollback target `cb842681-4a45-4f9a-a97e-265dc725f323`).

**Site deploy 2026-11-12 07:00 UTC, commit `8d20405` on branch `main`: pass.** crow-site `3564b317-b922-435f-9e7f-9c1b09ddec55` (rollback target `a806e65b-fff0-470a-9bc9-d4039a14b087`).

**The screen is live** [measured by the coordinating session]. The live operators serve `8d20405` since about 07:01 UTC, and the three demo adjudicators register `screen-1`. Just after the 06:55 deploy the service still reported `00be274` and `screen-0`. A smoke deal against the new screen at 07:05 UTC, `0x7b1b107c3921c73c0ab25fd91a3397e738930e22de5399ec4592aaa05c867d87`, ended Released in 42 s.

### T-366, T-368 and T-370: the seller adapter's API shapes, the buyer's approval stop and the discovery fields (operators deployed 2026-11-12)

Rafa ran this deploy on 2026-11-12, from `00be274`, before PR 386 (T-367). PR 216's discovery fields are live on both operators [measured by the coordinating session at 06:56 UTC: `demo.build.commit` is `00be274…` on both, with one funding lane and three deal lanes, `mintsPerDay` 600, and `byModel` empty].

**Deploy 2026-11-12 06:53 UTC, commit `00be274` on branch `main`: pass.** holdback-op1 `08524578-c766-4633-8b95-e9dc9e153b72` (rollback target `b531c0bc-c1b9-407a-b2d3-8f9cadd7bc4b`), holdback-op2 `c3c15379-fedb-4533-8941-0ac762d61a2a` (rollback target `aacbd652-ca95-4815-9223-93121806ca95`). Smoke deal `0x0ceb3fd15dd9a0f244ee9e87c22ca31002bb21f0741e5ddfda1ae44386dc1a66` Released in 42 s.

### T-359: the seller's page (site deployed 2026-11-12)

**Site deploy 2026-11-12 05:14 UTC, commit `18d2225` on branch `main`: pass.** crow-site `cb842681-4a45-4f9a-a97e-265dc725f323` (rollback target `106cdd47-c29b-41cb-825b-1c296ba75cda`).

Rafa ran it. The seller's page is live at `https://crow.direct/sell.txt` [measured by the coordinating session: HTTP 200, 33,495 bytes], and `llms.txt` points to it in place of the four seller sections.

### T-347: the operators catch up with `main` (deployed 2026-11-12)

Rafa ran this deploy on 2026-11-12. With it, T-347's fix is live: an unreadable delivery no longer stalls the adjudicator's other deals (PR 346).

**Deploy 2026-11-12 05:01 UTC, commit `2d03383` on branch `main`: pass.** holdback-op1 `b531c0bc-c1b9-407a-b2d3-8f9cadd7bc4b` (rollback target `c93d6786-0171-4299-8d93-5b227b3aedfa`), holdback-op2 `aacbd652-ca95-4815-9223-93121806ca95` (rollback target `24387d5f-e083-413a-8893-ace4204bec3c`). Smoke deal `0xbce2f1a4a1b2be922fe291baf4665def274f42adabf86733a55a20b240b48a18` Released in 51 s.

### T-329 and T-330: the refused report and terms set per quote in the agent docs (site deployed 2026-11-11)

**Site deploy 2026-11-11 20:18 UTC, commit `5a90dc5` on branch `main`: deployed by Rafa.** crow-site `106cdd47` (rollback target `feff0e7f-fd7b-4d80-88cc-34405ea80092`). The coordinator's log records the version, the commit and the rollback target; no check result is recorded here. The `site/` commits since the previous deploy (`ac2d2b6`) are T-329's `llms.txt` lines on fixing a refused report and T-330's two sections on terms set per quote [inferred: `git log ac2d2b6..5a90dc5 -- site/`]. The operators and the test agents were not deployed with it.

### T-323 to T-327: the report converter, the buyer signer's outcome and the adjudicator's reference files (deployed 2026-11-11)

All three deploys below ran on Rafa's go-ahead, or by Rafa himself, on 2026-11-11.

**Site deploy 2026-11-11 15:56 UTC, commit `ac2d2b6` on branch `main`: pass.** crow-site `feff0e7f-fd7b-4d80-88cc-34405ea80092` (rollback target `a3fd2ab0-efb9-4d63-af16-659083754387`). Only `/llms.txt` changed; the live file is 97,269 bytes.

**Deploy 2026-11-11 15:54 UTC, commit `ac2d2b6` on branch `main`: pass.** holdback-op1 `c93d6786-0171-4299-8d93-5b227b3aedfa` (rollback target `80b683f0-9023-4506-91e9-97c10f22809f`), holdback-op2 `24387d5f-e083-413a-8893-ace4204bec3c` (rollback target `2bfc0d0f-f9e6-4363-bdb3-baa90e3ebe54`). Smoke deal `0xb47e5385c117591b0b27b08293e52450c48b3d0bec1a532a8ce3a8f59f36d100` Released in 44 s. It carries T-327's PRs 306 and 312. The smoke deal has no reference check, so no live deal has exercised the reference path.

**Site deploy 2026-11-11 15:04 UTC, commit `488f30a` on a detached HEAD: pass.** crow-site `a3fd2ab0-efb9-4d63-af16-659083754387` (rollback target `6094a438-4ada-4826-861f-10f6d99f4ad4`). Only `/llms.txt` changed: T-323's line on report mappings.

### T-239: the test buyer (deployed 2026-11-11)

**Test seller deploy 2026-11-11 15:16 UTC, commit `7103cdf`: pass.** crow-test-agents `830eb7e1-9c6d-4892-a153-97b87bf17faa` (rollback target `545afdd8-1e1c-40ff-aa35-2eea83d9ec0e`). This deploy put the test buyer live. The first seller-started deal, `0xd298b3da40a61685ff5903284131607582b9b05dc41a14fa78401facf25c687a`, ended Released (T-239 Evidence) [measured].

**Test seller deploy 2026-11-11 15:45 UTC, commit `69c783b`: pass.** crow-test-agents `6d3b1cb7-dcd3-4ad9-81b8-7042693b9d21` (rollback target `830eb7e1-9c6d-4892-a153-97b87bf17faa`). It carries PR 313's review fixes to the test buyer. A seller-started deal against it, `0xe855a9baf0c72677e92bced214abaa0f62b9b9bf4f993fc051e14e3e5e549b01`, ended Released on Sepolia [measured].

### T-318 to T-321: the seller adapter, the buyer signer and the audit-deal docs (site deployed 2026-11-11)

**Site deploy 2026-11-11 09:28 UTC, commit `be19adc` on a detached HEAD: pass.** crow-site `6094a438-4ada-4826-861f-10f6d99f4ad4` (rollback target `33f0658b-1a40-4b2e-8f4a-904359d131ff`).

Rafa gave the go-ahead ("deploy when ready", 2026-11-11). This was a site deploy only: T-318 to T-321 changed examples, fixtures and `site/llms.txt`, and no operator code. After it, `https://crow.direct/llms.txt` serves the sections "Sell a priced API service", "A seller's client can carry the buyer's side" and "Writing checks for a report" [measured]. `node site/check.mjs` failed before the deploy, because `reports/site-out` held the earlier build, and passed after the deploy script rebuilt it [measured].

### T-314 to T-317: the faucet's stated amount, the ciphertext cap, the seller's check runner and the audit-report template (deployed 2026-11-11)

**Deploy 2026-11-11 07:54 UTC, commit `a42dc45` on branch `docs-deploy-2026-11-11`: pass.** holdback-op1 `80b683f0-9023-4506-91e9-97c10f22809f` (rollback target `f71bfaef-31ce-4535-bde7-15628384b55a`), holdback-op2 `2bfc0d0f-f9e6-4363-bdb3-baa90e3ebe54` (rollback target `60a7253a-a8a0-42c0-a0cc-ae43c8405fce`). Smoke deal `0xe47c874564d8c10ff56709629d8254fc832cf1cd6f1d113cddb753cbcc81b0a7` Released in 44 s.

**Site deploy 2026-11-11 07:56 UTC, commit `a42dc45` on branch `docs-deploy-2026-11-11`: pass.** crow-site `2d11374e-c999-4012-8d24-68f482363f37` (rollback target `4ceb5f29-6705-42ed-b9bd-3265a2f8d8de`).

Both operators and the site run main's tip `a42dc45`, on Rafa's go-ahead ("deploy when ready", 2026-11-11). The deploy shipped PRs 273, 274, 276 and 278 with `pnpm demo-cloud:deploy`, then `pnpm site:deploy`. No world, contract or domain changed. holdback-op2 no longer carries the variable `OPERATOR_URLS`, as PR 262 merged it (T-313).

The deploy ran from a clean worktree at `a42dc45`, which is why the lines name the branch `docs-deploy-2026-11-11`. The main checkout refused in pre-flight (exit code 2, nothing uploaded): its submodule `contracts/lib/commerce-payments` has a changed file in the nested `lib/spend-permissions`. Clean that submodule before the next deploy from the main checkout.

Checks on the live service after the deploy (measured):

- Discovery on both nodes states `limits.maxCiphertextBytes` 1048576 (1 MiB) and `demo.faucet.maxGrant` 1000000000000 base units (1,000,000 tUSDC).
- `POST /v1/faucet` with `"amount": "2005710000"` for a fresh address answered 200 with a balance of 2005710000 base units (2,005.71 tUSDC).
- `https://crow.direct/llms.txt` has the section "Writing checks for a report".

### Crow Control, the founders' console (moved to control.crow.direct on 2026-11-11)

Crow Control is the founders' console. Its code lives in a private repository, and it serves control.crow.direct behind an access proxy. The maintainers keep its deploy records privately (`docs/private-materials.md`).

**Live since 2026-11-11, about 06:44 UTC**: crow-console `001cb560-b57c-41d6-9902-13d1a3216764` serves control.crow.direct.

### T-312: crow.direct, the new landing page and escrow.stream forwarding (deployed 2026-11-10)

**Live since 2026-11-10, 10:33 UTC.** Rafa gave the go-ahead ("deploy when ready"). The coordinator shipped `b6b3980` from main in PR 253's order: the crow.direct domains first (`wrangler triggers deploy`, no new code), then crow-early-access, then the operators, the test seller and the site back to back. Versions and rollback targets (measured):

| Worker | Live | Rollback target |
| --- | --- | --- |
| holdback-op1 | `f71bfaef-31ce-4535-bde7-15628384b55a` | `d7211270-8310-49ec-be29-ebfc0baf793c` |
| holdback-op2 | `60a7253a-a8a0-42c0-a0cc-ae43c8405fce` | `fe75eceb-7943-4200-b48a-17808d55e64a` |
| crow-test-agents | `545afdd8-1e1c-40ff-aa35-2eea83d9ec0e` | `6122d260-d59b-41a0-8699-3bc6cacaa354` |
| crow-early-access | `99c500b2-c49e-4fb9-8348-083d0b939233` | `973116d7-2927-4b25-97ff-27db27df1819` |
| crow-site | `56af2ef3-4614-49ce-a10d-cf1ff407fc6b` | `f9806d3c-ac4a-4cd2-81ca-518e9b88d21f` |

Roll back in pairs, as PR 253 says: the operators with the site; the test seller only with the operators.

- **The first operator deploy failed safely.** Its smoke deal did not end Released within 180 s, and the script rolled both operators back (`07eaa890` and `adaf731a`, 10:25 UTC). The script printed no reason. A test deal against the rolled-back operators then ended Released in 43 s, and the second run passed: smoke deal `0x16429663fb232df430ec7476e7c47dec8a1c6331afffdbad25b611ec8cbb1dcc` Released in 47 s (10:28 UTC). The likeliest cause is the new hostnames' DNS reaching this Mac late: crow.direct did not resolve here for several minutes after Cloudflare served it [inferred]. The deploy script now prints the smoke deal's output when it fails.
- **Post-deploy checks (measured, 10:33 to 10:34 UTC):**
  - escrow.stream and www.escrow.stream return a 301 to the same path and query on crow.direct;
  - a POST to escrow.stream/agents/test-seller gets a 308;
  - join.escrow.stream returns a 301 to join.crow.direct;
  - crow.direct serves the new landing page, and its llms.txt reads "> ’crow. Verifiable settlement for AI commerce";
  - crow.direct/try.mjs hashes to `4dab4c08…1dd21`;
  - api and api2 answer 200 on both domains;
  - join.crow.direct allows the crow.direct origin;
  - a test deal against the crow.direct operators ended Released in 48 s.
- **Not done here:** control.crow.direct (Rafa adds it to the Crow Control Access application), and the private repo's checks, which still name escrow.stream and follow the forwarding.

### T-232 and T-233, through the deploy script (deployed 2026-11-07)

**Deploy 2026-11-07 06:32 UTC, commit `db5c6c3`: pass.** holdback-op1 `d7211270-8310-49ec-be29-ebfc0baf793c` (rollback target `066f1b18-24c6-4f0f-ad45-de2c27a6823f`), holdback-op2 `fe75eceb-7943-4200-b48a-17808d55e64a` (rollback target `21cbbc0b-dd56-4d0c-af4a-c6d4916d8283`). Smoke deal `0xe116a251931aa7c1dbee66d934748095b36080d766c7ba8fde9e3635a0b81f6f` Released in 43 s.

This was `pnpm demo-cloud:deploy`'s first real run (T-234), on Rafa's go-ahead ("Yes, deploy", 2026-11-07). It shipped T-232's read-after-write fixes, T-233's precompiled validators and PR 242's CodeQL fixes. Cloudflare took the first upload of each Worker, with no start-up refusal. Both nodes then answered `/v1/status` at event 650 with 0 s lag (measured). The site didn't change, so crow-site stays `f9806d3c`. A Haiku agent ran the deploy in 6 tool calls, 66,871 tokens and 114 s; T-231's hand-run deploy took 205 calls, 369,453 tokens and 50 min (measured).

### T-231: the operators send due timeouts on their own (deployed 2026-11-06)

T-231 deployed 2026-11-06: holdback-op1 066f1b18-24c6-4f0f-ad45-de2c27a6823f, holdback-op2 21cbbc0b-dd56-4d0c-af4a-c6d4916d8283, crow-site f9806d3c-ac4a-4cd2-81ca-518e9b88d21f

**Live since 2026-11-06, 19:01 UTC** for the two operators and 19:08 UTC for the site (T-231 Evidence, "The deploy"). Rafa gave the go-ahead on 2026-11-06 ("Yes, deploy T-231"). A deploy session shipped PR 230's merge commit `e24204d` from main with `pnpm demo-cloud:deploy`, in the same world, `holdback-public-demo-sepolia-2026-11-04` (D49). It waited until round 1's scenario 8 run had finished (15:35 UTC, pass). It then deployed the site from the same commit, for `llms.txt`'s two new lines on deadlines.

| Worker | Live version | Deployed (UTC) | Rollback target |
| --- | --- | --- | --- |
| holdback-op1 | `066f1b18-24c6-4f0f-ad45-de2c27a6823f` | 19:01:40 | `8bcda43c-ba12-4919-9355-54048b98f720` (T-230's build) |
| holdback-op2 | `21cbbc0b-dd56-4d0c-af4a-c6d4916d8283` | 19:01:56 | `7e4d3fa5-273f-47a2-b6c4-537dbf31b58f` (T-230's build) |
| crow-site | `f9806d3c-ac4a-4cd2-81ca-518e9b88d21f` | 19:08:14 | `16038434-1066-452c-bfec-25c064547359` (T-230's site) |

Every check passed, and nothing was rolled back (measured; T-231 Evidence). Two points from the deploy:
- **The first upload was refused.** At about 18:55 UTC Cloudflare refused holdback-op1 with "Script startup exceeded CPU time limit" (code 10021). It created no version, and both nodes kept serving T-230's code. The session retried the same build with no change, and the retry passed at 19:01 UTC. Wrangler then reported startup times of 575 ms for holdback-op1 and 780 ms for holdback-op2; T-230's deploy reported 394 and 397 ms (measured). The same refusal happened on 2026-11-03 (the backlog row on start-up CPU), and T-231's Handoff carries the follow-up.
- **The switch took at most 75 s.** `/v1/status` carries no build marker, so the session read the switch from `wrangler tail`. The Durable Object's last event on `8bcda43c` was at 19:01:54 UTC, and its first on `066f1b18` at 19:02:55 UTC, 75 s after holdback-op1's deploy (measured).

**What it carries,** since T-230's build (`e5f667a`): T-231 only, in `apps/demo-cloud/src/` and `packages/settlement/evm/` (measured: `git diff --stat e5f667a e24204d`). The operators' pass sends each due timeout of every deal the world holds: the reclaim, the default, the appeal expiry and an accepted offer's expiry. It sends each one a minute after its deadline, at the relayer's gas, once the contract accepts it at a pinned block. A cap of 4 sends a pass and 200 timeouts a UTC day, 50 of them offer expiries, bounds the gas. A party's trigger after the operators' timeout answers 200 with the state it left. No contract change, no schema change, no new secret or variable.

**On Sepolia an offer expiry costs 147,581 gas** (measured: the deploy's check, transaction [`0x0c27b233…504f`](https://sepolia.etherscan.io/tx/0x0c27b23328786937454e5f031c1d1c4b9742962eb0f3614aaa47c9fe1653504f)). That is 2.2 times the 65,597 gas measured on anvil. If every timeout costs that much, the day's 200 cost about 29.5 million gas, 0.03 Sepolia ETH at 1 gwei (inferred).

**To roll back** (`npx wrangler@4.151.3 rollback <version> --name <worker>`): both operators together, then the site if its lines must go too.

- `npx wrangler@4.151.3 rollback 8bcda43c-ba12-4919-9355-54048b98f720 --name holdback-op1`
- `npx wrangler@4.151.3 rollback 7e4d3fa5-273f-47a2-b6c4-537dbf31b58f --name holdback-op2`
- `npx wrangler@4.151.3 rollback 16038434-1066-452c-bfec-25c064547359 --name crow-site`

T-231 adds one storage prefix, `ot:`, the daily budget row, which T-230's code never reads (inferred from PR 230's diff). After a rollback the operators stop sending timeouts, and a party's trigger after a timeout ran answers 409 again.

**A hand redeploy of holdback-op1** (round 1's scenario 11 pauses it) must use `e24204d` or later, or it takes T-231 back out. The `.worktrees/round1-run` checkout sits at `e24204d` since this deploy.

### T-230: the operators join a delivery that is already on chain (deployed 2026-11-06)

T-230 deployed 2026-11-06: holdback-op1 8bcda43c-ba12-4919-9355-54048b98f720, holdback-op2 7e4d3fa5-273f-47a2-b6c4-537dbf31b58f, crow-site 16038434-1066-452c-bfec-25c064547359

**Live since 2026-11-06, 12:19 UTC** for the two operators and 15:04 UTC for the site (T-230 Evidence, "The deploy"), until T-231's deploy (above) replaced all three at 19:01 and 19:08 UTC. Rafa gave the go-ahead on 2026-11-06 ("Yes, deploy T-230"). A deploy session shipped PR 232's merge commit `e5f667a` from main with `pnpm demo-cloud:deploy`, in the same world, `holdback-public-demo-sepolia-2026-11-04` (D49). It then deployed the site from the same commit, for `llms.txt`'s new line on submitting directly.

| Worker | Live version | Deployed (UTC) | Rollback target |
| --- | --- | --- | --- |
| holdback-op1 | `8bcda43c-ba12-4919-9355-54048b98f720` | 12:19:19 | `ba7a2ad9-0172-458a-92a0-5d51d18afd0a` (T-228's build) |
| holdback-op2 | `7e4d3fa5-273f-47a2-b6c4-537dbf31b58f` | 12:19:36 | `7826e3ce-b8ce-422f-a2ea-9e88bd982ba9` (T-228's build) |
| crow-site | `16038434-1066-452c-bfec-25c064547359` | 15:04:51 | `4f049eb5-34fb-4a59-843a-bd3855aaea19` (T-229's site) |

Every check passed, and nothing was rolled back (measured; T-230 Evidence). `/v1/status` carries no build marker, so the session read the switch from `wrangler tail`: the Durable Object first ran `8bcda43c` at 12:20:10 UTC, 51 s after holdback-op1's deploy. The tail saw no Durable Object event between 12:18:59 and 12:20:10 UTC, so 51 s is an upper bound. The deploy session lost its network from about 12:25 to 14:58 UTC; it finished the checks at 15:00 UTC and deployed the site at 15:04 UTC.

**What it carries,** since T-228's build (`236786a`): T-230 only, in `packages/settlement/evm/evm-settlement.ts` and `sync.ts`. An operator joins a seller's posted delivery whose hash the chain already holds, whether the post comes before or after its sync pass, and sends no second delivery that lands. When it cannot read the seller's transaction yet, it answers 409 `invalid_state`, keeps the signed copy and joins it within about a minute. No contract change, no schema change, no new secret or variable. The other files that changed since `236786a` are examples, tests, the site, and `config/model-prices.json` and `config/ops-cost-prices.json`, which only `scripts/metrics/` reads (measured: `git diff --stat 236786a e5f667a` and a search for the two file names).

**To roll back** (`npx wrangler@4.151.3 rollback <version> --name <worker>`): the targets above, both operators together, then the site if its line must go too.

- `npx wrangler@4.151.3 rollback ba7a2ad9-0172-458a-92a0-5d51d18afd0a --name holdback-op1`
- `npx wrangler@4.151.3 rollback 7826e3ce-b8ce-422f-a2ea-9e88bd982ba9 --name holdback-op2`
- `npx wrangler@4.151.3 rollback 4f049eb5 --name crow-site`

T-230 adds two book fields, `posted` and `postedKeys`, and no storage prefix, so T-228's code keeps them unread (inferred from PR 232's diff). A copy kept at the rollback then never joins, and its deal waits for the seller to post again, as before T-230.

**A hand redeploy of holdback-op1** (round 1's scenario 11 pauses it) must now use T-231's `e24204d` or later (above). The `.worktrees/round1-run` checkout sat at `e5f667a` from this deploy until T-231's.

### T-229: the One-Click prompt on the site (deployed 2026-11-05)

**Live since 2026-11-05, about 15:58 UTC** (T-229 Evidence): crow-site `4f049eb5`, until T-230's site (above) replaced it on 2026-11-06 at 15:04 UTC. Rafa gave the go-ahead on 2026-11-05 ("ship the two One-Click changes (trim llms.txt, and copy the command with the prompt)"). A deploy session built the site from PR 209's merge commit `43f8067` with the site's three commands under Deploy (above) and deployed only `crow-site`. It waited until T-228's operators were recorded as live (below), because this build's `llms.txt` carries T-228's line on closing a deal behind the chain by its timeout.

| Worker | Live version | Deployed (UTC) | Rollback target (T-220's site) |
| --- | --- | --- | --- |
| crow-site | `4f049eb5-34fb-4a59-843a-bd3855aaea19` | 15:58:05 | `704bd295` |

The deploy uploaded 2 files, `index.html` and `llms.txt`; the live copies match the build byte for byte, and `https://escrow.stream/try.mjs` still serves sha256 `cc310963…d832`, the one the command names (measured). After the deploy, a fresh Claude Code needed 1 approval per deal in both permission modes (measured; T-229 Evidence).

**To roll back:** `npx wrangler@4.151.3 rollback 704bd295 --name crow-site`. That restores the link-only prompt and the `llms.txt` without T-228's line; the operators keep T-228.

### T-228: the operators close a deal behind the chain by its timeout (deployed 2026-11-05)

T-228 deployed 2026-11-05: holdback-op1 ba7a2ad9-0172-458a-92a0-5d51d18afd0a, holdback-op2 7826e3ce-b8ce-422f-a2ea-9e88bd982ba9

**Live since 2026-11-05, about 15:29 UTC** (T-228 Evidence): holdback-op1 `ba7a2ad9` and holdback-op2 `7826e3ce`, until T-230's deploy (above) replaced both on 2026-11-06 at 12:19 UTC. Rafa gave the go-ahead on 2026-11-05 ("Yes, deploy it"). A deploy session shipped PR 207's merge commit `236786a` from main with `pnpm demo-cloud:deploy`, in the same world, `holdback-public-demo-sepolia-2026-11-04` (D49). It deployed the operators only; the site, with T-228's line in `llms.txt`, ships in its own deploy.

| Worker | Live version | Deployed (UTC) | Rollback target (T-220's build) |
| --- | --- | --- | --- |
| holdback-op1 | `ba7a2ad9-0172-458a-92a0-5d51d18afd0a` | 15:28:56 | `1d8a029c-44eb-4276-b5c0-c2c8894b25d5` |
| holdback-op2 | `7826e3ce-b8ce-422f-a2ea-9e88bd982ba9` | 15:29:13 | `a042aae3-821a-4efd-856a-42070205c45e` |

Every check passed, and nothing was rolled back (measured; T-228 Evidence, "The deploy"). `/v1/status` carries no build marker and the schema stayed 0.10, so the session read the switch from `wrangler tail`: the first Durable Object event it saw, at 15:29:33 UTC, ran `ba7a2ad9`.

**What it carries,** since T-220's build (`69021a6`): T-228 only. The operators relay a due timeout for a deal behind the chain (residual 13 in `docs/neutrality.md`) through `POST /v1/commitments/<id>/triggers/<kind>`, at their own gas; a timeout that is not due reverts in the simulation and is not sent. Signed steps for such a deal still answer `invalid_state` until T-227. No contract change, no schema change, no new secret or variable. Main reached `2e6f3c6` during the deploy; its four later commits change none of the Worker's inputs (`apps/`, `packages/`, `spec/`, `config/`, `contracts/deployments/`), only CI, docs, the site and `examples/try.test.ts` (measured: `git diff --stat 236786a 2e6f3c6`).

**To roll back** (`npx wrangler@4.151.3 rollback <version> --name <worker>`, both Workers): the targets above. T-228 adds no storage prefix, so T-220's code reads the world as it is (inferred from PR 207's diff); a timeout for a deal behind the chain then answers `invalid_state` again.

### T-220: round 1's prerequisites in one deploy (deployed 2026-11-05)

**Live since 2026-11-05, about 11:04 UTC** (T-220 Evidence): holdback-op1 `1d8a029c`, holdback-op2 `a042aae3`, and crow-site `704bd295` from 11:10 UTC. T-228's deploy (above) replaced the two operators at 15:29 UTC; crow-site `704bd295` still serves. Rafa gave the go-ahead on 2026-11-05 ("When ready, deploy"). A deploy session shipped PR 204's merge commit `69021a6` from main, in the same world, `holdback-public-demo-sepolia-2026-11-04` (D49): `WORLD_NAMES` did not change.

- holdback-op1 `1d8a029c` and holdback-op2 `a042aae3`, deployed together by `pnpm demo-cloud:deploy` between 11:03:40 and 11:04:11 UTC, on the first try;
- crow-site `704bd295`, deployed at 11:10 UTC and replaced by T-229's site (above) at 15:58 UTC; `https://escrow.stream/try.mjs` serves sha256 `cc310963…d832`.

Every step below passed (measured; T-220 Evidence). The new code answered requests at once, but `/v1/status` read schema 0.9 until 11:04:55 UTC: the Durable Object took up to 44 s to restart under the new code (measured window, inferred cause). To roll back: holdback-op1 `50fd05c4`, holdback-op2 `1a95b960`, crow-site `5582b10e` (Rollback, below).

**What it carries,** since the build it replaced (`dd0a55a`): the drand quicknet source for fallback and appeal decisions and the rulebook that names it (T-217, T-220), direct contract calls in the operators' view (T-218), an in-flight row per relayer lane (T-219), adjudicator registration through the API with schema 0.10 (T-221), a fresh 30-day mandate at every faucet grant (T-223), and post-receipt reads at the receipt's block (T-226). No contract changes, no new secret, no new variable. The gas quote stays at `OPERATOR_FEE_GAS` 4700000 (4.70 tUSDC) until T-215 lands.

**What changes for agents:** `GET /v1/clubs/demo-club` serves a new `rulebookHash`, whose rulebook names `{"source": "drand-quicknet", "chainHash": "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"}`. Deals already offered keep their old hash and their sim beacon (`Book.club`), so a fallback or appeal on them still takes the default path. An offer prepared before the deploy and posted after it gets 422 `rulebook_unknown`, whose page says to read the club again; the test seller and `try.mjs` read the hash fresh for each offer.

**Before** (read-only; save each answer under `reports/t220/`):

1. Main is merged into the branch you deploy from, `pnpm verify` passes, and the fork run passes on it (`SEPOLIA_FORK_RPC=https://ethereum-sepolia-rpc.publicnode.com pnpm exec vitest run apps/demo-cloud/src/predeploy-fork.test.ts --silent=false`, about 10 minutes; Tenderly's gateway if publicnode makes anvil exit). That test was deleted later; the phase-one cutover's fork step runs `apps/demo-cloud/src/live-fork.test.ts` and `apps/adjudicator/src/drand-fork.test.ts` instead.
2. `curl -s https://api.escrow.stream/v1/status`: `schemaVersion` 0.9, domain 0.7, `verifyingContract` `0xf38287e5c5c1f20c6d03be500edbf8a244f27cfa`.
3. `curl -s https://api.escrow.stream/v1/clubs/demo-club`: the old `rulebookHash`, with `randomness` `{"source": "sim"}`.
4. `curl -s "https://api.escrow.stream/v1/commitments?limit=200"` (and its `nextCursor` pages): the deals the world holds. Keep each open deal's id and `escrowState`, and its `rulebookHash` from `/v1/commitments/<id>/terms`. Keep also the state read of `0xf0453986b888caa632f81606bcc44b28c24f0503b25c990851ae736091405e5b`, round 1's homepage deal (T-216): `Released`, appeal `expired`, and no `delivery.submitted` among its events (measured on api.escrow.stream, 2026-11-05). Deploy step 5 expects it to fall behind.
5. The funding lane's balance (`0x601137a8DE7E195E1426f57C053aFa49B20Ef555` on Sepolia Etherscan, or `cast balance`), and the three demo adjudicators' bonds in `GET /v1/adjudicators`.
6. No deal is mid-step: the build being replaced keeps no in-flight row (T-219 is in this deploy, not in the old build). Read `head.eventSeq` in `/v1/status` twice, 30 s apart, and deploy only if it did not move.
7. **Residual 13 is decided: deploy with the honest limit** (D50, Rafa, 2026-11-05; `docs/neutrality.md`; the backlog row "the operators' adjudicators act on a deal behind the chain"). From this deploy on, the operators follow the chain (T-218), and anyone who copies a signed step from the public mempool can leave a deal behind it, even a deal that uses only the API; the demo adjudicators then do not act on that deal, and it ends by its timeouts. The T-218 red team recommended the fix before this deploy; Rafa placed it in Phase 11 as T-227, before mainnet, and `llms.txt` states the limit. Quote D50 in T-220's Evidence.

**Deploy,** both Workers together, then the site, as at the 0.7 cutover:

1. `pnpm demo-cloud:deploy` (builds, then holdback-op1, then holdback-op2). Watch `npx wrangler@4.151.3 tail holdback-op1 --format json` for the first requests. One earlier deploy was refused with "Script startup exceeded CPU time limit" and the retry passed (backlog); the curve library T-217 adds loads on first use, so startup should not move (inferred, T-217 Decision 15). Record the two version IDs.
2. `curl -s https://api.escrow.stream/v1/status` and the same on api2: `schemaVersion` 0.10, the same domain and `verifyingContract`.
3. `GET /v1/clubs/demo-club` on both nodes: `randomness` names `drand-quicknet` with the chain hash above, and `rulebookHash` is `0x3fecb058383da073d562995df281fbd28dc895c3f7c93e7114266f607218d108`, keccak256 of the rulebook's canonical JSON. Before the deploy it is `0xd25b8f97bf315dd3d4f8dfe36c472f9bc96ba7fbc742a2c3a3f04c1ecbf50c25` (measured from the live club on 2026-11-05; the new hash is that rulebook with only `randomness` changed, computed).
4. `GET /v1/adjudicators` on both nodes: the three demo adjudicators, each with a signed `registration`, `observed.bond: "bonded"` and its `observed.defaultFor` role. The first open after the deploy writes their three `ar:` rows (T-221, measured on a storage copy).
5. **The first sync passes.** The live storage was written by `dd0a55a`, before T-218: it has no `cursor` row and its books keep no `chainTxs`. So the first passes read the rules contract's logs from the deployment's `fromBlock`, 12,061,237, to the head, and count a transaction as applied when one of the deal's events names it. Watch them in the `wrangler tail` from step 1: no error. Expect one deal to fall behind, `0xf0453986…5e5b` from step 4 of Before. Its relayed `deliver` [`0x64c5c757…caf1`](https://sepolia.etherscan.io/tx/0x64c5c757d4af4fd9b40850435eefffacdabe184835bad79b36282f7addd0caf1) mined while the deployed build logged nothing (T-216, T-226), and its book already stands `Released`, so the pass cannot apply that delivery. Its state read keeps `escrowState` `Released`, the contract's stage, and gains a "Behind the chain" notice naming that transaction (inferred from `EvmSettlement.follow` and `rebuild`; the fork run starts from this build's storage, so it did not measure this). The deal is final and its money settled on chain: this is the old build's lost delivery, not a regression. Read any other deal that falls behind before going on.
6. The setup pass sends nothing: no new transaction from the funding lane, the deal lanes or the three adjudicator addresses on Etherscan, and the funding lane's balance as in step 5 of Before. Measured on the fork run: 0 transactions and an unchanged balance.
7. Every deal from step 4 of Before reads the same `escrowState` and `rulebookHash` as before (`0xf0453986…5e5b` also carries the notice from step 5).
8. The smoke deal: `HOLDBACK_OPERATORS=https://api.escrow.stream,https://api2.escrow.stream node examples/try.ts` ends Released with three Etherscan links, as at the 0.7 cutover. `apps/demo-cloud/scripts/deal.ts` runs on SimChain only: on 2026-11-05 it refused the Sepolia nodes before it sent anything.
9. The site: `node site/build.mjs --op1 https://api.escrow.stream --op2 https://api2.escrow.stream --out reports/site-out`, `node site/check.mjs`, `npx wrangler@4.151.3 deploy --config apps/site/wrangler.jsonc`. Then `https://escrow.stream/try.mjs` has sha256 `cc310963bb0833e0d23f8018eb4ea802db09fa05fbd9489020340d2be2eed832` (it serves `26ccaa80…` before), and the one command in `llms.txt` ("Try it") runs end to end against both nodes.
10. Record here the Worker and site versions, and in T-220's Evidence what each step measured. Then T-216 reruns round 1 with `--t220`. (Done for this deploy: the versions are under State, above.)

**Rollback** (`npx wrangler@4.151.3 rollback <version> --name <worker>`): holdback-op1 `50fd05c4`, holdback-op2 `1a95b960`, crow-site `5582b10e`. The world is the same under the old code (inferred, `docs/research/2026-11-04-one-world.md`, finding 3):

- the old code lists only its own prefixes, so it never reads `cursor`, `lane:`, `ar:` or `ph:` rows, and books keep `chainTxs` and `beaconSource` unread;
- the old operators serve the sim rulebook again, so new offers bind the old hash, and an offer prepared against the drand hash gets 422 `rulebook_unknown`;
- deals offered under the drand rulebook keep their book; under the old adjudicator code their fallback and appeal panels take the default path;
- money is unaffected: the chain holds it.

### 2026-11-04, about 16:40 UTC: the test seller and T-210's and T-211's fixes

**2026-11-04, about 16:40 UTC** (Rafa's go-ahead: "You can deploy what's ready btw? like the test seller?"), all built from main at `dd0a55a`, in the same 0.7 world:
- crow-test-agents `9d171ddc` (new: Crow's test seller, T-222);
- crow-site `5582b10e` (llms.txt names the test seller; try.mjs sha256 `26ccaa80…`);
- holdback-op1 `50fd05c4` and holdback-op2 `1a95b960`, with T-210's and T-211's fixes.

After the deploy, a smoke deal ended Released in 44 s, and the test seller sold once each way (T-222 Evidence) [measured]. To roll back: holdback-op1 `5d369b0e`, holdback-op2 `1f169857` and crow-site `cb0adcb5` (`npx wrangler@4.151.3 rollback <version> --name <worker>`); `npx wrangler@4.151.3 delete --name crow-test-agents` removes the seller.

### The 0.7 redeploy: new contracts, a new world (deployed 2026-11-04)

**The 0.7 cutover, 2026-11-04, about 08:30 UTC** (Rafa approved it the same day; T-212 Handoff): the 0.7 contracts, then holdback-op1 `5d369b0e`, holdback-op2 `1f169857` and crow-site `87d3c54c`, all built from `t-212-sepolia-redeploy` (main at `64be1f1` plus the new record, the world names and the site pins). Both Workers deployed together (`pnpm demo-cloud:deploy`), since both already settled on Sepolia. To roll back to the 0.6 world: holdback-op1 `3b6febc8`, holdback-op2 `45c2e6a9` and crow-site `671481dc` (`npx wrangler@4.151.3 rollback <version> --name <worker>` for each); the 0.6 world's storage and its deals on chain stay.

- **The 0.7 redeploy (ADR-0029; Rafa approved it on 2026-11-04).** The whole stack was deployed again from `64be1f1` with the same script, after a rehearsal on a Sepolia fork, and `--check` passes against Sepolia [measured]. The rules contract signs under "Holdback" 0.7 [measured: `eip712Domain()`]. The throwaway deployer is the one of 2026-11-03. The 0.6 deployment's record moved to `contracts/deployments/sepolia-2026-11-03-domain-0.6.json`; check it with `deploy-sepolia.sh --check` from a checkout at `2342756`, after copying that file over `sepolia.json`. The 0.7 deployment also has a Permit2 collector and the bond vault `HoldbackBonds`, which are not in phase one.

### T-213: the Sepolia cutover (deployed 2026-11-03)

**Live since 2026-11-03, about 16:32 UTC** (T-213 Evidence): holdback-op1 `3b6febc8`, holdback-op2 `45c2e6a9`, and the Sepolia site. To roll back, the earlier versions are holdback-op1 `167a6e70` (before the cutover) or `36b26c6f` (the new code on SimChain), and holdback-op2 `6310f84a`. A deploy of holdback-op1 restarts the Durable Object. With T-219, live since T-220's deploy, a restart mid-step loses no deal step: each deal lane writes an in-flight row before its broadcast, and the next pass applies that transaction as the operators' relay, with the adjudicators' envelopes and the buyer's key; a client that retries with the same Idempotency-Key gets the mined result. A broadcast that times out keeps its row too, so a transaction that lands anyway applies as the relay. One limit remains: the funding lane keeps no row, so a faucet grant in flight may mint again when the client retries (test tokens only). Before T-220's deploy on 2026-11-05, the live version lost the operators' view of a transaction in flight (seen once at the cutover). One holdback-op1 deploy was refused with "Script startup exceeded CPU time limit"; the retry passed (backlog).

The procedure as it ran:

**Cutover** (Rafa approved it on 2026-11-03):

1. Deploy holdback-op1's code with `SETTLEMENT` still `sim`: `pnpm -C apps/demo-cloud build`, then `npx wrangler@4.151.3 deploy -c apps/demo-cloud/wrangler.op1.jsonc --var SETTLEMENT:sim`. The SimChain demo keeps running.
2. Deploy holdback-op2 with `SETTLEMENT` `sepolia`. Smoke test against op2's two origins: `HOLDBACK_OPERATORS=https://api2.crow.direct,https://holdback-op2.<account>.workers.dev node examples/try.ts`; it must end Released with three Sepolia transaction links. From here until step 4 the try command in `llms.txt` fails: try.mjs requires both operators to serve one discovery document, and op1 still serves SimChain's.
3. Deploy the site at once (the Sepolia `llms.txt`, and a `try.mjs` that knows both the SimChain and the Sepolia pins).
4. Deploy holdback-op1 with `SETTLEMENT` `sepolia`, and run the one command from `llms.txt` ("Try it"). Steps 2 to 4 take a few minutes; that is the window in which the try command fails.

**Rollback:** set `SETTLEMENT` back to `sim` on both wrangler files and run `pnpm demo-cloud:deploy`, then deploy the previous site build (`npx wrangler@4.151.3 rollback` on `crow-site`). The SimChain world resumes where it stopped; the Sepolia world's storage and its deals on chain stay, and a later flip back serves them again.
