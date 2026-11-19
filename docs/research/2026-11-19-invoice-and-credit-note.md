# The seller's invoice and credit note: what they carry in the EU, Germany, France, the UK and the US

**State: review for T-565 (roadmap row N198), 2026-11-19. It adds to `2026-11-18-deal-documents.md` (T-531) and does not repeat it: Article 226's list, the UK's full VAT invoice and credit note, US record keeping and retention are there, in its section 2. The first version of `examples/seller-invoice.ts` follows the table at the end.**

This note is research, not legal, tax or accounting advice. It says which fields a document carries and where each comes from; it does not say a document meets any law.

Labels: **documented** (a research pass opened the primary page on 2026-11-19, address given), **secondary** (an official or other secondary page said it that day), **recalled** (from the model's knowledge, not opened), **inferred** (this note's reasoning). Legifrance answered 403 that day, so France's statutes were read through the government's own guidance page and BOFiP.

## Summary

- **The fields are much the same everywhere.** A business invoice names the two parties and their tax numbers, carries a number in a series, the issue date and the date of supply, describes the work, and states the net amount, the tax rate and amount, and the total. A credit note carries the same and names the invoice it corrects by number and date (sections 1 to 5).
- **A Crow deal gives the deal half; the seller gives the rest.** The record gives the description, the amounts, the dates, the deal ID and the transactions. The seller gives its legal name, address and tax number, its numbering, its tax treatment and the buyer's details as the buyer disclosed them (section 7).
- **Three national points change the command.** A reverse-charged invoice needs both parties' VAT numbers (Germany, and the EU e-invoice rules), so the command refuses one without them. France requires one chronological, continuous series per set of documents, so the command never skips or repeats a number. In Germany the word "Gutschrift" means a self-billed invoice, so the command titles a correction "Credit note" (sections 2 and 3).
- **The first version carries 29 of the 36 fields reviewed** (section 7). What it leaves out is the structured e-invoice and its codes, self-billing, France's payment-terms mentions as fields, and a seller's signature on the document.

## 1. The European e-invoice model (EN 16931)

EN 16931-1 names each field of an invoice as a business term (BT). Peppol BIS Billing 3.0 is its profile on UBL and lists every term on its syntax pages [documented, https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/, opened 2026-11-19]. The terms the command's JSON maps to:

