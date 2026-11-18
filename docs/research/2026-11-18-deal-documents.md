# Business documents from a Crow deal: what procurement and bookkeeping need, and what a deal already holds

**State: research for T-531 (roadmap row N194), 2026-11-18. It proposes tasks in build order (section 8). Nothing was built, deployed or sent.**

This note is research, not legal, tax or accounting advice. Section 9 lists what a qualified adviser must confirm before any document from Crow is relied on for tax.

Labels:
- **measured:** read in this repository at `origin/main` `aafc3011`, at the cited file;
- **documented:** a primary source said it when a research pass opened it on 2026-11-18 (address given);
- **secondary:** a secondary, press or vendor page said it on 2026-11-18; the primary text was not opened;
- **recalled:** from the model's knowledge, not opened that day;
- **inferred** and **guessed:** this note's own reasoning.

Two research agents opened the outside pages on 2026-11-18. EUR-Lex refused automated reads that day, so the EU VAT Directive's articles were read from legislation.gov.uk's copy of Directive 2006/112/EC as it stood on 2020-12-31. The invoicing articles cited here were last amended in 2010, so that copy should match the text in force [inferred].

## Summary

- **What a purchase needs.** A procurement desk and a bookkeeper match four things for one purchase: the order, the proof the work was delivered and accepted, the supplier's invoice, and the proof of payment. An auditor follows that chain both ways (section 1).
- **How much a Crow deal already gives.** A finished public deal already holds the order (the signed commitment), the proof of acceptance (the delivery and the signed decision) and the proof of payment (the release transaction), each signed and checkable offline with `examples/evidence.ts check`. It holds nothing about who the parties are in law: no legal names, addresses or tax IDs, no invoice number, no tax treatment and no fiat value (section 5).
- **What is missing is a document, not a protocol feature.** Every missing fact is one the seller or the buyer already knows. None belongs on chain or with the operators (section 5).
- **First task:** a command the party runs over the deal record or evidence file it already holds. It writes one ledger row and a one-page proof of purchase. It needs no new route, storage or schema field (section 8, task 1). That is the step Rafa did by hand on 2026-11-18.
- **The invoice is the seller's document.** In the EU and the UK the supplier is responsible for the invoice. The buyer may issue it only under a self-billing agreement, and a third party only in the supplier's name and on its behalf (section 2). So Crow should give the seller the form and the proof that it matches the deal, and should issue no invoice in its own name for the work.

## 1. The paperwork for one purchase of a service

### Who expects what

| Role | Expects | Why |
| --- | --- | --- |
| Procurement desk | A purchase order: an order number, the supplier, what is bought, the price, the currency, the dates and the terms | It records that the company agreed to buy |
| Receiving, for a service | A signed acceptance or a service entry sheet in place of the goods-received note | It shows the work arrived and passed |
| Accounts payable (the bookkeeper) | The supplier's invoice quoting the order number, then the proof of payment and a remittance advice | It matches the invoice to the order and the receipt before paying |
| External auditor | The whole chain, traceable from the ledger back to source documents and forward again | It tests that each expense occurred, is complete and falls in the right period |

