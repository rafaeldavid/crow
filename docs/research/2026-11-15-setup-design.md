# "Set up Crow for me": the design and the build plan

A dated record, 2026-11-15, for T-471 (`docs/tasks/T-471-setup-plan.md`; roadmap row N160). It rests on two other records of the same day: the baseline (`2026-11-15-setup-baseline.md`) and the Blygger study (`2026-11-15-blygger-study.md`). The decisions it makes are D73 and D74 in `docs/decisions-today.md`, where Rafa can overrule them. Nothing here is built.

Labels: **measured**, **inferred**, **guessed**, as in the baseline.

## The state

**Nothing is built. The design adds one file, one command and two benchmark scenarios, and changes no contract, schema, signed type or API route.**

1. **One sentence.** A person tells their own assistant: "Read https://crow.direct/setup.txt and set up Crow for me as a seller", or "as a buyer".
2. **One file.** `setup.txt` is written for the assistant, at most 8,000 bytes, about 2,000 tokens. The assistant needs no other file for the sample path.
3. **One command.** `setup.mjs`, pinned by its SHA-256 like `try.mjs`. It makes the keys, writes the files, checks them, runs the first deal and removes the setup. It takes answers as flags and never prompts.
4. **Nothing sent before the first deal.** The steps before it make no request that names the party to a Crow-run host. The benchmark counts those requests; the target is 0.
   - **Added 2026-11-15 (T-486, D76):** one exception since this record. The setup's `list` step sends the party's website, and nothing else, to Crow's own list of who uses it, before the first deal. The person can skip it, no deal depends on it, and the benchmark counts it in a field of its own, so the target above stays 0. D76 in `docs/decisions-today.md` has the decision.
5. **Keys made where they are used.** The command makes every key on the party's machine, prints addresses only, and never puts a key on a command line or in the chat.
6. **A check before any offer.** Real results from the party's API must pass the deal's checks, 3 of them unless the person sets another number, and a broken result must fail them.
7. **A first deal with no second person:** a seller sells one job to Crow's test buyer; a buyer buys from Crow's test seller.
8. **Leaving is one command.** It writes the party's records, stops the service, removes what the setup made, and says what stays public.
9. **What a party publishes is the card that exists today,** on a page of its own domain. It stays a convention outside the API contract and gets a JSON Schema.
10. **The pilot comes first (D72).** The first slice imports the seller adapter and changes none of the paths the hosted sellers deploy from. One task waits for the pilot's deploy.

## What is offered, and by whom

Rafa asked on 2026-11-15 whether Crow's API is the equivalent of Blygger's Studio, with anyone free to set up their own path to the protocol, and a charge only for going through Crow's API, and only later.

**This plan's answer: yes, with one correction. Crow has two layers where Blygger has one.**

| Layer | Blygger | Crow | Who runs it | Price |
| --- | --- | --- | --- | --- |
| The party's own package | Studio, the reference client | The setup command, the seller adapter, the buyer's tools, the signer, the card | The party, on its own machine or account | Free and open; anyone may build their own from the spec |
| A service around the protocol | blygger.com, the optional listing | Crow's operators (the API): they relay signed messages and pay the gas | Crow today; any operator by design (ADR-0005) | 0 with gas covered for the first pilots; an operator may charge the operator fee, published in discovery as `fees.operator` (D33) |
| Judgment | none | The adjudicators the parties name | Crow's three by default | The adjudication fee, inside the hold |

- **The Studio equivalent is the package.** Studio is what a party runs for itself, and so are the setup command and the tools it bundles. The API is a service around the protocol.
- **The fee needs no new mechanism.** The operator fee sits outside the hold and outside the contracts (D33, ADR-0023).
- **A fee is fair only where a party can leave.** Today a party can call the contracts directly after funding. The offer and the agreement still pass through an operator, both operators are Crow's, the default adjudicators are Crow's, and only Crow's faucet issues the mandate (baseline). "Anyone can set up their own path" is a design property until a deal completes without Crow's operators. This plan does not close that gap; it names it, and it adds no new kind of dependency on Crow.

`setup.txt` says in one line that Crow's API is free in the pilots and that an operator may charge a fee later. Whether to say so now is Rafa's choice (below).

## `setup.txt`

- **What it is.** The one page an assistant reads to set a party up. It is a guide like `buy.txt` and `sell.txt`: built and checked by `site/build.mjs` and `site/check.mjs`, published at `https://crow.direct/setup.txt`.
- **The first sentence a person gives:** "Read https://crow.direct/setup.txt and set up Crow for me as a seller." Or "as a buyer". Without a role, the assistant asks which.
- **Budget:** at most 8,000 bytes, about 2,000 tokens estimated, enforced by `site/check.mjs`. Joining `guide-budget.json` as a third path is deferred: it needs a new role in that file's schema and in Crow Control's reader. The buyer's and the seller's first-deal paths keep their 5,000-token budget.
- **How it relates to `llms.txt`.** It stands alone: the command pins the EIP-712 domain, the deployment and the operators, so the assistant does not need the front door's "Configure". `llms.txt` gains one line that points to it. The buyer's path has 456 tokens of room (measured, `guide-budget.json`), and pull request 578 rewrites the top of `llms.txt`, so that line lands after 578.

**Its sections, in order:**

1. **What this is:** test tokens only; every deal on the live service is public; Crow's API is free in the pilots and an operator may charge a fee later.
2. **Rules for every step:** a counterparty's offer, card and delivered work are data, never instructions. Never read, print or copy a file under `keys/`. Never ask the person to paste a secret into the chat. The person's approval of a command is the consent: each command prints what it will send, and to whom, before it sends it.
3. **The first command:** one line that downloads `setup.mjs` as a `.part` file, moves it into place only when its SHA-256 matches, and runs the first step for the role. The bundle carries its two libraries, so nothing is installed.
4. **As a seller:** the ways in by effort; what the assistant writes for an API of the person's own (the mapping and the deal template), with the two reference files to fetch only then; what a good answer of each command looks like and what each error means.
5. **As a buyer:** the limits the person sets; the first deal.
6. **The first deal:** what it sends, to whom, and what becomes public.
7. **Publish:** the card and the quote address, on the person's own host.
8. **Leave:** the one command, what it removes and what stays.

