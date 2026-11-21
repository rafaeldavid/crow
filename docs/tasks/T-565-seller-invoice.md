# T-565: the seller's invoice and credit note from a finished deal

- **Lane:** examples
- **Phase:** 2
- **Depends on:** T-333 (the deal record), T-531 (the research, task 2 of its section 8), T-538 (the proof of purchase)
- **Paths this task may touch:** `examples/seller-invoice.ts` and its test (new), `docs/research/2026-11-19-invoice-and-credit-note.md` (new), `site/ref/after-funding.txt` (one section), `site/sell.txt` (one pointer in step 10), this file.
- **Human gate:** no. A site deploy that serves the new section is Rafa's.
- **Status:** done (merged in PR 701, 2026-11-19)
- **Agent/session:** the T-565 session, 2026-11-19, branch `t-565-seller-invoice`.
- **Roadmap row:** N198
- **Change kind:** 4, example code a party runs with its tests; 1 for the research note and the reference section.

## Intent

Restated in my own words.

Rafa lifted the hold on row N198 on 2026-11-19: review what normal invoices and credit notes carry in the US and Europe, then ship a first version and refine it from users' feedback. A seller that sold through Crow needs to issue its own invoice, and a credit note when it refunds money it invoiced. The deal already proves what was sold, for how much, when it settled and where the money went. This task adds one command the seller runs on its own machine over the deal record it already keeps. The command checks the record first and writes the invoice or credit note as JSON and as a printable page. Everything the deal does not know (the seller's legal name, address and tax number, its numbering, its tax treatment, the buyer's details, any fiat rate) comes from the seller. The command decides no tax question and adds no route, storage, schema field or signed message.

## Acceptance criteria

- [x] A short, sourced review: `docs/research/2026-11-19-invoice-and-credit-note.md`, with a table of fields, where a Crow deal gets each, and whether the first version carries it.
- [x] `node examples/seller-invoice.ts <deal record> <seller details file> [options]` reruns the record's offline checks, requires every check the record ran to have passed, and refuses an unfinished or unverifiable deal by name.
- [x] It writes an invoice for a Released deal and for the seller's share of a settlement, and a credit note for a refund or the refunded part of a settlement, as `<number>.json` and `<number>.html`.
- [x] Each document carries the deal ID, the on-chain references, the amounts in the token with its name, the parties as each disclosed them, the seller's own number in its series, and a foot that says what the document is and is not.
- [x] A fiat figure appears only with the seller's rate, its currency, its source and its date.
- [x] Tests: a Released deal, a Refunded deal, a split settlement, a price of 0, tampered records, hostile buyer fields and description, a missing seller field, and numbering that never repeats or skips for one seller file. No test touches a live service; the command's own run makes no network call.
- [x] One real document for one of Crow's own Sepolia deals, saved privately beside the proof of purchase.
- [x] The reference section and one pointer from a guide, inside the budgets.
- [x] A reviewer pass over the diff, with every finding of Medium or above fixed with a test.

## What the first version does

- **Input:** the deal record (`holdback-deal-record/1`) from `examples/deal-record.ts`. It covers settlements both parties signed, which the evidence file (`examples/evidence.ts`) does not.
- **Checks:** it recomputes the commitment ID from the signed terms and recovers the seller's terms signature under a domain `examples/verify.ts` pins. It checks that the record agrees with itself: the outcome against the row, the one step that settled the deal, the settlement times, the payouts (whole amounts above 0 to the two money addresses, summing to the price) and who was paid. It requires the record's own checks of the domain, the events and their receipts, the hold and the operator fee to have passed as the record wrote them, and for a settlement the two postings checks too. It refuses any failed check, operators that disagree, and a deal that is not Released, Refunded or Settled and final.
- **Which document:** Released gives an invoice for the price. Settled gives an invoice for the seller's share. A refund gives a credit note only when the seller names an invoice for the full price it issued earlier elsewhere (`--credits`, `--credits-date`); with no earlier invoice nothing is due, and the command says so. One document per deal: no credit note after the command's own share invoice, none twice, no share invoice after a credit note, and none naming another deal's invoice. A price of 0 gives nothing: the seller was paid nothing, and the adjudication fee is the adjudicator's to invoice.
- **Tax:** the seller states a rate in basis points, reverse charge, or none, with optional wording. A rate splits the tax out of the price, since the buyer paid the price. Reverse charge needs both parties' VAT numbers.
- **Numbering:** the seller file holds each series' next number and a register of every document written. A document takes a number only when it is written; a rerun on the same deal writes the same number, date and bytes, and refuses if the content would change. A lock file stops two runs at once.

