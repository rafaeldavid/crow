# What a deal can do today

This page lists what a deal on Sepolia can already do, each with the page that defines it. Read it before you design a build: if a line here already does the job, use it instead. It restates nothing; follow the pointer for the detail. `tests/what-a-deal-can-do.test.ts` fails when this page names a route that `spec/openapi.json` lacks, or when the spec tags a route `core` that this page leaves out.

## The happy path, from quote to Released

The commands: the buyer runs `buy.mjs` (`site/buy.txt`), and the seller runs the seller adapter (`site/sell.txt`, step 9). Under them, each party calls the API below. Every signed step is prepared by the operator, checked by the party (`examples/verify.ts`) and signed by the party (`site/ref/signing.txt`, "Prepare, verify, sign, submit"). Request and response shapes are in `docs/api.md` and `spec/openapi.json`.

1. **Both read discovery:** `GET /.well-known/holdback.json` (`site/ref/http.txt`).
2. **The seller takes a mandate:** `POST /v1/faucet`, which returns a `Mandate` (`site/ref/http.txt`).
3. **The seller offers:** `GET /v1/clubs/{clubId}` and `GET /v1/adjudicators/{address}` give what the offer names. `POST /v1/prepare/offer`, then the seller signs `CommitmentTerms` and sends `POST /v1/commitments` (`site/ref/http-seller.txt`, "Offer").
4. **The adjudicator accepts the job:** `POST /v1/commitments/{commitmentId}/acceptance`, signed `AdjudicatorAcceptance`. Crow's adjudicators do this step (`docs/api.md`).
5. **The buyer checks, agrees and funds in one call:** `GET /v1/commitments/{commitmentId}/terms`, then `POST /v1/prepare/agree-and-fund`. The buyer signs `Agree` and the token's `ReceiveWithAuthorization` and sends `POST /v1/commitments/{commitmentId}/agree` with `fund` (`site/ref/http-buyer.txt`).
6. **The seller delivers encrypted work:** `GET /v1/commitments/{commitmentId}/recipients` and `POST /v1/ciphertext`, then `POST /v1/prepare/delivery`. The seller signs `Delivery` and sends `POST /v1/commitments/{commitmentId}/deliveries` (`site/ref/http-seller.txt`, "Encrypt and deliver").
7. **The adjudicator decides:** it reads `GET /v1/ciphertext/{ciphertextId}`, runs the checks, and with a rubric the judge panel, then sends `POST /v1/commitments/{commitmentId}/decisions`, signed `Decision`. An accept pays the seller and releases the buyer's key in one step (`docs/api.md`; `docs/judgment-and-defenses.md`).
8. **The buyer opens the work:** `GET /v1/commitments/{commitmentId}`, `GET /v1/commitments/{commitmentId}/events` and, on `Released`, `GET /v1/commitments/{commitmentId}/key` (`site/ref/http-buyer.txt`, "Open the work").
9. **Either party keeps a record:** `buy.mjs record` or `examples/deal-record.ts`, which only read (`site/buy.txt`, step 11; `site/sell.txt`, step 10).

## Other paths that exist after funding

Each is defined in `site/ref/after-funding.txt` unless the line names another page.

- **Early accept.** The buyer signs `EarlyAccept` in `Delivered`: `POST /v1/prepare/early-accept`, then `POST /v1/commitments/{commitmentId}/accept`. The seller is paid now, the buyer's key is released and the adjudication fee returns to the buyer.
- **A settlement both parties sign.** Both sign one `MutualSettlement` in `Held`, `Delivered`, `FallbackJudging` or `Escalated`: `POST /v1/prepare/settlement` with `toSellerBps` or `payouts`, then `POST /v1/commitments/{commitmentId}/settlements`. Any split between the buyer and the seller works.
- **A full refund both parties sign.** The same settlement with `toSellerBps` 0. The first pilot's first deal closed this way [inferred, the simplicity review of 2026-11-18].
- **Settling late work.** In `Held`, the settlement names a delivery the buyer holds (`delivery` in the prepare call) and `releaseKey` releases its key. This also serves a seller that holds back work that fails a check and shows the failures, then settles with the buyer. `buy.mjs resume … --delivery` opens it (`site/buy.txt`, step 7).
- **A judgment with no price held.** A deal with price 0 and an adjudication fee of at least one base unit pays only the adjudicator for a signed decision (`docs/api.md`, the prepare refusals; D58 in `docs/decisions-today.md`). Not yet run end to end on Sepolia [not run].
- **Reclaim after the deadline.** After `deliverBy` with nothing delivered, the operators send `reclaim` on their own, or anyone sends `POST /v1/commitments/{commitmentId}/triggers/{kind}` with `{}`. The buyer gets price and fee back. The same route sends the `fallback` and `default` timeouts.
- **Submitting straight to the contract.** Any party can skip the operators and call the contract; the operators show the step within about a minute ("Submitting directly to the contract").
- **The offline check of a finished deal.** `examples/evidence.ts fetch` writes the evidence bundle, and `examples/evidence.ts check` checks it with no network ("A record anyone can check offline").
- **The seller's check before delivery, and why a deal was refused.** `apps/hosted-sellers/scripts/check-report.ts` runs a hosted seller's mapping and checks on a report before anything is submitted. A hosted seller's `GET /health` lists each refused deal's stage and failing checks (`site/ref/seller-adapter.txt`, "See why, and check a report first"). `node examples/check-delivery.ts` runs the agreed checks on one file (`site/sell.txt`, step 8).
- **The environment preflight.** `examples/preflight.ts` checks the setup before a role page and names each fix (`site/llms.txt`).

## What does not exist on Sepolia today

Do not build on these by mistake. Each answers an error or runs on SimChain only (`pnpm sim`, `pnpm demo`).

- **Party appeals and bonds.** The first decision by the primary or the fallback adjudicator is final; `POST /v1/prepare/appeal`, `POST /v1/commitments/{commitmentId}/appeals` and the `appeal-expiry` trigger answer 409 `invalid_state` (ADR-0031, D57; `docs/api.md`, "Party appeals").
- **Payouts to a third address, Permit2 funding, other tokens.** The phase-one contracts pay only the buyer's payment address and the seller's payout address, in one token (ADR-0031).
- **The routes `docs/api.md` marks "planned: 501 today",** such as club and agent registration, funding quotes, disputes and raising a deal's disclosure level.
- **A rule that limits spending.** Spending limits are the owner's wallet and tools, not the protocol (`site/ref/limits.txt`, "Where your agent's limits hold").
