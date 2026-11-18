# T-535: case study 3, four paths the protocol already has, on the revised security-review form

- **Lane:** research, with live test deals on Sepolia
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 9 (live tests on testnet) and 10 (research): one run per deal, then its log read; a review of the record
- **Depends on:** T-534 (version 2 of the form, holdback pull request 661)
- **Paths this task may touch:** `docs/research/2026-11-18-case-study-3.md`, `docs/research/2026-11-18-case-study-3/` (`terms.ts`, `waiver.ts`, `late-work.ts`, `note-check.ts`), `docs/research/README.md` (one row), this file
- **Human gate:** no (test tokens only; no deploy)
- **Status:** done with the merge of pull request 665 on 2026-11-18, after CI passed and the review's findings were fixed
- **Agent/session:** the T-534 session, 2026-11-18, branch `t-535-case-study-3`
- **Roadmap row:** N40

## What exists

Every path is in `docs/what-a-deal-can-do.md`, and none is built here:

- the main path, ending Released;
- "The seller's check before delivery, and why a deal was refused";
- "Reclaim after the deadline";
- "Settling late work", which also serves a seller that holds work that fails a check;
- "A judgment with no price held".

The record of a waiver's note is ADR-0039, section 4, and D78, which Rafa decided on 2026-11-18: a hash in the settlement's existing `nonce`. The tools used are `examples/audit-deal.ts`, `examples/try-sell.ts`, `examples/agent.ts` and `examples/evidence.ts`. This task adds three small scripts in its research folder:

- `terms.ts` fills a terms file from the form;
- `waiver.ts` runs the waiver as ADR-0039 section 2 describes it, which no command does yet; `late-work.ts` is the first run's script, the late-work variant, kept as the record of what ran;
- `note-check.ts` gives a reader the waiver's check, which `evidence.ts` does not cover yet.

## Intent

Run, on version 2 of the form and on public reports from a firm that did not shape it, the four paths a review of 2026-11-18 chose (private, `strategy/2026-11-18-review-after-the-reading.md`, decision 3). Rafa said yes to that review. Record each deal's ID, times, amounts and transactions. Record what a reader can check offline, the approvals a person would give, and the seconds from funding to the final state. If a path needs something the protocol lacks, stop there and report it.

Non-goals: any change to the product, the site, the contracts, the schemas or the hosted sellers.

## Acceptance criteria

- [x] Deal 1, a pass at first presentation, on a held-out report converted by the mapping: Released.
- [x] Deal 2, a refusal the seller sees before it delivers, ending as its terms say: Refunded by reclaim. The seller saw the check in its log and alert; a hosted seller's health page was not exercised (Evidence).
- [x] Deal 3, a waiver with the note in the settlement's nonce, as the decision record confirms: Settled, and the note checked from the transaction.
- [x] Deal 4, price 0 and a fee above 0: Released.
- [x] Before each deal, its checks ran on one real report of the firm.
- [x] For each deal: ID, times, amounts, transactions, the reader's check, approvals and seconds from funding to final.
- [x] The pull request merged after CI and a review (two passes: ISSUES, fixed, then PASS).
- [x] A private note, `strategy/2026-11-18-case-study-3.md`, in the private repository.

## Evidence

All measured on 2026-11-18 on Sepolia (chain 11155111) through `https://api.crow.direct` and `https://api2.crow.direct`, after the coordinator's word at about 17:50 UTC that the deploys of that afternoon were done. The terms were version 2 of the form (`examples/seller-adapter.template.json`, SHA-256 `e5460866…f1976`), filled by `terms.ts` with each report's own commit and files. Token: tUSDC, `0x0b3d947f594b59fc1fb7d02e62c6795f8118ca6d`, 6 decimals. Adjudicators: Crow's demo primary `0xa909f87a64fbe6982c838c1c1bf2973cda7823ed`, fallback `0xbae8249acaaa526d15680441dfc5071bd8dd0e89`, appeal `0xadceed335a5d4274e8cc4543eeeb53f542d140b0`. The rules contract is `0x3be45128565abbc35dbd4660716b703ff489f1b4`.

**The gate, before any deal was signed.** `node examples/check-delivery.ts` on one of the firm's layout-set reports (`shieldify-l6`), with terms filled from that report's own scope: accept, all four checks passed. Each deal's own report was also checked by its seller's check run before delivery, or before the waiver.

