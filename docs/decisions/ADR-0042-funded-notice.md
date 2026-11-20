# ADR-0042: A seller hears of a funded hold on the event stream it opens

- **Status:** Accepted, 2026-11-20 (D86). Rafa decided it on 2026-11-20: "How does a seller learn that the buyer's money is held? Use the event feed and the chain read". No webhook and no operator signature on each notice. Proposed on 2026-11-19.
- **Date:** 2026-11-19
- **Raised by:** T-573, roadmap row N210. Stage 2 of the roadmap asks that "the seller's system gets a signed, retried, idempotent "funded" push (webhook or event stream) with no polling".
- **Research:** a research pass by a Fable max-effort agent on 2026-11-19, given `CLAUDE.md`, the documents below and the inventory in Context, not a conclusion. Its findings are folded into this record; the sources it read are named where they are used.
- **Builds on:** ADR-0001 (neutrality), ADR-0005 (access by API, the escape hatch), ADR-0017 (the agent-ready API, which planned webhooks), ADR-0037 (the hosted seller adapter), D35 (rails, not a record-keeper).
- **Amends:** ADR-0017: its planned `POST /v1/webhooks` is withdrawn (section "Decision", point 5).
- **Changes at acceptance:** no code, no schema, no route. This record, D86, the task file, a note in ADR-0017, and one paragraph in `site/ref/http-seller.txt`, "Hear that the money is held". The build plan's pull requests follow as their own tasks.

Labels: **measured** (read at the cited line at `origin/main` `46b590c6`, or run as cited on 2026-11-19 between 21:40 and 22:10 UTC), **documented** (a doc or published standard states it), **inferred**, **guessed**.

## Summary

1. **The push is the event stream the seller opens at any operator.** `GET /v1/events` already serves every `hold.funded` on both live operators [measured]. A follower in the seller's own commands holds it, wakes on `hold.funded`, and fails over to the next operator.
2. **The notice only wakes the seller; the chain decides.** Before it starts work, the seller's command reads the deal's stage from the rules contract, at the finality the seller chose. That read replaces today's rule that every operator must agree, so a silent or lying operator cannot stop or fake a start. A notice from any source is never trusted alone.
3. **The seller's system gets the retried, idempotent call it needs from its own adapter.** When the seller's start mapping names its idempotency header, the adapter's start call into the seller's job API carries the commitment ID as its key and is sent again after a failure [measured, `examples/seller-adapter-core.ts:1535-1538`, `examples/seller-adapter-api.ts:485-486`]. A mapping without one gets a start sent at most once, by design (T-408).
4. **No operator stores anything about a seller, and `spec/schemas/` does not change.** No version bump; T-549's open schema work is untouched.
5. **The build is three pull requests after this one,** about 310,000 tokens in all [guessed]. The operator webhook (option B) stays unbuilt, with the signal that would reopen it.

## Context

### Every way a party learns of a state change today

- **The event stream.** `GET /v1/events?from=<seq>` serves server-sent events, oldest first, then live (`apps/operator/src/server.ts:1506-1521`). The handler reads the settlement log every 50 ms (`SSE_POLL_MS`, `server.ts:71`). It has no authentication and no party filter; a private deal appears as its settlement projection. On Cloudflare the same handler streams through `apps/operator/src/fetch.ts`.
  - Measured: `curl -s -N --max-time 6 "https://api.crow.direct/v1/events?from=130"` and the same at `api2.crow.direct` both answered 200 `text/event-stream` with a first byte in 0.055 s and 0.061 s. Each replayed 12 events, among them `hold.funded` at seq 136 with the same hash on both nodes.
  - That event's payload names the commitment ID, the buyer, the amount and token, the funding transaction's hash and its block. It has no seller field; a seller matches on the commitment IDs it knows.
  - Measured by the research pass: a replay from seq 0 returned 205 events in 243,843 bytes, about 1,190 bytes an event.