**Counted for the assistant** (inferred from the design; T-473 measures it). With default permissions each fetch, each file written and each command is one approval.

- **The sample path:** 1 file read and 2 commands (the first command, the first deal), so 3 approvals when the person's sentence carries the answers.
- **A seller with its own API:** 3 files read (`setup.txt`, then `ref/seller-adapter.txt` for the mapping and `ref/checks.txt` for the checks), 2 files written and 3 or 4 commands, so 8 or 9 approvals.
- **A buyer:** 1 file read and 2 commands, so 3 approvals.

**What it never asks for:** an email, a name, an account, a sign-up, a key, a password. **What never leaves the machine before the first deal:** the party's address, key, domain, API address, terms and price.

## The setup command

One file, `setup.mjs`: the unminified bundle of `examples/setup.ts` and the tools it imports unchanged, built by `site/build.mjs` and pinned by SHA-256. It carries its two libraries inside, as the bundles of pull request 578 do, so no package is installed and npm is not in the path of a key. It works in one folder and never outside it: by default `~/.crow/<name>`. It refuses a folder inside a git work tree, a synced folder or a served folder unless told to.

| Command | What it does | Names the party to a Crow-run host? |
| --- | --- | --- |
| `seller --sample` or `seller --api <base URL>` | Makes the folder, the signing key, the adapter's configuration, the deal template and the card files; then runs `check` | No |
| `buyer --max-per-deal <base units> --max-per-day <base units>` | Makes the folder, a key store and the limits file (T-475) | No |
| `check` | The conformance check, below | No |
| `first-deal` | Prints what it will send and to whom, then runs one deal to its end and writes the deal record | **Yes: the first requests that do** |
| `secret <NAME>` | Run by the person in their own terminal: a hidden prompt writes one secret to `keys/secrets.env` | No |
| `serve` | Keeps the seller running for outside buyers (T-477) | Only when a buyer asks for a quote |
| `status` | The folder's state and open deals; no secret | No |
| `leave` | Leaving, below (T-476) | Reads only |

Five rules shape it. The first three come from the Blygger study; the last two from the code check and the reviews.

- **No prompt.** A missing answer makes the command print one JSON object that names each question in plain words, and exit with status 3. The assistant asks the person and runs the command again. Only `secret` prompts, and only a person runs it.
- **Each step checks before it creates.** Progress is in `crow.json` in the folder. A rerun after a failure continues, with no second key, offer or delivery.
- **No shared default for what identifies or prices a party.** The command asks for the price, the item's name and the payout address, and derives the card's name from the party's host. It pins what every party must share: the EIP-712 domain and the deployment. The operators default to Crow's two and change with `--operators`, so no single API provider is required (ADR-0005).
- **The payout address is always asked.** With a fresh key for each deal and no payout address, every deal would name the standing key's address as its payout address, which links the deals in their public terms (measured: the adapter warns of it at start, `examples/seller-adapter-core.ts`). The person gives an address whose key is not on this machine, or answers "this folder's key" and is told what that links and where that key lives.

- **No ambient settings.** The command ignores `HOLDBACK_*` and `CROW_*` variables in its environment. The tools it bundles read some of them, the deployment pin and the operators among them (measured, `examples/verify.ts`, `examples/buyer-signer.ts`), so a variable left in a shell could point a seller at operators that are not Crow's and have it deliver paid work to them. Every setting is a flag the person sees in the command they approve. The command accepts the Sepolia deployment only; a local test world needs an explicit flag, and the command then says on every line that it is not the live service.

**Why a bundle and not a clone.** Today's seller path clones the repository, installs and builds: one long command, minutes, and the whole source tree. A pinned bundle is one download with a hash, the pattern that took the buyer's test deal to 1 approval (measured, T-229). Two risks: the adapter and the check library may not bundle into one self-contained file; and three of the bundled tools run their own command line when the running file is their own, which is true inside a bundle (measured, `examples/seller-adapter.ts`, `check-delivery.ts`, `report-converter.ts`). T-472 proves both first, with a build transform in `site/build.mjs`, and stops if either fails.

**What it reuses from pull request 578, and what it adds.** That pull request (T-469, open on 2026-11-15) adds `try-sell.mjs`: one pinned command that sells a sample file to Crow's test buyer over plain HTTP, with keys in memory, `Released` in 77 s live (measured there). The setup command reuses its self-contained bundling and its shared kit for the handshake with the test agents. It adds what a party keeps: a folder with a key that lasts, the adapter's path that a real API will use (quote, start, result, check, deliver), the check, and leaving.

**What the pin protects, and what it does not.** The hash stops a bundle that differs from the one the command names: a changed file at the host, a stale copy, a swap on the way. It does not protect against whoever controls crow.direct, because the hash and the download address come from that one origin. That is true of `try.mjs` today; the exposure is larger here, because the setup runs beside a key that lasts and the party's own API key. The repository holds the same bundle, so `setup.txt` gives one optional command that compares the file's hash with the repository's copy at its tag, for a party that wants a second origin.

## The ways in, by effort

### A seller

| Way in | What the party needs | What it gets | Built by |
| --- | --- | --- | --- |
| 0. Already halfway in | An HTTP API that returns a file or JSON for a job. Nothing changes in it: a mapping file describes its quote, start and result calls | A seller on its own machine and a first settled test deal with Crow's test buyer. No domain, host, deploy or login | T-483 |
| 0, with no API yet | Node | The same path with a sample API the command serves on the loopback address | T-472 |
| 1. Publish on your own host | A host with Node, a hostname, TLS | A quote address outside buyers can reach, and the card on a page of the party's domain | T-477 |
| 1, on your own Cloudflare account | A Cloudflare account and a domain on it; one login by the person | The same, as one deploy, with the key held as a secret of the party's own account | T-478, after the pilot's deploy |
| 2. Build your own from the spec | `ref/http-seller.txt`, `ref/signing.txt` | Any implementation; the check for a live quote address and card says whether it conforms | exists; the check is T-477 |

