# T-531: research the business documents a deal gives its buyer and seller

- **Lane:** research
- **Phase:** 2
- **Depends on:** T-333 (the deal record), T-511 (the evidence file checked offline)
- **Paths this task may touch:** `docs/research/2026-11-18-deal-documents.md` (new), `docs/research/README.md` (one row), this file.
- **Human gate:** no. The adviser questions in the note's section 9 are Rafa's to put to an adviser; nothing is built.
- **Status:** done
- **Agent/session:** the T-531 session, 2026-11-18, branch `t-531-deal-documents`.
- **Roadmap row:** N194
- **Change kind:** 10, research and decisions.

## What exists

- A finished public deal holds the signed commitment (the order), the delivery and the adjudicator's signed decision (the proof of acceptance), and the release transaction (the proof of payment) (`docs/what-a-deal-can-do.md`, steps 5 to 9).
- `buy.mjs record` and `examples/deal-record.ts` write the deal record, with a flat `row` of IDs, price, fees, outcome and times.
- `examples/evidence.ts fetch` and `check` write and check the evidence file offline.
- Nothing turns these into documents a bookkeeper files: no ledger row with a fiat value, no invoice, no credit note. So the research is still needed.

## Intent

Restated in my own words.

Rafa had to find each proof of payment by hand when he entered Crow's own purchases in a ledger. He asked what paperwork procurement and bookkeeping need from a purchase, and whether the API should give each party a contract and an invoice only the two of them can read. This task finds out what a procurement desk, a bookkeeper and an auditor expect, what an invoice must carry in the EU, the UK and the US, how a stablecoin payment is recorded, and what the deal's key signatures prove. It compares that with what a deal already holds, field by field. It ends in small roadmap tasks in build order, starting from the least: a command the party runs over files it already has. It builds nothing.

## Acceptance criteria

- [x] What a purchase needs and how the documents are matched (the note, section 1).
- [x] What an invoice must carry by law in the three places, who issues it, retention and structured e-invoicing (section 2).
- [x] Stablecoin payment: what to record, what Crow can state, what the party adds (section 3).
- [x] What the key signatures prove, against the electronic signatures the law names, with no claim of equivalence (section 4).
- [x] What a deal already holds, field by field: present, derivable or missing, who knows each missing fact and where it belongs (section 5).
- [x] Who each document is for and who issues it, the fees and refunds included (section 6).
- [x] Encryption and custody with the deal's existing keys, key loss, and whether operators hold anything (section 7).
- [x] Tasks in build order with what each produces, needs, done-when, size and the gate before the next; the first task and why; what not to build (section 8).
- [x] What a qualified adviser must confirm (section 9).

## Out of scope

- Any product code, schema change, route or storage.
- Legal, tax or accounting advice.
- Naming any partner, customer or person, and the company's own location or legal status.

## Evidence

- **Repository reads (measured):** `spec/schemas/commitment.schema.json`, `receipt.schema.json`, `event.schema.json`, `spec/examples/event.fee-operator.example.json`, `examples/deal-record.ts`, `examples/evidence.ts`, `docs/api.md` (fees, the delivery recipe, private deals), `docs/what-a-deal-can-do.md`, `site/buy.txt`, at `origin/main` `aafc3011`.
- **Outside sources:** two research agents opened the pages on 2026-11-18; each claim in the note carries its address and a label (documented, secondary, recalled). EUR-Lex refused automated reads that day, so the VAT Directive was read from legislation.gov.uk's copy, and eIDAS Article 25 is recalled.
- **No private note:** the note names no real party, so nothing went to crow-private's `strategy/`.

## Decisions

- **Start with task 1**, a ledger row and a proof of purchase from files the party already has, with no route, storage or schema change (the note, section 8). It is enough for a buyer's bookkeeper, because the buyer does not issue the seller's invoice.
- **Each party keeps its own documents;** operators hold nothing new until a party shows it lost its documents but kept its key (section 7).

## Handoff

For the coordinator: section 8 of the note holds five proposed tasks for the roadmap, in order, each with its size and the condition for starting the next. Task numbers are not reserved; reserve them when the rows are added. Section 9's questions go to a tax adviser before task 2's invoice is relied on.
