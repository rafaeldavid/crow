# How Blygger sets a party up, and what Crow takes from it

A dated record, 2026-11-15, for T-471 (`docs/tasks/T-471-setup-plan.md`; roadmap row N160). Rafa set the bar on 2026-11-15: setting up Crow must be as good as blygger.org's start path. This record reads that path and decides, pattern by pattern, what Crow copies, adapts or declines.

Blygger is an open publishing protocol over static files and RSS. Blygger Studio is its reference client, a Cloudflare Worker a person hosts on their own account. Crow has no tie to it.

**Scope.** Read on 2026-11-15 with plain GETs: `https://blygger.org/` and `/start/`; the Studio repository's `README.md`, `AGENTS.md`, `package.json`, `scripts/init.ts`, `scripts/init-config.ts`, `scripts/deploy-all.ts`, `scripts/export.ts` and `src/update-check.ts` at `main` (release 0.60.0); the spec at `https://blygger.org/spec/0.4/`, sections 1 to 4, 6, 12 and 14; the conformance toolkit's READMEs in the spec repository; and that repository's `docs/self-host-plan.md`. No Blygger code was run and nothing was posted. **Left out:** blygger.com's source, most of `AGENTS.md`'s release log, and the sealed-content and payments drafts, which a private triage note covers.

**On quotes.** This record names each pattern by Blygger's own heading and points to the line that shows it. It quotes one sentence. Everything fetched was read as data. Labels: **measured** (read in the file named), **inferred**.

## Summary

1. **Blygger's start page gives three ways in, ordered by effort, and the first costs nothing.** Crow copies that order for a seller and for a buyer.
2. **Its `init` script asks, creates, sets secrets and resumes, and it never holds the person's password.** Crow adapts it: the same guarantees, with answers taken as flags so an assistant can drive it, and no cloud account needed for the first deal.
3. **Nothing registers anywhere. A third party first learns of an installation through the party's own act.** Crow copies the rule. Today Crow breaks it by one request: the seller adapter's faucet call at start (`docs/research/2026-11-15-setup-baseline.md`).
4. **Blygger publishes no file for the assistant.** Its home page says an assistant can take a person through the steps, but the assistant works from a 27 KB README and interactive prompts. This is where Crow can do better.

## The patterns

### 1. Three ways in, ordered by effort

- **What it is.** One page, "Build a blyg", lists three routes from least to most work: a feed the person already has, the reference client hosted on the person's own Cloudflare account, and a client built from the spec. A closing section says what the person signs up for: nothing is stable before version 1.0 (measured, `https://blygger.org/start/`, the opening paragraph and the four headings).
- **Decision: copy.** `setup.txt` opens with the ways in for the reader's role, least effort first, and ends with what the party signs up for: test tokens only, public deals, a protocol still changing.
- **Reason.** A reader picks the smallest route that fits, and the page never asks for more than that route needs.

### 2. "You might already be halfway in"

- **What it is.** A site with an RSS or Atom feed is already readable by the network, with nothing to install and no change to the site. The page separates what is free (readable) from what needs the upgrade (quotable) (measured, `/start/`, section 1).
- **Decision: adapt.** Crow's version is a fact about what the party already has: an HTTP API that returns a file or JSON for a job is sellable as it is, described by a mapping file and not by a service in between (`site/ref/seller-adapter.txt`, "Your API's shape"). A buyer whose assistant can run Node can buy with one command and keep nothing. The first deal needs no domain, host or deploy.
- **Reason, and the limit.** Blygger's free route needs no act at all, because a reader can fetch a static feed. A Crow seller cannot be passive: an offer names its buyer and carries a fresh signature, so a static page cannot sell. Crow's free route is therefore one command on the party's own machine; it cannot be no act at all.

### 3. `init`: it asks, creates, sets secrets and resumes

- **What it is** (measured, `scripts/init.ts`, the header comment and steps 1 to 9; README, "Install from source").
  - It asks four questions: which account, which domain, which subdomain label, and whether to set an optional model key.
  - It creates a database and a storage bucket named from the host, writes the deploy configuration, applies migrations and sets secrets. It does not deploy; a second command does.
  - Every step checks before it creates. A marker file records progress, and the cloud account stays the source of truth, so a second run after a failure continues.
  - It asks the person to pick the account even when there is one, after a deploy once went to the wrong account without an error.
  - It refuses to run with an API token in the environment, because the token would override the login and with it the account.