- **State reads.** `GET /v1/commitments/{id}` (`server.ts:1375-1377`) returns `escrowState` and `lastEventSeq`. `GET /v1/commitments?party=&role=seller&escrowState=Held` (`server.ts:1368`, `:1429-1452`) pages a seller's held deals, newest first, with a backward cursor. `GET /v1/commitments/{id}/events` and `/receipts` (`server.ts:1384-1385`) page one deal's events and the operator's signed receipts. `GET /v1/status` reports `head.eventSeq` (`server.ts:1495-1497`).
- **The chain.** The rules contract's `agreeAndFund` (`contracts/src/HoldbackRules.sol:153`) emits `JobCreated`, `JobFunded` and `SettlementAddresses` in one transaction (`:197-199`). `JobCreated` indexes the seller as `provider` (`contracts/src/IHoldbackRules.sol:132`), so one log filter on the seller's address finds every funded deal it signed with that address, whoever relayed it. A private deal signs with a per-deal key (ADR-0024), so the filter lists each per-deal address the seller holds [inferred]. `dealOf(bytes32)` (`IHoldbackRules.sol:338`) returns the deal, whose stage 1 is `Held` (`:71-80`). The operators read logs with chunked `eth_getLogs` (`packages/settlement/evm/sync.ts:246-252`); nothing in the repository uses `eth_subscribe` or a log watcher.
- **Webhooks.** `POST /v1/webhooks` is planned under ADR-0017 and answers 501 (listed at `spec/openapi/paths.json:41`, answered by the planned-route handler at `server.ts:685-688`, tested at `apps/operator/src/operator.test.ts:176`). `docs/api.md`, "Reading a deal", says: "There is no push to a party yet: poll, or follow `GET /v1/events`."
- **The seller's own adapter.** The hosted seller adapter's Durable Object alarm runs a pass and re-arms every `pollMs` while a deal is open (`apps/hosted-sellers/src/worker.ts:265-282`); the example sets 5,000 ms (`apps/hosted-sellers/example/seller/adapter.json:14`). The Node shell runs `setInterval(core.wake, pollMs)` (`examples/seller-adapter.ts:203`). A pass reads `escrowState` with `trusted()`, which needs every configured operator to answer the same (`examples/agent.ts:104-110`, `seller-adapter-core.ts:1488-1503`). The adapter's `alerts.callback` is an HMAC-signed POST to the seller's own systems (`seller-adapter-core.ts:1635-1657`), sent once on refusals and job problems, never on funding.
- **History.** Until 2026-11-11 the adapter followed the first operator's stream for `hold.funded` as a wake-up, with the trusted read deciding and polling as the net. T-331 removed that `stream` option as a simplification (commit `5d761d5b`); a configuration that still sets it is refused (`seller-adapter-core.ts:221`).
- **Other pollers.** The test seller polls every operator every 3 s, or 15 s for an offer older than 5 minutes (`apps/test-agents/src/seller.ts:710`, `:814-862`). `setup.mjs deliver` (PR 714, open) runs one pass over a seller folder's held deals and prints a cron entry for every 5 minutes (`examples/setup-deliver.ts:44-45`, `:76-100`, on its branch).
- **The operators' own passes** sync the chain, run Crow's adjudicators and send timeouts (`apps/demo-cloud/src/world.ts:1242-1300`). None of them notifies a party.
- **No operator stores a seller's contact.** The sign-up Worker keeps emails and websites (`apps/early-access/worker.js:70-72`); no operator or deal reads them.

### What the comparable APIs do