**Deal 1: a pass at first presentation.** Report `shieldify-6`, held out, 9 findings, 23,288 bytes as converted.
- Run: `pnpm audit-deal --live --case released --report <report> --terms <terms> --scope <scope>`, exit 0.
- Commitment `0xeda0000a3f6fdfcb029d85f722ebced3aa3d56b538fef8455af4f6b30e1fb1da`. Seller `0x2c425326a83f1fbb8935297e49245751cb8db686`, buyer `0xc43cbd53896788b024293b84e594ebd9855f866c`.
- Times: offered 17:54:50 UTC, adjudicator accepted 17:54:52, funded 17:55:24, delivered 17:55:36, decided accept and Released 17:55:48. Funding to final: 24 s.
- Money: 41.00 tUSDC held. The 40.00 price went to the seller and the 1.00 fee to the adjudicator; the operator fee was 0.00.
- Transactions:
  - funding `0xaaaf5726273f6d17d280d646db07d36a2a5148b49b8105c20143ee4b70afb8a2`;
  - delivery `0x2574f5f441cdcc210582b7cbc16c84c61263041f42a146cc8e2bb7f87bb7cab1`;
  - decision `0x886bf81b386987abd4bb488de1679d5676ba2df5f8a2066c0d20ff14a8752348`.
- Reader: `examples/evidence.ts fetch` then `check`: PASSED, 54 offline checks. The judgment record shows the four checks passed and no panel. The one chain read left is the decision's receipt.

**Deal 2: a refusal the seller sees.** Report `shieldify-l4`, 6 findings, one Medium, no proof files. The terms add the Medium-or-higher proof check of `site/ref/checks.txt`, with 900 s to deliver.
- Run: the same command, exit 1, ending "Held, not the expected Released", as `audit-deal` reports a refused report.
- Commitment `0xf5b89f3d9141b7bb4bb9729b9c145a56922c5b373ea9b78623267bf05acf1d6d`.
- Times: offered 17:56:51 UTC, funded 17:57:24, refused by the seller's check run at 17:57:26.773 by the adapter's clock, due at 18:11:50, reclaimed by the operators at 18:13:00 (`settlement.reclaimed`, actor `anyone`): Refunded. Funding to final: 15 min 36 s, of which 14 min 26 s was the agreed window. Seller `0xd592645847b944076f19dc2d0f1f33eaf0be2d49`, buyer `0x445058974cb6131961f8a2fd260213792a7f4d2f`.
- The seller's log: `REASON refused at checks: FAIL proof (required) /findings/0: anyOf not satisfied`, then an `ALERT … delivery.refused (attempt 1)` that holds the delivery until `deliverBy`.
- Money: 41.00 tUSDC held, and all 41.00 back to the buyer, read from the reclaim receipt's one token transfer.
- Transactions: funding `0x9cde91affce4dea519ca09b302782a73f6e423f3001afa5221af80ba56e2746c`, reclaim `0x2c8227e379353c0a19f605510f546e8854eddcbaee90b5e5e77a748d4737a9be` (block 12163136).
- The health page: `/health` is a hosted seller's route, and the plain adapter has none, so a poll of it every 0.3 s answered nothing. The deal's own route, `GET /deals/<commitmentId>`, gives the same reason, but `audit-deal` closed the adapter right after the refusal. So the refusal was seen in the log and the alert, and the health page is untested here.
- Reader: `examples/evidence.ts fetch` stops with exit 2 ("judgment answered 404"): a reclaim has no judgment, and the command does not cover it yet. The reclaim receipt, read from a public Sepolia node, shows success and the 41.00 tUSDC transfer to the buyer.

**Deal 3: a waiver, as ADR-0039 section 2 describes it.** Report `shieldify-l3`, 13 findings, three Medium, no proof files, under the same added proof check. The gate: `check-delivery` on it with these terms rejects on `proof` alone.
- Run: `node docs/research/2026-11-18-case-study-3/waiver.ts --report <report> --scope <scope> --price 40000000 --add-check <proof check> --out <dir>`, exit 0.
- Commitment `0x8c874253fd8405cf3112234526cc28605f395ad527c77698a02e851449773cf4`. Seller `0x71a7a79825a445b245adac1638c8200e5ddb0c4d`, buyer `0x929a6ff9696c51bb7e15b43c64feb4e24953aad5`.
- Times:
  - offered 18:22:06 UTC, adjudicator accepted 18:22:08, funded 18:22:12;
  - delivery signed and held, and the waiver offered: the failing check, the delivery's fields and 4 envelope hashes, no envelope, at 18:22:14.051 by the script's clock;
  - the buyer recomputed the delivery's hash from those and it matched, 18:22:14.052;
  - the buyer countersigned, the seller submitted, Settled at 18:22:24;
  - the buyer opened its envelope after the settlement, and its own check run failed `proof`.
