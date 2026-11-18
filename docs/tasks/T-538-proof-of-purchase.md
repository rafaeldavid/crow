# T-538: a ledger row and a one-page proof of purchase from a finished deal's evidence file

- **Lane:** examples
- **Phase:** 2
- **Depends on:** T-511 (the evidence file checked offline), T-531 (the research, task 1 of its section 8)
- **Paths this task may touch:** `examples/proof-of-purchase.ts` and its test (new), `examples/evidence.ts` (two exports, no change to any check), `site/ref/after-funding.txt` (one paragraph), this file.
- **Human gate:** no. A site deploy that serves the new paragraph is Rafa's.
- **Status:** review
- **Agent/session:** the T-538 session, 2026-11-18, branch `t-538-proof-of-purchase`.
- **Roadmap row:** N197
- **Change kind:** 4, operator-side example code with its tests; 1 for the reference paragraph.

## What exists

Checked against `examples/evidence.ts` and its fixtures at `origin/main` `bdedab57` [measured].

- **The evidence file** (`holdback-evidence/1`) holds the operator's terms, events, receipts and judgment record verbatim, the encrypted work, and the raw signed transactions the events name.
- **`examples/evidence.ts check`** proves offline that the seller signed the terms (they hash to the commitment ID), the buyer signed its agreement and its payment address signed the funding, the primary adjudicator accepted the case, the seller signed the delivery, and the deciding adjudicator signed the decision and the judgment record. It prints the one chain read it cannot make, the settlement transaction's receipt, and checks that answer when given. It covers public deals closed by an accept or a reject only: a deal settled by an agreement both parties sign has no judgment, and `fetch` stops at its 404.
- **What a bookkeeper needs, against the file** (the research note's section 5, checked):

| Fact | In the file | Where |
| --- | --- | --- |
| Deal reference | has | `commitmentId` |
| Settlement date | has, as the operator recorded it | the `settlement.released` or `settlement.refunded` event's `at`; the block number from the chain read |
| What was bought | has | `terms.deliverable.description`, signed |
| Counterparty's address | has | `terms.seller`, `sellerPayoutAddress`, `buyer`, `buyerPaymentAddress` |
| Price, adjudication fee | has, base units | `terms.price`, `terms.adjudication.fee` |
| Decimal form | derives | the pinned deployment's token decimals (`examples/deployments.ts`) |
| Operator fee | has when charged | `fee.operator` events; none while the fee is 0 (`docs/api.md`, "Operator fee") |
| Paid and received | derives | price plus fee out of the buyer's payment address; on a refund the price back, the fee kept (`docs/api.md`, "Fees") |
| Outcome | has | the closing event, which the check ties to the signed decision |
| Settlement transaction | has | the closing event's `tx`, which is the decide transaction |
| Party's name, reference, fiat value, rate and its source and time | lacks | only the party knows them |

## Intent

Restated in my own words.

Rafa had to find each proof of payment by hand when he entered Crow's purchases in a ledger. A finished deal's evidence file already proves the order, the acceptance and the payment. This task adds one command that a buyer or seller runs over that file: it runs the existing check and stops if it fails, then writes a ledger row as JSON and a one-page Markdown proof of purchase beside the file. The party's own facts come only from what it types; the command never guesses a name or a rate. It adds no route, storage or schema field, and the page says it is not an invoice and not tax advice.

## Acceptance criteria

- [x] One new command, `examples/proof-of-purchase.ts <evidence file> --as buyer|seller --receipt <file>`, runs `checkBundle` from `examples/evidence.ts` with the chain read first and writes nothing when it fails (exit 1) or the chain read is missing (exit 2).
- [x] The ledger row (`crow-ledger-row/1`) holds the deal ID, the settlement time and date, the deliverable's description, the counterparty's addresses, the price, the adjudication fee, the operator fee, what the party paid and received, each in base units and decimals, the outcome, the funding and settlement transactions, and the evidence file's SHA-256.
- [x] The row's `stated` fields (name, counterparty name, reference, fiat value and currency, rate, rate source, rate time) are null unless the party gives them, by flag or `--facts <file>`; the page prints "not stated".
- [x] The page shows the order with the commitment ID, the acceptance with the delivery and judgment record hashes, the payment with the transactions and amounts, who signed what by address, the file's SHA-256 and the commands that check it again, and one line that it is a record of a settled deal on a test network, not an invoice and not tax or legal advice.
- [x] Tests on the released and refunded fixtures: the row's amounts equal the terms' and the chain receipt's payment event; one changed byte makes the command refuse and write nothing; any `fetch` fails the test.
- [x] One paragraph in `site/ref/after-funding.txt`, "A record anyone can check offline".
- [x] Used once for Crow's own scan deals; files in crow-private `ops-costs/deals/`.

## Out of scope

- An invoice, a credit note, or any tax treatment (the research note's tasks 2 and 4).
- A rate lookup or a computed fiat value.
- Deals settled by agreement, early accepts and reclaims: the evidence check does not cover them yet.
- Any change to `buy.mjs`, `try.mjs`, `spec/`, the API or the operators.

## Evidence

- **Tests (measured, 2026-11-18):** `pnpm exec vitest run examples/proof-of-purchase.test.ts`: 13 passed, after the review's fixes. `examples/evidence.test.ts`: 13 passed. `pnpm typecheck` and `eslint` on the changed files: clean.
- **Review (2026-11-18):** one reviewer pass found 2 High, 3 Medium and 5 Low. Fixed: both High (the chain read required; an operator fee refused), the three Medium (the unpinned-deployment warning carried, the block taken from the checked receipt only, autolinks broken) and three Low (fiat value without a currency, the settlement time checked as a UTC time and labelled the operator's, the "nothing was written" message after a partial write). Left: the test's network stub does not reach inside `evidence.ts`'s own offline replay, which swaps `fetch` for its run; that is `evidence.ts`'s design.
- **Real use (measured, 2026-11-18 19:12 UTC):** for Crow's Released scan deal `0xb00e30e4…56ce`, `evidence.ts fetch` wrote 9 events and 3 transactions; the chain read of `0x08373b2f…5e83` came from `ethereum-sepolia-rpc.publicnode.com`; the command passed the check with the receipt and wrote a row reading paid 1523.00 tUSDC (1523000000 base units), price 1473.00, fee 50.00, settled 2026-11-18T16:24:00Z in block 12162606. Those match the run notes in crow-private.
- **The other scan deal (measured):** `0x4e11ea5f…5ee6` was refunded by an agreement both parties signed. `evidence.ts fetch` stopped at `/judgment` answering 404, so the new command cannot run on it, by design of the check it reuses.

## Decisions

- **The row's unstated facts are JSON null, the page's are "not stated".** A null keeps the row's types plain for a spreadsheet import; the page is for people.
- **Amounts are the party's view:** `paid` and `received` each in base units, so a refund reads paid 41, received 40 instead of a signed net figure.
- **The page escapes Markdown** in every text it did not write (the seller's description, the party's own words), and breaks autolinks, so a description cannot add links, images or table cells to the page.
- **The chain read is required** (the review's first High finding). Without it the file proves the signed messages, not that the money moved, and a proof of payment must not say it did.
- **A file with an operator fee is refused** (the review's second High finding). The operator alone writes `fee.operator` and the evidence check does not check it; the fee is 0 on the pilots, so no such deal exists yet.
- **`evidence.ts` gains three exports only:** `decimalOf`, the formatter it already used, and on a passing result the deployment it used and whether it pinned it. No check is copied or changed. The page carries the check's warning when the deployment came from `HOLDBACK_DEPLOYMENT`.

## Handoff

- **Site:** `site/ref/after-funding.txt` names the command. A site deploy serves it; that is Rafa's.
- **Next, if wanted:** the evidence check for a deal settled by agreement (`MutualSettlement`, both signatures in the settle transaction's calldata), which would let this command cover Crow's first scan deal. Not started: no second deal of that kind needs a proof yet.
- **crow-private's `ops-costs/ledger.json`** has no entry for the two Sepolia deals; its `2026-11-18-scan-credits` entry is the scan's real-money cost. The coordinator decides whether the ledger points at `ops-costs/deals/`.
