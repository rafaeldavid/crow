# T-486: The setup's listing step, a party sends Crow its website

- **Lane:** demo (agent access: the guides in `site/` and the reference tools in `examples/`), with one route on the sign-up Worker (`apps/early-access/`)
- **Phase:** 2
- **Depends on:** T-472 (the setup command and `setup.txt`, merged at `d72490bf`)
- **Paths this task may touch:**
  - The command: `examples/setup.ts`, `examples/setup-seller.ts` (the state's type), `examples/setup-list.ts` (new), `examples/setup-list.test.ts` (new), `examples/setup-bundle.test.ts`, `apps/test-agents/src/setup.test.ts`.
  - The page and the bundle: `site/setup.txt`, `site/setup.mjs` (generated), `site/guides.mjs`, `site/check.mjs`, `site/build.mjs` (the bundle's banner line only), `tests/site-guides.test.ts`.
  - The receiver: `apps/early-access/worker.js`, `apps/early-access/listing.js` (new), `tests/early-access-listing.test.ts` (new).
  - The benchmark's count: `tools/one-click/bench-record.mjs`, `tools/one-click/README.md` (one line), `scripts/metrics/schemas/one-click.schema.json`, `tests/metrics/one-click-setup.test.ts`.
  - The records: `docs/decisions-today.md` (D75), one dated line in `docs/research/2026-11-15-setup-design.md`, this file.
  - It changes nothing under `apps/hosted-sellers/`, `apps/operator`, `apps/demo-cloud`, `packages/` or `spec/schemas/`, none of the frozen files in `examples/` that T-472 lists, and no generated bundle but `site/setup.mjs`.
- **Human gate:** yes, for two steps, both the coordinator's to order and Rafa's to approve: the deploy of the Worker `crow-early-access` with the new route, and the site deploy that publishes the new `setup.txt` and `setup.mjs`. The Worker deploys first. The merge has no gate.
- **Status:** in progress
- **Agent/session:** a sub-session of the coordinator, 2026-11-15, branch `t-486-setup-listing`. Phase A wrote this file and D75 and stopped for the coordinator's word.
- **Roadmap row:** N162
- **Change kind:** 4 is the nearest recipe (client code in `examples/` and a Worker route), with 1 (an agent guide in `site/`). Local checks: `pnpm exec vitest run examples/setup apps/test-agents/src/setup.test.ts tests/early-access tests/site-guides.test.ts tests/metrics`, `node site/build.mjs && node site/check.mjs`, `pnpm typecheck`, `eslint` on the changed sources.
- **Review:** one `red-teamer` pass (the change sends a party's data to Crow and adds a route that fetches an address a stranger names) and one `reviewer` pass. Blocking findings only.
- **Token budget:** 150,000 tokens, a target.

## Intent

Restated in my own words before any code.

Rafa wants Crow to know who has set Crow up. So the setup asks each party, seller or buyer, for one thing: its website. The party's own command sends that website to a list Crow keeps of who uses it. The step is part of the default path, the person can decline it, and no deal waits for it or reads it.

This task builds that step end to end, locally:

- **One command.** `node ~/.crow/setup.mjs list --website <https URL>` sends the website. `list --skip` records that the person declined and sends nothing. With neither answer the command prints the question as one JSON object and exits 3, as the payout question does.
- **One request.** A POST whose body is `{"website": "<url>", "role": "seller" | "buyer"}` and nothing else. The command prints what it will send, and to whom, before it sends it, and writes what it sent and the answer into `crow.json`.
- **One route.** `POST /listing` on the sign-up Worker stores the website, the role, the time and one mark, `verified`, in the store that holds the email sign-ups. It stores no IP address.
- **One mark.** For a seller the receiver reads the card at `<website>/agent.json`. A `crow-agent` card there gives `verified: "card"`; anything else gives `verified: "none"`. A buyer has no card, so its mark is `"none"`. The mark never decides anything about a deal.
- **One count.** The benchmark keeps `setup.requestsBeforeFirstDeal` as it is and counts listing requests in a field of their own.

Inputs: a folder that `seller` made, and the person's answer. Outputs: one entry at the receiver or a recorded skip, and a line in `crow.json`.

Non-goals:

- **A gate.** `first-deal`, the operators, the test agents and the contracts never read the list. A party that skips, or whose listing fails, settles its deals as before.
- **A directory.** Nothing publishes the list, and nobody finds a party through it (D74's decline stands).
- **A deploy.** The route is built and tested on this machine. No test and no command of this task calls a live host.
- **A buyer's setup.** The route takes `role: "buyer"` now; the command sends it once T-475 gives a folder that role.
- **Removal.** No command takes a website off the list in this slice.

## Context

- The decision: D75 in `docs/decisions-today.md`, with Rafa's words of 2026-11-15. It amends one line of D73, "Nothing sent before the first deal".
- The setup as built: `docs/tasks/T-472-setup-first-slice.md` (the command table, the criterion "Nothing before the first deal", the fix round's choices) and `examples/setup.ts`.
- The design: `docs/research/2026-11-15-setup-design.md`, sections "`setup.txt`", "The setup command", "The privacy table", "Where the signing part runs" and "The measure".
- What an operator learns from a client's IP address: `docs/privacy-baseline.md`, "What each observer learns", the row "Link between two deals of one party".
- The card: `site/ref/intake.txt` ("a reading agent takes the card from `agent.json` beside the page") and `site/card.schema.json`.
- The receiver as it is today (measured at `d72490bf`, `apps/early-access/worker.js`):
  - **One route.** `POST /early-access` (line 54), for a browser on an allowed origin (lines 16 and 55).
  - **The store.** Workers KV, binding `EMAILS` (`apps/early-access/wrangler.jsonc`, line 14). One entry for each address: the key is `email:<address in lower case>` and the value is `{"at": "<time>", "page": "<at most 120 characters>"}` (lines 65 to 67). An entry is written once: a second sign-up of one address writes nothing (line 66).
  - **No IP address, no cookie** (line 2). Observability is off (`wrangler.jsonc`, line 15).
  - **Sizes.** The email is at most 254 characters (line 64). The body has no cap of its own.
  - **No rate limit.** The Worker has none. An origin allow-list (line 55) and a honeypot field (line 62) are its only fences, and both assume a browser.
- The limits this route copies in kind: the operators' report limits, counted in memory by client (`docs/operations.md`, "Limits").
- The benchmark's count: `tools/one-click/bench-record.mjs` (`setupOf`), `scripts/metrics/schemas/one-click.schema.json` (`Setup`), `docs/tasks/T-473-setup-benchmark.md`.

## What is built

### The command

| Command | What it does | Requests |
| --- | --- | --- |
| `list --website <https URL>` | Reads the role from `crow.json`, prints one `preview` line, sends one POST, writes the result into `crow.json` and prints one `list` line with the receiver's mark | 1 POST to the listing address |
| `list --skip` | Writes the skip and its time into `crow.json` | none |
| `list` | Prints the question as one JSON object and exits 3 | none |
| `seller` | As before. Its line gains `next`: the `list` step and how to skip it | none |
| `first-deal` | As before. With neither a listing nor a skip in `crow.json`, it prints one advisory line on standard error and goes on | as before |
| `status` | As before, with the listing or the skip | none |

- **The listing address** is a constant in the command, `https://join.crow.direct/listing`, and changes with `--list-at <URL>`, so a test, another keeper of a list, or nobody can receive it. With `--test-world` the flag is required, so a test world never reaches a Crow host by a default. Without `--test-world` the address is an https host that is not this machine, as the operators and the buyer are.
- **The website** is an `https` URL with a host, at most 200 characters as the URL parser writes it. The command refuses one with a user name or password, a query, a fragment or a port, before it sends anything: a website's address needs none of them, and a query can hold a credential. It sends the website as the parser writes it.
- **The request** carries the two fields and `content-type: application/json`. It has a 15 s timeout and follows no redirect, so the website reaches only the host the preview names.
- **Exit status.** 0: sent and taken, or the skip recorded. 1: the receiver refused or did not answer; the line says that no deal depends on it. 2: a wrong call. 3: the answer is missing.
- **`crow.json`** gains `listing`: for a listing, the website, the role, the address it went to, the time, the answer's status and its `verified` mark; for a skip, the time. A failed attempt is recorded as failed and counts as neither.
- **No key.** `list` opens no file under `keys/`.

### The receiver

`POST /listing` on `crow-early-access`, in `apps/early-access/listing.js`.

- **The body** is JSON of at most 1,024 bytes with exactly two fields, `website` and `role`. Any other field is refused with 400, so the route never holds more than the page promises.
- **Refused, with nothing stored and nothing fetched:** a request with an `Origin` header (a browser's; the command sends none), another content type, a role other than `seller` or `buyer`, and a website that fails the command's rules or whose host is an IP address, has no dot, or ends in `.localhost`, `.local`, `.internal` or `.home.arpa`.
- **Limits,** counted in memory as the operators' report limits are, so a restart resets them: 10 requests an hour for each client (an IPv4 address or an IPv6 /64) and 500 a UTC day in all. Over a limit the answer is 429 with `retryAfterSec`. The client's address is a counter's key in memory for the hour and is never stored.
- **The mark, for a seller.** The receiver makes one GET to one address: the website with its trailing slashes removed, then `/agent.json`. It follows no redirect, waits at most 5 s and reads at most 65,536 bytes. `verified` is `"card"` when the answer is status 200 and a JSON object whose `type` is `crow-agent` and whose `offers` is a list, the two fields the card's schema requires of a seller. Otherwise it is `"none"`. The fetched text is never stored, logged or returned.
- **The mark, for a buyer:** `"none"`, with no fetch.
- **The entry.** KV `EMAILS`, key `listing:<role>:<website>`, value `{"website", "role", "receivedAt", "verified"}`. The first request for a key writes it. A later one writes only when the mark rises from `"none"` to `"card"`, and keeps `receivedAt`.
- **The answer:** 200 with `{"ok": true, "website", "role", "verified"}`.

### The benchmark

A listing request is a `POST` whose path is exactly `/listing`. The host does not decide it: it only names the row in `byHost`. The probes record method, host, path and status and no body, so the rule reads none. No operator route has that path (inferred from `docs/api.md`; the build checks it against the operators' own route list).

- `setup.requestsBeforeFirstDeal` leaves listing requests out, so it stays 0 for a run that lists and for a run that skips.
- `setup.listingRequestsBeforeFirstDeal` is new: `{total, byHost}` for the listing requests before the marker, and null in the cases where the other counts are null.
- The record's version stays 3. The field is optional in the schema, so a version 3 record written before this change stays valid.

## Acceptance criteria

The command:

- [ ] `list --website https://seller.example` makes exactly one request: a POST to the listing address whose body, parsed, equals `{"website": "https://seller.example/", "role": "seller"}`. A test records the request's method, address, headers and body. The body and the headers hold no address of the folder, no key, no folder path and no name.
- [ ] Before that request the command prints one `preview` line that names the address it sends to, the exact body, and what the receiver sees beside it: the sender's IP address.
- [ ] `list` with no answer prints one JSON object with the question, exits 3 and sends nothing. `list --skip` exits 0, sends nothing and records the skip. `--website` with `--skip` is a wrong call, exit 2.
- [ ] The command refuses, before any request: a website that is not `https`, one with a user name or password, a query, a fragment or a port, and one over 200 characters.
- [ ] `--list-at` changes the address. `--test-world` without `--list-at` is a wrong call. Without `--test-world`, an address that is not https or is this machine is a wrong call. A receiver that answers with a redirect gets no second request.
- [ ] After a listing, `crow.json` holds the website, the role, the address it went to, the time, the answer's status and its mark, and `status` prints them. After a receiver's 500, or with the receiver unreachable, `list` exits 1, its line says that no deal depends on the list, and `crow.json` records the attempt as failed.
- [ ] `list` opens no file under `keys/`. T-472's leak test, extended to `list`, still finds no key in any printed line or any file outside `keys/`.
- [ ] `seller` and `check` still make no request off the machine, and `seller`'s line names `list` as the next step and how to skip it.
- [ ] `first-deal` with neither a listing nor a skip prints exactly one advisory line that names the step, and goes on. After a listing or a skip it prints none. It never refuses for the list.

Neutrality:

- [ ] In the test world, `first-deal` ends `Released` in each of three runs: the listing skipped; the listing refused (the receiver answers 500); the receiver unreachable (`apps/test-agents/src/setup.test.ts`).
- [ ] A test reads the sources and finds the listing route and the store's binding named in no file under `apps/operator`, `apps/demo-cloud`, `apps/test-agents` (its tests aside), `apps/hosted-sellers` or `packages/`.

The receiver:

- [ ] `POST /listing` with a seller's website whose `agent.json` is a `crow-agent` card answers 200 with `verified: "card"`. The store then holds one new entry, under `listing:seller:<website>`, with exactly the fields `website`, `role`, `receivedAt` and `verified`. A test reads the whole store and finds no IP address and no header's value in it.
- [ ] The receiver makes exactly one GET, to `<website>/agent.json`, with no redirect followed. Each of these gives `verified: "none"` and stores the entry: a 404; a redirect; a body over 65,536 bytes; no answer within 5 s; text that is not JSON; a `crow-buyer` card; a card with no `offers` list.
- [ ] A buyer's listing stores `verified: "none"` and makes no fetch.
- [ ] Each refusal in "The receiver" above answers 400, 403 or 413, stores nothing and fetches nothing: an `Origin` header, another content type, a body over 1,024 bytes, a third field, another role, each bad website, an IP address as the host, `localhost`, a name with no dot.
- [ ] The eleventh request of one client within an hour answers 429 with `retryAfterSec`, stores nothing and fetches nothing. So does request 501 of a UTC day.
- [ ] A second listing of one website and role writes nothing when the mark is unchanged, and writes once when it rises from `"none"` to `"card"`, with `receivedAt` kept.
- [ ] The email sign-up is unchanged: `tests/early-access-headers.test.ts` passes with no edit, and every answer of the new route carries the security headers.
- [ ] No test opens a connection off the machine: the card's fetch is a function the test supplies.

The page:

- [ ] `site/setup.txt` has one short section on the list: what is sent, to whom and why; that the receiver sees the website and the sender's IP address; that Crow can tie the website to the fresh keys the same IP address asks the faucet for; how to skip; that skipping changes nothing about a deal; that the list is Crow's own record and is not published by this version; that this version cannot take a website off the list.
- [ ] The three statements stay true and `site/check.mjs` still holds their phrases: "Before the marker, this version sends nothing to a Crow-run host" now names its one exception, the website, sent only by `list`; "This version registers nothing at Crow" names the same exception; "**No account.**" says the one thing the setup asks for.
- [ ] `SETUP_MAX_BYTES` is 10,000, `site/check.mjs` fails above it, and the published page is under it. `node site/build.mjs` leaves the tree clean and `node site/check.mjs` passes.

The benchmark:

- [ ] A record of a run that lists before the marker has `requestsBeforeFirstDeal.total` 0 and `listingRequestsBeforeFirstDeal` with total 1 under the listing host. A run that skips has 0 and 0. A run whose setup posts to the faucet before the marker still counts 1 in the first field. A run with no marker has null in both.
- [ ] The schema takes a version 3 record with the new field and one without it.

The records and the frozen files:

- [ ] D75 is the last entry of `docs/decisions-today.md`, and the design record has one dated line that points to it where it says nothing is sent before the first deal.
- [ ] `site/try.mjs` keeps SHA-256 `04ef4434fb4b5635bb3c49df69c7547f3200c6c41f903237ee37098be23f75c8` and `site/buy.mjs` keeps `e74ff2230f0d4fd426525095731e42d50b65b55ab7792a43cab73c302b22eb88`, measured before the first change and after the last. `git diff --stat origin/main --` over the frozen paths prints nothing.
- [ ] `gitleaks` finds nothing in the branch's commits.
- [ ] One `red-teamer` pass and one `reviewer` pass, ordered by the coordinator; their blocking findings are fixed and listed in Evidence.

## Out of scope

- **The deploys.** The Worker's and the site's; the coordinator orders them. Until the Worker has the route, a published `list` gets a 404, exits 1 and says so, and no deal changes.
- **Removal from the list.** A route that removes an entry needs to know who may ask. `leave` (T-476) says today that nothing was registered at Crow; that task takes the removal, and until then Crow removes an entry by hand.
- **The whole card schema at the receiver.** The receiver checks the two fields the schema requires of a seller's card. Checking the whole of `site/card.schema.json` inside a Worker needs a validator built ahead of time; see Decisions.
- **The buyer's side of the command.** T-475 makes a buyer's folder; `list` then sends `role: "buyer"` with no change here.
- **The trust page and `docs/operations.md`.** Both state what the live sign-up Worker stores. Each gets its line with the Worker's deploy, from the coordinator.
- **The summary of benchmark records.** `scripts/metrics/one-click-summary.mjs` keeps reading `requestsBeforeFirstDeal` only.
- **Reading the list.** No page, script or console reads the entries in this slice. `wrangler kv key list --binding EMAILS --prefix listing:` lists them.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

Choices made inside this task. Escalate anything that changes architecture, a contract or a defense to an ADR.

**Phase A's choices (2026-11-15), each open to the coordinator's word before the build.** The first five depart from the coordinator's brief. The rest settle what it left open.

- **The mark checks the card's two required fields, and leaves the whole schema for later.** The brief asked for a card that passes `site/card.schema.json`. A Worker refuses code made at run time, and the repository's schema checker makes its checking code that way; the operators therefore run validators built ahead of time (`packages/core/src/validators-codegen.ts`, measured; that the card's schema would fail the same way in a Worker is inferred). A validator built ahead of time for the card is a generated file, a build step and a staleness test: guessed at 25,000 tokens. The lighter check reads `type` and `offers`. The mark decides nothing, so a card that would fail the whole schema costs no party anything.
- **No redirect is followed at all.** The brief allowed a redirect that stays on the origin. Following none is one rule less to test, and a site that redirects `agent.json` can serve it in place.
- **The website carries no user name, password, query, fragment or port.** The brief asked for an `https` URL with a host. A query or a user name can hold a credential, and the command would send it; a port turns the receiver's one GET into a probe of any port.
- **The receiver refuses a request with an `Origin` header.** The command sends none. Without the rule, any web page could have its visitors' browsers post listings from their own IP addresses, past the limit for each client.
- **The route has limits of its own.** The brief asked for the Worker's rate-limit habits, and the Worker has none (measured, Context). The route copies the operators' report limits in kind, in a few lines of its own: importing `apps/demo-cloud/src/limits.ts` would bring the operator's packages into the sign-up Worker.
- **The record's version stays 3.** The brief left it open. The new field is optional in the schema, so no reader of version 3 breaks on an older record. A reader that refuses unknown fields would refuse a new record; Crow Control's reader is in the private repository and is not measured here.
- **Phase A wrote two files.** The brief's Phase A names the task file and the decision "and nothing else", and elsewhere asks for one line in the design record. That line waits for Phase B.
- **Every entry is kept, with its mark.** A seller whose card is not up yet is stored with `"none"` and rises to `"card"` when the same command runs again after the card is published. Crow counts a seller as listed by its mark.
- **One store.** The entries go into the KV namespace of the email sign-ups, under their own prefix. A namespace of its own would be a change on the Cloudflare account, which waits for Rafa.
- **The role comes from `crow.json`.** `list` needs a folder the setup made. It takes no `--role`, so the role it sends is the one the folder has.
- **A failed attempt is neither a listing nor a skip.** `first-deal` keeps its advisory line until the person lists or skips.
- **The advisory line goes to standard error,** beside the marker. `setup.txt` says that every line on standard output but `preview` and `status` carries `ok`, and an advisory is neither a pass nor a failure.
- **No `Idempotency-Key`.** The hard rule covers the operators' API. This route is outside `spec/schemas/`, on the sign-up Worker, and is idempotent by its key: one website and role is one entry.
- **`SETUP_MAX_BYTES` rises from 8,000 to 10,000.** The published page stands at 7,978 bytes (measured by the coordinator), and the list's section needs about 900 (guessed). The page stays one fetch, about 2,500 tokens estimated as bytes divided by four. The later tasks move detail for each role into reference files.

**What a private address behind a public name can do.** A Worker's `fetch` gives no way to see the address a name resolves to, so the receiver cannot refuse a public name that points at a private address. On Cloudflare the request leaves from Cloudflare's network, which has no route to a private host of Crow's (inferred from the platform; not measured). The receiver returns no fetched text, and its only signal is the mark and the time, bounded by 5 s. The red team's pass reads this line.

## Handoff

**Phase A is done: this file and D75 are committed on `t-486-setup-listing`; nothing is built, pushed or deployed.** The build waits for the coordinator's word.

- **To resume:** `pnpm install --frozen-lockfile` and `pnpm build` in the worktree, then the tests first, in the order of "Acceptance criteria".
- **A find for the triage file, outside this task.** The benchmark reads the first-deal marker as the line `crow-setup: first-deal started <ms>` (`tools/one-click/bench-record.mjs`, `MARKER_LINE`), and the setup command writes a JSON line and a JSON file with `startedAt` (`examples/setup.ts`, step 3). Read from the two sources, not run: a real run of the setup scenario would record `markerSeen: false` and null counts. This task changes neither side.
- **Open for the coordinator or Rafa:** the verification rule and whether the step is part of the default path (both in D75); whether the whole card schema is worth its build now; whether the record's version should move to 4; who removes an entry, and how a party asks.