- Funding to final: 12 s.
- Money: 41.00 tUSDC held. The settlement paid 40.00 to the seller and returned the 1.00 fee to the buyer, read from the settlement receipt's two token transfers.
- Transactions: funding `0x140014b27900c789f9fb5693cdda26aa7b77665d8ac503d7f1ed62535f57ff59`; settlement `0x96b0d7b9600c5f457ad8cd06b0072dd24399188b0c780e8193d97af4ceaadb83`, block 12163181.
- The note: kind `waiver`, the held delivery `0x83cbbef3…42fb`, waived checks `proof`, salt `0x67173871…c5a6`. Its hash, `0xf93bcf1f21754f4ee38b3dfbf86d0b6b4475874d7313b9a8c2754975699d17c0`, is the settlement's nonce. The full note is in the research note.
- A step ADR-0039 does not name: the operators' prepared settlement carries the whole delivery, envelopes included, in its submit body. The seller removes it before it hands the prepared settlement to the buyer, and the script refuses to go on if anything the buyer gets holds an envelope's ciphertext.
- Reader: `node docs/research/2026-11-18-case-study-3/note-check.ts --tx <settlement> --note <note.json> --commitment <ID>`. PASSED, seven checks, from the transaction and its receipt alone. The check fails on the note with `waivedChecks` set to `scope` (the hash), and on the note with an extra field (the fields), each with exit 1. `examples/evidence.ts` does not cover a settlement by agreement yet.

**Before it, the late-work variant (not ADR-0039's waiver).** The first waiver run used `late-work.ts`. It handed the buyer the whole signed delivery, its envelope included, so the buyer opened the work before it signed, and the buyer submitted. That is "Settling late work" (`site/ref/after-funding.txt`), and with a buyer you do not trust it gives the free look ADR-0012 prevents. The review found this against ADR-0039 section 2, step 2, and deal 3 above ran it again.
- Commitment `0x965d887e9db6d53f8770d942ee8947a7422302c870df8db161b16ab2db3c145a`, report `shieldify-l2`. Funded 17:59:12 UTC, Settled 17:59:24 (12 s).
- Money: 40.00 tUSDC to the seller and the 1.00 fee back to the buyer.
- Transactions: funding `0x9816bc2cb9a129c169115b63b5f946c8b19497bc8f93e0b081c9ab300812a313`; settlement `0x683d9248890746502ea4083e4c1c1e36fc01d04624e814f46d5977462f0ee099`, block 12163071.
- The note `0xc1d9a138…8872b` passes the same seven checks.

**Deal 4: price 0, fee 1.00.** Report `shieldify-l5`, 2 findings, 3,048 bytes, sold to Crow's test buyer (`0xd0a29422c5515a0ee31586a379a649803821dc29`).
- Run: `node examples/try-sell.ts --work <report> --terms <terms with "price": "0">`, exit 0.
- Commitment `0x75efb4ebc9ea6341c2fbd4cb1266dedd5b5a097e6faf53883c0df8971aff719c`. Seller `0x7c82ac…6067`.
- Times: offered 17:59:16 UTC, accepted 17:59:17, funded 17:59:24, delivered 17:59:36, decided accept and Released 17:59:48. Funding to final: 24 s.
- Money: 1.00 tUSDC held, the fee alone; the adjudicator was paid it and the seller received 0.00.
- Transactions:
  - funding `0xd16d3722aa78d5aedff5c068e01229429b9d1961e6531a5a1f4fecd4274ddf7b`;
  - delivery `0x069de2b4f700e5a39006c2b0445320469207ddb8ca1a24eef8f3e90675646cdb`;
  - decision `0x40abe267a15da04661a32e1cd42ac82385f6ebc604fd3032dce4c8f9c0d55635`.
- Reader: `examples/evidence.ts check`: PASSED, 54 offline checks, naming "the price 0.00 tUSDC and the adjudicator's fee".

**A waiver attempt that stopped after funding.** Deal `0x04aa0bb5d0aa80b34f76d8382aabe072e6653affa17b8b8954e67a5053e5c85a`, funded with 41.00 tUSDC at 18:21:24 UTC (`0x7685825602fd69f3109b9850f92daaacc0713faced96f04cf01ff37a1b7eef8b`). The buyer refused, correctly, to sign a prepared settlement whose body carried the delivery and its envelope, and the script stopped. Nothing was delivered. The deal stays Held until `deliverBy`, 19:21:16 UTC, and the operators then reclaim it to the buyer, as they did deal 2 (inferred).

**Starts that failed before any money moved.** Each was caused by this task's input, and none by the protocol:
- `audit-deal` refused a terms file that named the local token symbol, before any deal opened.
- The operator refused an offer whose funding window equalled its delivery window, `invalid_terms: fundBy < deliverBy`.
- The first waiver run agreed before the adjudicator accepted, `acceptance_missing`. That left offer `0x008cea978240a8217f36ad69d430395cd7a44ec6f3b52f8f1dc286162f91b7cd` unfunded until it expired.

**Approvals a person would have given (inferred):** deal 1: 1; deal 2: 1; deal 3: 3 (the buyer's yes to the offer and to the waiver, and the seller's yes to the waiver); deal 4: 1, which Crow's test buyer gave by its standing rules.

**The review (one reviewer agent, 2026-11-18): ISSUES, none blocking; it reproduced every ID, time, amount and receipt.** Fixed:
- the waiver deal did not follow ADR-0039 (Medium): rerun as deal 3, the first run kept and labelled;
- `note-check.ts` accepted unsigned extra fields: it now refuses them and checks a waiver's own fields, and exits 2 when a node does not answer;
- this file said the held-out six stay unread, though deal 1 delivered one: now "the other five";
- two claims had no label: labelled below.
Recorded as a follow-up: CI does not lint or type-check these scripts, and they import viem through `examples/node_modules` by path, so a viem upgrade could break a rerun silently.

## Decisions

- **The case study uses the second held-out firm.** The first publishes summaries with no findings (T-534). Deal 1 used the newest held-out report; the others used the firm's layout-set reports, so the other five held-out reports stay unread.
- **The refusal and the waiver turn on a term the buyer adds.** Version 2 of the form has no proof check by default, and every held-out report passes it (measured, T-534). So the buyer's own term, proof on Medium-or-higher findings, is what a real report fails. A buyer's term the seller's report does not meet is one of the ways the pilots were refused (inferred; D78 records that the first pilot refusal was the seller's own conversion).
- **The waiver note carries the nonce as ADR-0039 says,** because its record confirms the bridge. The note's text is published in the research note. The operators do not yet put it in the transaction.

