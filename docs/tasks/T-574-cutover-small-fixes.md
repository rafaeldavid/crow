# T-574: The small defects the contract cutover left

- **Lane:** shipping (tests, operator, core, tooling)
- **Phase:** 2
- **Depends on:** T-563, the cutover to the fixed phase-one contracts; T-559, the operators' early refusals
- **Paths this task may touch:** `apps/adjudicator/src/hung-read.test.ts`, `apps/adjudicator/src/drand-fork.test.ts`, `apps/demo-cloud/src/limits.attack.test.ts`, `apps/demo-cloud/src/worker.ts` and its test, `apps/operator/src/server.ts` (the JSON body reader) and `apps/operator/src/body-limit.test.ts`, `packages/core/src/parse.ts`, `packages/core/src/state.ts`, `packages/core/src/validators-codegen.ts` and the generated `validators.generated.ts`, new tests in `packages/core/src/`, `packages/settlement/evm/evm-settlement.ts` (the decide case only) and `packages/settlement/evm/appeal-ground.test.ts`, `tools/duet/replay.ts` and `tools/duet/duet.test.ts`; `site/setup.mjs`, rebuilt for item 3 only, in its own pull request held for a deliberate re-pin (the coordinator, 2026-11-19); for item 6, `apps/demo-cloud/src/judges.ts`, `apps/demo-cloud/src/world.ts` (the adjudicators' construction and pass) and their tests; this file
- **Human gate:** no for the merges. The operator deploy that carries items 2, 5 and 6 is Rafa's; the coordinator arranges it.
- **Status:** review
- **Agent/session:** the T-574 session, started by the coordinator on 2026-11-19 ("Start all seven")
- **Roadmap row:** N211

## Intent

The cutover of 2026-11-19 and the review of T-559 left five small defects, none blocking. This task fixes each one with a test that fails before the fix, or drops it with the reason. Nothing new: no route, field or message. Three kinds, in three small pull requests, and a fourth for item 6:

1. **Tests that depend on the clock or the network** become deterministic, and each still proves what it proved.
2. **Operator and core:** a JSON body over a route's limit costs about that limit to refuse, not 10 MiB; one rule in core says what "no appeal ground" is, matching the rules contract; a beacon without its signature is told so; the API hostnames answer `/.well-known/security.txt`.
3. **Tooling:** the duet tool's published page keeps its record links whole.
4. **Item 6, added by the coordinator on 2026-11-19 from T-570's red team (High on the test network):** the demo's judge panel is live or scripted as a whole. A live seat's retry must never be answered by the scripted judge, whose pass would count as a second model family.

Non-goals: no schema rule changes (item 3 changes only the error text), no change to what the contract accepts, no deploy.

## Acceptance criteria

- [x] Each of the six items is fixed or dropped with its reason (Evidence).
- [x] Each fix has a test that fails before it and passes after it.
- [x] The three tests of item 1 assert at least what they asserted before, and none reads the wall clock for a bound.
- [x] Item 2(b): a property test shows the core rule refuses an appeal ground exactly when the rules contract would.
- [x] Each pull request has a reviewer subagent's report, and every finding of Medium or above is fixed with a test.
- [x] The coordinator knows which items need an operator deploy and which a site deploy.

## Evidence

All measured on 2026-11-19 on this Mac, on `origin/main` `22dd494a` plus each branch, unless labelled otherwise. Outputs are in `reports/scratch/t574-*` on the maintainer's machine (not committed).

**Every item is real** [measured where a test or a run shows it; inferred from reading the code otherwise]: each was confirmed against the code before its fix. None is dropped.

### Pull request 1: tests only (item 1)

**1(a) `apps/adjudicator/src/hung-read.test.ts`.** Four tests bounded a pass by the wall clock: "many stuck deals" (under 5 limits), "a registration read that never answers" (under 4 limits, the one that read 238 ms against 160 ms), "a pass waits out at most PASS_WAIT_LIMITS limits" (under 4 limits) and "offers come after the turns" (under 1 limit). They now run on fake timers (`setTimeout`, `clearTimeout` and `Date`; `setImmediate` stays real), so time moves only when one of the pass's own timers fires. What each still proves, now exactly:
- many stuck deals: the second pass waits at most what is left of one limit, never five (was: under five);
- a registration read that never answers: the pass waits exactly one limit for five deals (was: under four);
- PASS_WAIT_LIMITS: the pass waits exactly 2 full limits and 3 tenths, 1,150 ms of fake time at a 500 ms limit (was: under 2,000 ms);
- offers come after the turns: the delivered deal is judged before any wait at all (was: under one limit).

The driver gives the pass real turns of the event loop while no timer is due, and fires the next timer only then. The store reads in this file are in-memory and settle in promise steps; the one real asynchronous step, the WebCrypto decrypt, runs between reads, when no time limit is pending, and the driver then gives real turns without moving time [inferred from the code; the reviewer measured at most 16 turns for one decrypt against the driver's 10,000]. While it fired a timer, `process.getActiveResourcesInfo()` listed only the stdio pipes [measured]. Under a load average of 34 to 58 (ten busy loops on 8 cores), one run of the file passed 13 of 13 tests; the old file passed too at that load, so the old failure does not reproduce on demand [measured].

**1(b) `attack.t422-replay-cpu` in `apps/demo-cloud/src/limits.attack.test.ts`.** It now counts body work instead of timing it. With a budget of 12 writes a minute and one accepted faucet grant of 991,954 bytes, 36 replays answered 12 with 200 and 24 with 429, a burst of 12 more was refused 12 of 12, the operator parsed the body 12 times, and a stranger's read answered 200 [measured]. With the replay budget removed from `knownKey` (a mutation, reverted), all 36 replays were answered, none of the burst was refused, and the body was parsed 48 times: the test failed [measured]. It proves the count bound of T-422's fix for the red team's F3; the cost of one replay of a body of about 1 MiB is T-422's measurement (75 ms), so the cost bound is the budget times that [documented].

**1(c) `apps/adjudicator/src/drand-fork.test.ts`.** Forking a public Sepolia node at its head failed 1 of 6 times with `block not found: 0xb9b760`; anvil exited [measured]. The fork now starts 8 blocks behind the node's head (`FORK_BEHIND`), and 10 of 10 forks started [measured]. A fork at that block runs its clock 99 to 120 s behind; `anvil_setTime` brings it within 1 s, which the test now calls before its deals, since they are timed by the wall clock and the drand rounds by real time [measured]. The whole test then passed against a public Sepolia node, 1 of 1 in 168 s [measured]. It still proves that the fallback and the appeal adjudicator decide from live quicknet rounds, that the rules contract accepts both decisions, and that a bad proof never reaches it.

**Local checks (kind 4 for the test files).** `pnpm exec vitest run` over the three files: 2 files passed, 1 skipped (the fork test, without `SEPOLIA_FORK_RPC`); 25 tests passed. `pnpm build` (typecheck) exit 0; `pnpm exec eslint` on the three files exit 0 [measured].

### Pull request 2: operator and core (items 2 and 5; item 3 in its own pull request)

**2(a) A refused JSON body costs about its route's limit.** Since T-559, `body()` in `apps/operator/src/server.ts` read on past a route's limit to keep the connection usable, but up to the ciphertext ceiling (10 MiB) on every JSON route. It now reads on only to `bodyCeiling(limit)`: the limit plus `BODY_READ_ON_BYTES` (1 MiB), at most 10 MiB. Through the Worker's fetch entry, a body that never ends on `/v1/commitments` (limit 1 MiB) was read to 10,551,296 bytes before the fix and to at most 2,228,224 bytes after; each of the four JSON routes now stops within two 64 KiB chunks of its own ceiling [measured, `apps/operator/src/body-limit.test.ts`]. A body up to the ceiling is still read to its end, so the T-559 test (limit plus 512 KiB, the connection reused) and T-547's 2 MiB ciphertext test still pass [measured].
- **The trade, found by the review:** a body past the ceiling is cut off and its connection reset, as a body past 10 MiB was before; a Node client then sees `ECONNRESET` instead of the 413, and the review measured the next request on a reused keep-alive socket failing too, for bodies of 2.5 and 3 MiB on a 1 MiB route [measured by the reviewer]. A 413 with `connection: close` does not help: stopping the read resets the upload before the answer arrives (the client saw no status in 3 of 3 runs) [measured]. A clean answer needs the server to read on, which is the cost this item removes. The operators' Worker refuses a body by its declared `Content-Length` before the operator reads it, so only a chunked body on the live service reaches this [inferred from `apps/demo-cloud/src/limits.ts`]. `body-limit.test.ts` pins it: a body 1 MiB past the ceiling gets a reset or a 413, never an answer.

**2(b) One rule for "no appeal ground".** The signed message encodes an absent ground as the empty string (`packages/core/src/eip712.ts`), and the phase-one rules contract refuses any decision whose `appealGroundHash` is not keccak256("") (`HoldbackRules`). So a decision without the field and one with `appealGround: ""` are one signed message. Core refused `""` at the primary, the fallback and the escalation; the EVM relay passed it. On anvil, before the fix, a primary's accept with `""` was accepted by the contract and then refused by the relay's mirror: `EVM/core divergence: the contract accepts decide but core refuses decide in Delivered: invalid_terms: appealGround belongs to appeal decisions only` [measured]. `carriesAppealGround` in `packages/core/src/state.ts` is now the one rule; core and the relay both use it.
- A property test (`packages/core/src/state.test.ts`, "no appeal ground, as the rules contract reads it") runs the three phase-one turns that take a decision against absent, `""`, the four schema grounds and arbitrary non-empty strings. Core refuses a ground exactly when its keccak256 differs from keccak256(""), the contract's own test, and a decision with `""` ends in the same state as one without the field. Before the fix it failed 3 of 4; after, 4 of 4 passed [measured]. The same file shows that the two forms have one EIP-712 digest.
- On anvil (`packages/settlement/evm/appeal-ground.test.ts`), a primary's accept and an escalation's accept with `""` land, on chain and in the mirror; T-559's three tests that refuse a real ground still pass [measured].
- The operators' API still refuses `appealGround: ""` by the schema's enum. That refuses a form, not a signed message: the same signature is valid without the field. Changing it needs an ADR (`spec/schemas/` is the API contract), so it stays.

**3. A beacon without its signature is told so: in its own pull request, not merged.** Any fix to this text changes `packages/core/src/parse.ts`, which the pinned `site/setup.mjs` carries. Rebuilt from the branch, `setup.mjs` went from 2,442,746 to 2,411,720 bytes; with item 3 reverted it was byte-identical, and so were `buy.mjs`, `try.mjs`, `try-sell.mjs`, `try-judged.mjs`, `try-reclaim.mjs` and `preflight.mjs` either way [measured]. The coordinator chose on 2026-11-19 to take item 3 out of pull request 726 and hold it for a deliberate re-pin of `setup.mjs`. What follows is item 3's evidence on its own branch, `t-574-message-error`. The messages schema is a oneOf, and the parser reported its first error, the first branch's: a fallback Decision whose drand beacon had no signature read `messages: / must have required property 'seller'` [measured]. The validators now include one validator per message type (`messages#Decision` and so on), and `parse.ts` explains a refused message with the validator of the type it names: the same Decision now reads `messages: /beacon must have required property 'signature'` [measured].
- The first version picked the branch's error from the oneOf's errors, by the order Ajv checks keywords. The review found it wrong: Ajv checks a branch's `allOf` and `if` before its required fields, so every bad field of a Dispute read `messages: / must NOT be valid`, a Decision's rule [measured by the reviewer]. Running the named type's validator alone needs no such argument.
- To export each type's validator, the generator now compiles references as functions instead of inlining them (`inlineRefs: false`). That makes the generated code about 99 KB smaller; the per-type exports are second copies of the oneOf's own functions, about 120 KB; net, the file grows 21,315 bytes (957,528 to 978,843 bytes) [measured by the second review]. Its every function is rewritten, so its diff is large. `validators.test.ts` checks that the precompiled code matches a runtime compile with the same options, and that every example and mutation gets the same answer as the inlined compile [measured: 6 of 6 tests passed].
- `packages/core/src/parse.message-error.test.ts`: a beacon without its signature; every example without each required field; every example with an extra field; every example with each field of the wrong kind, which must be named (the review's probe); every example still parses; an unknown type. Against the parser before T-574, the wrong-kind test failed on the first example [measured]. 8 of 8 pass.
- The rule is unchanged: the whole schema still decides, and the per-type validator only explains a refusal [inferred from the code: `validate()` decides before `messageError` runs].
- `validators.generated.ts` changes only through its generator (`node packages/core/scripts/validators.ts`); `validators.test.ts` fails when it is stale.

**5. security.txt on the API hostnames.** Both `api.crow.direct` and `api2.crow.direct` answered 404 at `/.well-known/security.txt` (the task's brief). The operators' Worker (`apps/demo-cloud/src/worker.ts`) now answers a GET or HEAD there with a 301 to `https://crow.direct/.well-known/security.txt`, before any world is opened and without needing a settlement. RFC 9116 allows a redirect, and the site's build stays the one place that sets Expires. `apps/demo-cloud/src/worker.test.ts` ("security.txt on the API hostnames") checks both hosts and both methods, that SECURITY.md names the same URL, and that a POST there or a near path is not redirected [measured]. The redirect is the smaller fix: serving the file from the operators would need the Expires date in a second place.

### Pull request 3: tooling (item 4)

**4. The duet publish keeps the record links whole.** `forPublishing` in `tools/duet/replay.ts` shortened every long hex string on the page, the `href`s of the endings' record and transaction links included, so each led nowhere. A link to a deal's record on the live service or to its Sepolia transaction (`PUBLIC_LINK`, built from `tools/duet/endings.json`) now keeps its hex; every other long hex string is cut as before, in text and in other links. The scenario tests still find no 40-hex string on a published page once those links are taken out. Against the old publish, 2 tests failed: the 10 links of the endings section differed, and the "paid" scenario found no whole record link; after, `pnpm exec vitest run tools/duet` passed 51 of 51 [measured].

### Pull request 4: the demo's judge panel (item 6)

**The defect, reproduced.** `apps/demo-cloud/src/judges.ts` chose live or scripted on every judge call. In a world test with a stand-in for the live models, where the first DeepSeek call answers HTTP 503 and the day's budget holds 3 calls, the panel judged live had 1 of its 3 members scripted: the retried seat, whose scripted pass counted as the second family [measured: `expected [ 3, 1 ] to deeply equal [ 3, +0 ]` before the fix].

**The fix.** `PanelConfig.panel(size, run)` chooses once per panel, and the world runs each adjudicator's decision task inside it; one task runs at most one panel. Inside a live panel every call goes live and is counted, retries included; a call outside any panel is scripted. A panel goes live only when the budget holds twice its size, a first call and one retry for each seat, so "at most N live judge calls a day", as discovery and the notes say, stays true. The panel's size is the policy the deal bound. Panels queue: one asked for while another is open waits for it. A day the pass crosses midnight from is written before the next day is loaded.

**Tests** [measured]: `apps/demo-cloud/src/judges.test.ts` (4 tests), `judges.redteam.test.ts` (the red team's 2 tests, both failing before), and "chooses live or scripted once per panel" in `world.test.ts`. With the fix, the panel above runs 3 of 3 seats live and 4 calls are counted; the next panel is scripted as a whole and every member's rationale starts "[fake judge, no model ran]". The three files pass 55 of 55 tests. `packages/judgment` is unchanged.

**What the operators report.** `GET /v1/commitments/<id>/judgment` returns the record; a scripted member's rationale starts "[fake judge, no model ran]". With one choice per panel, a panel is scripted exactly when all its members carry the mark, so a reader such as the demo script (T-569) can tell. No new field: the record's shape is the API contract.

## Handoff

**Done.** Five items are fixed, four of them merged and items 2 and 5 with pull request 726; item 3 is fixed and waits; none was dropped. Pull requests: 721 (item 1, merged as `9b732e63`), 727 (item 4, merged as `8065d37b`), 728 (item 6, merged as `cf60e083`), 726 (items 2 and 5), and item 3's own pull request from branch `t-574-message-error`, not to be merged until a deliberate re-pin of `site/setup.mjs`.

**Item 3 waits for the re-pin.** It changes the pinned `site/setup.mjs` (Evidence, item 3). Pull request 714 (the deliver command), merged on 2026-11-19, already changes `setup.mjs`, so the next site deploy carries a deliberate re-pin. If item 3's pull request is green and reviewed before that deploy, the coordinator decides whether it rides along; if not, it waits for the re-pin after. To resume: bring `origin/main` into `t-574-message-error`, run `node packages/core/scripts/validators.ts` and `node site/build.mjs`, and check the new `setup.mjs` hash in `site/llms.txt`. Each had a reviewer subagent; items 2(b) and 6 also had a red-teamer. Every Medium was fixed, with a test where a test can show it.

**Deploys.** An operator deploy carries items 2, 5 and 6: the body ceiling, the appeal-ground rule in the relay, the security.txt redirect and the judge panel; item 3's parser text joins whichever deploy carries it. It is Rafa's; the coordinator arranges it. No site deploy is needed: item 4 reaches the demo page at the next `duet publish` and site deploy. Item 1 is tests only.

**Found, not fixed (for the triage file):**
- `attack.t422-known-key-cpu` in `apps/demo-cloud/src/limits.attack.test.ts` still bounds by the wall clock (`heavy < fresh * 2`), the same failure kind as item 1 (review of PR 721).
- `apps/demo-cloud/src/live-fork.test.ts` still forks at the RPC's head; the pinned block of item 1(c) would help it too.
- `packages/settlement/evm/deploy-script.test.ts`, "the rehearsal command runs the whole routine twice on a local chain with no hand edit", failed once at 124.5 s in a full run of PR 726's packages under load, well inside its 900 s timeout, and passed alone in 155.7 s [measured]. An intermittent failure: to root-cause, not rerun.
- The API's schema refuses `appealGround: ""`, a form of a message the contract accepts; the same signature is valid without the field. A change needs an ADR (red team of 2(b), Low).
- A full-profile appeal decision's ground is never checked against the party's appeal; harmless while nothing reads it (red team of 2(b), Info).
- The site's security.txt names only `https://crow.direct/.well-known/security.txt` as Canonical, so a strict checker may flag the API hostnames' redirect; `site/trust.mjs` could list them (review of PR 726, Info).
- The ciphertext route still reads on to 10 MiB past a node's 1 MiB limit, T-547's choice; item 2(a) covered the JSON routes only.
- Item 6, red team, Medium: past the day's live budget a seller can steer a rubric deal into a scripted panel that accepts, and its members still name the live models. It predates T-574 and `docs/operations.md` documents it. The coordinator has put it to Rafa, recommending that the scripted stand-in abstain in a live world.
- Item 6, Info: the pass-level live check in `world.ts` sizes by the adjudicator's role in the world, not the task's (conservative); the live-call count is written only at the end of a pass.
- The reviewers suggest a second review by another model family for item 6 and for items 2(b) and 3. `docs/team.md` makes that Rafa's call.