- **Services push signed webhooks** because the service is the source of truth and the receiver runs none of its code. Stripe signs a timestamp and the body with HMAC-SHA256, retries for up to three days, promises no order, and asks receivers to log event IDs against duplicates [documented, docs.stripe.com/webhooks]. Standard Webhooks keeps one `webhook-id` across retries as the idempotency key and tells senders to block internal addresses [documented, github.com/standard-webhooks/standard-webhooks]. Escrow.com posts on each state change and "strongly recommends verifying" by fetching the transaction [documented, escrow.com/api/docs/webhooks].
- **Protocols define no webhook.** x402 has the buyer carry the signed payment to the seller, who settles through a facilitator [documented, coinbase/x402 specification v2]. ERC-8183 (a draft) defines on-chain events only [documented, eips.ethereum.org/EIPS/eip-8183]. AP2 defines no push [documented, ap2-protocol.org]. A2A offers server-sent events to a connected client and a webhook for a disconnected one, warns of SSRF, and tells the client to fetch the task after a notice [documented, a2a-protocol.org].
- **Server-sent events** resume with `Last-Event-ID`, and servers send a comment line about every 15 s so proxies keep the connection [documented, html.spec.whatwg.org, section 9.2].
- **`eth_subscribe`** needs a WebSocket, drops its subscriptions when the connection closes, sends no past events, and re-sends logs with `removed: true` after a reorg [documented, geth.ethereum.org, pubsub].
- **Chain-webhook providers** (Alchemy, QuickNode) can post the contract's `JobCreated` log to a seller's URL today, with their own signature and retries, and no Crow code [documented, their notify and streams docs].

The careful ones share one rule: after any notice, fetch the truth.

## Decision

1. **A seller hears of a funded hold on `GET /v1/events` at any operator.** The seller's own follower reads `head.eventSeq` from `/v1/status` and holds `GET /v1/events?from=<head + 1>` at the first operator that answers. On each `hold.funded`, and after each connect, it runs one pass. It moves to the next operator on an error or after 60 s without a byte. A slow pass stays as the net for a gap the follower misses.
2. **The notice wakes; the settlement layer decides.** Before the seller's command starts work, it reads `dealOf(id)` from the rules contract through an RPC node the seller configures, at the block tag it chose: `latest` (inclusion, today's behaviour), `safe` or `finalized`. Work starts only when that read shows `Held`. A notice that the chain does not confirm starts nothing.
   - **The chain read replaces `trusted()` as the gate for a start.** Today every configured operator must answer the same (`examples/agent.ts:104-110`), so one silent or lagging operator stops every start until the buyer reclaims [inferred, not run]. With the chain read deciding, an operator that is silent or disagrees can delay the notice but not the start.
   - **The chain stays behind the API for an agent that writes raw HTTP.** The read lives inside Crow's own seller commands (the adapter and `setup.mjs`), which take an RPC URL as configuration. An outside agent that integrates by HTTP alone follows the stream and checks with today's read of the state at two operators; the guide offers the chain read as the stronger check.
3. **The call into the seller's system is the adapter's start, as today.** With a repeatable start (the mapping names its idempotency header), it carries the commitment ID as its key and is sent again on a later pass after a failure. The roadmap's "signed, retried, idempotent" push to the seller's endpoint is this call, under the seller's own credential. A start that the seller's API cannot repeat safely stays at most once and alerts the seller when no answer comes back (T-408); the guide says that the retried push needs a repeatable start.
4. **The operators change only the stream's behaviour, in three repairs.** `stream()` sends a comment line every 15 s, so a follower can tell a quiet stream from a dead one (an idle stream sent 0 bytes in 6 s, measured by the research pass). It honours `Last-Event-ID` (with that header and no `from`, the replay started at event 0, measured). It answers 400 `invalid_cursor`, a problem type that exists today, to a `from` past the head plus one, which today waits with no error until the log reaches it (`server.ts:1506-1521`, inferred). No file in `spec/schemas/` changes, so the schema version stays; the OpenAPI document's `info.version` moves (`docs/api.md`, "Versions, in one place").
5. **`POST /v1/webhooks` is withdrawn from the plan.** The route keeps answering 501, and its problem detail and `docs/api.md` point to the stream. ADR-0017's webhook row and its deferred "Standard Webhooks signing headers" close with this record.
6. **The chain's log is the documented backstop.** A deal whose offer no operator ever saw never reaches a stream (`sync.ts`, "no book is invented", measured by the research pass's reading), for example a standing offer (ADR-0040) taken straight at the contract. A seller covers it with an `eth_getLogs` filter on `JobCreated` with `provider` set to its addresses, or a chain-webhook provider. The guide documents it; Crow builds no command for it now.