[documented: three-way matching, https://www.corpay.com/resources/blog/three-way-matching and https://peakflo.co/blog/three-way-matching-accounts-payable, both vendor pages; the service entry sheet is recalled]

### How the documents are matched

- **Three-way match:** the bookkeeper checks the invoice against the purchase order and the receipt before paying. A mismatch goes to review. The control stops payment for work never ordered, work never received and wrong amounts [documented, the pages above].
- **Two-way match:** the purchase order against the invoice only. Services, which have no physical receipt, often use it [documented, the pages above].
- **The fields that must agree** across the three: the order number, the supplier, the item, the quantity, the unit price and total, the currency, and the acceptance date against the invoice date [inferred].
- **A remittance advice** is the payer's note to the payee naming which invoices a payment settles: invoice numbers, amounts, payment date and payment reference [recalled].
- **Auditors** weigh evidence by relevance and reliability, and reliability depends on the source of the evidence and how it was obtained. More evidence of the same weak kind does not make up for its weakness. PCAOB AS 1105, https://pcaobus.org/oversight/standards/auditing-standards/details/AS1105 [documented]. ISA 500 is the international equivalent [recalled; not opened].

### What this means for a Crow deal

In an escrow deal the order, the acceptance and the payment happen in one sequence the contract enforces, and the release pays the seller at the moment of acceptance [measured: `docs/api.md`, "Fees"; `docs/what-a-deal-can-do.md`, step 7]. So the three-way match is already true by construction. The bookkeeper still needs to see it on paper, under one reference that ties the pieces together. The commitment ID can be that reference [inferred].

## 2. What an invoice must carry by law

Only what changes Crow's design is kept here.

### European Union (VAT Directive 2006/112/EC)

- **Mandatory fields, Article 226** [documented, https://www.legislation.gov.uk/eudr/2006/112/article/226]:
  1. the date of issue;
  2. a sequential number that identifies the invoice uniquely;
  3. the supplier's VAT number;
  4. the customer's VAT number when the customer pays the VAT (the reverse charge);
  5. the full name and address of the supplier and of the customer;
  6. the nature and extent of the services;
  7. the date of supply or completion, where it differs from the issue date;
  8. the taxable amount per rate, the unit price without VAT and any discounts;
  9. the VAT rate and 10. the VAT amount;
  - the mention "Self-billing" when the customer issues the invoice (10a), and "Reverse charge" when the customer pays the VAT (11a).
- **Cross-border services between businesses:** the customer pays the VAT when the supplier is not established in its member state (Article 196), and the invoice is due by the 15th day of the month after the supply (Article 222) [documented, articles 196 and 222 at the address above].
- **Currency, Article 230:** the invoice may be in any currency, but any VAT amount must be stated in the member state's national currency, converted under Article 91 (the latest ECB rate or a national rate) [documented, articles 230 and 91]. Whether a stablecoin counts as a currency for this purpose is open [inferred; an adviser must confirm].
- **Who issues it, Articles 220(1) and 224:** the supplier must ensure an invoice is issued, by itself, by its customer (self-billing, only with a prior agreement and a procedure by which the supplier accepts each invoice), or by a third party in the supplier's name and on its behalf [documented, articles 220 and 224].
- **Whose rules apply, Article 219a:** the rules of the member state where the supply takes place, except that a supplier not established there whose customer reverse-charges follows its own state's rules [documented, article 219a]. A seller outside the EU selling to an EU business falls outside the Directive's invoicing rules; the buyer self-assesses the VAT from its own records [inferred].
- **No simplified invoice** for a reverse-charged supply by a non-established supplier (Articles 220a, 226b, 238), so every cross-border sale between businesses needs a full invoice [documented].
- **Electronic invoices, Articles 232 and 233:** the recipient must accept them, and the supplier ensures authenticity of origin, integrity and legibility by one of: business controls that create a reliable audit trail between the invoice and the supply, an advanced electronic signature on a qualified certificate, or EDI [documented]. A signed, hash-linked deal record fits the first route [inferred; an adviser must confirm].
- **Retention, Article 247:** each member state sets the period [documented]; many set 6 to 10 years [inferred].
- **Credit notes, Article 219:** a document that amends an invoice and refers to it specifically counts as an invoice [documented].
- **Structured e-invoices are coming:**
  - VAT in the Digital Age (ViDA, Directive (EU) 2025/516) was adopted on 2025-03-11. Digital reporting of cross-border sales between businesses starts on 2030-07-01 [documented, https://taxation-customs.ec.europa.eu/taxation/vat/vat-digital-age-vida_en].
  - From 2030-07-01, invoices between businesses in different member states must be structured e-invoices that follow EN 16931; a PDF will no longer count, and the recipient's acceptance is no longer needed [secondary, https://www.eurofiscalis.com/en/intra-eu-e-invoicing-2030/]. Reports say the new fields include the payee's bank account (IBAN), which has no plain value for a stablecoin payee [secondary; inferred; an adviser must confirm].
  - National mandates for domestic sales already run: Germany requires every business to receive structured e-invoices since 2025-01-01, with issuing required from 2027 or 2028 by turnover, and a plain PDF is not an e-invoice there [secondary, the German finance ministry's FAQ seen through search results]. France has required receiving since 2026-09-01; Belgium uses Peppol for domestic sales since 2026-01-01; Poland's KSeF clearance system runs since 2026; Italy has cleared invoices through SDI since 2019 [secondary or recalled].
- **The standards that matter:**
  - **EN 16931:** the European standard's semantic model of an invoice, with syntax bindings to UBL 2.1 and UN/CEFACT Cross Industry Invoice. Its business terms carry IDs such as BT-1 (invoice number) [documented, https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/Obtaining+a+copy+of+the+European+standard+on+eInvoicing; the BT numbering is recalled].
  - **Peppol BIS Billing 3.0:** a profile of EN 16931 on UBL, for invoices and credit notes, exchanged through Peppol access points [documented, https://docs.peppol.eu/poacc/billing/3.0/].
  - **XRechnung and ZUGFeRD:** the German forms; ZUGFeRD is a PDF with the structured data inside [secondary].

### United Kingdom

- **A full VAT invoice** carries a unique sequential number, the time of supply, the supplier's name, address and VAT number, the customer's name and address, a description, per item the quantity, unit price, rate and amount without VAT, and the total VAT in sterling. It is issued normally within 30 days, may be in a foreign currency with the VAT total in sterling, and a simplified invoice is allowed only up to £250 [documented, VAT Notice 700, paragraphs 16.2.3, 16.3.1, 16.4 and 16.6, https://www.gov.uk/guidance/vat-guide-notice-700].
- **Reverse charge:** a UK business buying services from a supplier outside the UK accounts for the VAT itself [documented, VAT Notice 741A].
- **Self-billing** needs a prior written agreement in which the supplier agrees not to issue its own invoices and to accept each self-bill; each invoice is marked "SELF-BILLING" [documented, VAT Notice 700/62, https://www.gov.uk/government/publications/vat-notice-70062-self-billing/vat-notice-70062-self-billing].
- **Records:** 6 years, kept digitally under Making Tax Digital [documented, VAT Notice 700/21, https://www.gov.uk/guidance/record-keeping-for-vat-notice-70021].
- **Credit notes** carry their own number and date, both parties, the amounts, the VAT credited in sterling and the original invoice's number and date [documented, VAT Notice 700, paragraph 18.2.3].
- **E-invoicing** becomes mandatory for VAT-registered businesses from April 2029, on Peppol [documented, https://www.gov.uk/government/publications/e-invoicing-implementation-roadmap/roadmap-for-e-invoicing-implementation]. Cross-border sales are reported to be out of scope [secondary].

### United States

- **No federal VAT and no federal rule on invoice content** [inferred].
- **Records:** any system that clearly shows income and expenses, with supporting documents such as invoices, receipts, paid bills and account statements; electronic records count like paper [documented, https://www.irs.gov/businesses/small-businesses-self-employed/what-kind-of-records-should-i-keep].
- **Retention:** 3 years by default, 6 years if income was under-reported by more than 25 %, 7 years for bad-debt losses [documented, https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records].
- **Contractor payments:** Form 1099-NEC, with a threshold of $2,000 for tax years beginning after 2025 [documented, https://www.irs.gov/instructions/i1099mec]. Whether a buyer reports a USDC payment there at its dollar value is an adviser's question [inferred].
- **Sales tax** on digital services varies by state [inferred]. **E-invoicing** has no mandate; an exchange framework is voluntary [secondary, the Federal Reserve's FedPayments Improvement page].

### What this changes in Crow's design

1. The facts an invoice needs beyond the deal (legal names, addresses, tax IDs, the number series, the tax treatment) are the parties' own. They differ by country and change over time, so they belong in a file the seller keeps, not in signed terms or on chain [inferred].
2. Crow cannot know the tax treatment. The seller states it; a command can only print what the seller states and refuse a self-contradiction [inferred].
3. A structured e-invoice (EN 16931, Peppol) is required for some sellers now and for cross-border EU sales from 2030. If the first invoice's data uses EN 16931's business terms from the start, a structured export later is mechanical [inferred].
4. Delivering into Peppol or a national platform needs an access point. That is the seller's own service, not Crow's [inferred].

## 3. Payment in a stablecoin

### What a bookkeeper records

- the token amount, the token and the chain;
- the transaction hash and the block time in UTC;
- the payer's and the payee's addresses;
- the fiat value at the time of the transaction, with the rate and its source;
- any fees and gas, and who paid them;
- the order or invoice reference.

[inferred, consistent with the IRS and HMRC pages below]

### What the rules say

- **United Kingdom:** VAT is due in the normal way on services paid for in tokens. The taxable value is the sterling value at the time of the transaction. HMRC calls this treatment provisional [documented, https://www.gov.uk/hmrc-internal-manuals/cryptoassets-manual/crypto45000].
- **United States:** digital assets, stablecoins included, are property. Digital assets received for services are income at their dollar fair market value when received [documented, https://www.irs.gov/filing/digital-assets]. The IRS accepts a value from a blockchain explorer as evidence of fair market value, in FAQs that say they apply to transactions before 2025 [documented, https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-virtual-currency-transactions, questions 27 and 46].
- **European Union:** a VAT amount in another currency is converted at the ECB's or a national rate when the tax becomes chargeable (Article 91) [documented].
- **Accounting standards are unsettled.** Under US GAAP a stablecoin that gives a claim on other assets is usually outside the crypto-asset standard ASU 2023-08 [documented, https://dart.deloitte.com/USDART/home/publications/deloitte/heads-up/2024/faq-fasb-crypto-assets-standard-asu-2023-08]. A FASB proposal of 2026-08-18 on whether some stablecoins are cash equivalents closes for comment on 2026-11-19 [documented, https://kpmg.com/us/en/frv/reference-library/2026/fasb-issues-proposed-asu-cash-equivalents.html]. Under IFRS, the 2019 agenda decision applies IAS 38 or IAS 2 to cryptocurrencies, and the IASB is weighing a narrow project that would cover stablecoins [documented, https://www.iasplus.com/en/meeting-notes/ifrs-ic/2019/june/holdings-of-cryptocurrencies; https://www.ifrs.org/content/dam/ifrs/meetings/2026/november/iasb/ap8b-adding-projects-work-plan.pdf].
- **The US GENIUS Act** (signed 2025-07-18) defines payment stablecoins and their reserves; it sets no accounting treatment [documented, https://www.cov.com/en/news-and-insights/insights/2025/07/the-genius-act-becomes-law-key-provisions-from-the-federal-stablecoin-regulatory-framework; the accounting point is inferred].

### What Crow can state and what the party adds

| Fact | Crow can state it | From where |
| --- | --- | --- |
| Token amount, token, chain | yes | the terms and the settlement event |
| Transaction hash, block time | yes | the events and the chain |
| Payer and payee addresses | yes | `buyerPaymentAddress`, `sellerPayoutAddress`, the postings |
| Gas | partly: the operators' relayer pays it today | `docs/api.md`, "Operator fee" |
| Fiat value, rate and source | no | the party picks the rate its tax authority accepts (ECB, HMRC, an explorer price) and adds it |
| The tax effect | no | the party and its adviser |

A command can take a rate file the party supplies and fill the fiat columns from it. It should never choose the rate itself, because the acceptable source differs by country and by the party's own policy [inferred].

## 4. What the parties' key signatures prove

- **To anyone who checks:** an EIP-712 signature proves that whoever controlled that key signed exactly those bytes, and that they have not changed since [inferred]. It does not prove who holds the key, that the holder may bind a company, or that the key was not stolen [inferred].
- **European Union, eIDAS (Regulation 910/2014 as amended by 2024/1183):**
  - An advanced electronic signature must be uniquely linked to the signatory, capable of identifying the signatory, created with data under the signatory's sole control, and linked to the data so that a later change is detectable (Article 26) [documented, https://www.legislation.gov.uk/eur/2014/910/article/26].
  - A key signature plausibly meets the first, third and fourth; identifying the signatory is the gap when nothing binds the key to an identity [inferred]. No source found says such a signature is advanced or qualified.
  - A signature may not be denied legal effect or admissibility only because it is electronic or not qualified (Article 25(1)); only a qualified signature has the effect of a handwritten one (Article 25(2)) [recalled; EUR-Lex did not load].
  - For invoices, an advanced signature on a qualified certificate is only one of three ways to show origin and integrity; a reliable audit trail is another (Article 233, section 2) [documented].
- **United Kingdom:** an electronic signature, meaning anything electronic logically associated with data and used to sign, is admissible as evidence of authenticity or integrity (Electronic Communications Act 2000, section 7) [documented, https://www.legislation.gov.uk/ukpga/2000/7/section/7]. The Law Commission found in 2019 that an electronic signature can execute a document where the signer intends to authenticate it [secondary, https://united-kingdom.taylorwessing.com/en/insights/radar/law-commission-report-on-electronic-execution-of-documents].
- **United States:** E-SIGN defines an electronic signature as an electronic sound, symbol or process attached to or logically associated with a record and adopted with intent to sign (15 U.S.C. §7006(5)) [documented, https://www.law.cornell.edu/uscode/text/15/7006]. Arizona (A.R.S. §44-7061) and Tennessee (§47-10-201) say a blockchain or cryptographic signature is an electronic signature [documented, https://www.azleg.gov/legtext/53leg/1R/laws/0097.htm]. Federal Rules of Evidence 902(13) and 902(14) let a record be self-authenticating on a qualified person's certification, and the committee notes name the hash value as the usual way to show a copy is exact [documented, https://www.law.cornell.edu/rules/fre/rule_902].

**For Crow's documents** [inferred]:
- The deal's signatures make the order, the acceptance and the payment tamper-evident and attributable to keys. That serves a counterparty and an auditor as integrity evidence, and a court as evidence the other side must rebut.
- They do not say who the parties are in law. The binding of a key to a company is outside the protocol: the party's own records, a mandate, or a certificate it chooses to show (`CLAUDE.md`, "rails, not a record-keeper").
- No document should claim these signatures are legally equivalent to a handwritten or a qualified signature.

## 5. What a Crow deal already holds

Sources read [measured]: `spec/schemas/commitment.schema.json`, `spec/schemas/receipt.schema.json`, `spec/schemas/event.schema.json` and `spec/examples/event.fee-operator.example.json`; the deal record's `row` in `examples/deal-record.ts`; the evidence bundle `holdback-evidence/1` in `examples/evidence.ts`. Public deals only: a private deal's terms need a ReadToken, and the evidence command reads public deals closed by an adjudicator's decision only (`examples/evidence.ts`, header).

Key: **present** (where), **derivable** (from present data by a rule), **missing** (who knows it; where it belongs).

### The order

| Needed | State | Where, or who knows it | Belongs in |
| --- | --- | --- | --- |
| Order reference | derivable | the commitment ID, `id` | |
| The buyer's own purchase order number | missing | the buyer | the buyer may hand it to the seller before the offer, and the seller may write it in `deliverable.notes`, which the terms' hash binds; no schema change |
| Supplier and customer, as keys | present | `seller`, `buyer`, `sellerPayoutAddress`, `buyerPaymentAddress` | |
| Supplier and customer legal names and addresses | missing | each party | its own document |
| What is bought | present | `deliverable.kind`, `description`, `format`, `inputs` | |
| Acceptance terms | present | `acceptance` checks and rubric | |
| Price and token | present | `price` `{token, amount}` in base units | |
| Adjudication fee | present | `adjudication.fee` | |
| Operator fee | present when charged | `fee.operator` event; 0 for the first pilots | |
| Dates | present | `createdAt`, `timing.*` | |
| Signed by both | present | seller's terms signature on `/terms`; the buyer's `Agree` in the agree-and-fund transaction's calldata, which the evidence bundle carries | |
| Governing law and jurisdiction | missing | the parties | the signed terms, later (the parked idea in the private roadmap); not needed for an invoice |

### The proof of delivery and acceptance

| Needed | State | Where | Note |
| --- | --- | --- | --- |
| Delivered, when, which work | present | `delivery.submitted`: attempt, `deliveryHash`, `plaintextSha256`, time | the seller's `Delivery` signature is in the transaction's calldata |
| Accepted, by whom, when | present | `judgment.decided` and `/judgment`, signed by the adjudicator; or the buyer's `EarlyAccept`; or a `MutualSettlement` both sign | |
| Date of supply for the invoice | derivable | the decision or settlement time (`decidedAt`, `settledAt` in the record's `row`) | an adviser confirms which date counts (section 9) |

### The invoice

| Needed | State | Who knows it | Belongs in |
| --- | --- | --- | --- |
| Invoice number in a series | missing | the seller | the seller's document |
| Issue date | missing | the seller | the seller's document |
| Supplier's and customer's names, addresses, VAT IDs | missing | each party; the buyer tells the seller its own | the seller's document, never on chain or at the operators |
| Description and extent | present | `deliverable.description` | |
| Date of supply | derivable | as above | |
| Taxable amount | derivable | the seller's share of the price paid | |
| VAT rate, amount, or the mention "Reverse charge" | missing | the seller, with its adviser | the seller's document |
| VAT in national currency, and its rate source | missing | the seller | the seller's document |
| Payment reference | present | the commitment ID and the release transaction hash | |
| "Self-billing" mention | missing | only if the parties agreed self-billing | the seller's document; the agreement is the parties' own |

### The proof of payment and the remittance advice

| Needed | State | Where |
| --- | --- | --- |
| Paid, to which address, how much | present | `settlement.released` or `commitment.settled` with postings; `row.paidTo`, `row.refundedTo` |
| Transaction hash and time | present | `row.transactions`; the raw signed transactions in the evidence bundle |
| Checkable without trusting Crow | present | `examples/evidence.ts check` checks offline and prints the one chain read that confirms the decision transaction was mined |
| Fiat value with its rate source | missing | the party (section 3) |
| Which invoice the payment settles | derivable | the commitment ID, once the seller's invoice quotes it |

### Totals

- **Present or derivable:** every deal fact a three-way match needs: what was ordered, by which keys, for how much, that it was delivered and accepted, and that it was paid, under one reference [measured, the tables above].
- **Missing:** the parties' legal identity, the invoice number and dates, the tax treatment and the fiat value. Each is known to the seller or the buyer. The adjudicator knows none of them, and none needs to reach the protocol [inferred].

## 6. Who the documents are for, and who holds them

| Payment | Supplier | Customer | Document | Issued by |
| --- | --- | --- | --- | --- |
| The price, on release | the seller | the buyer | an invoice | the seller, or the buyer under a self-billing agreement |
| A split settlement | the seller, for its share | the buyer | an invoice for the share paid | the seller |
| A refund before any invoice | none | | no invoice; the buyer's books show money out and back | |
| A refund after an invoice | the seller | the buyer | a credit note quoting the invoice | the seller |
| A replaced deal (ADR-0039) | the seller | the buyer | the invoice follows the deal that paid; the refunded first deal needs none if no invoice was issued for it | the seller |
| The adjudication fee, kept on a decision | the adjudicator | the party that paid it, the buyer today | the adjudicator's invoice or receipt | the adjudicator; Crow when Crow's adjudicators charge |
| The adjudication fee, returned (early accept, a settlement both sign, a reclaim) | none | | no invoice; the fee comes back to the buyer's payment address | |
| A price-0 deal (judgment only) | the adjudicator | the buyer | only the adjudicator's invoice | the adjudicator |
| The operator fee | the operator that relayed | the buyer's payment address | the operator's invoice or receipt | that operator |

[inferred from section 2 and `docs/api.md`, "Fees" and "Operator fee"; the fee rules are measured]

Three points follow [inferred]:
- **Invoice on release, not on funding.** If the seller invoices only once the deal pays it, a refund needs no credit note in the usual case. Whether funding the hold counts as a payment on account, which would make an invoice due earlier, is an adviser's question (section 9).
- **The fees' supplier is not Crow by default.** The adjudication fee's supplier is whichever adjudicator the parties named, and the operator fee's is the operator that relayed. Crow is the supplier only where its own adjudicators or operators charge. The operator fee is 0 for the first pilots (`docs/api.md`, "Operator fee"). The adjudication fee is charged on every judged deal today, so the adjudicator's invoice is a live question now, for Crow's own adjudicators included [measured: `docs/api.md`, "Fees"; `docs/what-a-deal-can-do.md`, the price-0 deal].
- **The adjudication fee is sometimes returned.** An early accept, a settlement both parties sign and a reclaim after the deadline return it to the buyer's payment address. Then no adjudicator invoice is due, and the buyer's ledger must not book the fee as an expense [measured: `docs/api.md`, "Fees"; `docs/what-a-deal-can-do.md`, "Other paths"].
- **Who holds them:** each party keeps its own documents, as it keeps its own deal record today (`site/buy.txt`, step 11).

## 7. Encryption and custody

### What a deal already has

- The buyer's per-deal x25519 key, `buyerEncryptionPublicKey`, in the signed terms; the seller's per-deal x25519 key, `deliverable.sellerEncryptionPublicKey`, bound by the terms' hash [measured, `spec/schemas/commitment.schema.json`].
- A published recipe for sealing a file to named recipients: AES-256-GCM content, a NaCl box envelope per recipient, the ciphertext stored with `POST /v1/ciphertext` under its SHA-256 [measured, `docs/api.md`, the delivery recipe].

So a document could be sealed to both parties' keys and put in the operators' ciphertext store with no new route, schema field or storage [inferred].

### Why that is not the first step

- **It does not survive the loss it guards against.** `buy.mjs` makes fresh keys for each deal in a local file [measured, `site/buy.txt`]. A party that loses its copy of the document most likely lost that key file with it, and then cannot open the sealed copy either [inferred].
- **The deal's half is already recoverable.** For a public deal, the terms, the events, the judgment and the transactions stay readable at the operators and on chain, so the deal record and the evidence file can be fetched again [measured, `examples/evidence.ts fetch`]. Only the party's own details (names, tax IDs, invoice number) would be lost, and those live in the party's own books anyway [inferred].
- **The store makes no retention promise** that this pass found; tax records must be kept for 3 to 10 years (section 2) [inferred; `docs/api.md` states size limits, not retention].
- **It adds what Rafa wants to avoid:** a stored object per deal, a retention duty and a privacy surface, before any party has shown it needs one.

### What to do instead

Each party keeps its own copy. The protocol makes the copy verifiable: every document quotes the commitment ID and the transaction hashes, carries the hash of the evidence file it was made from, and the seller can sign the invoice's hash with its deal key, so the buyer and an auditor can check the invoice offline against the deal [inferred]. An operator holds nothing new.

If real use later shows a party that kept its key and lost its documents, sealing to both keys with the existing ciphertext route is a small step (task 5).

## 8. Proposed tasks, in build order

Each is small enough to build and test alone. Task numbers are the coordinator's to reserve.

### Task 1. Write a deal's ledger row and proof of purchase

- **Produces:** a command in `examples/` (a new command, since `buy.mjs` is pinned by hash) that reads a deal record or evidence file the party already has, runs `examples/evidence.ts check` over the evidence file first, and writes:
  - one CSV row and the same as JSON: the deal's date of acceptance in UTC, the commitment ID as the reference, the counterparty's address, the description, the price, the adjudication fee (marked kept or returned) and the operator fee in the token and in base units, the chain, the transaction hashes with an explorer address, the outcome, and the paid-to and refunded-to addresses;
  - optional fiat columns filled only from a rate file the party supplies (rate, currency, source, time), blank otherwise;
  - a one-page proof of purchase in Markdown: the order, the acceptance and the payment side by side, with the signatures, the evidence file's SHA-256 and the command that checks it.
- **Needs:** no change to the protocol, the API or the schemas. No route, no storage.
- **Done when:** run on a recorded Sepolia deal's evidence file, every value in the row equals the bundle's; the command refuses an evidence file that fails its check; a test with an edited amount fails; the CSV opens in a spreadsheet with one row per deal; and a second deal appends a row.
- **Size:** S.
- **Before task 2 starts, real use must show:** Rafa enters Crow's own purchases into the operations ledger from these rows without searching for proofs of payment by hand, and one outside buyer's bookkeeper accepts the row and the page as the record of the purchase.

### Task 2. Draft the seller's invoice from a deal

- **Produces:** the same command's `invoice` mode for the seller. It reads the deal and a details file the seller keeps (its legal name, address and tax ID; the buyer's details as the buyer gave them; the next number in its series; the tax treatment it states, such as a rate or "Reverse charge"; an optional rate and source for any VAT in national currency). It writes an invoice in Markdown and as JSON keyed by EN 16931 business terms, quoting the commitment ID and the release transaction as the payment reference. It covers a split settlement (the seller's share) and a credit note that quotes an earlier invoice. The seller may sign the invoice's hash with its deal key under its own EIP-712 type, separate from every protocol message, and a check mode recovers the signer and compares the amounts and dates with the deal.
- **Needs:** a new command mode. No route, no storage, no schema field. The details file never leaves the seller's machine except as the invoice the seller sends.
- **Done when:** for a released deal, a split settlement and a refund after an invoice, the output carries every field in the Article 226 and VAT Notice 700 lists that the seller supplied, prints "not supplied" for any it left out, refuses amounts that differ from the deal, and the buyer's check recovers the seller's address from the signature offline.
- **Size:** M.
- **Before task 3 starts, real use must show:** one seller issues an invoice this way for a real deal, and an adviser has read one sample (section 9, items 1 to 4).

### Task 3. Carry the buyer's order number into the signed order

- **Produces:** an option in task 1's command in `examples/` (never in the pinned `buy.mjs`) that sends the buyer's own purchase order number with the quote request, and a seller adapter change that writes it into `deliverable.notes`, so it appears in the signed terms, the proof of purchase and the invoice.
- **Needs:** no schema change: `deliverable.notes` is free text the terms' hash already binds [measured, `spec/schemas/commitment.schema.json`]. A new option in an `examples/` command and a seller adapter change.
- **Disclosure:** on a public deal the operators serve `deliverable.notes` in the clear and the judges read it as untrusted text [measured, `spec/schemas/commitment.schema.json`, `x-holdback-untrusted`]. So the order number becomes public. A buyer that wants it private chooses a private deal, or keeps the mapping in its own books.
- **Done when:** a test deal's terms carry the number, tasks 1 and 2 print it, and a deal without one is unchanged.
- **Size:** S.
- **Start only when:** a buyer's accounts payable says it cannot match an invoice without its own order number.

### Task 4. Export the invoice as a structured e-invoice

- **Produces:** an export of task 2's JSON to EN 16931 in UBL 2.1 (Peppol BIS Billing 3.0), and a credit note in the same form, checked against the published validation rules.
- **Needs:** a new command mode. Delivery through Peppol or a national platform stays the seller's own access point.
- **Done when:** the export passes the Peppol BIS 3.0 validation artefacts for an invoice and a credit note made from a Sepolia deal.
- **Size:** L.
- **Start only when:** a seller in a country with a mandate (Germany from 2027, France, Belgium, Poland, the UK from 2029) or a buyer that accepts only e-invoices asks for it.

### Task 5. Seal a copy of the documents to both parties' keys

- **Produces:** an option that seals a document with the existing delivery recipe to `buyerEncryptionPublicKey` and `sellerEncryptionPublicKey`, stores it with `POST /v1/ciphertext`, and prints the ciphertext ID for each party's records.
- **Needs:** no new route or schema field; a decision on how long the ciphertext store keeps an object, which today it does not state.
- **Done when:** either party opens the sealed copy with its own key and only with it; a third key cannot.
- **Size:** M.
- **Start only when:** a party shows it lost its documents but kept its key. Until then, each party's own copy plus the recoverable deal data is enough (section 7).

### The one to start with

Task 1. It closes the gap Rafa hit on 2026-11-18: each purchase's proof of payment, found in one row with the transaction hash and the reference, and a page a bookkeeper can attach to the ledger entry. A first buyer's bookkeeper needs the order, the acceptance and the payment under one reference, and the deal already holds all three, signed (section 5). A buyer does not issue the seller's invoice, so the buyer's side is complete without task 2. It adds no surface to the API or the protocol.

### What not to build

- **An invoice issued in Crow's name for the work.** The seller is the supplier. Crow issuing it would need a self-billing or on-behalf arrangement per country (section 2).
- **Identities, addresses or tax IDs in the signed terms, on chain or at the operators.** They differ by country, change over time and belong to each party (`CLAUDE.md`, "rails, not a record-keeper").
- **A fiat rate inside the protocol, or a rate chosen by Crow.** The acceptable source differs by country; the party supplies it.
- **Tax calculation.** The seller states its treatment; the command does not decide rates or reverse charges.
- **Operator-held documents, encrypted or not, before task 5's condition is met.**
- **A Peppol access point.** That is the seller's service.
- **The governing-law field now.** It stays the parked roadmap idea; no invoice needs it.

## 9. What a qualified adviser must confirm

1. Whether a USDC amount satisfies the EU's Article 230 and the UK's paragraph 16.4, and which rate and source to use for any VAT in national currency.
2. Which date is the date of supply for a Crow deal: the delivery, the decision or the release.
3. Whether funding the hold is a payment on account that makes an invoice due before delivery (EU Article 220(1); the UK tax point).
4. Whether a signed, hash-linked deal record meets Article 233's "reliable audit trail", and whether an invoice signed by a deal key adds anything for that purpose.
5. Whether any arrangement where a tool or a buyer drafts the invoice needs a self-billing agreement in a given country.
6. What ViDA's 2030 fields require for a stablecoin payee, such as the payee's bank account.
7. Which domestic mandates catch a given pair of parties, for example two parties established in Germany.
8. The invoicing duties of a seller outside the EU or the UK selling to businesses there.
9. US reporting of USDC payments to contractors (Forms 1099-NEC, 1099-K, 1099-DA) and state sales tax on the services sold.
10. Whether a key signature without a certificate counts as an advanced electronic signature under eIDAS, and what binding of key to company a counterparty or auditor would accept.
11. Which records an auditor accepts as source documents for a deal settled on chain, and how it tests the operators' data.