| Term | Name | Note |
| --- | --- | --- |
| BT-1, BT-2 | Invoice number, issue date | |
| BT-3 | Invoice type code | 380 commercial invoice, 381 credit note [documented, https://docs.peppol.eu/poacc/billing/3.0/codelist/UNCL1001-inv/] |
| BT-5, BT-6 | Invoice currency, VAT accounting currency | With BT-6, BT-111 (the VAT total in that currency) is required [documented] |
| BT-10, BT-13 | Buyer reference, purchase order reference | Peppol rule R003 requires one of the two [documented] |
| BT-25, BT-26 | Preceding invoice number and date (group BG-3) | BR-55: a preceding invoice reference carries the number; the date is needed when the number is not unique [documented, https://docs.peppol.eu/poacc/billing/3.0/bis/] |
| BT-27, BG-5, BT-31, BT-32 | Seller name, postal address, VAT identifier, tax registration ID | BR-06 makes the name mandatory [documented] |
| BT-44, BG-8, BT-48 | Buyer name, postal address, VAT identifier | BR-07 makes the name mandatory [documented] |
| BT-72 | Actual delivery date | |
| BT-131, BT-153, BT-154 | Line net amount, item name, item description | BR-25 makes the item name mandatory [documented] |
| BT-106, BT-109, BT-110, BT-112, BT-115 | Sum of line net amounts, total without VAT, total VAT, total with VAT, amount due | |
| BT-118, BT-151 | VAT category code, document and line | S standard, Z zero, E exempt, AE reverse charge, K intra-EU, G export, O outside the scope [documented, https://docs.peppol.eu/poacc/billing/3.0/codelist/UNCL5305/] |
| BT-120, BT-121 | VAT exemption reason text and code | |

Rules that matter for a later structured export [documented, https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/]:
- **Reverse charge (AE):** the line rate is 0 (BR-AE-05), the breakdown says "Reverse charge" in BT-120 or BT-121 (BR-AE-10), and the seller's VAT number is required (BR-AE-02). The same rule's requirement of the buyer's VAT number is recalled, since the extract cut it off.
- **Outside the scope (O):** the invoice must not carry the seller's or the buyer's VAT number (BR-O-02), and needs a reason (BR-O-10). So an export cannot map every "none" treatment to O without asking the seller [inferred].
- **A credit note** normally uses UBL's separate CreditNote syntax with positive amounts [recalled]. The command's credit note uses positive amounts too.

## 2. Germany

- **Invoice fields beyond Article 226,** in §14 Abs. 4 UStG [documented, https://www.gesetze-im-internet.de/ustg_1980/__14.html]:
  - the seller's tax number or its VAT number, at its choice (Nr. 2);
  - "eine fortlaufende Nummer mit einer oder mehreren Zahlenreihen", a running number in one or more series (Nr. 4);
  - the time of the supply (Nr. 6), and a note when an exemption applies (Nr. 8);
  - the word "Gutschrift" when the buyer or a third party issues the invoice (Nr. 10).
- **"Gutschrift" means self-billing.** §14 Abs. 2 Satz 5 calls an invoice the recipient issues by prior agreement a Gutschrift [documented, same address]. A seller's correction that everyday usage also calls a Gutschrift is not one (UStAE 14.3 Abs. 2 Satz 5) [secondary, https://www.steuerschroeder.de/steuergesetze/ustae/14.3]. The label alone does not create a tax debt [secondary, the finance ministry's letter of 2013-10-25 as the Hamburg chamber of commerce reports it, https://www.handelskammer-hamburg.de/recht-steuern/steuerrecht/umsatzsteuer-mehrwertsteuer/umsatzsteuer-mehrwertsteuer-national/klarstellung-gutschriften-bundesfinanzministerium-6680504]. So a correction should be titled "Rechnungskorrektur" or "Stornorechnung" in German, and "Credit note" in English [inferred].
- **Reverse charge.** For a service whose place of supply is another member state where the recipient owes the tax, the invoice says "Steuerschuldnerschaft des Leistungsempfängers", shows both parties' VAT numbers, and is issued by the 15th day of the next month (§14a Abs. 1). Domestic reverse charge under §13b takes the same words (§14a Abs. 5) [documented, https://www.gesetze-im-internet.de/ustg_1980/__14a.html].
- **Small businesses (§19 UStG).** A seller with at most 25,000 EUR turnover last year and 100,000 EUR this year charges no VAT [documented, https://www.gesetze-im-internet.de/ustg_1980/__19.html]. Its invoice needs the names and addresses, a tax number, the issue date, the work, the amount in one sum and a note that the small-business exemption applies; the law sets no fixed wording, and asks for no invoice number or date of supply (§34a UStDV) [documented, https://www.gesetze-im-internet.de/ustdv_1980/__34a.html].
- **Structured e-invoices.** Since 2025, §14 Abs. 1 defines an e-invoice as a structured format under the European standard, and between two businesses established in Germany it becomes the required form (§14 Abs. 2 Satz 2 Nr. 1) [documented]. The transition periods in §27 Abs. 38 end for most sellers on 2026-12-31 [recalled]. A small business may always send a plain invoice (§34a UStDV) [documented]. A PDF from this command is therefore not the invoice a German seller sends a German business buyer once its transition ends [inferred].

## 3. France

From the government's guidance page, which cites Code de commerce L441-9, CGI annex II article 242 nonies A and CGI articles 289 and 293 B [documented, https://entreprendre.service-public.gouv.fr/vosdroits/F31808]:
- a unique number on "une séquence chronologique et continue", one chronological and continuous sequence;
- the seller's SIREN (company number), and its VAT number; the buyer's VAT number when the buyer owes the VAT, unless the invoice is 150 EUR or less before tax;
- the date of the sale or the service;
- **for business buyers:** the payment date, the late-payment penalty rate, the fixed 40 EUR recovery indemnity, and the discount terms, or "Escompte pour paiement anticipé : néant";
- the mention "Auto-liquidation" when the buyer owes the VAT, and "TVA non applicable, art. 293 B du CGI" for a seller under the small-business scheme;
- **with the e-invoicing reform:** the buyer's SIREN, the delivery address when it differs, whether the operations are goods, services or both, and the option to pay VAT on debits. Large and mid-size companies issue e-invoices from 2026-09-01, small ones from 2027-09-01.

Numbering and credit notes, from the tax administration's doctrine:
- Separate series are allowed when the business's conditions justify them, such as several sites or issuing methods. Each series is chronological and continuous with no number used twice, and a distinct prefix per series is advised. Customers in several countries do not alone justify a separate series [documented, BOI-TVA-DECLA-30-20-20-10, §80 to §110, https://bofip.impots.gouv.fr/node/1820, a 2012 version that may be superseded].
- A credit note ("facture d'avoir") counts as an invoice when it refers specifically and unambiguously to the original. It cites the original's number and date and shows the reduction before tax and the matching VAT [documented, BOI-TVA-DECLA-30-20-20-20, §180 to §260, https://bofip.impots.gouv.fr/bofip/142-PGP.html/identifiant=BOI-TVA-DECLA-30-20-20-20-20190925, the version in force from 2019-09-25 to 2022-01-19].

## 4. The United Kingdom

- **Series:** the invoice carries "a sequential number based on one or more series which uniquely identifies the document" [documented, VAT Notice 700, paragraph 16.3.1, https://www.gov.uk/guidance/vat-guide-notice-700].
- **Domestic reverse charge** (specified goods and services, Notice 735): the invoice includes the words "reverse charge"; HMRC's examples are "reverse charge: VAT Act 1994 Section 55A applies" and "reverse charge: Customer to pay the VAT to HMRC". The VAT amount is stated but kept out of the VAT total [documented, Notice 735, paragraph 7.6.1, https://www.gov.uk/guidance/the-vat-domestic-reverse-charge-procedure-notice-735]. Digital services are not normally among the specified services [inferred].
- **Services across the border:** Notice 741A gives no wording for the invoice. It asks for a clear description, and the UK customer reverse-charges even if an overseas supplier wrongly charged UK VAT [documented, paragraphs 2.3 and 5.17, https://www.gov.uk/guidance/vat-place-of-supply-of-services-notice-741a].

## 5. The United States

- **No statute fixes an invoice's format** [recalled]. For a deduction, the IRS asks for supporting documents that "show the amount paid and that the amount was for a business expense"; invoices are among them, a statement shows the amount, the payee and the date, and a proof of payment alone does not establish a deduction [documented, Publication 583, https://www.irs.gov/publications/p583].
- **Common commercial practice** adds an invoice number, the dates, both parties, a description, the amount and the payment terms [recalled].
- **Sales tax** varies by state. Washington, for example, taxes digital automated services such as software as a service as a retail sale, and IT services since 2025-10-01 [documented, https://dor.wa.gov/taxes-rates/information-technology-services]. Other states, California among them, generally do not tax software as a service [recalled]. The seller states any rate; the command does not know the buyer's state.

## 6. Points that apply across the EU

- **Series:** an invoice number "may be based on one or more series of numbers, which may include as well alphanumeric characters", and the business chooses the series, for example per branch or per type of supply [documented, the Commission's explanatory notes on the invoicing rules of Directive 2010/45/EU, 2011-10-05, https://taxation-customs.ec.europa.eu/system/files/2016-09/explanatory_notes_en.pdf].
- **Wording:** "Exempt" is enough as an exemption reference, and "Reverse charge" (Article 226(11a)) is enough when a supply is both [documented, the same notes].
- **Credit notes:** a credit note may be a simplified invoice if it refers specifically and unambiguously to the original and gives the details amended (Article 226b(e)); no simplified invoice is allowed for a cross-border reverse-charged supply (Articles 220a(2) and 238(3)) [documented, the same notes]. So a credit note for a cross-border service between businesses carries the full Article 226 content [inferred].
- **Date of supply and currency:** the date of supply is required where it differs from the issue date (Article 226(7)), and any VAT amount is stated in national currency (Article 230); both are in the T-531 note. In a Crow deal the seller is paid at settlement, so the command takes the settlement date as the date of supply unless the seller states another; which date counts is the T-531 note's open question 2.

## 7. The fields, where a Crow deal gets each, and what the first version carries

Source: **record** (the deal record, checked), **seller file** (the seller's details file), **seller input** (a flag for one document), **buyer via seller** (the buyer's details as the buyer gave them to the seller, in `--buyer`), **command** (computed from the others).

| # | Field | Where it is required or expected | Where it comes from | First version |
| --- | --- | --- | --- | --- |
| 1 | Number in a series (BT-1) | EU Art 226(2); DE §14(4) Nr 4; FR continuous series; UK 16.3.1 | seller file: series and register | yes |
| 2 | Issue date (BT-2) | EU Art 226(1) | seller input, or today in UTC | yes |
| 3 | Invoice or credit note (BT-3) | EN 16931 | command: the outcome and `--credits` | yes |
| 4 | Date of supply (BT-72) | EU Art 226(7); DE §14(4) Nr 6; FR | record (settlement date), or seller input | yes |
| 5 | Seller's legal name (BT-27) | EU Art 226(5) | seller file | yes |
| 6 | Seller's address (BG-5) | EU Art 226(5) | seller file | yes |
| 7 | Seller's VAT or tax number (BT-31, BT-32) | EU Art 226(3); DE §14(4) Nr 2 | seller file | yes |
| 8 | Seller's company registration and legal form | FR SIREN; national company law | seller file, free lines | yes, as text |
| 9 | Buyer's name (BT-44) | EU Art 226(5) | buyer via seller | yes |
| 10 | Buyer's address (BG-8) | EU Art 226(5) | buyer via seller | yes |
| 11 | Buyer's VAT number (BT-48) | EU Art 226(4) when the buyer owes the VAT; DE §14a | buyer via seller | yes |
| 12 | Buyer's reference or order number (BT-10, BT-13) | Peppol R003; accounts payable practice | buyer via seller | yes |
| 13 | Description of the work (BT-153, BT-154) | EU Art 226(6) | record: the signed terms | yes |
| 14 | Quantity and unit price | EU Art 226(8); UK 16.3.1 | command: one unit at the price | yes |
| 15 | Line net amount (BT-131) | EN 16931 | command | yes |
| 16 | Tax rate | EU Art 226(9) | seller file or seller input, in basis points | yes |
| 17 | Tax amount (BT-110) | EU Art 226(10) | command: split out of the price at the seller's rate | yes |
| 18 | Totals and amount due (BT-106 to BT-115) | EN 16931 | command; the amount is paid at settlement | yes |
| 19 | Currency (BT-5) | EU Art 230 | record: the token, by name and address | yes, as the token |
| 20 | Tax and totals in national currency (BT-6, BT-111) | EU Art 230; UK 16.4 | seller input: rate, currency, source and date; command multiplies | yes, when supplied |
| 21 | Exemption or no-tax wording (BT-120) | EU Art 226(11); DE §19 and §34a UStDV; FR 293 B | seller file or seller input, as text | yes, as text |
| 22 | Reverse-charge mention | EU Art 226(11a); DE §14a; FR "Auto-liquidation"; UK Notice 735 | seller file or seller input | yes: "Reverse charge" plus the seller's own wording |
| 23 | Both VAT numbers under reverse charge | DE §14a(1); Peppol BR-AE-02 | seller file, buyer via seller | yes: refused without them |
| 24 | Credited invoice's number (BT-25) | EU Art 219 and 226b(e); UK 18.2.3; FR avoir | seller input | yes |
| 25 | Credited invoice's date (BT-26) | UK 18.2.3; FR avoir; Peppol when not unique | seller input | yes |
| 26 | Payment proof and reference | Accounts payable matching (T-531 section 1) | record: deal ID, payout address, transactions | yes |
| 27 | Proof of the amount, payee and date | US Publication 583 | record | yes |
| 28 | US sales tax at a state's rate | State law | seller input as a rate | yes, as a rate |
| 29 | Small-business note wording | DE §34a UStDV; FR 293 B | seller file, as text | yes, as text |
| 30 | VAT category code (BT-118, BT-151) | EN 16931 structured invoice | command, from the treatment | no |
| 31 | Exemption reason code (BT-121) | EN 16931 | seller | no |
| 32 | "Self-billing" or "Gutschrift" mention | EU Art 226(10a); DE §14(4) Nr 10 | only when the buyer issues | no: the command writes the seller's own documents only |
| 33 | Payment date, late-penalty rate, 40 EUR indemnity, discount terms | FR L441-9 | seller file, as text | no fields; a seller may put them in its free lines |
| 34 | Buyer's SIREN; goods, services or both | FR e-invoicing reform | buyer via seller; command | no |
| 35 | Structured e-invoice (UBL or CII) | DE between domestic businesses after the transition; FR from 2026-09-01 by size; EU cross-border from 2030 | command | no |
| 36 | The seller's signature over the document | T-531 section 7 and task 2 (an integrity proof, no law requires it) | the seller's deal key | no |

**Count: the first version carries 29 of the 36 fields reviewed** (rows 1 to 29). Three of the 29 are free text the seller writes (rows 8, 21 and 29), and one carries the token in place of an ISO currency code (row 19).
