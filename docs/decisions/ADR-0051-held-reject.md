# ADR-0051: Crow's adjudicators hold a rubric deal's reject before signing it

- **Status:** Accepted, 2026-11-25 (Rafa: "Yes, build it"), with the research note's recommended answers to its open points: build it now; take the hold from the terms; include the appeal adjudicator's hold; do not hand the buyer the signed reject early. Built by T-619. Rafa can overrule any line.
- **Date:** 2026-11-25
- **Raised by:** Rafa, 2026-11-25: "So there's no grace period in the contracts as they are built today that can accommodate that?"; then "Yes, check it" and "Yes, build it".
- **Research:** a research note in the maintainers' private repository (`docs/private-materials.md`): what today's contracts check about a decision's timing, with line references, the rule, the escalation path, neutrality and the costs.
- **Builds on:** ADR-0001 (neutrality), ADR-0002 (the hold), ADR-0006 (defended judgment), ADR-0019 (settlement by agreement), ADR-0031 (phase one), ADR-0048 (the reject grace period in the next contract version); D26, D28, D31, D32, D104.
- **Interim for:** ADR-0048. When the next contract version ships, this hold goes away and Crow's tools write `rejectGraceSec` instead of the long windows.
- **Changes:** `packages/judgment` (the rule, `hold.ts`), `apps/adjudicator` (`decideTask`), `apps/demo-cloud` (the wake, the notice, the judge-call count, the counts), `examples/seller-adapter-core.ts` (`rubricTiming`), `examples/held-reject.ts`, `examples/audit-deal.ts`, `packages/testkit` (the runner applies the same rule), `fixtures/`, the agent guides. No contract, schema, signed type, API route or `packages/core` change.

Labels: **measured** (read at `origin/main` `323ebd9b`, or run on this branch), **documented**, **inferred**, **guessed**.

## Summary

1. **On a deal whose terms carry a rubric, Crow's adjudicators sign an accept or an escalation at once, and hold a reject.**
2. **The primary signs its reject at the record's `decidedAt` plus `judgeWithinSec` (`judgeBy` minus `deliverBy`) minus 600 s.** The appeal adjudicator, after an escalation, at `decidedAt` plus `appealDecideSec` minus 600 s. Neither signs later than its turn's deadline minus 600 s.
3. **The fallback signs at once, and so does every adjudicator on a deal decided by checks alone.** A window of 600 s or less holds nothing, so today's short windows change nothing.
4. **Until the reject is signed the deal stays `Delivered` (or `Escalated`).** In `Delivered` the buyer alone may accept; in either both may settle. Both moves exist on today's contracts.
5. **Crow's seller tools write 87,000 s for both windows on a rubric deal,** a hold of one day. `prepare/offer`'s own defaults do not change.
6. **It is a rule of Crow's adjudicators, read from the signed terms.** No per-deal setting and no choice. Another adjudicator may sign at once.

## Context

- **The case** [measured, the private deal record of 2026-11-25]. A delivery passed every check; half the panel's outputs failed the verdict filter; the primary escalated; the appeal adjudicator rejected; the refund landed in the reject's transaction. The buyer wanted the work and had no move left.
- **The contract checks one thing about a decision's time: that it lands before the turn's deadline** [measured, `HoldbackRules.sol:226`, `:244`, `:281`]. No minimum, and no link to the delivery's time.
- **Until a decision lands the deal stays open** [measured]. Only `decide`, `earlyAccept`, `mutualSettle` and `triggerFallback` leave `Delivered`, and `triggerFallback` reverts before `judgeBy` (`:454`). The buyer alone accepts in `Delivered` (`:353`); both settle in `Delivered` and `Escalated` (`:382`).
- **A signed decision is the same bytes whenever it is signed** [measured]. It carries no clock value but `expiresAt`, the turn's deadline, and the signature is deterministic (`apps/adjudicator/src/service.ts`, `#sign`).
- **The judged result survives a restart** [measured]. `judgedStore` keeps the record from the moment the panel returns, so the panel never runs twice (A-4, T-530).
- **ADR-0048 puts the same period in the next contract version.** This record gives the window now, with the moves today's contracts allow before a decision.

## Decision

### 1. The rule (`packages/judgment/src/hold.ts`, `holdUntil`)

| Turn | Outcome | Signed at |
| --- | --- | --- |
| Primary, rubric deal | reject | min(`decidedAt` + min(`judgeWithinSec` − 600 s, 86,400 s), `judgeBy` − 600 s) |
| Appeal after an escalation, rubric deal | reject | min(`decidedAt` + min(`appealDecideSec` − 600 s, 86,400 s), `appealDecideBy` − 600 s) |
| Any turn | accept, escalate | at once |
| Fallback; a party appeal (SimChain); a deal decided by checks alone | any | at once |