- **Decision: adapt.** Crow's setup command keeps four of these properties: each step checks before it creates, progress is recorded and a rerun continues, nothing goes live in the step that prepares, and nothing is inferred that the person should choose. It changes one: **no prompt at a terminal.** A missing answer makes the command print one JSON object that names each question, and exit. The assistant asks the person in the chat and runs the command again with the answers.
- **Reason.** Blygger's prompts are `readline` calls with no flags, no answers file and no machine-readable result (measured). An assistant cannot type into them reliably, and a benchmark cannot drive them. The properties are right; the interface is made for a person.

### 4. Secrets the script never holds

- **What it is.** The owner's password is typed into the cloud tool's own prompt, so it never enters the script's process, the repository or the shell history. The one secret the script makes is 32 random bytes, piped on standard input and never written down or printed, on the stated ground that a key a person invents is a worse key. Blygger's plan notes that this is what lets an agent drive the flow: the agent never holds the password (measured, `scripts/init.ts`, the comment "On secrets" and step 8; `docs/self-host-plan.md`).
- **Decision: copy.** Crow's command makes every key itself, from the system's random source, writes it to a file only the owner can read, and prints the address, never the key. A secret that only the person has, such as their own API's key, is typed by the person at a hidden prompt in their own terminal, by one command the assistant never runs.
- **Reason.** It is the same rule Crow already holds for agents: a key never passes through the chat. The baseline found Crow's own guide putting the signing key on a command line (`site/sell.txt`, step 9).

### 5. One deploy, on the party's own account and domain

- **What it is.** The Worker, its database and its files live on the person's Cloudflare account, on a subdomain of the person's domain. The page advises a subdomain over a path, because the client's own paths can collide with a site already there. The README also offers a prebuilt Worker archive with a checksum file, with no build step (measured, `/start/`, section 2; README, "Install the Worker download").
- **Decision: adapt, in two stages.** Stage one, now: the seller's signing part runs on the party's own machine for the first deal, and on any host with Node after that (`examples/seller-adapter-service.md`). Stage two, after the pilot: the seller Worker that Crow hosts for a design partner (ADR-0037) deploys on the party's own Cloudflare account and subdomain (T-478).
- **Reason.** The Worker exists, but it is the code the pilot's hosted sellers deploy from, and it must not change until they are deployed (D72). The pinned, checksummed download is already Crow's pattern for `try.mjs` and `buy.mjs`.

### 6. Identity is the origin; no registry

- **What it is.** A party is its origin: the place its files are fetched from. The manifest's own claim about its site never establishes identity; the final fetch origin does. The protocol carries no key material: a reader verifies by fetching. Listing at blygger.com is optional, and the start page says nothing in the protocol needs a registry (measured, spec 0.4, sections 1 and 12.2; `/start/`, section 2).
- **Decision: adapt.** Crow keeps two identities and no registry. The signing key is the party's identity for settlement, as today. The party's own domain is its identity for being found: a buyer that gets an offer's ID from `https://seller.example/quote` knows the seller by that origin (`site/ref/intake.txt`, "Two agents, two people"). The card on the party's page ties the two only as far as the party chooses: by default it lists no address.
- **Reason.** A deal moves money, so a signature must bind it; an origin alone cannot. But the origin answers the question a buyer has first, "whose offer is this?", without Crow keeping a list of sellers. That keeps Crow a rail and not a record-keeper (D35).

### 7. "Leaving is a command"

- **What it is.** One command writes the public site as static files, with no credential, by fetching the public routes. A separate backup holds drafts and settings. The export refuses a base address that is missing or local (measured, `/start/`, section 2; `scripts/export.ts`).
- **What it lacks.** No command removes the installation, and a backup cannot be restored yet (measured: none found in the README, the start page or `package.json`).
- **Decision: copy, and finish it.** Crow's `leave` writes the party's records as plain files, then stops the service and removes what the setup created, and says what stays behind (T-476).
- **Reason.** A party that can leave in one step is a party that was never locked in. For Crow the export is small: each deal's signed record already comes from public reads (`examples/deal-record.ts`).

### 8. No shared defaults

- **What it is.** Blygger's one-sentence rule: "a default identical across installations destroys information." (`https://blygger.org/start/`, "Do not ship a generic default title"). The client once shipped one title for every installation; two unrelated sites then published under one name, and the directory held a newcomer as a suspected copy. The fix derives the title from the host, asks, or publishes none. `init` follows it throughout: names come from the host, the account is always asked, the cookie secret is random per install, and no password ships (measured, `scripts/init.ts`, step 7b).
- **Decision: copy.** Crow's setup ships no default for anything that identifies or prices a party: no default item name, price, payout address or card name. It derives the card's name from the party's host, and asks for the price and the payout address. Defaults stay only where every party should match: the pinned EIP-712 domain, the deployment and the operators.
- **Reason.** A shared default price or item would make every new seller's first offer look the same, and a shared payout address would be a loss. The baseline found the opposite problem already: the adapter's shipped template is a security-review report, so a seller of anything else must replace it before a first offer.