### Does the bar's wording fit?

The bar names "webhook or event stream", so a stream meets its letter on the mechanism. Word by word:
- **Signed.** The stream carries no signature per message. A webhook signature answers "did the operator send this?", and a seller that opened the connection knows that from TLS. The question that matters, "is the deal funded?", only the settlement layer answers, and the seller asks it in point 2. The stream's events are also hash-chained, and each has an operator-signed receipt one read away (`/receipts`, 0.08 s, measured by the research pass; the signature was not checked).
- **Retried.** The follower reconnects and runs a pass; a repeatable start call into the seller's system is retried.
- **Idempotent.** The commitment ID, in every source; the contract funds an ID once.
- **No polling.** Met for hearing of the hold. The slow pass is a net, not the signal.
- **Finality when the seller asks.** Point 2's block tag.

So the bar is met in substance by a smaller thing than a webhook. Its word "signed" is better met by the chain check than by an operator signature. If Rafa reads "signed" as an operator signature on each notice, the smallest addition is the receipt sent as a second message on the stream, still with no webhook (question 2).

## Alternatives considered

| | A. The seller listens itself (chosen, A2) | B. An operator webhook | C. Polling stays |
| --- | --- | --- | --- |
| **Shape** | A1: the seller filters the rules contract's logs. A2: the seller holds the event stream at any operator | `POST /v1/webhooks` registers a URL; the operator posts a signed notice on `hold.funded` and retries | One documented command: `setup.mjs deliver --schedule` (PR 714) or the adapter's `pollMs` |
| **Adds to the API contract** | A1: nothing. A2: nothing in `spec/schemas/`; three repairs to the stream's behaviour, described in `spec/openapi/paths.json` | Three routes (register, list, delete), a signed registration type and a notice schema: an ADR and schema v0.13, after T-549's v0.12 [inferred] | Nothing |
| **An operator stores** | Nothing | Per seller: the URL, its filter, and each notice's tries and next try, kept across restarts. The URL beside the address links an identity to a key, which D35 says the rails do not need. Today's idempotency records last one process [documented, discovery] | Nothing |
| **The pushing operator refuses or goes offline** | A2: the follower moves to the next operator within 60 s, and a pass after each connect covers the gap. A1: no operator is in the path | No notice arrives. The seller must register at every operator and drop duplicates, or keep a poll. With neither, it misses `deliverBy` and the buyer reclaims: the deal still ends by its terms | The poll fails over as today |
| **Fixture that proves the deal still settles** | `neutrality.operator-stream-silent`, `neutrality.operator-lies-about-funding` (Litmus tests) | `neutrality.operator-webhook-refuses`: operator 1 never posts the notice; the seller hears from operator 2's notice or its own pass, and the deal ends Released; with neither, it ends Refunded by the buyer's reclaim | The existing `neutrality.operator-offline` and `neutrality.operator-refuses` cover the poll's failover |
| **The seller checks the notice** | `dealOf(id)` at its chosen tag: one `eth_call` | The same read. The signature shows who sent the notice, not that it is true | The same read, or today's `trusted()` |
| **Failure cases** | A dropped stream (reconnect and pass); a lying operator (the check refuses); a seller offline for hours (one pass at restart); an open stream keeps the operator's Durable Object billed, at most about 4 USD a month [inferred from documented prices]; a stream that the platform cuts after about 15 minutes in memory [documented, Cloudflare Durable Object lifecycle] means a reconnect, which the follower does anyway | Outbound calls to addresses a stranger chose: SSRF, an egress filter, proof of URL ownership, retry caps that end at `deliverBy`; a signing key to rotate, which `receiptSigner` cannot do today [inferred]; a durable outbox | Up to 5 minutes late with the cron entry; 12 reads a minute per operator per open offer at 5 s, against 1,200 allowed per client, so about 100 open offers behind one address reach the limit [measured, discovery; inferred] |
| **An outside agent needs** | About 250 tokens of guide and about 30 lines for the stream and the state read at two operators: read the head, hold the stream, read the deal, key on the commitment ID, reconnect. The chain read adds about 300 tokens: an RPC URL, the `dealOf` selector and the stage in the answer's first word [guessed] | A public HTTPS endpoint, which an agent that only makes requests lacks; a signed registration per operator; signature, timestamp and duplicate checks; about 700 tokens of guide [guessed] | Today's guide |
| **Meets the bar** | Yes, in substance (above) | Yes, to the letter | No: it is polling |