- **`decidedAt` is the record's own time,** kept with the record. A restart holds to the same second.
- **A time already passed means sign now.** A service that wakes late in the hold still signs before the deadline.
- **A rubric deal is one whose `acceptance.rubric.criteria` is not empty.** A failed check on a rubric deal is held too, as ADR-0048 section 8 holds it.
- **The hold is never longer than a day (86,400 s)** (red team M1). The parties choose the window; Crow's adjudicators do not delay a reject longer than a day whatever the window, so a seller cannot turn a month-long `judgeWithinSec` into a month of pressure on the buyer.
- **Only a service that keeps its judged results (`judgedStore`) holds** (red team M2). Without a store a restart would run the panel again, so such a service signs at once, as before. Crow's public demo and the local sim world keep one.
- **A held task costs a pass nothing:** a reject held in memory for the same delivery waits without the preflight's reads, which run again before it is signed.
- **The margin is 600 s** [guessed; Sepolia takes about a minute a transaction, documented]. It leaves room for the relay's retries.
- **The rule lives in `@holdback/judgment`,** so the adjudicator service and the scenario runner run one function. The bundles that carry the testkit then carry no adjudicator service.

### 2. The adjudicator service

- `decideTask` publishes the record, then asks `holdUntil`. Before the hold's end it returns no decision and the hold's end; `RunReport.held` lists it. At the end it signs, as before. The panel, the record and the signed decision do not change.
- The record is public from the moment it is published, as today: both parties read the same reject at the same time. Neither gets an earlier look, and the signed reject is not handed out early (open point 4).

### 3. The operators (`apps/demo-cloud`)

- **One wake at the hold's end.** `workAt` wakes the holding adjudicator at the hold's end instead of on every pass.
- **A notice on the state read:** "The primary adjudicator's panel rejected this delivery (…/judgment). It signs the reject at <time>, and the deal stays Delivered until then. Until then the buyer may accept …, or both parties may settle …".
- **No judge calls reserved for a held deal.** Its panel has run and its result is kept, so the gate on new rubric deals no longer counts it.
- **Counts:** held, rescued (accepted or settled during the hold), signed, and missed (the turn ended another way), in the usage view as `heldRejects`.
- **Kept under `hr:<commitmentId>`,** so the notice and the counts survive a restart. The adjudicator's kept record fixes the time, so a lost row changes only this view.

### 4. Crow's tools

- **The seller adapter (`serve.mjs`, the hosted and own-seller Workers):** a new `rubricTiming`, default `{"judgeWithinSec": 87000, "appealDecideSec": 87000}`, which an offer with a rubric takes over `timing`. A terms rule's windows still win. `{}` keeps `timing` for every offer. An offer decided by checks alone always takes `timing`.
- **`prepare/offer` keeps `DEFAULT_TIMING` for every deal** [measured, why]. The example client (`examples/verify.ts`) and outside sellers that follow `site/ref/http-seller.txt` recompute `judgeBy` from the documented default of 300 s and refuse to sign anything else. Moving the API's default would break every such client on a rubric offer. ADR-0048 also has `prepare/offer` write the protocol's default for silent terms. So the long windows are written by Crow's tools, and the guide tells sellers which values to send.
- **The buyer's command:** `examples/held-reject.ts` notices a held reject and runs the existing early accept or the buyer's half of a settlement. The pinned buyer bundles (`buy.mjs`, `try.mjs`) do not change.

## Alternatives considered

- **A fixed day on the adjudicator, whatever the terms say.** Simpler to explain. Refused: the adjudicator would choose a value the parties can manage themselves (D31).
- **The primary holds its escalation, so the buyer alone could accept in `Delivered`.** Refused: every flagged deal would wait a day, the ones the appeal accepts included, and ADR-0048 rules out delaying an accept.
- **The fallback holds its reject.** Refused: it adds a day to a deal whose primary already missed its turn.
- **Hand the buyer the signed reject at once** (research open point 4). It would remove the missed-deadline risk. Not in this cut: it adds an endpoint.
- **Change `prepare/offer`'s default for rubric deals.** Tried and measured: the example client refuses the prepared offer (`refusing to sign: body.timing.judgeBy differs from what you asked for`). Refused for the compatibility cost above.
- **Wait for the next contract version.** Refused: one measured case stands behind the change, and it touches no audited code.

## Consequences