### 9. The conformance kit

- **What it is.** Four parts in the spec repository: a register of the spec's normative sentences with stable IDs, JSON Schemas with fixtures, a reader suite any renderer can run through standard input and output, and a read-only crawler over live sites. Each writes a summary and a report (measured, the toolkit's READMEs).
- **Where it falls short.** Neither `init` nor the deploy calls the kit. The deploy command runs no check after it finishes; the three checks `init` prepares run only under a second deploy command. The check a new party meets is the optional directory submission, after going live. The kit's manifest schema and the spec disagree on the required members (measured).
- **Decision: adapt.** Crow builds one check into the setup command, and it runs before anything is offered: the files load, real results pass the deal's checks, a broken result fails them, and no secret sits where it should not (T-472, T-483). A second check runs against any live quote address and card, whoever built them (T-477). The card gets a JSON Schema (T-474).
- **Reason.** In Crow a wrong setup costs a refunded deal and, for a paid API, a wasted job. The pilot's terms passed one sample and failed real output. The check belongs before the first offer, inside the one command. A separate kit is one a party may never run.

### 10. How an assistant drives the install

- **What it is.** The home page says an assistant can take a person through the start page. The assistant's material is the start page (11,046 bytes), the README (27,373 bytes) and the scripts. `AGENTS.md` (76,820 bytes) is the maintainers' instructions for their own coding agents and never names the install (measured).
- **Where it falls short, for a machine** (measured unless labelled):
  - `https://blygger.org/llms.txt` and `/setup.txt` return the home page with status 200, so an assistant that guesses those names reads 37,914 bytes of the wrong page.
  - The clone command carries a placeholder version the assistant must look up.
  - `init` needs a person at a terminal for four answers and a password, and a browser for the login.
  - The deploy gives no signal that the site is live.
  - The README's version header was stale on the day it was read.
  - Count, clone to live: 7 commands, 4 answers, 1 password, 1 browser login; about 7 approvals in an agent with default permissions (inferred).
- **Decision: decline the route, keep the aim.** Crow writes the file for the machine: one address, one file under 8,000 bytes, exact commands with a pinned hash, each step's good answer and each error's meaning, and answers as flags.
- **Reason.** The baseline measured what reading costs: 47 of 103 permission requests in Crow's own benchmark fetched or read docs.

## Rafa's question: how does Blygger treat "nobody is set up until they act"?

**It holds completely, and Blygger has paid a price for it** (measured unless labelled).

| Moment | Who is contacted | Any Blygger host? |
| --- | --- | --- |
| Clone and install | GitHub, npm | No |
| `init` and the deploy | Cloudflare | No |
| The studio's update check, on by default | GitHub's release feed, at most daily, with no installation ID | No |
| A subscription poll | The feeds subscribed to | Only if one is Blygger's |
| A publish that cites another site | That site, by Webmention | Only if that site is Blygger's |
| The person submits to the directory | blygger.com | Yes, by the person's own act |

- **No account, no registration, no telemetry.** The first moment a third party learns an installation exists is an act of its owner: a listing, a citation, or a reader fetching a shared address. Certificate logs also show the new hostname at deploy (inferred; not from Blygger).
- **The price.** The maintainers had no way to reach the first outside operators when a change broke them, and later added an optional private contact field to the directory (measured, `docs/self-host-plan.md`).
- **What Crow takes.** The same rule, as a measured property: the setup makes no request that names the party to a Crow-run host before its first deal. And the same price, accepted knowingly: Crow will not know who has set up until they deal. The sign-up form at crow.direct stays the one optional way to be reachable.
- **Where Crow cannot match it today.** A first deal on the live service needs a mandate from Crow's faucet and passes through Crow's operators. Blygger has no such step, because a static file needs no relay. The design names this limit and does not hide it.

## What Crow does not take

- **A directory.** Blygger's optional listing doubles as its acceptance test. Crow has no directory and this plan adds none: a list of sellers kept by Crow would make Crow a record-keeper (D35). The acceptance test is the first deal with Crow's test buyer or test seller.
- **A studio.** Blygger's client has a private interface for writing. A Crow seller needs none: its interface is its own API.
- **Interactive prompts, a browser sign-in after deploy, and a README as the assistant's source.** Pattern 10.