Crow hosting the seller (ADR-0037) stays a convenience for design partners. `setup.txt` does not offer it: Crow then makes and holds the seller's signing key (baseline), which is the opposite of this plan's aim.

### A buyer

| Way in | What the party needs | What it gets | Built by |
| --- | --- | --- | --- |
| 0. Already halfway in | An assistant that can run Node | One command buys a test dataset from Crow's test seller; its keys live in memory and nothing is kept | exists (`llms.txt`, "Try it") |
| 1. A standing buyer | Two numbers: the most per deal and the most per day | A folder with its own keys, a limits file, a first settled test deal and its record; later deals from any seller's card | T-475 |
| 1, with a wallet | A wallet the person controls | Nothing funds until the wallet signs (`CROW_PAYMENT_ADDRESS`) | exists (`buy.txt`, step 6); T-475 wires it |
| 2. Build your own from the spec | `ref/http.txt`, `ref/signing.txt`, `ref/http-buyer.txt` | Any implementation | exists |

## What a party publishes on its own domain

**The card that exists today, on a page of the party's own domain. Nothing new in the protocol.**

- **The format.** A `<script type="application/json" id="crow-agent">` block in an HTML page, and the same JSON as `agent.json` beside it (`site/ref/intake.txt`, "Two agents, two people"; the test seller and the hosted sellers serve both). A buyer publishes a `crow-buyer` card the same way, as the test buyer does.
- **The fields.** `type`, then `offers`: each an `id` and a `pricing` of kind `quoted` with a `quote` address and a `defaults` address, or fixed `terms`. Optional: `name`, an `intake` for sealed proposals, `seller` (a standing address), `testTokensOnly`. The `defaults` address serves the template, the windows and the scope rules a buyer compares an offer with.
- **The setup writes it.** `seller` writes `card/index.html` and `card/agent.json` from the configuration. The person puts them on their site as they would any page.
- **The domain is the party's identity for being found; the key stays its identity for settlement.** A buyer that takes an offer's ID from `https://seller.example/quote` knows the seller by that origin, by TLS. The contract knows the seller by its signature. By default the card lists no address. TLS at the quote address is then the only thing that binds an offer to the domain; a card that lists a standing `seller` address adds a signature a buyer can check, and links every deal.
- **A fresh key for each deal does not unlink a seller's deals by itself.** Every offer still names one payout address, and anyone can list a payout address's deals and read its balance (`docs/privacy-baseline.md`). The adapter takes one payout address, so a payout address for each deal waits until the adapter's core can change (deferred).
- **It does not change `spec/schemas/`.** The card is a convention between parties; no operator serves or reads it. Its JSON Schema is published beside the guides, at `https://crow.direct/card.schema.json` (T-474). It moves into the protocol, by a decision record and a version bump, when a second implementation reads it (D74).

**The coordinator's split, tested.** The coordinator's reading was: a static card on the party's domain, plus a small signing service, with a lighter buyer. It survives with three amendments:

1. **Both parts exist.** The card is today's convention, and the signing part is the seller adapter. The work is to assemble them.
2. **The card is not needed for a first deal.** A seller's first deal goes to Crow's test buyer by commitment ID. The card matters when an outside buyer must find the seller.
3. **A static page alone cannot sell.** An offer names its buyer and is signed fresh, and a delivery is signed after funding. A seller with no signing part would need a mailbox at an operator, which would make Crow carry messages between parties (declined: `site/ref/intake.txt` states that Crow carries none).

## Where the signing part runs