- **A refund after a rubric deal's reject waits the hold:** about a day with Crow's tools. An accept is never delayed.
- **A deal whose adjudicators all stay silent refunds about a day later,** and an escalation nobody decides refunds 87,000 s after it, not 300 s [computed from the windows].
- **A rescue returns the whole fee to the buyer** [measured, `held-reject-buyer-accepts`, `held-reject-settled`]. The adjudicator that judged earns nothing. So on every held reject a settlement that pays the seller less than the fee leaves both parties better off than the signed reject, at the adjudicator's cost [measured, `attack.held-reject-fee-dodge`, red team M3]. A pair that plays this gets rejecting panels free; the live judge budget and the per-pair cap on judged deals bound it. Crow's adjudicators carry it during the pilot; ADR-0048 fixes it, since there the fee stays with the decider.
- **Sealed terms are not held:** the adjudicator cannot read a sealed rubric (T-207), so it sees no rubric and signs at once.
- **A held reject that misses its deadline costs a second panel** [measured, `attack.held-reject-missed-deadline`]. The fallback takes over at `judgeBy` and judges again, and its outcome stands. Before the hold an outage had to hit the seconds after the panel; now the instant is known in advance, and the 600 s margin covers the relay.
- **A primary that goes silent holds a rubric deal for `judgeWithinSec`,** now a day, before the fallback may take over. That is the window's cost, not the hold's: the parties chose it.

## Litmus tests

- **Neutrality (ADR-0001): holds.** No new power on chain: an adjudicator could already sign at any second before its deadline, or never. The hold makes Crow's timing a published rule that depends only on the signed terms and the outcome, so it cannot favour one party. Every bound stays permissionless: `judgeBy`, the fallback's turn until `fallbackBy`, the default, and the escrow's expiry. New fixture: `neutrality.held-reject-adjudicator-offline`, where the primary holds and goes silent, and the fallback decides at once after `judgeBy`.
- **The hold (ADR-0002): holds.** The funds stay locked on the settlement layer; nothing moves them but today's moves, each idempotent by the deal's stage.
- **Defended multi-model judgment (ADR-0006): unchanged.** The panel runs once, its result is kept, and no verdict is re-rolled. ADR-0031 section 8 stands: a decision is final when written. Only the time of writing moves.

## Fixtures

`held-reject-buyer-accepts`, `held-reject-settled`, `held-reject-signed-at-end`, `held-reject-short-window-signs-at-once`, `held-reject-accept-signed-at-once`, `neutrality.held-reject-adjudicator-offline`, `attack.held-reject-restart-no-second-panel`, `attack.held-reject-missed-deadline`, `attack.held-reject-changed-delivery`, `attack.held-reject-fee-dodge` (the red team's). The red team's named tests are in `apps/adjudicator/src/hold.redteam.test.ts`. The accept fixture has no `attack.` prefix: that prefix fails a first-instance release, which is what it shows.

## Amendment, 2026-11-25: the gaps the partner C rehearsal found (T-625, D109)

The judged-deal rehearsal on the live build `4b6821c` showed the hold working after an escalation, and found five gaps [measured, the private rehearsal record]. Four are fixed here:

- **The buyer's accept can run against an adapter seller.** The seller adapter now keeps every delivery its own key signs, as it kept the remote signer's, and hands it to the deal's buyer at `GET /deals/<commitmentId>/delivery`, signed by the buyer's key. `shareDelivery` is the seller's choice: `"held-reject"` (the default: only while the deal is `Delivered` and the primary's published reject is not yet signed), `"delivered"`, or `"never"`. The body carries the buyer's own envelope, so the buyer can read the work before it pays (D32). The seller's alternative at that moment is a refund in which it keeps the work.
- **A held record passes the buyer's deal record.** "Judgment names the delivery" no longer needs a decided event when no decision of the record's own role exists: the record was published and not signed, whether still held or closed by a settlement or an accept during the hold.
- **Every judgment record is served.** `GET /v1/commitments/{id}/judgments`, planned since the API review of 2026-11-02, now lists every record, the latest for each role and attempt, oldest first. `GET /judgment` stays the latest. OpenAPI document revision 0.4; no `spec/schemas` change.
- **A rubric default never replaces a seller's value** (D31). From a configuration file, the adapter's `rubricTiming` default fills only the windows the file's `timing` leaves out; a `rubricTiming` the seller writes applies as written.

Not fixed here: **a filter abstention's detail on the member entry.** The member entry in `judgment.schema.json` takes no other field, so it is an API-contract change with a schema version bump, and PR 835 (T-616, ADR-0050) moves the same schema to v0.15 and rewrites the member's verdict. It belongs in that version bump.

**When the buyer's lone accept is reachable** [measured in `packages/judgment/src/aggregate.ts`]: only when the primary itself rejects, so the deal stays `Delivered`. The primary rejects when a required deterministic check fails, or when two thirds of the valid verdicts fail (from two families after any fault) with no screen flag, no suspected injection and no judge output a filter rejected. A single filter abstention at the primary escalates (`aggregate.ts:209`), and after an escalation only a settlement works on today's contracts (ADR-0048 section 7 adds the buyer's accept there in the next version).
