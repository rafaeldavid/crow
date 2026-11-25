# A seller's own Worker

The seller adapter's core on the party's own Cloudflare account (T-478). It is for work whose terms name the buyer's own input, such as a review of the buyer's code: a program must answer each buyer's quote with a signed offer (D82). A fixed file or job needs no program; a standing offer serves it (`setup.mjs publish`, ADR-0040).

It is the hosted seller of ADR-0037 in a second shell. The core (`examples/seller-adapter-core.ts`), the bundle check and the journal storage (`apps/hosted-sellers/src`) are imported, not changed. What differs: the party deploys it, at the root of a host of its own, with its own secrets, and Crow runs nothing of it.

- `src/worker.ts`: the Durable Object class and the Worker in front of it. The address comes from `SELLER_URL` (https, the root of a host, never on Crow's zones). Only requests to that host are served. The object starts only on a chain in `TEST_CHAINS`. `GET /export` answers the journal to a signature of the owner's key (the folder's address) within 300 s.
- `src/entry.ts`: binds the class to `seller-bundle.txt`, a text module beside the Worker that holds the bundle and no secret.
- Built by `node site/build.mjs` into `site/seller-worker.mjs`; `examples/seller-worker-pin.ts` carries its SHA-256 into `setup.mjs`.

The party's steps are in `site/setup.txt`; the command is `examples/setup-cloudflare.ts`. Tests: `pnpm exec vitest run apps/own-seller`.
