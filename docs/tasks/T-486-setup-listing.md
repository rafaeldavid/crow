# T-486: The setup's listing step, a party sends Crow its website

- **Lane:** demo (agent access: the guides in `site/` and the reference tools in `examples/`), with one route on the sign-up Worker (`apps/early-access/`) and one script in `scripts/`
- **Phase:** 2
- **Depends on:** T-472 (the setup command and `setup.txt`, merged at `d72490bf`)
- **Paths this task may touch:**
  - The command: `examples/setup.ts`, `examples/setup-seller.ts` (the state's type, the `seller` line), `examples/setup-list.ts` (new), `examples/setup-list.test.ts` (new), `examples/setup-bundle.test.ts`, `apps/test-agents/src/setup.test.ts`.
  - The page and the bundle: `site/setup.txt`, `site/setup.mjs` (generated), `site/guides.mjs`, `site/check.mjs`, `site/build.mjs` (the bundle's banner line only), `tests/site-guides.test.ts`.
  - The receiver: `apps/early-access/worker.js`, `apps/early-access/listing.js` (new), `tests/early-access-listing.test.ts` (new).
  - The check, run by a person: `scripts/listing-check.mjs` (new), `tests/listing-check.test.ts` (new).
  - The benchmark: `tools/one-click/bench-record.mjs`, `tools/one-click/README.md`, `scripts/metrics/schemas/one-click.schema.json`, `tests/metrics/one-click-setup.test.ts`, `tests/metrics/one-click-bench.test.ts` (one expectation).
  - The records: `docs/decisions-today.md` (D75), one dated line in `docs/research/2026-11-15-setup-design.md`, the sign-up Worker's commands in `docs/operations.md`, this file.
  - It changes nothing under `apps/hosted-sellers/`, `apps/operator`, `apps/demo-cloud`, `packages/` or `spec/schemas/`, none of the frozen files in `examples/` that T-472 lists, and no generated bundle but `site/setup.mjs`.
- **Paths outside this task, and why** (the coordinator's word of 2026-11-15, each in a commit of its own):
  - `docs/operations.md`, "Deploy record": the entry for the site deploy of 2026-11-15, 11:24 UTC, which Rafa ran and which had no record line.
  - `docs/tasks/T-469-one-command-per-goal.md`: its status line, set to done. Pull request 578 merged on 2026-11-15 and the file still said review.
- **Human gate:** yes, for two steps, both Rafa's to run: the deploy of the Worker `crow-early-access` with the new route, then the site deploy that publishes the new `setup.txt` and `setup.mjs`. The Worker goes first. The merge has no gate.
- **Status:** review (built and checked on a maintainer's machine on 2026-11-15; committed on `t-486-setup-listing`, not pushed: the coordinator opens the pull request and orders the reviews)
- **Agent/session:** a sub-session of the coordinator, 2026-11-15, branch `t-486-setup-listing`. Phase A wrote this file and D75 and stopped. Phase B built it, with one change from Rafa while it was being built: the request carries the website alone.
- **Roadmap row:** N162
- **Change kind:** 4 is the nearest recipe (client code in `examples/` and a Worker route), with 1 (an agent guide in `site/`). Local checks: `pnpm exec vitest run examples/setup apps/test-agents/src/setup.test.ts tests/early-access tests/listing-check.test.ts tests/site-guides.test.ts tests/metrics`, `node site/build.mjs && node site/check.mjs`, `pnpm typecheck`, `eslint` on the changed sources.
- **Review:** one `red-teamer` pass (the change sends a party's data to Crow, adds a route anyone can post to, and adds a script that fetches addresses a stranger named) and one `reviewer` pass. Blocking findings only.
- **Token budget:** 150,000 tokens, a target. The coordinator accepted 180,000 to 220,000 as the likely cost before the build; see Decisions.

## Intent

Restated in my own words.

Rafa wants Crow to know who has set Crow up. So the setup asks each party for one thing: its website. The party's own command sends that website, and nothing else, to a list Crow keeps of who uses it. The step is part of the default path, the person can decline it, and no deal waits for it or reads it. Crow learns the rest later, by reading the site: whether it publishes a Crow card.

This task builds that end to end, on this machine only:

- **One command.** `node ~/.crow/setup.mjs list --website <https URL>` sends the website. `list --skip` records that the person declined and sends nothing. With neither answer the command prints the question as one JSON object and exits 3, as the payout question does.
- **One request.** A POST whose body is `{"website": "<url>"}` and nothing else. The command prints what it will send, and to whom, before it sends it, and writes what it sent and the answer's status into `crow.json`.
- **One route.** `POST /listing` on the sign-up Worker stores one entry for each website, the website and the time it first arrived, in the store that holds the email sign-ups. It stores nothing about the caller, fetches nothing, and serves no entry to anyone.
- **One script, for later.** `node scripts/listing-check.mjs <file>` reads each listed site's `agent.json` and says whether it is a valid Crow card. A person runs it; every fetched byte is untrusted.
- **One count.** The benchmark keeps `setup.requestsBeforeFirstDeal` as it is and counts listing requests in a field of their own.

Inputs: a folder that `seller` made, and the person's answer. Outputs: one entry at the receiver or a recorded skip, and a line in `crow.json`.

Non-goals:

- **A gate.** `first-deal`, the operators, the test agents and the contracts never read the list. A party that skips, or whose listing fails, settles its deals as before.
- **A directory.** The list is private. Nothing publishes it, and nobody finds a party through it (D74's decline stands).
- **A deploy.** No test and no command of this task calls a live host.
- **A check at request time.** The route never fetches. The script is run by hand.
- **Removal.** No command takes a website off the list in this slice.

## Context

- The decision: D75 in `docs/decisions-today.md`, with Rafa's three sentences of 2026-11-15. It amends one line of D73, "Nothing sent before the first deal".
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

### The command

| Command | What it does | Requests |
| --- | --- | --- |
| `list --website <https URL>` | Prints one `preview` line, sends one POST, writes the result into `crow.json` and prints one `list` line | 1 POST to the listing address |
| `list --skip` | Writes the skip and its time into `crow.json` | none |
| `list` | Prints the question as one JSON object and exits 3 | none |
| `seller` | As before. Its line gains `next`: the `list` step and how to skip it | none |
| `first-deal` | As before. With neither a listing nor a skip in `crow.json`, it prints one advisory line on standard error and goes on. Its marker line and file now carry `startedAtMs` | as before |
| `status` | As before, with `listing`, and `listingFailed` when the last attempt failed | none |

- **The listing address** is a constant in the command, `https://join.crow.direct/listing`, and changes with `--list-at <URL>`, so a test, another keeper of a list, or nobody can receive it. With `--test-world` the flag is required. Without it the address is an https host that is not this machine.
- **The website** is an `https` address of a public name, at most 200 characters as the URL parser writes it, with no user name, password, query, fragment or port. The command refuses any other before it sends anything, and sends the website as the parser writes it. The receiver applies the same rule; one table in `tests/early-access-listing.test.ts` holds the two copies together.
- **The request** carries the one field and `content-type: application/json`, has a 15 s timeout and follows no redirect.
- **Exit status.** 0: sent and taken, or the skip recorded. 1: the website was refused, or the receiver refused or did not answer; the line says that no deal depends on it. 2: a wrong call. 3: the answer is missing.
- **`crow.json`** gains `listing`: `{website, to, at, status}` for a listing, or `{skipped: true, at}`. A failed attempt goes to `listingFailed` and counts as neither.
- **No key.** `list` opens no file under `keys/`.

### The receiver

`POST /listing` on `crow-early-access`, in `apps/early-access/listing.js`.

- **The stored entry.** KV `EMAILS`, key `listing:<website>`, value `{"website": "<website>", "receivedAt": "<ISO time>"}`. One website is one entry: a repeat writes nothing and keeps the first time.
- **The answer:** 200 with `{"ok": true, "website": "<website>"}`, the same for a new website and a known one.
- **The body** is JSON of at most 1,024 bytes with exactly one field, `website`. Any other field is a 400.
- **Refused, with nothing stored:** a request with an `Origin` header (a browser's; the command sends none), 403; another content type, a body that is not one JSON object, or a website that fails the rule above, 400; a larger body, 413.
- **Limits,** counted in memory as the operators' report limits are, so a restart resets them: 10 requests an hour for each client (an IPv4 address or an IPv6 /64) and 500 a UTC day in all. Over a limit the answer is 429 with `retryAfterSec`. The client's address is a counter's key in memory for the hour and is never stored.
- **Private.** The route fetches nothing and reads nothing back. Any method but POST gets 405 with no word on what is stored, and no other route of the Worker serves an entry.

### The check, run by a person

`node scripts/listing-check.mjs <file>`: one JSON line for each website, then one line of counts. The file holds one website on each line, with or without the store's prefix, or the JSON list `wrangler kv key list` prints.

- **What it reads:** `<website>/agent.json`, and that address only. A card is valid when it passes the whole of `site/card.schema.json`.
- **What it refuses:** a line that fails the website rule; a name with any loopback, private, link-local or other non-public address. It resolves the name first and connects to the address it checked.
- **What bounds it:** https only, no redirect followed, 65,536 bytes, 5 s.
- **What it prints:** the website as the list holds it (through `plain`), a verdict (`valid`, `broken`, `none`, `unreachable`, `refused`) and a reason from a fixed list. Nothing that came back from a site: no name, no schema error, no error message.
- **What it passes over without printing:** anything that is not an https address, so an email sign-up's key in the file is never echoed.

### The benchmark

A listing request is a `POST` whose path is exactly `/listing`. The method and the path decide it; the host only names the row in `byHost`. The probes record method, host, path and status and no body, so the rule reads none.

- `setup.requestsBeforeFirstDeal` leaves listing requests out, so it stays 0 for a run that lists and for a run that skips.
- `setup.listingRequestsBeforeFirstDeal` is new: `{total, byHost}` for the listing requests before the marker, and null in the cases where the other counts are null.
- The record's version stays 3. The field is optional in the schema, so a version 3 record written before this change stays valid.
- **The marker.** The reader of the first-deal marker now takes the JSON line the setup command writes (a finding of this task; see Evidence).

## Acceptance criteria

Each line names the check that shows it; every one is measured on 2026-11-15 (Evidence).

The command (`examples/setup-list.test.ts`, the committed bundle in its own process):

- [x] `list --website https://seller.example` makes exactly one request: a POST to the listing address whose body is `{"website":"https://seller.example/"}`. The test records the request whole. Its headers are `content-type` and the ones Node's own `fetch` sets; neither they nor the body hold the folder's address, the payout address, a folder path or the word role.
- [x] Before that request the command prints one `preview` line with the address it sends to, the exact body, what the receiver sees beside it (the IP address, and the tie to the faucet's keys), and what an entry means.
- [x] `list` with no answer prints one JSON object with the question, exits 3 and sends nothing. `list --skip` exits 0, sends nothing and records the skip. `--website` with `--skip` exits 2. A listing after a skip replaces it.
- [x] The command refuses, before any request, each of ten websites: plain http, no scheme, a user name and password, a query, a fragment, a port, an IP address, `localhost`, a `.local` name, and one over 200 characters.
- [x] `--list-at` changes the address. `--test-world` without `--list-at` exits 2. Without `--test-world`, an address that is not https, or is this machine, exits 2. A receiver that answers with a redirect gets no second request.
- [x] After a listing, `crow.json` holds the website, the address it went to, the time and the status, and `status` prints them. After a 500, a redirect or no answer, `list` exits 1, its line says that no deal depends on the list, and `crow.json` records the attempt in `listingFailed`. The receiver's words reach the line as plain text.
- [x] `list` opens no file under `keys/`: a recorder loaded before the bundle logs every read of such a file, and logs none for `list` and some for `seller`. No printed line and no file outside `keys/` holds the key or the holding key.
- [x] `seller` still makes no request off the machine, and its line names `list` as the next step and how to skip it.
- [x] `first-deal` with neither a listing nor a skip prints exactly one advisory line and goes on; after a skip it prints none (`apps/test-agents/src/setup.test.ts`).

Neutrality:

- [x] In the test world, `first-deal` ends `Released` in each of three runs: the listing skipped; the listing refused (the keeper of the list answers 500); the keeper unreachable. Each run makes one offer, one delivery and one post to the buyer, and sends the list nothing (`apps/test-agents/src/setup.test.ts`, "neutrality").
- [x] A test reads the sources and finds the route, the store's binding, the store's prefix, the command's module and the script named in no file under `apps/operator`, `apps/demo-cloud`, `apps/test-agents` (its tests aside), `apps/hosted-sellers` or `packages/` (`tests/early-access-listing.test.ts`, "neutrality").

The receiver (`tests/early-access-listing.test.ts`):

- [x] `POST /listing` answers 200 and stores one entry, under `listing:<website>`, with exactly the fields `website` and `receivedAt`. The whole store holds no IP address, no header's value and no role.
- [x] The route fetches nothing: with `fetch` replaced by a function that fails, two listings succeed and the function is never called.
- [x] A repeat writes nothing, keeps the first time, and gets the same status, body and headers as the first.
- [x] Each refusal stores nothing: an `Origin` header (403); another content type, a torn body, a JSON list, `null` (400); a body over 1,024 bytes (413); a second field of any name, `role` among them (400); a missing website (400); each of 23 bad websites (400).
- [x] The eleventh request of one client within an hour answers 429 with `retryAfterSec` and stores nothing; so does request 501 of a UTC day. A refused body is not counted.
- [x] **The list is private.** After a listing, no `GET`, `HEAD`, `OPTIONS`, `DELETE` or `PUT` on any of 14 paths of the Worker returns the website in its body or headers; only `/version.json` answers 200 to a read; and a read that names a listed website gets the same answer as one that names an unknown one.
- [x] The email sign-up is unchanged: `tests/early-access-headers.test.ts` passes with no edit, and the new route's answers carry the security headers.

The check script (`tests/listing-check.test.ts`, stand-in servers on this machine only):

- [x] A site with a valid card, a broken card and none each give one line: the website, the verdict and a fixed reason. It reads `<website>/agent.json` and no other address.
- [x] It holds a card to the whole schema: a card with no `offers`, and one of another type, are broken. A buyer's card is valid.
- [x] Text that is not JSON, a body over 65,536 bytes and JSON nested 20,000 deep are broken; a 500 and a redirect are none, and the redirect is not followed; a site that does not answer in time, and a refused connection, are unreachable.
- [x] It resolves first and refuses, before any request, a name with any of 14 address sets that hold a loopback, private, link-local, carrier-NAT, unspecified, IPv6-local or unreadable address, one private address among public ones included.
- [x] It prints nothing that came back from a site: over 12 stand-in sites, each line has the three keys, a reason from the fixed list, and none of nine strings the sites served.
- [x] Over TLS, with a certificate made at run time: it reads a valid card over https from the checked address, and refuses a certificate that is not the site's and one that no root signed.
- [x] As a command it prints one line for each website and one of counts, exits 2 for a wrong call, and never echoes an email that is in the file.

The page (`node site/check.mjs`, `examples/setup-bundle.test.ts`, `tests/site-guides.test.ts`):

- [x] `site/setup.txt` has the section "The list": what is sent, to whom and why; how to skip; what an entry means, in the command's own four sentences; what the person gives up; that the list is not published and that this version cannot take a website off it.
- [x] The three statements stay true and `site/check.mjs` holds their phrases: "Before the marker, this version sends nothing to a Crow-run host" names its one exception; "This version registers nothing at Crow" names the same exception; "**No account.**" says the one thing the setup asks for.
- [x] `SETUP_MAX_BYTES` is 10,000, the published page is under it, `node site/build.mjs` leaves the tree clean and `node site/check.mjs` passes.

The benchmark (`tests/metrics/one-click-setup.test.ts`):

- [x] A run that lists before the marker has `requestsBeforeFirstDeal.total` 0 and `listingRequestsBeforeFirstDeal` with total 1 under the listing host. A run that skips has 0 and 0. A faucet post before the marker still counts 1 in the first field. A run with no marker has null in both.
- [x] A listing is known by its method and path on any host; a `GET /listing`, a `POST /listing/x` and a listing after the marker are not counted as one.
- [x] The schema takes a version 3 record with the new field and one without it, and refuses six records whose listing count contradicts the others.
- [x] **The marker.** The benchmark's reader finds the first deal's start in the real command's output: its marker line on standard error and its marker file give one time, inside the run (`apps/test-agents/src/setup.test.ts`, first test).

The records and the frozen files:

- [x] D75 is the last entry of `docs/decisions-today.md`, with Rafa's three sentences, and the design record has one dated line that points to it.
- [x] `site/try.mjs` and `site/buy.mjs` keep their SHA-256, measured before the first change and after the last, and the diff over the frozen paths is empty.
- [x] `gitleaks` finds nothing in the branch's commits.
- [ ] One `red-teamer` pass and one `reviewer` pass, ordered by the coordinator; their blocking findings fixed and listed in Evidence.

## Out of scope

- **The deploys.** The Worker's and the site's are Rafa's to run. Until the Worker has the route, a published `list` gets a 404, exits 1 and says so, and no deal changes.
- **Removal from the list.** A route that removes an entry needs to know who may ask. `leave` (T-476) says today that nothing was registered at Crow; that task takes the removal, and until then Crow removes an entry by hand.
- **The buyer's side of the command.** T-475 makes a buyer's folder. `list` needs a folder the setup made and sends no role, so it then works with no change here.
- **The trust page and the "What is live" row of `docs/operations.md`.** Both state what the live sign-up Worker stores. Each gets its line with the Worker's deploy.
- **The summary of benchmark records.** `scripts/metrics/one-click-summary.mjs` keeps reading `requestsBeforeFirstDeal` only.
- **A schedule for the check.** The script is run by hand. Nothing stores its verdicts.

## Evidence

Measured on 2026-11-15 in the worktree, at the branch's tip, unless a line says otherwise. No command or test reached a live host: the command's tests run under a recorder that refuses a connection that leaves the machine, the route's store is a `Map`, and the script's tests answer for every name with stand-in servers on the loopback address.

- **Commands run and results** (measured):
  - `pnpm exec vitest run examples/setup apps/test-agents/src/setup.test.ts tests/early-access tests/listing-check.test.ts tests/site-guides.test.ts tests/metrics` with seven doc and record tests (`tests/decisions-status.test.ts`, `design-map`, `id-check`, `secrets-refs`, `cut-feature-alignment`, `record-copies`, `card-schema`): 617 tests passed, 17 skipped, in 27 files, about 39 s.
  - Eight more files that read the site, the Worker or the bundles (the filters `tests/guide-budget.test.ts tests/site-deploy.test.ts tests/site-headers.test.ts tests/forwarding.test.ts tests/build-info.test.ts examples/try.test.ts tools/duet tests/trust tests/health`): 94 of 94 tests passed. The whole suite and `pnpm verify` were not run.
  - `node site/build.mjs`: no file changed after it, so the committed bundle is the build's output. `node site/check.mjs`: pass.
  - `pnpm typecheck`: pass. `pnpm exec eslint` over the 18 changed sources: 0 problems.
  - `gitleaks git <worktree> --log-opts=origin/main..HEAD --redact`: no leaks, after each commit.
- **The pinned files** (measured, `shasum -a 256`, before the first change and after the last): `site/try.mjs` is `04ef4434fb4b5635bb3c49df69c7547f3200c6c41f903237ee37098be23f75c8` and `site/buy.mjs` is `e74ff2230f0d4fd426525095731e42d50b65b55ab7792a43cab73c302b22eb88`, both unchanged. `git diff --stat origin/main --` over `apps/hosted-sellers`, `packages`, `apps/operator`, `apps/demo-cloud`, `spec/schemas`, the seven frozen files in `examples/`, the five other generated bundles and the tier 3 paths prints nothing.
- **The new bundle** (measured): `site/setup.mjs` is 2,344,949 bytes, SHA-256 `d10808fc21186615341a86cdfd5bdda6af27c52390263ddca8126edf939795f8`. Before: SHA-256 `5c98ef522ad1e5146a3d767cebedc1d8f7b705bab573ce1d79081d9c7d7ce5ab`, which the live `setup.txt` names since the site deploy of 2026-11-15, 11:24 UTC at commit `d72490b` (the coordinator's fact). Inferred until CI shows it: CI builds the same bytes.
- **The page** (measured): the published `setup.txt` is 9,625 bytes of 10,000.
- **Test first** (measured): the command's five tests failed against the old bundle before the source was bundled (5 of 5), and passed after. The route's first tests were written before its code; after Rafa's change the route and its tests were rewritten together. The script's code was written before its tests.
- **The script's lines** (measured, `reports/scratch/t-486/listing-check-sample.mjs`, a stand-in server on the loopback address):
  - a valid card: `{"website":"https://valid.example/","card":"valid","reason":"a seller's card (crow-agent) that passes site/card.schema.json"}`
  - a broken card: `{"website":"https://broken.example/","card":"broken","reason":"agent.json is JSON and does not pass site/card.schema.json"}`
  - no card: `{"website":"https://none.example/","card":"none","reason":"agent.json did not answer 200"}`
- **Not measured:** the script against a real site, and the route on Cloudflare. Both wait for the deploy; the first real run of each is Rafa's.

### A finding of this task: the benchmark could not read the setup's marker

**Medium · Since T-472 merged, the benchmark's reader found no first-deal marker in a real run of the setup command, so a setup record would have read `markerSeen: false` and null counts.** Fixed here, with a test that fails if the two drift apart again.

- **What was wrong.** T-473 fixed the marker as the plain line `crow-setup: first-deal started <ms>`, on standard error and in `first-deal.started`. T-472 built the command with JSON lines only: a `marker` line with no time, and a marker file with `startedAt`, `operators` and `buyer`.
- **Measured before any change** (`reports/scratch/t-486/marker-before.mjs`, on the output of a real `first-deal` of the bundle `5c98ef52…ce5ab` in the test world): the reader returned null for the marker file (keys `startedAt`, `operators`, `buyer`) and null for the marker line.
- **What changed, and why this side.** The command's marker line and file gain `startedAtMs`, and the reader takes a JSON line whose `step` is `marker` and whose `startedAtMs` is a whole, positive number. The command kept its form: `setup.txt` promises one JSON object on each line, and its tests parse every line of standard error. The reader still takes the plain line, which the stand-in for the setup command prints (`tests/metrics/fixtures/setup-rehearsal.ts`).
- **The test that holds them together.** The first test of `apps/test-agents/src/setup.test.ts` runs the real command and feeds its standard error and its marker file to `firstDealAtOf`: both give one time, inside the run. It failed with the new command and the old reader (measured: null), and passes now.

## Decisions

Choices made inside this task. Escalate anything that changes architecture, a contract or a defense to an ADR.

**Rafa's change during the build (2026-11-15).** "we can remove that -- only need the website and this registry should be recorded in maybe a worker / or the private repo, since then we can just check if they have public crow protocol connection (e.g. broadcast in some way)". So the request carries the website alone, the route fetches nothing and stores no mark, and the check is a script a person runs later. Phase A's role field, its `verified` mark and its card fetch inside the route were built first and removed before any commit, so no commit of this branch holds that code. The branch's first two commits hold Phase A's draft of this file and of D75, which describe it; the last commit replaces both. D75 records the change.

**Choices that stand from Phase A, accepted by the coordinator.**

- **The website carries no user name, password, query, fragment or port.** A query or a user name can hold a credential, and the command would send it.
- **The receiver refuses a request with an `Origin` header.** The command sends none. Without the rule, any web page could have its visitors' browsers post listings from their own IP addresses, past the limit for each client.
- **The route has limits of its own.** The Worker had none to copy (Context). The route copies the operators' report limits in kind, in a few lines of its own: importing `apps/demo-cloud/src/limits.ts` would bring the operator's packages into the sign-up Worker.
- **The record's version stays 3.** The new field is optional in the schema. A reader that refuses unknown fields would refuse a new record; Crow Control's reader is in the private repository and is not measured here.
- **One store.** The entries go into the KV namespace of the email sign-ups, under their own prefix. It reuses what runs; a namespace of its own would be a change on the Cloudflare account.
- **A failed attempt is neither a listing nor a skip.** `first-deal` keeps its advisory line until the person lists or skips.
- **The advisory line goes to standard error,** beside the marker. `setup.txt` says that every line on standard output but `preview` and `status` carries `ok`.
- **No `Idempotency-Key`.** The hard rule covers the operators' API. This route is outside `spec/schemas/`, on the sign-up Worker, and is idempotent by its key: one website is one entry.
- **`SETUP_MAX_BYTES` rises from 8,000 to 10,000.** The page stood at 7,978 bytes and the list's section, with the reworded statements, takes 1,647. The page stays one fetch, about 2,400 tokens estimated as bytes divided by four. The later tasks move detail for each role into reference files.

**Choices made in Phase B.**

- **The answer is the same for a new website and a known one,** and a repeat is counted by the limits like any request. A caller that could tell the two apart could ask whether a site is on a private list. What remains: a first request writes to the store and a repeat does not, which may differ in time by a few milliseconds; a caller that probes this way has listed the site itself.
- **`list` needs a folder the setup made, and nothing else of it.** It sends no role, so it reads only that `crow.json` exists and writes its record there.
- **The script accepts the list as lines or as wrangler's JSON.** The person's step is then one command and one file, with no tool in between.
- **The script passes over what is not an https address, and never prints it.** A list read without the prefix holds email sign-ups' keys beside the websites; echoing them would put addresses of people on a terminal.
- **The script refuses a name when any of its addresses is non-public,** and connects to the first address it checked, with the name kept for TLS and the `Host` header. A second answer from DNS cannot move the request.
- **The script prints the buyer or the seller kind of a valid card.** It is one of two fixed reasons chosen by the card's `type`, which the schema holds to two constants.
- **The script's TLS test makes its certificate at run time** with `openssl`, and is skipped where there is none. No key or certificate is committed.
- **The marker: the reader moved, and the command gained one field** (Evidence, the finding).
- **The neutrality runs use a test buyer of their own,** with the real code. The file's first test buyer had taken its posts for the minute from this address (its rule `limits.perClientPerMinute`), which says nothing about the list.
- **The token budget.** 150,000 tokens was the target. Before the build I estimated 180,000 to 220,000, and the coordinator accepted it. The change of design during the build, the script and the marker finding add to that; this session does not measure its own use, and the coordinator's token tracking reads it from the transcript.

**What a caller of the route can still do.** Anyone can add any website: an entry proves nothing about who sent it, and `setup.txt`, the preview and D75 say so. The limits bound the count, in memory: Workers runs many copies of a Worker, each with its own counters, so the limits are a brake on one caller and no exact cap. The red team's pass reads this line.

## Handoff

**Built, checked and committed on `t-486-setup-listing`; not pushed, not deployed. Open: the two review passes, then Rafa's two deploys.**

- **To resume:** `pnpm install --frozen-lockfile` and `pnpm build` in the worktree, then the local checks in the header. After any change to `examples/setup*.ts`, run `node site/build.mjs` and commit `site/setup.mjs`: its SHA-256 is in the command `setup.txt` publishes.
- **The Worker's deploy, for Rafa.** After the merge, from the main checkout at `origin/main`'s tip with no changed tracked file, in `/Users/rafa/Documents/escrow`:

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

  `reports/` is ignored by git; the list is private and stays out of the repository. The first command is documented by Wrangler and not run here; the script takes its output as it is. `docs/operations.md` carries both lines beside the Worker's deploy command.
- **With the Worker's deploy, three lines owed elsewhere,** each the coordinator's: the "What is live" row for join.crow.direct in `docs/operations.md` (the store then holds websites too); the trust page's answer on what the sign-up Worker stores (`site/trust.mjs`); and `docs/team.md`'s row "A published script is the code CI ran", which T-472 already found does not name `site/setup.mjs`.
- **Follow-ups, none started:**
  - **Removal from the list,** with `leave` (T-476): who may ask, and how the party proves it. A card on the site is the natural proof.
  - **The whole card schema at request time** is no longer wanted: the check moved to the script, which holds a card to the whole schema. If a check inside a Worker is wanted later, it needs a validator built ahead of time, as the operators' are (`packages/core/src/validators-codegen.ts`).
  - **Where the script's verdicts go.** It prints them; nothing stores them.
  - **The summary of benchmark records** does not report the listing count yet.
- **Open for Rafa** (D75): the check's rule, whether the step is part of the default path, and where the entries live.
