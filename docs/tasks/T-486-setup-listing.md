# T-486: The setup's listing step, a party sends Crow its website

- **Lane:** demo (agent access: the guides in `site/` and the reference tools in `examples/`), with one route on the sign-up Worker (`apps/early-access/`) and one script in `scripts/`
- **Phase:** 2
- **Depends on:** T-472 (the setup command and `setup.txt`, merged at `d72490bf`)
- **Paths this task may touch:**
  - The command: `examples/setup.ts`, `examples/setup-seller.ts` (the state's type, the `seller` line, the lock's error), `examples/setup-list.ts` (new), `examples/setup-list.test.ts` (new), `examples/setup-bundle.test.ts`, `apps/test-agents/src/setup.test.ts`.
  - The page and the bundle: `site/setup.txt`, `site/setup.mjs` (generated), `site/guides.mjs`, `site/check.mjs`, `site/build.mjs` (the bundle's banner line only), `tests/site-guides.test.ts`.
  - The receiver: `apps/early-access/worker.js`, `apps/early-access/listing.js` (new), `tests/early-access-listing.test.ts` (new).
  - The check, run by a person: `scripts/listing-check.mjs` (new), `tests/listing-check.test.ts` (new).
  - The benchmark: `tools/one-click/bench-record.mjs`, `tools/one-click/README.md`, `scripts/metrics/schemas/one-click.schema.json`, `tests/metrics/one-click-setup.test.ts`, `tests/metrics/one-click-bench.test.ts` (one expectation).
  - The records: `docs/decisions-today.md` (D76), one dated line in `docs/research/2026-11-15-setup-design.md`, the sign-up Worker's commands in `docs/operations.md`, this file.
  - It changes nothing under `apps/hosted-sellers/`, `apps/operator`, `apps/demo-cloud`, `packages/` or `spec/schemas/`, none of the frozen files in `examples/` that T-472 lists, and no generated bundle but `site/setup.mjs`.
- **Paths outside this task, and why** (the coordinator's word of 2026-11-15, each in a commit of its own):
  - `docs/operations.md`, "Deploy record": the entry for the site deploy of 2026-11-15, 11:24 UTC, which Rafa ran and which had no record line.
  - `docs/tasks/T-469-one-command-per-goal.md`: its status line, set to done. Pull request 578 merged on 2026-11-15 and the file still said review.
- **Human gate:** yes, for two steps, both Rafa's to run: the deploy of the Worker `crow-early-access` with the new route, then the site deploy that publishes the new `setup.txt` and `setup.mjs`. The Worker goes first. The merge has no gate.
- **Status:** review (built, reviewed once and red-teamed once, fixed and checked on a maintainer's machine on 2026-11-15; committed on `t-486-setup-listing`, not pushed: the coordinator opens the pull request)
- **Agent/session:** a sub-session of the coordinator, 2026-11-15, branch `t-486-setup-listing`. Phase A wrote this file and the decision and stopped. Phase B built it, with one change from Rafa while it was being built: the request carries the website alone. A fix round followed the reviewer's and the red team's passes.
- **Roadmap row:** N162
- **Change kind:** 4 is the nearest recipe (client code in `examples/` and a Worker route), with 1 (an agent guide in `site/`). Local checks: `pnpm exec vitest run examples/setup apps/test-agents/src/setup.test.ts tests/early-access-listing.test.ts tests/listing-check.test.ts tests/site-guides.test.ts tests/metrics`, `node site/build.mjs && node site/check.mjs`, `pnpm typecheck`, `eslint` on the changed sources.
- **Review:** one `red-teamer` pass and one `reviewer` pass, both done on 2026-11-15; their findings and what changed are in Evidence, "Reviews". The fixes were not reviewed again (one round, `docs/team.md`).
- **Token budget:** 150,000 tokens, a target. The coordinator accepted 180,000 to 220,000 as the likely cost before the build; see Decisions.

## Intent

Restated in my own words.

Rafa wants Crow to know who has set Crow up. So the setup asks each party for one thing: its website. The party's own command sends that website, and nothing else, to a list Crow keeps of who uses it. The step is part of the default path, the person can decline it, and no deal waits for it or reads it. Crow learns the rest later, by reading the site: whether it publishes a Crow card.

This task builds that end to end, on this machine only:

- **One command.** `node ~/.crow/setup.mjs list --website <https URL>` sends the website. `list --skip` records that the person declined and sends nothing. With neither answer the command prints the question as one JSON object and exits 3, as the payout question does.
- **One request.** A POST whose body is `{"website": "<url>"}` and nothing else. A website is a site's own address, so nothing else can ride in it. The command prints what it will send, and to whom, before it sends it, and writes what it sent and the answer's status into `crow.json`.
- **One route.** `POST /listing` on the sign-up Worker stores one entry for each site, the website and the UTC date it first arrived, in the store that holds the email sign-ups. It stores nothing about the caller, fetches nothing, and serves no entry to anyone.
- **One script, for later.** `node scripts/listing-check.mjs <file>` reads each listed site's `agent.json` and says whether it is a valid Crow card. A person runs it; every fetched byte is untrusted, and so is its input file.
- **One count.** The benchmark keeps `setup.requestsBeforeFirstDeal` as it is and counts the run's one listing request in a field of its own.

Inputs: a folder that `seller` made, and the person's answer. Outputs: one entry at the receiver or a recorded skip, and a line in `crow.json`.

Non-goals:

- **A gate.** `first-deal`, the operators, the test agents and the contracts never read the list. A party that skips, or whose listing fails, settles its deals as before.
- **A directory.** The list is private. Nothing publishes it, and nobody finds a party through it (D74's decline stands).
- **A deploy.** No test and no command of this task calls a live host.
- **A check at request time.** The route never fetches. The script is run by hand.
- **Removal.** No command takes a website off the list in this slice.

## Context

- The decision: D76 in `docs/decisions-today.md`, with Rafa's words of 2026-11-15. It amends one line of D73, "Nothing sent before the first deal". Phase A recorded it under the number before this one; another pull request holds that number, so it was renamed (Decisions).
- The setup as built: `docs/tasks/T-472-setup-first-slice.md` and `examples/setup.ts`.
- The design: `docs/research/2026-11-15-setup-design.md`, sections "`setup.txt`", "The setup command", "The privacy table", "Where the signing part runs" and "The measure".
- What an operator learns from a client's IP address: `docs/privacy-baseline.md`, "What each observer learns", the row "Link between two deals of one party".
- The card: `site/ref/intake.txt` ("a reading agent takes the card from `agent.json` beside the page") and `site/card.schema.json`.
- The receiver before this task (measured at `d72490bf`, `apps/early-access/worker.js`):
  - **One route.** `POST /early-access` (line 54), for a browser on an allowed origin (lines 16 and 55).
  - **The store.** Workers KV, binding `EMAILS` (`apps/early-access/wrangler.jsonc`, line 14). One entry for each address: the key is `email:<address in lower case>` and the value is `{"at": "<time>", "page": "<at most 120 characters>"}` (lines 65 to 67). An entry is written once (line 66).
  - **No IP address, no cookie** (line 2). Observability is off (`wrangler.jsonc`, line 15).
  - **No rate limit and no body cap.** An origin allow-list (line 55) and a honeypot field (line 62) are its only fences, and both assume a browser.
- The limits this route copies in kind: the operators' report limits, counted in memory by client (`docs/operations.md`, "Limits").
- The benchmark's count: `tools/one-click/bench-record.mjs` (`setupOf`), `scripts/metrics/schemas/one-click.schema.json` (`Setup`), `docs/tasks/T-473-setup-benchmark.md`.

## What is built

### The website

One rule, applied by the command, the route and the script's input. A website is a site's own address, an origin:

- `https`, and a public name of lower-case letters, digits, dots and hyphens. An internationalised name arrives in its `xn--` form.
- Nothing after the name: no path, query or fragment. No user name, password or port.
- No IP address, no name without a dot, and no name that ends in `.localhost`, `.local`, `.internal` or `.home.arpa`.
- At most 200 characters. It is sent and stored as the URL parser writes it: `https://seller.example/`.

So one site is one entry, and nothing but a host name is sent, stored or later printed. Two copies of the rule exist, in `examples/setup-list.ts` and `apps/early-access/listing.js`; one table in `tests/early-access-listing.test.ts` holds them together.

### The command

| Command | What it does | Requests |
| --- | --- | --- |
| `list --website <https URL>` | Takes the folder's lock, prints one `preview` line, sends one POST, writes the result into `crow.json` and prints one `list` line | 1 POST to the listing address |
| `list --skip` | Writes the skip and its time into `crow.json`. After a listing it keeps the record and says the website was already sent | none |
| `list` | Prints the question as one JSON object and exits 3 | none |
| `seller` | As before. Its line gains `next`: the `list` step and how to skip it | none |
| `first-deal` | As before. With neither a listing nor a skip in `crow.json`, it prints one advisory line on standard error, which says to run `list` after the deal, and goes on. Its marker line and file now carry `startedAtMs` | as before |
| `status` | As before, with `listing`, and `listingFailed` when the last attempt failed | none |

- **The listing address** is a constant in the command, `https://join.crow.direct/listing`, and changes with `--list-at <URL>`, so a test, another keeper of a list, or nobody can receive it. With `--test-world` the flag is required. Without it the address is an https host that is not this machine, in any form an address can take. An address with a user name or a password is refused and not echoed.
- **The lock comes first.** `list` takes `crow.lock` before the preview and the request. When another run holds it, as `first-deal` does for a whole deal, `list` sends nothing and says so at once.
- **The request** carries the one field and `content-type: application/json`, follows no redirect, and waits 15 s at most for the whole answer (2 s in a test world).
- **The answer is another party's text.** The command reads 4,096 bytes of it at most and takes from it only its status and whether it says `ok`. A failure's line and record carry a reason from a fixed list of nine, chosen by the status, and no word of the answer.
- **Exit status.** 0: sent and taken, or the skip recorded. 1: the website was refused, the receiver refused or did not answer, or another run holds the folder; the line says that no deal depends on it. 2: a wrong call. 3: the answer is missing.
- **`crow.json`** gains `listing`: `{website, to, at, status}` for a listing, or `{skipped: true, at}`. A failed attempt goes to `listingFailed`, `{website, to, at, status, reason}`, and counts as neither. Anything else in either place is read as absent.
- **When the record cannot be written** after the receiver took the website, the line says that the website was sent.
- **No key.** `list` opens no file under `keys/`.

### The receiver

`POST /listing` on `crow-early-access`, in `apps/early-access/listing.js`.

- **The stored entry.** KV `EMAILS`, key `listing:<website>`, value `{"website": "https://seller.example/", "receivedOn": "2026-11-15"}`: the website and the UTC date it first arrived, with no time of day.
- **The answer:** 200 with `{"ok": true, "website": "<website>"}`.
- **A repeat** stores nothing new: it puts the stored value back, with its first date. A new website and a known one get the same answer after the same store operations, one read and one write.
- **No `Idempotency-Key`** (decided by Rafa, D76): the website is the key.
- **The body** is JSON of at most 1,024 bytes with exactly one field, `website`. Any other field is a 400. The content type is `application/json`, with or without a charset.
- **Refused, with nothing stored:** a request with an `Origin` header (a browser's; the command sends none), 403; another content type, a body that is not one JSON object, or a website that fails the rule above, 400; a larger body, 413.
- **Limits,** counted in memory as the operators' report limits are, so a restart resets them: 10 requests an hour for each client (an IPv4 address or an IPv6 /64) and 500 a UTC day. Over a limit the answer is 429 with `retryAfterSec`. The client's address is a counter's key in memory for the hour and is never stored. The limits are a brake and no cap: each copy of the Worker counts by itself.
- **Private.** The route fetches nothing and reads nothing back to a caller. `GET /listing` and every method but POST and OPTIONS get 405 with no word on what is stored. `OPTIONS /listing` gets 204 with the sign-up's own CORS headers, as every path of the Worker does. No route of the Worker serves an entry.

### The check, run by a person

`node scripts/listing-check.mjs <file>`: one JSON line for each website, then one line of counts. The file is a read-out of the list: one website on each line, with or without the store's prefix, or the JSON list `wrangler kv key list --prefix listing:` prints.

- **The file is checked first.** The store also holds the sign-up emails. When the file holds any entry that is not a listed website, the script says so on standard error, names how many, tells the person to delete the file, checks none, echoes none and exits 1.
- **What it reads:** `<website>agent.json`, and that address only. A card is valid when it passes the whole of `site/card.schema.json`.
- **What it refuses:** a name with any address that is not public. IPv4 outside loopback, private, link-local, carrier, documentation and reserved ranges; IPv6 only inside `2000::/3`, less Teredo, 6to4 and the documentation range. It resolves the name first and connects to the address it checked.
- **What bounds it:** https only, no redirect followed, 65,536 bytes, and 5 s for the name lookup and the request together.
- **What it prints:** the website, a verdict (`valid`, `broken`, `none`, `unreachable`, `refused`) and a reason from a fixed list. Nothing that came back from a site.
- **Exit status.** 0: read and checked. 1: the file is not a read-out of the list. 2: a wrong call.

### The benchmark

A listing is one request: the first `POST` of the run to the listing's own origin (`LISTING_ORIGIN`, `https://join.crow.direct`; the scripted world names its own in `listingOrigins`), at the path `/listing` exactly, with no address in its query. The probes record method, host, path, status and whether the query holds an address, and no body, so the rule reads none.

- `setup.requestsBeforeFirstDeal` leaves that one request out, so it stays 0 for a run that lists and for a run that skips. Every other request is held to its rule: a `POST` to `/listing` on an operator's host, one whose query holds an address, and a second listing all count as requests that name the party.
- `setup.listingRequestsBeforeFirstDeal` is new: `{total, byHost}`, with a total of 0 or 1, and null in the cases where the other counts are null.
- The record's version stays 3. The field is optional in the schema, so a version 3 record written before this change stays valid.
- **The marker.** The reader of the first-deal marker now takes the JSON line the setup command writes (a finding of this task; see Evidence).

## Acceptance criteria

Each line names the check that shows it; every one is measured on 2026-11-15 (Evidence).

The website (`tests/early-access-listing.test.ts`, the shared table; `examples/setup-list.test.ts`):

- [x] **A website is an origin.** The command's rule and the route's agree on each of 56 rows: 8 taken, 48 refused. The refused rows hold every path the red team's pass got stored, a host with shell or quote characters, an underscore, a hyphen at a label's edge, an empty label, a trailing dot, an IP address in six spellings, a local name, a query, a fragment, a user name, a port, and a name over 200 characters. Each taken row is stored as `https://<host>/`.
- [x] The command refuses, before any request, each of 17 such websites, the folder's own address in a path among them.
- [x] Ten listings for ten paths of one host store nothing; four spellings of one site store one entry.

The command (`examples/setup-list.test.ts`, the committed bundle in its own process):

- [x] `list --website https://seller.example` makes exactly one request: a POST to the listing address whose body is `{"website":"https://seller.example/"}`. The test records the request whole. Its headers are `content-type` and the ones Node's own `fetch` sets; neither they nor the body hold the folder's address, the payout address, a folder path or the word role.
- [x] Before that request the command prints one `preview` line with the address it sends to, the exact body, what the receiver sees beside it (the IP address, the tie to the faucet's keys, the tie by the first offer's time and the payout address), and what an entry means.
- [x] `list` with no answer prints one JSON object with the question, exits 3 and sends nothing. `list --skip` exits 0, sends nothing and records the skip. `--website` with `--skip` exits 2. A listing after a skip replaces it.
- [x] `list --skip` after a listing keeps the record and says that the website was already sent and cannot be taken off the list.
- [x] **The lock comes first.** With `crow.lock` held by a live process, `list --website` and `list --skip` each exit 1 within 10 s, the receiver gets no request, the line says nothing was sent and why, and `crow.json` is unchanged byte for byte.
- [x] When the folder turns read-only between the request and the answer, the line says that the website was sent and that the record could not be written.
- [x] **No word of the answer.** For a 500, a 400 and a 429 whose bodies hold words for an assistant, a terminal escape, a bidi override and a tag character, for a redirect, for no answer, and for a 200 that names another website: the line's keys are fixed, its reason is one of nine, and no word of the answer is in any printed line, in `crow.json`, or in what `status` prints. A redirect gets no second request.
- [x] The command reads 4,096 bytes of the answer at most: a receiver with 400 MB to send writes under 64 MiB before the command stops, within 15 s. An answer that never ends is given up within 12 s in a test world.
- [x] `--list-at` changes the address. `--test-world` without `--list-at` exits 2. Without `--test-world`, an address that is not https, or is this machine in any of nine spellings (IPv4 written inside IPv6 among them), exits 2. An address with a user name or a password exits 2 and is not echoed or saved.
- [x] A `listing` or `listingFailed` in `crow.json` that is null, text, a number, a list, or an object with no text website is read as absent: `status` exits 0 and `list --skip` works, for each of six planted values.
- [x] `list` opens no file under `keys/`: a recorder loaded before the bundle logs every read of such a file, and logs none for `list` and some for `seller`. No printed line and no file outside `keys/` holds the key or the holding key.
- [x] `seller` still makes no request off the machine, and its line names `list` as the next step and how to skip it.
- [x] `first-deal` with neither a listing nor a skip prints exactly one advisory line, which says to run `list` after the deal, and goes on; after a skip it prints none (`apps/test-agents/src/setup.test.ts`).

Neutrality:

- [x] In the test world, `first-deal` ends `Released` in each of three runs: the listing skipped; the listing refused (the keeper of the list answers 500); the keeper unreachable. Each run makes one offer, one delivery and one post to the buyer, and sends the list nothing (`apps/test-agents/src/setup.test.ts`, "neutrality").
- [x] A test reads the sources and finds the route, the store's binding, the store's prefix, the command's module and the script named in no file under `apps/operator`, `apps/demo-cloud`, `apps/test-agents` (its tests aside), `apps/hosted-sellers` or `packages/` (`tests/early-access-listing.test.ts`, "neutrality").

The receiver (`tests/early-access-listing.test.ts`):

- [x] `POST /listing` answers 200 and stores one entry, under `listing:<website>`, whose value is exactly `{"website":"https://seller.example/","receivedOn":"2026-11-15"}`. The whole store holds no IP address, no header's value, no role and no time of day.
- [x] The route fetches nothing: with `fetch` replaced by a function that fails, two listings succeed and the function is never called.
- [x] **The route takes no `Idempotency-Key` and needs none:** the same website posted twice, two days apart and in another spelling, leaves exactly one stored entry with its first date, and both requests get the same status and body. A request that carries the header changes nothing.
- [x] A new website and a known one get the same answer and headers after the same store operations, one read and one write.
- [x] Each refusal stores nothing: an `Origin` header (403); another content type, four neighbours of `application/json` among them, a torn body, a JSON list, `null` (400); a body over 1,024 bytes (413); a second field of any name, `role` among them (400); a missing website (400); a website that is no text (400).
- [x] The eleventh request of one client within an hour answers 429 with `retryAfterSec` and stores nothing; so does request 501 of a UTC day **on one copy of the Worker**. A refused body is not counted. An IPv4 address written inside an IPv6 one counts as that IPv4 client.
- [x] **The list is private.** After a listing, no `GET`, `HEAD`, `OPTIONS`, `DELETE` or `PUT` on any of 14 paths of the Worker returns the website in its body or headers; only `/version.json` answers 200 to a read; and a read that names a listed website gets the same answer as one that names an unknown one.
- [x] The email sign-up is unchanged: `tests/early-access-headers.test.ts` passes with no edit, and the new route's answers carry the security headers.

The check script (`tests/listing-check.test.ts`, stand-in servers on this machine only):

- [x] A site with a valid card, a broken card and none each give one line: the website, the verdict and a fixed reason. It reads `/agent.json` and no other address.
- [x] It holds a card to the whole schema: a card with no `offers`, and one of another type, are broken. A buyer's card is valid.
- [x] Text that is not JSON, a body over 65,536 bytes and JSON nested 20,000 deep are broken; a 500 and a redirect are none, and the redirect is not followed; a site that does not answer in time, and a refused connection, are unreachable.
- [x] **One time limit.** A name whose lookup takes 12 s costs the limit and no more, and what the lookup spent, the request does not get again.
- [x] **Addresses.** Of 43 addresses, 4 are public and 39 are refused: IPv4 in loopback, private, link-local, carrier, documentation and reserved ranges; every IPv4 address written inside an IPv6 one (mapped, compatible, translated, 6to4, Teredo); IPv6 loopback, link-local with and without a zone, site-local, unique local, multicast and the documentation range; and text that is no address. An address that is no text is refused and does not throw.
- [x] It resolves first and refuses, before any request, a name with a non-public address, one such address among public ones included, and an answer it cannot read.
- [x] It prints nothing that came back from a site: over 12 stand-in sites, each line has the three keys, a reason from the fixed list, and none of nine strings the sites served.
- [x] **Input that is not a listing.** For the whole store read out with no prefix, for lines with an email among them, for a line that is no website and for a mistyped prefix: exit 1, nothing on standard output, a stop on standard error that names how many entries are not listed websites and says to delete the file, no entry echoed, and no lookup or connection made.
- [x] 72,533 distinct lines are read in under 3 s.
- [x] Over TLS, with a certificate made at run time: it reads a valid card over https from the checked address, and refuses a certificate that is not the site's and one that no root signed.

The page (`node site/check.mjs`, `examples/setup-bundle.test.ts`, `tests/site-guides.test.ts`):

- [x] `site/setup.txt` has the section "The list": what is sent, to whom and why; that a website is a site's own address and nothing after it; how to skip; what to do when `list` exits 1, and that too many requests may be another caller's doing; what an entry means, in the command's own four sentences; what the person gives up, the tie by the first offer's time and the payout address included; that the list is not published and that this version cannot take a website off it.
- [x] "Read the lines" names the three kinds of line on standard error: the marker, the adapter's log and the advisory on the list.
- [x] The three statements stay true and `site/check.mjs` holds their phrases: "Before the marker, this version sends nothing to a Crow-run host" names its one exception; "This version registers nothing at Crow" names the same exception; "**No account.**" says the one thing the setup asks for.
- [x] `SETUP_MAX_BYTES` is 10,000, the published page is under it, `node site/build.mjs` leaves the tree clean and `node site/check.mjs` passes.

The benchmark (`tests/metrics/one-click-setup.test.ts`):

- [x] A run that lists before the marker has `requestsBeforeFirstDeal.total` 0 and `listingRequestsBeforeFirstDeal` with total 1 under the listing host. A run that skips has 0 and 0. A faucet post before the marker still counts 1 in the first field. A run with no marker has null in both.
- [x] **The listing's own origin.** A `POST` to `/listing` on an operator's host, or on crow.direct, counts as a request that names the party. The scripted world's own receiver counts as the listing when the harness names it.
- [x] **No address in the query.** A `POST` to `/listing` whose query holds an address counts as a request that names the party, and does not use up the run's one listing.
- [x] **The first such request.** A second and a third listing count as requests that name the party. The red team's seven requests count 7 and 0.
- [x] The schema takes a version 3 record with the new field and one without it, and refuses six records whose listing count contradicts the others.
- [x] **The marker.** The benchmark's reader finds the first deal's start in the real command's output: its marker line on standard error and its marker file give one time, inside the run (`apps/test-agents/src/setup.test.ts`, first test).

The records and the frozen files:

- [x] D76 is the last entry of `docs/decisions-today.md`, with Rafa's words and where each came from, and the design record has one dated line that points to it. No file this branch changes holds the number Phase A gave it, the one before D76.
- [x] `site/try.mjs` and `site/buy.mjs` keep their SHA-256, measured before the first change and after the last, and the diff over the frozen paths is empty.
- [x] `gitleaks` finds nothing in the branch's commits.
- [x] One `red-teamer` pass and one `reviewer` pass; their findings and what changed are in Evidence, "Reviews".

## Out of scope

- **The deploys.** The Worker's and the site's are Rafa's to run. Until the Worker has the route, a published `list` gets a 404, exits 1 with the reason that the list may not be deployed there yet, and no deal changes.
- **Removal from the list.** A route that removes an entry needs to know who may ask. `leave` (T-476) says today that nothing was registered at Crow; that task takes the removal, and until then Crow removes an entry by hand.
- **A cap on the list's growth.** The limits are a brake for each copy of the Worker. A cap needs a counter outside the Worker's memory, which is a change on the Cloudflare account.
- **A store of the list's own.** The entries share the sign-ups' store and its write quota.
- **The buyer's side of the command.** T-475 makes a buyer's folder. `list` needs a folder the setup made and sends no role, so it then works with no change here.
- **The trust page and the "What is live" row of `docs/operations.md`.** Both state what the live sign-up Worker stores. Each gets its line with the Worker's deploy.
- **The summary of benchmark records.** `scripts/metrics/one-click-summary.mjs` keeps reading `requestsBeforeFirstDeal` only.
- **A schedule for the check.** The script is run by hand. Nothing stores its verdicts.

## Evidence

Measured on 2026-11-15 in the worktree, after the fix round, unless a line says otherwise. No command or test reached a live host: the command's tests run under a recorder that refuses a connection that leaves the machine, the route's store is a `Map`, the script's tests answer for every name with stand-in servers on the loopback address, and the script's command-line tests load a guard that refuses every lookup and connection.

- **Commands run and results** (measured):
  - `pnpm exec vitest run examples/setup apps/test-agents/src/setup.test.ts tests/early-access-listing.test.ts tests/listing-check.test.ts tests/site-guides.test.ts tests/metrics`, with `tests/early-access-headers.test.ts`, `tests/early-access-deploy.test.ts` and seven doc and record tests (`tests/decisions-status.test.ts`, `design-map`, `id-check`, `secrets-refs`, `cut-feature-alignment`, `record-copies`, `card-schema`): 709 tests passed, 17 skipped, in 27 files, about 40 s. The whole suite and `pnpm verify` were not run.
  - `node site/build.mjs`: no file changed after it, so the committed bundle is the build's output. `node site/check.mjs`: pass.
  - `pnpm typecheck`: pass. `pnpm exec eslint` over the 18 changed sources: 0 problems.
  - `gitleaks git <worktree> --log-opts=origin/main..HEAD --redact`: no leaks, after each commit.
- **The pinned files** (measured, `shasum -a 256`, before the first change and after the last): `site/try.mjs` is `04ef4434fb4b5635bb3c49df69c7547f3200c6c41f903237ee37098be23f75c8` and `site/buy.mjs` is `e74ff2230f0d4fd426525095731e42d50b65b55ab7792a43cab73c302b22eb88`, both unchanged. `git diff --stat origin/main --` over `apps/hosted-sellers`, `packages`, `apps/operator`, `apps/demo-cloud`, `spec/schemas`, the seven frozen files in `examples/`, the five other generated bundles and the tier 3 paths prints nothing.
- **The new bundle** (measured): `site/setup.mjs` is 2,351,625 bytes, SHA-256 `1d7e546c022af7b232705bf74d4d5fbc6616b1b761a181250dbfeddb4d10069d`, after the fix for the CI race below. Before that fix: 2,350,394 bytes, `2edbfc46…2adcd`. Before this task: SHA-256 `5c98ef522ad1e5146a3d767cebedc1d8f7b705bab573ce1d79081d9c7d7ce5ab`, which the live `setup.txt` names since the site deploy of 2026-11-15, 11:24 UTC at commit `d72490b` (the coordinator's fact). Before the fix round: `d10808fc…95f8`. Inferred until CI shows it: CI builds the same bytes.
- **The page** (measured): the published `setup.txt` is 9,884 bytes of 10,000.
- **Test first, in the fix round** (measured, each run before its fix):
  - The command: 9 of 10 tests failed against the bundle of the first build, each on the attack it holds; 10 of 10 passed after the rebuild.
  - The route: 23 of 75 failed; 84 of 84 passed after, the sign-up's own tests included. The two late tests (the content type, the client key) failed 2 of 2, then passed.
  - The benchmark: the two new tests that ran under the run's filter failed; the third, "the first such request", was first run after the fix.
  - The script: 27 of 67 failed; 67 of 67 passed after.
- **Test first, in the first build** (measured): the command's five tests failed against the old bundle (5 of 5). The route's first tests were written before its code; after Rafa's change the route and its tests were rewritten together. The script's code was written before its tests.
- **The script's lines** (measured, `tests/listing-check.test.ts`, a stand-in server on the loopback address):
  - a valid card: `{"website":"https://valid.example/","card":"valid","reason":"a seller's card (crow-agent) that passes site/card.schema.json"}`
  - a broken card: `{"website":"https://broken.example/","card":"broken","reason":"agent.json is JSON and does not pass site/card.schema.json"}`
  - no card: `{"website":"https://none.example/","card":"none","reason":"agent.json did not answer 200"}`
- **A slow receiver** (measured in a test world, read for the live service): a test world waits 2 s for the receiver, as it shortens its other waits, and the test gives up on an answer that never ends within that. The live service's 15 s is the same line of code with another number; it is read, not run.
- **Not measured:** the script against a real site, and the route on Cloudflare. Both wait for the deploy; the first real run of each is Rafa's.

### A finding of this task: the benchmark could not read the setup's marker

**Medium · Since T-472 merged, the benchmark's reader found no first-deal marker in a real run of the setup command, so a setup record would have read `markerSeen: false` and null counts.** Fixed here, with a test that fails if the two drift apart again.

- **What was wrong.** T-473 fixed the marker as the plain line `crow-setup: first-deal started <ms>`, on standard error and in `first-deal.started`. T-472 built the command with JSON lines only: a `marker` line with no time, and a marker file with `startedAt`, `operators` and `buyer`.
- **Measured before any change** (`reports/scratch/t-486/marker-before.mjs`, on the output of a real `first-deal` of the bundle `5c98ef52…ce5ab` in the test world): the reader returned null for the marker file (keys `startedAt`, `operators`, `buyer`) and null for the marker line.
- **What changed, and why this side.** The command's marker line and file gain `startedAtMs`, and the reader takes a JSON line whose `step` is `marker` and whose `startedAtMs` is a whole, positive number. The command kept its form: `setup.txt` promises one JSON object on each line, and its tests parse every line of standard error. The reader still takes the plain line, which the stand-in for the setup command prints (`tests/metrics/fixtures/setup-rehearsal.ts`).
- **The test that holds them together.** The first test of `apps/test-agents/src/setup.test.ts` runs the real command and feeds its standard error and its marker file to `firstDealAtOf`: both give one time, inside the run. It failed with the new command and the old reader (measured: null), and passes now.

### Two CI faults, fixed in this pull request (2026-11-15, measured)

- **The secrets check failed when another run removed a file it had listed.** Found by CI on pull request 589, in T-472's test "eight runs at once": one run's check listed the folder, another run removed its `crow.lock`, and the read of that file threw. The cause is in `examples/setup-check.ts`, shipped in `site/setup.mjs` since T-472: the check listed the files, then read each with no case for a file gone in between. Now `scanFiles` passes over a file that is gone when its size or its content is read, counts it, and names the count in its line. Any other error still fails the check, and a key in any file outside `keys/` still fails it.
  - **`crow.lock` stays in the scan, by decision.** Leaving one file name out would make a place where a key could sit unseen; a file that vanishes is handled by the rule above, whatever its name.
  - **The test makes the file vanish by a seam, not by a race:** `examples/setup-check.test.ts` passes `scanFiles` a file-system stand-in that says one file is gone before its size is read, or between its size and its content. With the new catch taken out for one run, 3 of its 5 tests failed with the error CI saw; with it, all 5 pass.
  - **This task's earlier reading in Handoff was a guess, and the CI log shows another cause:** the missing file. The helper's 20 s limit against the lock's 30 s wait stays possible under heavy load (read, not run), and is in Handoff.
- **`tests/ci-gated.test.ts` failed this pull request's own test shard 1.** Two new files hold a gated case: `examples/setup-list.test.ts` (one case needs a folder its user cannot write, so not root and not Windows) and `tests/listing-check.test.ts` (one case makes a certificate with `openssl`). Both gates hold on the CI runners, so both are listed in that test's exemptions with their reasons, as `packages/core/src/store/store.test.ts` is.

### Reviews (2026-11-15)

Both passes ran the code at `d19b402b`. The coordinator relayed their findings in one list; the probes are in `reports/scratch/t-486-review/` and `reports/scratch/t-486-redteam/` in the main checkout. A finding is listed under the pass whose probe shows it, or whose name the coordinator gave; the third table holds what was relayed with neither. Each fix has a test that failed before it. The fixes are commits `d2f63031` (the command), `7cda840c` and `a0ead42b` (the route), `77a455b9` (the benchmark), `4768a72c` (the script) and `75f2eb68` (the page).

**The reviewer's pass: ISSUES, 1 Medium and 5 Low** (the coordinator's count; `probe.mjs` shows the first two rows).

| Finding | Severity | What changed |
| --- | --- | --- |
| `list` sent before it took the folder's lock: under a lock, the receiver got the POST, `list` exited 1 after 30 s and `crow.json` recorded nothing (measured by both passes) | Medium | `list` takes the lock before the preview and the request, and exits at once when it is held, with a line that says nothing was sent. A record that cannot be written after the receiver took the website gives a line that says it was sent. The advisory line says to run `list` after the deal |
| `list --skip` after a listing erased the record | Low | The record stays; the line says the website was already sent and cannot be taken off the list |
| Rafa's first two quotes in the decision had no source the reviewer could find; the third matched the private log | Low | D76 says of each of the first two: relayed by the coordinator, 2026-11-15. The words are unchanged |
| The deploy record's line: its rollback target is not the last site version on record, and it carries no measurement after the deploy | Low | Not changed: the line is the coordinator's. Recorded in Handoff as waiting for the coordinator |
| The T-472 test "eight runs at once" failed 1 run in 6 under load | Low | Its cause, a file removed between the secrets check's listing and its read, found later by CI on pull request 589 and fixed here, with a test by a seam ("Two CI faults", above) |

**The red team's pass: one claim broken (the benchmark's count), seven rated weak.** Its scripts were run again after the fixes; what each prints now is below the tables.

| Finding (the script) | Severity | What changed |
| --- | --- | --- |
| The benchmark's rule hid naming requests: a `POST /listing` to an operator's host, and one with an address in its query, left `requestsBeforeFirstDeal` at 0 (`h-bench.mjs`). **Broken** | Medium | A listing is the first POST of the run to the listing's own origin, at `/listing`, with no address in its query. Every other request is held to the existing rule |
| The website rule let a path and odd host characters through: a path carried the folder's address to the receiver; the route stored hosts and paths with shell and instruction text; one host got 30 entries (`a-command.mjs`, `d-route.mjs`) | Medium | A website is an origin, in the command, the route and the script's input: one rule, one table |
| The receiver's words reached the terminal, were saved, and `status` reprinted them; a 400 MB answer was read whole (`a-command.mjs`) | Medium | A fixed reason by the status; no text of the answer printed or stored; 4,096 bytes read at most |
| `setup.txt` understated what Crow can link; the entry kept the time to the millisecond | Medium | The entry keeps the UTC date. `setup.txt`, the preview and D76 say that Crow could tie the website to the folder's deals by the first offer's time and through the payout address |
| A repeat read, and a first request read and wrote: a prober could tell whether a site was listed (`d-route.mjs`) | Low | A repeat puts the stored value back; both do one read and one write |
| The script: the 5 s bound left the name lookup out (12 s measured); the address check passed IPv4 written inside IPv6, 6to4, Teredo and site-local forms; 72,533 lines took 40 s; a key of another prefix was passed over with no warning (`e-script.mjs`) | Low | One time limit for the lookup and the request; IPv6 only inside `2000::/3`, less three ranges; a set; a file that holds anything but listed websites is refused whole, loudly, with exit 1 |
| The command: a planted `"listing": null` made `status` exit 1; `--list-at https://[::ffff:127.0.0.1]` passed as "not this machine"; a user name and password in `--list-at` were saved and printed (`a-command.mjs`) | Low | A record that is not one is read as absent; this machine is known in its IPv6 spellings; credentials in `--list-at` are refused and not echoed |
| The route took `application/json-patch+json`, and counted every IPv4 address written inside IPv6 as one client (`d-route.mjs`, in its output; not in the coordinator's list) | Low | `application/json` only, with or without a charset; such an address counts as its IPv4 client |

**Relayed by the coordinator with no pass named.**

| Finding | Severity | What changed |
| --- | --- | --- |
| `setup.txt` named two kinds of line on standard error where there are three, did not say what to do when `list` exits 1, and did not say that too many requests may be another caller's doing | Low | The page says each, within its byte limit |
| This file said any method but POST gets 405; `OPTIONS /listing` gets 204 with the sign-up's own headers (measured) | Low | The sentence is corrected. No behaviour changed |
| The day cap's criterion read as a cap in all | Low | The criterion says it bounds one copy of the Worker |
| A slow receiver had no test | Low | A test world waits 2 s, and a test gives up on an answer that never ends |

**What the red team's scripts print now** (measured, on the loopback address only).

- `a-command.mjs`: cases 1 to 7 print the defended result. The plain listing sends `{"website":"https://seller.example/"}` and no folder address, key or path. The hostile 400 prints "Nothing was listed: the receiver refused the request…", and `listingFailed.detail` reads undefined, because the field is now `reason`. The path with the folder's address and the instruction path each exit 1 with no request. Under a held lock: exit 1 after 88 ms, 0 requests, nothing recorded. Each planted record: `status`, `check`, `first-deal --preview` and `list --skip` exit 0. The 400 MB answer: exit 1 after 97 ms, 2,097,152 bytes written by the receiver. The endless answer: exit 1 after 2,095 ms. **The script then stops at its case 8 with a `TypeError` of its own:** it reads a JSON line from standard output, and a wrong call now prints none there. The scratch file was not edited. Run by hand under the same guard, case 8 (a user name and password in `--list-at`) and case 9 (`https://[::ffff:127.0.0.1]`) each exit 2 with nothing sent.
- `b-keys.mjs`, with `keys/` at mode 000: `list --skip` exits 0, `list` exits 3, `status` exits 0; `check` exits 1, since it needs the key.
- `d-route.mjs`: every path and odd host is refused; one host from one client stores 0 entries by paths; a new website and a known one each do `get+put` with equal headers; the stored value is `{"website":"https://known.example/","receivedOn":"2026-11-15"}`. Still as before, and recorded below: three copies of the Worker store 1,500 entries in a day, and one caller with 50 /64s spends a copy's day, after which an honest listing gets 429. It ran before the two late fixes; `tests/early-access-listing.test.ts` holds those.
- `h-bench.mjs`: the POST to an operator's `/listing` counts 1 and 0; the one with an address in its query counts 1 and 0; the seven count 7 and 0; a lower-case method is the listing; the near misses count 3.
- `e-script.mjs`, under its guard: all 31 addresses read false; the slow lookup takes 5,002 ms; no unreadable answer throws; no request is made for a path; the hostile file returns `{"notAList":{"entries":5,"notWebsites":5}}` and prints no entry; 72,533 lines are read in 84 ms.

**Not fixed, and why.**

- **The limits are a brake and no cap.** They are counted for each copy of the Worker, and one caller with many addresses can spend a copy's day for everyone. A cap needs a counter outside the Worker's memory, which is a change on the Cloudflare account.
- **Listings share the sign-ups' store and its write quota,** so a flood of listings could make sign-ups fail (inferred). A store of its own is a change on the account, at deploy.
- **The script shows each listed site the maintainer's IP address and the time of the run** (inferred). The script's header and `docs/operations.md` say so.
- **The script checks one website after another:** 5,000 websites at 5 s each take up to about 7 hours in the worst case (the red team's arithmetic). The list is far from that size; running several at once is a follow-up.
- **Removal from the list,** and the whole schema check at request time: Out of scope and Handoff.
- **A forged marker line.** The reader takes the earliest marker in any text it is given, so a line with an early time beside the real one wins (`h-bench.mjs`). The harness drops a time outside the run, as T-473 built it; a forged time inside the run is not told apart. Not in the coordinator's list; for triage.
- **The fixes were not reviewed again** (one round, `docs/team.md`).

## Decisions

Choices made inside this task. Escalate anything that changes architecture, a contract or a defense to an ADR.

**Rafa's change during the build (2026-11-15).** "we can remove that -- only need the website and this registry should be recorded in maybe a worker / or the private repo, since then we can just check if they have public crow protocol connection (e.g. broadcast in some way)". So the request carries the website alone, the route fetches nothing and stores no mark, and the check is a script a person runs later. Phase A's role field, its `verified` mark and its card fetch inside the route were built first and removed before any commit, so no commit of this branch holds that code. The branch's first two commits hold Phase A's draft of this file and of the decision, which describe it; later commits replace both.

**The decision is D76.** Phase A recorded it under the number before that. Another session's pull request, open on 2026-11-15, holds that number for another decision (the coordinator's measure). The fix round renamed 27 mentions in the files this branch changes, and a search for the old number over them finds none; this file names it only as "the number before D76" so that the search stays empty. The coordinator places the two entries in order when it merges `origin/main`.

**The route takes no `Idempotency-Key`: decided by Rafa on 2026-11-15** (D76; relayed by the coordinator). The hard rule names the protocol's API, which the operators serve; this route is on the sign-up Worker and is idempotent by its own key, the website. The test: `tests/early-access-listing.test.ts`, "takes no Idempotency-Key and needs none…".

**Choices that stand from the build.**

- **The receiver refuses a request with an `Origin` header.** The command sends none. Without the rule, any web page could have its visitors' browsers post listings from their own IP addresses, past the limit for each client.
- **The route has limits of its own.** The Worker had none to copy (Context). The route copies the operators' report limits in kind, in a few lines of its own: importing `apps/demo-cloud/src/limits.ts` would bring the operator's packages into the sign-up Worker.
- **The record's version stays 3.** The new field is optional in the schema. A reader that refuses unknown fields would refuse a new record; Crow Control's reader is in the private repository and is not measured here.
- **One store.** The entries go into the KV namespace of the email sign-ups, under their own prefix. It reuses what runs; a namespace of its own would be a change on the Cloudflare account.
- **A failed attempt is neither a listing nor a skip.** `first-deal` keeps its advisory line until the person lists or skips.
- **The advisory line goes to standard error,** beside the marker. `setup.txt` says that every line on standard output but `preview` and `status` carries `ok`.
- **`SETUP_MAX_BYTES` rises from 8,000 to 10,000.** The page stood at 7,978 bytes and stands at 9,884. It stays one fetch, about 2,500 tokens estimated as bytes divided by four. The later tasks move detail for each role into reference files.
- **The script refuses a name when any of its addresses is non-public,** and connects to the first address it checked, with the name kept for TLS and the `Host` header. A second answer from DNS cannot move the request.
- **The script's TLS test makes its certificate at run time** with `openssl`, and is skipped where there is none. No key or certificate is committed.
- **The marker: the reader moved, and the command gained one field** (Evidence, the finding).
- **The neutrality runs use a test buyer of their own,** with the real code. The file's first test buyer had taken its posts for the minute from this address (its rule `limits.perClientPerMinute`), which says nothing about the list.

**The fix round's choices (2026-11-15).**

- **A website is an origin.** The coordinator set the rule; the label test (no hyphen at a label's edge, no empty label) is this task's reading of "a host of lower-case letters, digits, dots and hyphens".
- **`list` does not wait for the lock.** It exits at once. A run that waited could not tell the person when the deal would end, and the step is never urgent.
- **Nine fixed reasons, by the status.** 404 and 405 read as "no listing route at that address", which is what a published `list` meets before the Worker is deployed. 429 names another caller's doing.
- **A test world waits 2 s for the receiver.** It is the one way to test a slow receiver without a flag or a variable that a person could misuse; a test world already shortens its other waits.
- **The entry's field is `receivedOn`,** a date, where it was `receivedAt`, a time. Nothing was deployed, so no stored entry has the old shape.
- **A repeat writes.** It costs one store write for each accepted request, which the limits bound; in exchange a first request and a repeat cannot be told apart by their time.
- **The script refuses the whole file,** where it passed such entries over. A line that is no website is refused the same way as a key of another prefix: the route stores only websites that pass the rule, so a clean read-out holds nothing else.
- **The benchmark's listing origin is a constant with an override,** as the Crow-run hosts are: `LISTING_ORIGIN`, and `listingOrigins` for the scripted world.
- **Two fixes beyond the coordinator's list,** each a line with a test, from the red team's own output: the content type, and the client key for an IPv4 address written inside IPv6.
- **The token budget.** 150,000 tokens was the target. Before the build I estimated 180,000 to 220,000, and the coordinator accepted it. The change of design during the build, the script, the marker finding and the fix round add to that; this session does not measure its own use, and the coordinator's token tracking reads it from the transcript.

**What a caller of the route can still do.** Anyone can add any site: an entry proves nothing about who sent it, and `setup.txt`, the preview and D76 say so. The limits bound the count for each copy of the Worker, in memory.

## Handoff

**Built, reviewed, fixed and committed on `t-486-setup-listing`; not pushed, not deployed. Open: the coordinator's pull request and merge, then Rafa's two deploys.**

- **To resume:** `pnpm install --frozen-lockfile` and `pnpm build` in the worktree, then the local checks in the header. After any change to `examples/setup*.ts`, run `node site/build.mjs` and commit `site/setup.mjs`: its SHA-256 is in the command `setup.txt` publishes.
- **The Worker's deploy is Rafa's to run.** After the merge, from the main checkout at `origin/main`'s tip with no changed tracked file, in `/Users/rafa/Documents/escrow`:

  ```
  node apps/early-access/deploy.mjs
  ```

  - **What it publishes:** the Worker `crow-early-access` at join.crow.direct with the new `POST /listing`, and nothing else new. It reads the live version first as the rollback target, uploads, waits up to 120 s for `https://join.crow.direct/version.json` to name the commit, rolls back by itself when that fails, and prints the record line for `docs/operations.md`.
  - **How to check it after,** with two reads: `curl -s https://join.crow.direct/version.json` names the merged commit, as before; and `curl -s -i https://join.crow.direct/listing` answers `405` with `allow: POST` and the body `{"error":"send a POST"}`, where it answered 404 before the deploy. Neither answer holds an entry.
  - **Then the site deploy** (`pnpm site:deploy`), which publishes the new `setup.txt` and `setup.mjs`. In the other order, a published `list` would post to a route that answers 404.
- **Reading the list, for a person with the Cloudflare login.** Not run by this task. From the repository root:

  ```
  npx wrangler@4 kv key list --binding EMAILS --config apps/early-access/wrangler.jsonc --remote --prefix listing: > reports/listing-keys.json
  node scripts/listing-check.mjs reports/listing-keys.json
  ```

  - **Type the prefix exactly, `listing:`.** The same store holds the sign-up emails under `email:`. A read-out with no prefix, or a mistyped one, writes people's email addresses into the file. The script then refuses the file whole: it says on standard error how many entries are not listed websites, checks none, echoes none and exits 1. Delete the file and read the list out again.
  - `reports/` is ignored by git; the list is private and stays out of the repository.
  - A run shows each listed site this machine's IP address and the time of the run.
  - The first command is documented by Wrangler and not run here; the script takes its output as it is. `docs/operations.md` carries both lines and the same warning beside the Worker's deploy command.
- **Waiting for the coordinator: the deploy record of 2026-11-15, 11:24 UTC.** The reviewer observed two things about the line this branch added by the coordinator's word, and the line is unchanged: its rollback target is not the last site version on record, and it carries no measurement after the deploy.
- **With the Worker's deploy, three lines owed elsewhere,** each the coordinator's: the "What is live" row for join.crow.direct in `docs/operations.md` (the store then holds websites too); the trust page's answer on what the sign-up Worker stores (`site/trust.mjs`); and `docs/team.md`'s row "A published script is the code CI ran", which T-472 already found does not name `site/setup.mjs`.
- **The T-472 test "eight runs at once"** (`examples/setup-bundle.test.ts`): its failure on CI was the secrets check reading a file another run had removed, fixed in this pull request ("Two CI faults", in Evidence). **One more cause stays possible, for triage:** the test's helper kills each child after 20 s, `seller` waits up to 30 s for the folder's lock, and the eight runs take the lock one after another; on a very slow machine the last can pass 20 s and be killed (read, not run).
- **Follow-ups, none started:**
  - **Removal from the list,** with `leave` (T-476): who may ask, and how the party proves it. A card on the site is the natural proof.
  - **A cap and a store of the list's own,** both changes on the Cloudflare account.
  - **The whole card schema at request time** is no longer wanted: the check moved to the script, which holds a card to the whole schema. If a check inside a Worker is wanted later, it needs a validator built ahead of time, as the operators' are (`packages/core/src/validators-codegen.ts`).
  - **Where the script's verdicts go,** and checking several sites at once.
  - **The summary of benchmark records** does not report the listing count yet.
- **Open for Rafa** (D76): the check's rule, whether the step is part of the default path, and where the entries live.