- **A1 alone** makes the chain the seller's only signal, against `CLAUDE.md`'s "Any blockchain stays behind the REST API", and `eth_subscribe` needs a WebSocket and a backfill after each drop. One `eth_call` inside Crow's own commands (point 2) is a much smaller step than a log subscription the seller keeps alive. A1 stays the backstop (point 6).
- **B** is the right shape for a service and the wrong one for rails. It is the only option that makes an operator store a party's contact and call out to it, and it still does not remove the seller's check or its fallback when an operator refuses.
- **The x402 shape,** where the buyer hands the seller the operator's receipt, costs the operators nothing but depends on the counterparty and changes the pinned buyer bundle. Not chosen.

## Consequences

- **The API contract:** no file in `spec/schemas/` changes and the schema version stays. `spec/openapi/paths.json` describes the heartbeat, `Last-Event-ID` and the new 400, and marks `POST /v1/webhooks` as withdrawn.
- **The operators** keep no new state. A held stream costs a Durable Object's time while it is open.
- **The seller's commands** gain a follower, a chain read that gates each start, an RPC URL in their configuration and a finality option. The hosted seller keeps its alarm for now: a Durable Object pays for each second it holds a stream [documented, Cloudflare pricing]. Its partner's job API still gets the pushed start call.
- **The guides** stop telling a seller to poll for `Held`: `site/ref/http-seller.txt` gains "Hear of a funded hold"; `site/ref/seller-adapter.txt`, `site/ref/intake.txt`, `docs/api.md` ("Reading a deal", "Events and audit") and `docs/what-a-deal-can-do.md` follow.
- **The roadmap's done-when for N210** should read, if Rafa agrees (question 3): "A fixture funds a deal. The seller's follower hears of it on the stream with no poll, after a dropped connection too, and checks the settlement layer. The seller's job API then gets one start call, sent again after a failed try under the commitment ID as its idempotency key when the API takes one. When the seller asks for finality, the call waits for the finalized block."
- **A limit closes: one silent operator no longer stops a start** in Crow's seller commands, because the chain read gates it (point 2). An agent that integrates by HTTP alone and keeps the read at every operator keeps that limit; the deal still ends by its terms, in the buyer's reclaim.
- **Not measured:** how long an idle stream survives on the live nodes (each read lasted 6 s); the delay from a funding block to its event; the adapter with one operator offline; the receipt's signature.

### What would reopen B, or change this record