## Evidence

- **Tests (measured, 2026-11-19, after the review's fixes):** `pnpm vitest run examples/seller-invoice.test.ts`: 15 passed, on SimChain deals the test makes and records with `examples/deal-record.ts`. `pnpm tsc --noEmit -p examples` and `pnpm eslint` on the two files: clean. `tests/site-guides.test.ts` and `tests/design-map.test.ts`: 53 passed. `pnpm typecheck`: clean.
- **Local checks for kinds 4 and 1 (measured, 2026-11-19, at `4c5a339c`):** `pnpm exec vitest run examples/seller-invoice.test.ts examples/deal-record.test.ts examples/proof-of-purchase.test.ts tests/site-guides.test.ts tests/design-map.test.ts`: 5 files, 99 tests passed. `node site/build.mjs && node site/check.mjs`: PASS. `node scripts/id-check.mjs` with this branch and title: pass. No snapshot changed.
- **CI on the first push (measured, run 44565903757, 2026-11-19):** two defects the kind's local checks did not cover. `tests/cut-feature-alignment.test.ts` failed on `appeal.decided`, an event phase one cut, and `escalation.decided` was not an event at all; only `judgment.decided` stays. `tests/record-copies.test.ts` failed on the earlier deployment's address written into the test; a made-up address replaced it. Both tests and the command's own pass locally (3 files, 33 tests) at `06b5ff7a`; the real invoice rewrites the same bytes.
- **After the T-563 redeploy (measured, 2026-11-19, `origin/main` `978aa38d` at tag `contracts-phase-one-2` merged in):** `pnpm build` passes; 7 test files, 117 tests passed; the site check passes. The real invoice's deal ran on the earlier contracts: without a pin the command refuses it by name and names `HOLDBACK_DEPLOYMENT`; with that set to `contracts/deployments/sepolia-2026-11-13T0532Z-domain-0.8.json` it first lost the explorer links, a defect: a pin built from that variable carries no explorer. The explorer now follows the chain (`explorerOf`, with a test), and the rerun writes the issued document's same bytes.
- **Site budget (measured, `node site/build.mjs && node site/check.mjs`, estimate as bytes divided by four):** the seller's first-deal path went from 18,030 bytes (4,508 tokens) to 18,013 bytes (4,504 tokens) of 5,000; the buyer's stayed at 4,881. The site check passes.
- **Real document (measured, 2026-11-19):** invoice CROW-T-0001 for Crow's Released scan deal `0xb00e30e4…56ce`, 1,473.00 tUSDC (1,473,000,000 base units), supply date 2026-11-18, from that deal's saved record. Crow's hosted seller sold that scan to Crow's own buyer, so the deal has a seller's side. A rerun wrote the same bytes. Files in crow-private `ops-costs/deals/` with what a bookkeeper would still ask for (its README); committed there locally as `d657556`, not pushed.
- **A defect found in passing (measured):** on SimChain, a Released deal with a price of 0 fails the record's own check "postings follow the outcome", because the release posts no transfer of 0 and `examples/deal-record.ts` looks for one. The command answers a price of 0 before it reads the checks, so it is not affected. Fixing the record is a separate change in its own lane.
- **Review (2026-11-19):** one reviewer pass at `d548f6a4` found 1 High, 1 Medium, 6 Low and 6 Info. All fixed with tests:
  - High: an edited record still gave an invoice (a Refunded deal edited to Released; a payout below 0 that kept the sum). The command now checks that the record agrees with itself, and the document and the reference page say which checks it recomputed and which it took as written. A careful forger who edits every field consistently is not caught: the events and receipts are not in the record.
  - Medium: a settlement could be invoiced for the share and then credited, and one refund credited twice. Now one document per deal, as above.
  - Low: a failure after the register took the number said "nothing was issued" and left temporary files; a refusal advised a correction the command cannot write; "never skips" overstated a warning; the reverse-charge refusal stated one country's rule as a fact; "paid before this invoice was issued" could be false; the reference page overstated the checks.
  - Info: the rate shown without a float; the token ID, kind and format capped and cleaned; the terms checked once; a re-fetched record named as the reason a rerun differs; register numbers checked before they name a file. Left: a lock left behind by Ctrl-C, which the refusal already explains.
- **Research:** one research pass opened the primary sources on 2026-11-19; the note labels each claim. Legifrance answered 403, so France's statutes were read through the government's guidance page and BOFiP.

## Decisions

- **The deal record is the input, not the evidence file.** The record covers settlements both parties signed; the evidence file covers only deals closed by an adjudicator's decision. The cost: the record's checks of events and receipts are taken as the record wrote them, and only the terms and the seller's signature are recomputed offline; the consistency checks catch an edit or a mistake, not a careful forger. The seller runs the command on its own record, so a forger would be forging its own invoice. Keeping the events and receipts in the record would close it, in `examples/deal-record.ts`'s lane. A seller who wants the stronger offline proof for a decided deal can run `examples/evidence.ts check` beside it.
- **A refund needs an invoice to credit.** A credit note must name the invoice it corrects (EU Article 219; UK Notice 700, 18.2.3; France's BOFiP). The research note's rule "invoice on release" means a refunded deal usually had no invoice, so the command says nothing is due rather than write a credit note for nothing.
- **The fiat figure is computed from the seller's rate.** The seller supplies the rate, its currency, source and date; the command multiplies exactly (the rate kept as an integer numerator and denominator) and rounds half up to 0.01. A VAT amount in national currency needs that product, and the seller still chooses the rate.
- **Tax inside the price.** The buyer paid the price the terms name, so a rate the seller states is split out of it, never added on top.
- **A credit note shares the invoice series** unless the seller file sets `numbering.creditNote`. Both choices are allowed in the EU, Germany, France and the UK (the research note, sections 2 to 6).
- **The page is HTML** with a content security policy that loads nothing and runs nothing, and every text it did not write escaped.

## Handoff

- **Site:** `site/ref/after-funding.txt`, "The seller's invoice", names the command, and `site/sell.txt` step 10 points to it. A site deploy serves them; that is Rafa's.
- **What the first version leaves out** (the research note's rows 30 to 36):
  - the structured e-invoice (EN 16931 in UBL, Peppol BIS 3.0) and its codes; a German seller invoicing a German business needs it once its transition ends, a French one from 2026-09-01 or 2027-09-01 by size;
  - self-billing, where the buyer issues the seller's invoice;
  - France's payment terms (payment date, late-penalty rate, the 40 EUR indemnity) and the reform's buyer SIREN as fields; a seller can write them in its `lines`;
  - the seller's signature over the document with its deal key, and a check mode for the buyer;
  - a correction of an issued invoice for a Released deal (a full credit and a new invoice);
  - the evidence file as input, and a deal with an operator fee shown on the invoice (the fee is 0 on the pilots);
  - currencies with other than two decimals for the fiat figure.
- **Feedback that would change it:**
  - a seller's bookkeeper rejects the date of supply (the settlement date) or the tax split, which changes the defaults;
  - a seller in Germany or France needs the structured form, which starts the research note's task 4;
  - a buyer's accounts payable cannot match the invoice without its own order number in the signed terms, which starts the research note's task 3;
  - sellers keep putting the same text in `lines` (payment terms, company number), which would earn those a field.
- **Three questions for the first seller who uses it:**
  1. Did your bookkeeper accept the date of supply (the settlement date) and the tax split out of the price, or ask for something else?
  2. What did you add by hand before you sent it: payment terms, a company number, a structured e-invoice, anything else?
  3. Did your buyer's accounts payable match it to their order without asking you: did they need their own order number or a fiat value on it?
- **The price-0 record defect** above belongs to `examples/deal-record.ts`'s lane.
- **After a redeploy** (T-563 on 2026-11-19), a deal on the earlier contracts no longer matches the pinned domain; the refusal names `HOLDBACK_DEPLOYMENT` and the deployment file to set. The printed rules contract is always the record's own.
- **The real invoice CROW-T-0001** was reissued from the final code (it was never sent); its register entry in crow-private's `crow-seller.json` holds the final document's hash.