| Where | What the party needs | What it costs the party | What it tells Crow beyond the deal's public record | Who can reach the key |
| --- | --- | --- | --- | --- |
| The party's own machine | Node | Nothing; it sells only while the machine is on | The machine's IP address on each request | The party, and an assistant that shares the machine |
| The party's own host | A host with Node, a hostname, TLS; root for the service files | The host; the person's own steps for DNS and the service | The host's IP address | Whoever has a shell on the host |
| The party's own Cloudflare account (T-478) | An account and a domain on it; one login by the person | Cloudflare's charges; ADR-0037 puts a deal's wake-ups within the paid plan's included use (inferred there) | Cloudflare's addresses and, by a header Cloudflare adds to a Worker's outgoing requests, the Worker's zone, which is the party's domain (inferred from Cloudflare's documentation; T-478 measures it) | The platform shows the secret to nobody after it is set. Whoever holds the account's login can replace it, or deploy code that reads it |
| Hosted by Crow (ADR-0037) | Crow's go-ahead | Crow makes and holds the signing key and holds the party's API key | Everything: the configuration, the API key, every request | Crow |

**Neutrality.** No step of the first three rows needs Crow's permission or Crow's account. Each leans on Crow-run hosts in five ways, and the design names them:

- **crow.direct serves `setup.txt` and `setup.mjs`.** The repository holds both, so a party can take them from there.
- **The operators** relay the offer and the agreement. Both are Crow's today; `--operators` names others.
- **The faucet's mandate.** With a fresh key for each deal, a seller needs the faucet for every quote, and a quote answers 503 when the faucet refuses; with a standing key it needs the faucet once in 30 days. The fresh-key default trades more use of the faucet for less linking and for sending nothing before the first deal. The trade ends when a mandate becomes optional in an open club (D69).
- **The default adjudicators** are Crow's three.
- **The first counterparty** is Crow's test buyer or test seller, each with its own limits by address. When one refuses or is down, the command plays the other side itself and marks the deal as a self-test in its public terms.

The fourth row is outside the protocol: an agency relationship the party can end (ADR-0037, section 8).

### Where the signer runs: Crow's own two machines, and the same answer for a party

Rafa asked on 2026-11-15 what Crow's own two machines should run on (the agents' machine and the signer's machine of the own-agents design, T-439 and T-443), whether Cloudflare can do it, and for "something sustainable for development". Crow runs its own agents on the package a new party gets (Rafa, 2026-11-14), so one design answers both. Cloudflare's documentation was read on 2026-11-15; nothing was tested against a live account.

**The signer's claim is that the agent cannot override it. That holds only where the agent has no way to change the signer or read its keys.** Two ways to get there:

| | 1. Two small Linux VMs | 2. Cloudflare only |
| --- | --- | --- |
| What runs | The signer as built (`examples/signer.ts serve`: a Node server with a ledger on disk) on its own VM; the agent and the adapter on the other | The signer as its own Worker, with a Durable Object for the ledger and its keys as Worker secrets, no public address, called through a service binding from the adapter Worker |
| What the claim rests on | A firewall rule so only the agents' VM reaches the signer's port, and no login from the agents' VM | The agent's API token carries a role on the adapter Worker only. Cloudflare's per-Worker roles and tokens scoped to named Workers exist since 2026-09-15 (measured, Cloudflare's Workers authorization page and changelog) |
| Who can break it | Root on the signer's VM; whoever holds its SSH or console login; the VM's provider | The account's administrators; any token or member with the Editor role on the signer Worker, since Editor can deploy code that reads the keys (inferred); Cloudflare; **any agent session that can read an administrator's token** |
| Still to prove | The boundary itself: the machines do not exist yet (T-439, "Still soft") | Four things the documentation leaves open: whether a token scoped to one Worker can bind to a Worker outside its scope; whether it can bind another Worker's Durable Object; whether the API ever returns a secret's value; whether the audit log records a secret overwrite (all inferred, none tested) |
| What it cannot host | Nothing: the assistant has its shell on the agents' VM | An assistant needs a shell and files. Cloudflare's Containers and Sandbox give one, started from a Worker (measured, Cloudflare's Sandbox pages), at the price of a runner to build. Otherwise the assistant stays on a machine |
| Cost to build | No code: provisioning, the firewall and a service unit (guessed: one session) | A port: the signer split into a core with no Node import and two shells, as ADR-0037 split the seller adapter. About 600 of the signer's 908 lines move to the core; a Worker shell of 250 to 350 lines; 300 to 500 lines of tests; every ledger and stop attack test run again on the Worker shell; one red-team pass (guessed: the size of the ADR-0037 build) |
| What changes in the port | nothing | The rules file is bundled at deploy, so "the rules changed on disk" becomes "the rules change only by a deploy". The stop, the mandate's renewal and the revocations need a path only the administrator can use, because every public method of a bound Worker is callable by the agent (inferred). Preview addresses must be off as well as the `workers.dev` address (measured) |
| Cost to run | Two small VMs, about USD 10 a month, plus patching (guessed) | Inside the Workers plan Crow already pays (guessed) |
| A development copy | A second pair of VMs the agents may rebuild freely, with test keys, under credentials that cannot touch the real pair | A second pair of Workers **in a second account**. In one account, a token for the rehearsal adapter could bind to the real signer, and the roles apply only to Workers an administrator has already created (measured rule; inferred conclusion) |

**Is a permission boundary inside one account as hard as a network and login boundary between two machines? It is the same rung, 3, and a weaker instance of it.**

- Both are enforced by someone who is not the agent: an operating system and a network in one case, Cloudflare's permission system in the other. Neither is by construction or on chain.
- Both fail the same way: an agent that holds the administrator's credential owns the signer. On a VM that credential is an SSH key. On Cloudflare it is an account token, and this repository's sessions read `CLOUDFLARE_API_TOKEN` from their environment today (`CLAUDE.md`, "Cloudflare tooling"). So the real signer cannot live in the account those sessions deploy from, unless every session gets a scoped token.
- The Cloudflare boundary has more ways to be widened by mistake: one role too many on one token, with no error. And four of its properties are untested.
- It has one real advantage: a Worker secret is never shown again after it is set (measured for the dashboard and Wrangler), and the audit log names who changed a Worker (measured in general; inferred for secrets).

**Recommendation: one design, two shells, VMs first.**

1. **The signer becomes a core with two shells,** like the seller adapter: a Node shell for a machine and a Worker shell for an account. Where it runs is the party's choice; the attack tests are the same for both.
2. **Crow's own agents start on two small VMs,** as the signer is built today. It costs no code, it is what the own-agents tests assume, and its one open point, the boundary, is proved by attack tests run from the agents' VM. The proof run does not wait for a port.
3. **The Worker shell follows, as the package's answer for a party** (T-481): a party that deploys a page on Cloudflare can then have limits its assistant cannot pass, with no machine to patch. It starts with a live test of the four open points on a scratch account with test keys. If any fails, the Worker shell stops there and the VMs stay.
4. **The real pair and the rehearsal pair never share credentials.** VMs: separate teams or projects with separate tokens. Cloudflare: a second account for the rehearsal, and the real signer in an account whose administrator's token never enters an agent's environment.

What is sustainable for development is the split, not the host: one core, tested once, that runs where each party already is.

## Keys, secrets and limits

**Keys.**

- **Made by the command, on the party's machine,** from the system's random source. The seller gets one standing key; with `"signingKey": "per-deal"`, the default the setup writes, each deal's key is derived from it and the standing key signs no deal.
- **Stored** in `keys/` (folder mode 0700, files 0600), covered by a `.gitignore` the command writes. The card files go to a separate output folder, so a folder that is served never holds `keys/`.
- **Never shown by the command.** It prints addresses. It passes the key to the adapter inside its own process, never through the process's environment, so no key is on a command line or in the shell's history. A test reads every line the commands print and every file outside `keys/` and fails if a key is there: the standing key, each derived deal key, the faucet holding key and the encryption secrets, in hex and in base64.
- **Files, by a precedent.** `CLAUDE.md`'s hard rule takes secrets from environment variables only. The buyer's tools already keep each deal's key in a file of mode 0600 in a key store the buyer names (`site/buy.txt`). The setup follows that precedent on a party's own machine. D73 records it for Rafa to overrule.
- **Never sent.** No request carries a key. The check fails when a secret's value sits in any file outside `keys/`.

**Other secrets.** The party's own API key, and the credentials it gives buyers for its quote address. The person types each at a hidden prompt (`setup.mjs secret <NAME>`), as Blygger leaves the password to the cloud tool's own prompt. `secret` refuses to run when its input is not a terminal. The configuration names variables, never values, and the adapter already refuses a file in which two credentials name one variable. A call mapping's headers take any text, so the check refuses a header that carries a credential in plain text and points to the configuration's `auth` field.

**Limits, and what enforces each.** Crow's own agents use a ladder of rungs (T-443): 1, by construction; 2, on chain; 3, by another party; 4, by the agent's own tool; 5, written only. A written rule is not a constraint.

| Limit | What enforces it | Rung |
| --- | --- | --- |
| Where a sale pays | The signed terms name the payout address; after funding the contract pays only it. The adapter refuses to sign an offer that names another | 2 after funding; 4 at the offer |
| The payout address's key is not on the selling machine | Only when the person gives an address whose key is elsewhere; the setup never makes or asks for that key | 1 for the selling machine, in that case |
| An early accept, or a settlement by agreement, on a funded hold | Nothing in the setup: a key on the machine can sign either, and either releases without judgment (`site/ref/limits.txt`) | 4 at best; the signer or the person's wallet is the limit |
| A seller's lowest price | Nothing before T-479: the price comes from the party's own API | none |
| Who may ask a published seller for a quote | The quote credential and the rate limit over all callers (T-477) | 3 against an outside caller |
| How many offers a seller signs | The adapter's `quoteRateLimit` and scope rules | 3 against an outside caller; 4 against an assistant on the same machine |
| The most a buyer pays per deal and per day | The buying command reads `limits.json` and refuses above it | 4 |
| A buyer's payment needs the person | A separate wallet: nothing funds until it signs | 3 |
| Any of the above, against an assistant on the same machine | The signer, on a machine or account the assistant cannot reach (T-479) | 3 |

Two facts the setup states in its own output, so nobody reads more into it:

- **On one machine shared with the assistant, every limit the setup writes is rung 4.** It holds against a mistake. It does not hold against an assistant that reads the key file.
- **On the test service a buyer pays nothing real, and a seller's work is real.** Anyone can take test tokens from the faucet, fund a deal and so start a job at a published seller's API. A quote address open to all gives that work away, and with a fresh key for each deal it also spends the seller's faucet grants (measured: the adapter warns of it at start). `publish` therefore refuses an open quote address unless the person passes `--open` (T-477).
- **On the test service no balance bounds a buyer.** The faucet mints a deal's total to any payment address (baseline). The balance becomes the hard limit only where no faucet fills it (ADR-0038).

**The seller's text is data.** The card, the defaults, the offer and the delivered work are the counterparty's text. `setup.txt` says so in its rules, as `buy.txt` does, and the card's schema keeps its fields to addresses and short strings (T-474). The buying command writes opened work to a file and prints its path and hash, so a delivery's text does not enter the assistant's context unless the assistant opens it (T-475).

## The privacy table

"Stranger" is anyone with no key. The last column rests on `docs/privacy-baseline.md` (measured 2026-11-14) where it concerns a deal; the setup rows are inferred from the design.

| Step | What is sent | To whom | What a stranger can then learn |
| --- | --- | --- | --- |
| Read `setup.txt` | A GET | crow.direct | Nothing. The host sees an IP address |
| The first command: install and download | Two package fetches; a GET of `setup.mjs` | npm; crow.direct | Nothing. Each host sees an IP address |
| `seller` or `buyer`: keys and files | Nothing | Nobody | Nothing |
| `check` with the party's own API | The party's own sample jobs | The party's own API | Nothing |
| `secret` | Nothing | Nobody | Nothing |
| Publish the card (T-477) | A page on the party's site | Anyone who fetches it | That this domain sells through Crow, what it offers, its quote address, and at the `defaults` address its template and windows. Certificate logs show the hostname. No address or key unless the party lists one |
| **`first-deal`: discovery** | Two GETs | Both operators | Nothing. The operators see an IP address |
| **`first-deal`: the faucet grant** | The deal key's address; for a seller, also the one holding address every grant of its names; for a buyer, the amount | Operator 1 | A mandate for that address with its issue time, and a mint on Sepolia. The operator can group one client's fresh keys by IP address, and a seller's by its holding address |
| `first-deal`: the offer | The signed terms | Both operators | **The whole terms:** the description, every check, the price, the deadlines, the adjudicators, both keys, the payment and payout addresses. One payout address ties a seller's deals together, with their prices and its balance; a buyer's wallet address does the same for a buyer |
| `first-deal`: the test agent | The commitment ID (a seller), or a sealed proposal (a buyer) | Crow's test buyer or test seller | Nothing beyond the offer |
| `first-deal`: funding, delivery, decision | Signatures; ciphertext and sealed keys | The operators, then Sepolia | The amounts and times; the delivery's exact size, its arrival time and its SHA-256, which confirms a guessed copy; each check's result. Not the content |
| A later quote from an outside buyer | The buyer's address, public key and scope | The seller | The scope appears in the public terms once offered |
| A deal from a Worker on the party's own Cloudflare account (T-478) | The same requests | The operators | The same. The operators may also see the Worker's zone, the party's domain, in a header Cloudflare adds (inferred) |
| `leave` | Reads of each of the party's deals and addresses, in one burst | The operators | Nothing new for a stranger: the deals and the chain's record stay public. An operator sees one client read that set of deals together |

The setup's defaults are the baseline's own advice: a fresh key for each deal, checks only, a salt in a JSON report where the checks allow it. `setup.txt` carries the baseline's five lines for a new party in short form.

## Leaving

**One command: `node setup.mjs leave`.**

- **It writes** `export/`: one deal record for each deal the folder knows, the configuration, the template, the card and the journal. No key.
- **It stops** new work: the seller takes no new quote. If a deal is open, it says which and until when, and finishes it first unless told otherwise; a funded deal left unfinished ends in the buyer's refund at its deadline, and the command prints until when that buyer's money stays locked.
- **It removes** what the setup made: the card files, and the Worker where the setup deployed one. It names the block the person must take off their own page, because it cannot edit their site.
- **It checks that a published quote address no longer answers,** and exits with an error while it does. A service a person installed as root is that person's to stop; the command prints the lines.
- **It deletes** the secrets that sign nothing: the party's API key and the quote credentials.
- **It keeps** the signing keys until the person passes `--delete-keys`, and refuses that flag while a deal is open. It lists every balance the keys still hold, and the person names each balance they abandon: the token is open-mint, so a stranger can leave dust on any address, and a rule that waits for zero would never let a party leave.
- **It says what stays.** Nothing is removed at Crow, because nothing was registered. The party's past deals stay public on the operators and on Sepolia, and the faucet's mandate runs out by itself within 30 days.

## The conformance check

`node setup.mjs check` prints one JSON line per check and exits 0 only when all pass. `first-deal` refuses to run after a failure. It makes no request to a Crow-run host.

| Check | What it proves |
| --- | --- |
| The configuration loads with the adapter's own loader | The files are ones the adapter will take |
| The template, filled with a sample scope and stand-in values for the club and the adjudicators, passes the bundled commitment schema | The terms are ones the operators will take. The check posts no terms anywhere |
| Real results of the party's API pass the deal's checks, through the adjudicator's first stage: at least `--min-samples` of them, 3 unless the person sets another number. They are past results in `samples/`, or fresh ones the command fetches on the person's word, since each may cost a paid job | The checks fit real output, and more than one sample of it |
| Each of those results with a required field removed fails | The checks are not empty |
| Each result is under the operators' size limit | It can be delivered |
| No secret's value is in a file outside `keys/`; no mapping header carries a credential; each credential names its own variable; `keys/` has the right modes | No secret leaks by a file |
| The card validates against its schema (T-474's schema, wired in by T-477) | A buyer's tools can read it |
| For a published seller (T-477): `agent.json` answers on the party's domain over HTTPS; its quote and defaults addresses are on that origin or on one the party states; none resolves to a private address; the defaults equal the local ones. The check prints pass or fail, never the fetched text | An outside buyer finds what the party meant to publish, and the check cannot be turned on the party's own network |

The last row also runs alone against any live quote address and card, so a seller built from the spec can use it.

## The measure

**Two new scenarios in the benchmark harness, and one new count** (T-473).

- **s7, set up as a seller.** The goal sentence names `https://crow.direct/setup.txt`, a job API of another shape that the harness serves on the loopback address, and a price. Success: a commitment `Released` whose buyer is Crow's test buyer; a deal the command bought itself does not count.
- **s8, set up as a buyer.** The goal names `setup.txt` and the two limits. Success: a commitment `Released` with Crow's test seller.
- **The new count:** requests before the first deal. The first deal starts when the `first-deal` command starts; it writes a marker the harness reads. A request names the party when it goes to a Crow-run host and is not a GET, or when its path holds an address. The probes record method, host, path and status and no body (measured, `tools/one-click/probes.mjs`), so the rule needs none. The record also gains the count of guide files fetched.
- **One thing to probe first:** whether the harness's sandbox lets the agent reach a job API on the loopback address. Its allow-list names no local address (measured, `tools/one-click/bench-live.mjs`).
- **The goal carries every answer,** because the harness answers each question "yes" and cannot choose a price or a limit.
- **Scripted runs in CI** play both scenarios in the in-process world with no model.

| Target | Set up as a seller (s7) | Set up as a buyer (s8) | Today's nearest measured figure |
| --- | --- | --- | --- |
| Approvals, default permissions | at most 9 | at most 3 | 11 (s3, seller over HTTP); 20 (buyers, median) |
| Approvals, sandboxed auto mode | at most 1 | at most 1 | not measured |
| Tokens | at most 300,000 | at most 150,000 | 579,928 (s3); 1,095,097 (buyers, median); about 141,000 (the one command) |
| Time without the user | at most 6 min | at most 3 min | 3 min 15 s (s3); 4 min 17 s (buyers, median) |
| Requests that name the party to a Crow-run host before the first deal | 0 | 0 | 1 (the adapter's faucet call at start) |
| Guide files the assistant fetches | at most 3 | 1 | 13 (a seller with its own API); 6 (over HTTP) |

The targets are guessed. They are reset from the first three live runs of each scenario, which Rafa starts. The approval targets follow from the counts under "`setup.txt`". They sit above the standing target of 1 approval per deal (D51), because a setup is a fetch, a setup step and a deal; the first runs show which steps can fold together.

**What the harness cannot measure:** a deploy on a party's own account (its network fence allows Crow's, npm's and Sepolia's hosts only), a person's own steps, and a secret typed into the chat. T-477 and T-478 are measured by hand, once each, with the steps counted.

### An isolated machine for each simulated party

Rafa, 2026-11-15: "I think we need a truly isolated environment to really simulated sellers / buyers." Today the benchmark runs the assistant in a sandbox on the maintainer's own Mac, so every simulated party shares one machine, one address and one user's files behind a fence. T-482 moves a run to a machine of its own.

**What a simulated party's machine must be, for a run to mean something:**

1. **Its own VM with its own kernel,** so one run cannot read another's files or keys.
2. **Its own public address, stable for the run and different for each party.** The faucet limits grants by client address, the test agents limit requests by address, and an operator can group one client's fresh keys by address (`docs/privacy-baseline.md`).
3. **Nothing of Crow's on it:** no repository, no credential, no document. A fresh assistant gets one sentence. Its user account can read only its own empty folder.
4. **A clean slate for every run:** made from one small image with Node and the assistant's command-line tool, destroyed after.
5. **Plain SSH with a key,** so the harness can start a session on it.
6. **For a seller that publishes: a hostname of its own with HTTPS, not under crow.direct.**
7. **Credentials that cannot touch anything else:** the token that makes and destroys these machines reaches no other machine of the account, and the model key on the machine is a spend-capped key used for nothing else.

**The four services Rafa named, from each vendor's own pages on 2026-11-15** (measured there unless labelled; no machine was created):

| Service | Own kernel | Own outbound address | Clean per run | Plain SSH | HTTPS hostname | Token scope |
| --- | --- | --- | --- | --- | --- | --- |
| DigitalOcean Droplets | Yes (inferred: the pages say virtual machines and name no hypervisor) | **Yes: a public IPv4 on each Droplet** | From a snapshot; creation time not documented | Yes | No: a domain of one's own and a certificate | By resource type and action, not by project; a separate team is the boundary (inferred) |
| Fly.io Machines | Yes (Firecracker) | Only with a static outbound address bought per app and region, USD 0.005 an hour | Yes; starts in under a second | Certificates through its own tool; plain SSH unverified | Yes, one per app | Per app |
| exe.dev | Yes (KVM) | **No: a VM gets no public address of its own;** outbound is shared (inferred) | Yes, about 2 s | Yes | Yes, one per VM | Per VM, with expiry |
| boat | Yes | A public IPv6 that changes at each resume and fork; IPv4 not always its own | Yes, a fork in seconds | Yes | Yes, one per port; no custom domain | Per key, limited to machines the key made |

**Recommendation: DigitalOcean Droplets, in a team of their own, one Droplet for each run.**

- **It is the only one of the four whose pages promise each machine its own public IPv4,** which is the property that decides whether two simulated parties look like two parties to the faucet, the test agents and an operator.
- It gives plain SSH and bills by the second, and Rafa has an account. A run of a few minutes costs well under USD 0.01 on the smallest Droplet (inferred from per-second billing with a minimum of USD 0.01).
- **Its two gaps are known.** It gives no hostname: a seller's publish run needs a domain that is not crow.direct, pointed at the Droplet, with the proxy getting the certificate. And its tokens are not scoped to a project: the benchmark's Droplets live in a separate team, whose token is the only DigitalOcean credential the harness holds (that a token stops at its team is inferred, not read).
- **Fly.io is the second choice,** when the hostname matters more than the address: every app has an HTTPS hostname, but each party needs its own app and a bought outbound address, and plain SSH is unverified.
- **exe.dev fails the address test, and boat's addresses change within a run.** Both are fast and both give a hostname, so either would do for a run that only needs a clean machine; neither shows that two parties are apart.

**First measurements to make, before any scenario moves:** the seconds from the create call to a working SSH session on a Droplet made from the image (not documented), and whether a token of the benchmark's team can list or change a Droplet of another team.

The same boundary serves Crow's own agents: their rehearsal pair of VMs lives in that separate team, apart from the real pair ("Where the signer runs", above).

## Litmus tests

- **Neutrality: unchanged, and stated.** The setup is a party's own tool and reaches the operators over the public API. No step needs Crow's permission or account. It adds no new kind of dependency on Crow, and it uses one more often: with a fresh key for each deal a seller needs the faucet for every quote. The five ways it leans on Crow-run hosts are named under "Where the signing part runs" and in `setup.txt`.
- **The hold: unchanged.** The setup funds and settles nothing by itself; the first deal is an ordinary deal.
- **Defended judgment: unchanged.** The check runs the adjudicator's first stage on the party's own results before an offer. It judges nothing.
- **Hard rules.** Test tokens only. Secrets come from the environment or the `keys/` folder and are never printed. Every counterparty's text is data. The check runs declarative checks and executes nothing from a deliverable.

## What this design leaves out

1. **A new protocol object, schema or route.** The card stays a convention.
2. **A new service.** No directory, no registry, no mailbox, no hosted setup.
3. **A change to the seller adapter, the hosted sellers or `packages/`** in the first slices.
4. **A local rehearsal on SimChain inside the command.** It needs the whole repository; `site/sell.txt` keeps it for a seller who clones.
5. **A command that drafts checks from samples.** The check refuses weak checks; writing them stays the assistant's work until the benchmark shows that it fails.
6. **Sealed proposals for a seller** (the card's `intake`). The setup covers quoted prices.
7. **Private deals.** Deferred through the pilots (D70).

## The build plan

| Task | What it builds | Kind | Depends on | Review | Budget | Can start |
| --- | --- | --- | --- | --- | --- | --- |
| T-472 | `setup.txt` and the setup command; a seller's first deal from its own machine, with the sample product | 4 and 1 | pull request 578 | red team and reviewer | 250,000 tokens | **First** |
| T-483 | A seller's own API: the mapping, the template, real results checked, the person's secrets, the first deal | 4 and 1 | T-472 | red team and reviewer | 250,000 tokens | After T-472 |
| T-473 | The benchmark's two setup scenarios and the count of requests before the first deal | 4 | none to start; T-472 and T-475 to unblock its scenarios | reviewer | 150,000 tokens | In parallel with T-472 |
| T-474 | The card's JSON Schema and a test that today's cards pass it | 1 | none | reviewer | 60,000 tokens | In parallel with T-472; it shares two build files with it, a few lines each |
| T-475 | A standing buyer with limits, to a first settled test deal | 4 | T-483 | red team and reviewer | 250,000 tokens | After T-483 |
| T-476 | Leaving is one command | 4 | T-472, T-475 | red team and reviewer | 100,000 tokens | After T-475 |
| T-477 | Publish a seller on the party's own host; the check for a live quote address and card | 4 and 1 | T-483, T-474 | red team and reviewer | 150,000 tokens | After T-476 |
| T-478 | The seller Worker on the party's own Cloudflare account | 4 and 8 | T-477 | red team and reviewer | 300,000 tokens | **Waits for the pilot's deploy** |
| T-479 | Hard limits through the signer for an outside party | 4 | T-475 | red team and reviewer | 300,000 tokens | **Waits for the own-agents proof run** |
| T-481 | The signer as a core with a Worker shell, on the party's own Cloudflare account | 4 and 8 | T-479, T-478 | red team and reviewer; a decision record | 300,000 tokens | **Waits for T-479 and T-478** |
| T-482 | The benchmark on an isolated machine for each simulated party | 4 | T-473 | red team and reviewer | 200,000 tokens | After T-473; its real runs are Rafa's |

- **The first slice is T-472:** the smallest thing that makes the one sentence work end to end for one case, a seller on its own machine that sells the sample product. T-483 adds the party's own API on top.
- **Three lanes run in parallel:** the setup command (`examples/setup*.ts`, `site/setup.*`), the benchmark (`tools/one-click/`, `scripts/metrics/`, `tests/metrics/`) and the card's schema (`site/card.schema.json`, `tests/`). The first and the third each add a few lines to `site/build.mjs` and `site/check.mjs`; whichever lands second rebases.
- **T-483, T-475, T-476 and T-477 run one at a time, in that order.** Each changes the bundle `site/setup.mjs` and its pinned hash, so two at once would conflict.
- **The budgets are above the recipes'.** `docs/team.md` gives kind 4 a target of 150,000 tokens and names operator code; client code in `examples/` has no kind of its own, and these tasks carry attack tests and a red-team pass. The budgets are targets.
- **T-478 waits for the pilot's deploy.** It is the only task that may change `apps/hosted-sellers`. No other task touches `apps/hosted-sellers`, `examples/seller-adapter-core.ts`, `examples/seller-adapter-api.ts` or `packages/`.
- **T-479 waits for the own-agents lane.** It changes `examples/signer.ts`, which Crow's own agents (roadmap row N131) are about to prove in a live run. T-481 follows it and T-478.
- **T-482 follows T-473** on the benchmark's own paths and touches nothing of the setup command.
- **`docs/plan.md` does not change.** It lists no task after the phase-one contract work; the coordinator updates it.

## Deferred, and why

| Deferred | Why | When it matters |
| --- | --- | --- |
| `setup.txt` as a third path in `guide-budget.json` | It needs a new role in that file's schema and in Crow Control's reader; `site/check.mjs` enforces the byte limit meanwhile | With the next change to that file |
| A payout address for each deal | The adapter takes one, and its core is frozen until the pilot's deploy | With the first seller that needs its deals unlinked |
| A mandate made optional in an open club (D69, roadmap row N132) | It waits for the pilot's first deal. It would remove the faucet grant as a step before a first deal | Before any claim that a deal needs nothing from Crow |
| A party's own club or principal (`POST /v1/agents` and `POST /v1/clubs` answer 501) | Operator routes, outside this plan | With the first partner that brings its own club |
| The card in the protocol, or at a fixed well-known path | No second implementation reads it yet | When one does |
| A generator for a buyer's card, and a seller's intake for sealed proposals | Not needed for a first deal | When a seller wants to sell to a standing outside buyer |
| A command that drafts checks from samples | The check already refuses weak ones | If T-473's runs show the assistant fails or spends most of its tokens there |
| Service files for macOS and Windows | The recipe is Linux and systemd | With the first party that asks |
| A setup prompt on the home page | The page is Rafa's (landing taste) | After the first measured runs |
| A quoting seller that Crow runs for strangers | `buy.txt` cannot be finished against anything Crow runs today; Crow's own selling agent (N131) will be one | When that agent is live |

## Choices for Rafa

Each has a default that applies if he says nothing.

1. **Say the future fee in `setup.txt` now?** Recommended: yes, one line: free in the pilots, an operator may charge the operator fee later. Default: yes.
2. **The card: a convention with a published schema, or part of the protocol?** Recommended: a convention now (D74). Default: a convention.
3. **A seller's first deal when its offer does not fit the test buyer's rules** (a price above 50 tUSDC, for one). Recommended: with `--self-buy`, the command buys the job itself with a fresh buyer key, and marks the deal as a self-test in its public terms and in the record. The other way is to raise the test buyer's maximum price, which is the test buyer's own setting. Default: the command may buy, on that flag.
4. **Crow hosting in `setup.txt`.** Recommended: not offered there; it stays a convenience for design partners. Default: not offered.
5. **The targets** in "The measure". Recommended: as written, reset after three live runs each. Default: as written.
6. **The seller Worker on a party's own Cloudflare account (T-478).** Recommended: build it once the pilot's hosted sellers are deployed; it is what makes publishing as simple as one deploy. Default: it starts then.
7. **Where Crow's own two machines run.** Recommended: two small Linux VMs now, as the signer is built, and the signer's Worker shell later as the package's answer for a party (T-481), after a live test of four open points. Default: VMs now; T-481 waits.
8. **The benchmark's machines.** Recommended: DigitalOcean Droplets in a team of their own, one for each run (T-482). It needs that team, its token and a spend-capped model key from Rafa. Default: the benchmark stays on the sandbox until he provides them.
9. **A fresh key for each deal as the seller's default.** It sends nothing before the first deal and keeps the standing key out of every deal, and it needs the faucet for every quote. Recommended: yes, with the trade stated in `setup.txt`; a standing key is one flag. Default: a fresh key for each deal.
10. **Keys in files on a party's own machine.** The hard rule takes secrets from environment variables only; the buyer's tools already keep deal keys in files of mode 0600. Recommended: the setup follows the buyer's tools. Default: it does.
11. **Two gates that are Rafa's by rule:** the site deploy that publishes `setup.txt` and `setup.mjs` after T-472 merges, and the live benchmark runs for T-473.