1. A seller that can only receive HTTP and will run nothing. First answer: a notifier outside the operator API (the seller's own, one Crow hosts as ADR-0037 hosts the adapter, or a chain-webhook provider), which reads public data and needs no place in `spec/schemas/`. Sellers that such a notifier cannot serve would reopen B.
2. Live nodes that cut an idle stream within minutes even with the heartbeat, or case-study agents that cannot hold a stream: add a long-poll parameter to the state read.
3. Polling at scale (about 100 open offers behind one address): the hosted seller follows the stream too.
4. A chain with finality in seconds: the finality option becomes a constant.

## Litmus tests

- **Neutrality.** A notice is not a settlement step, so no notifier can stop a deal: it settles by its terms whether or not the seller hears. In Crow's seller commands, a refusing operator can only make a seller late: the follower fails over, and the chain read, not the operators' agreement, gates the start (point 2). An agent that keeps the read at every operator can be stopped from starting by one silent operator; the deal then ends Refunded by the buyer's reclaim, still by its terms. Fixtures, in `docs/neutrality.md`'s style:
  - `neutrality.operator-stream-silent`: operator 1 closes the stream or leaves the funded hold out; the seller hears from operator 2's stream or from its own pass; the deal ends Released.
  - `neutrality.operator-lies-about-funding`: operator 1 streams `hold.funded` for a deal the settlement layer does not hold; the seller's chain check refuses, no job starts and no balance moves.
  - Planned for a local chain: `neutrality.operators-silent-about-funding`, every operator silent, the seller hears through its log filter, beside the existing `neutrality.operators-offline-after-funding` (`examples/send-timeout.test.ts:403`).
  
  Option B would fail no litmus test either, but it adds a stored link from a key to a contact on every operator, against D35. Passes.
- **The hold.** Unchanged. No option moves money or touches a hold; the chain check refuses to start work on a hold that does not exist. Passes.
- **Defended judgment.** Unchanged. Passes.

## Build plan

Each pull request names T-573 or a new task taken with `roadmap/ids.mjs reserve`. Token numbers are guessed.

| Order | Pull request | Kind | Paths | Fixtures and tests | Tokens |
| --- | --- | --- | --- | --- | --- |
| 1 | This record: ADR-0042, D86, the task file | 10 | `docs/` | none | about 60,000 with the research pass and the review |
| 2 | The follower, the chain read that gates a start, and the finality option, after PR 714 merges | example code a party runs, reviewed as kind 4 (the change recipes name no row for `examples/`); it changes what decides that a seller starts work, so one review before merging, checking whether a lying or lagging operator or a reorg at `latest` can game the gate; a second review by another model family if Rafa asks (`docs/team.md`) | `examples/agent.ts`, `examples/seller-adapter-core.ts`, `examples/seller-adapter.ts`, `examples/setup-deliver.ts`, their tests | `funded.pushed-once` (the stream drops, the follower reconnects, the first start call fails, the second carries the same key, the job API sees one job); `funded.waits-for-finality`; `funded.one-operator-silent` (the chain read starts the job); `neutrality.operator-stream-silent`; `neutrality.operator-lies-about-funding` | about 170,000 |
| 3 | The stream's three repairs and the withdrawn webhook route, after PR 715 (T-549) merges | 4 | `apps/operator/src/server.ts`, its tests, `spec/openapi/paths.json` (its `info.version` moves), the generated `spec/openapi.json` | a heartbeat within 15 s on an idle stream; `Last-Event-ID` resumes; a `from` past the head answers 400 | about 100,000 |
| 4 | The guides, after PRs 2 and 3, and after PRs 714 and 715 merge (715 edits `docs/neutrality.md`, 714 edits `site/setup.txt`) | 1 and 2, one batch | `site/ref/http-seller.txt`, `site/ref/seller-adapter.txt`, `site/ref/intake.txt`, `site/setup.txt`, `docs/api.md`, `docs/what-a-deal-can-do.md`, the operator row of `docs/neutrality.md` | `node site/build.mjs && node site/check.mjs`; the seller page's tokens measured before and after | about 40,000 |

PRs 2 and 3 do not depend on each other: the follower reads the head first, so it never sends a `from` past it, and it treats 60 s without a byte as a drop until the heartbeat ships. A deploy of PR 3 and a site deploy of PR 4 wait for Rafa.

**Not built, each with its trigger:**
- Stream filters by party or event type: when a follower reads more than about 1 MB a day.
- A cap on open streams per client: a triage row; `docs/operator-threat-model.md` has no row for held streams [measured by reading, research pass].
- A seller command that reads the chain's log: before mainnet.

## Questions for Rafa

1. Accept the event stream, with the seller's chain check, as the funded push, and withdraw the planned `POST /v1/webhooks`?
2. Is the chain check enough for "signed", or should each `hold.funded` on the stream also carry the operator's signed receipt?
3. Reword N210's done-when as in Consequences?