## Handoff

- Done: the four deals and their record.
- Rerun, from a checkout at this task's merge, after `pnpm install --frozen-lockfile && pnpm build` and the corpus run of `examples/security-review-form.md`:
  1. `node docs/research/2026-11-18-case-study-3/terms.ts --scope <scope.json> --price 40000000 --deliver-within 3600 --token 0x0b3d947f594b59fc1fb7d02e62c6795f8118ca6d --out terms.json`, where `scope.json` holds a converted report's `commit` and `filesReviewed`, and `lines`;
  2. `pnpm audit-deal --live --case released --report <converted report.json> --terms terms.json --scope "$(cat scope.json)"`;
  3. for the refusal, add `--add-check <proof check> --deliver-within 900 --offer-within 300 --fund-within 600` to step 1;
  4. for the waiver, `node docs/research/2026-11-18-case-study-3/waiver.ts …` as in Evidence;
  5. for the judgment at price 0, `node examples/try-sell.ts --work <report> --terms <{"price":"0","deliverable","checks"}>`.
- Follow-ups, for the coordinator to weigh:
  - `examples/evidence.ts` should cover a reclaim and a settlement by agreement, with the waiver's note; the planned single record command (decision 6 of the review) is the place;
  - `audit-deal` could keep the adapter up after a refusal, so its deal route can be read;
  - the waiver needs a script today, and ADR-0039 plans the hosted seller's offer of it. When it is built, the prepared settlement the buyer gets must not carry the delivery, as `waiver.ts` strips it; a second-family review of that build should check who sees the envelope before the buyer signs, who submits, and the key proof;
  - CI does not lint or type-check the scripts in this research folder.
  - From the re-review (PASS on `0cecad94`), for the hosted waiver: before it countersigns, the buyer should fetch the public ciphertext and check its SHA-256 and byte count, and check the delivery's `plaintextMime` against the terms' format, its `attempt` and its `cipher`; `waiver.ts` compares hashes only. The buyer also cannot check before paying that its envelope opens: the contract checks only that the envelope is the one the delivery commits to, so the signed `plaintextSha256` is the evidence it keeps (D26). The planned second-family review should weigh both.
