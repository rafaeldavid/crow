# T-591: The home demo shows a known customer

- **Lane:** demo
- **Phase:** 2
- **Depends on:** —
- **Paths this task may touch:** `site/home-demo.mjs`, `site/home.js` (built by `node site/build.mjs`), `site/home.css` (built, only if the demo's styles change), and this file.
- **Human gate:** yes, for the site deploy only. It waits for Rafa's word. This task opens a pull request and neither merges nor deploys it.
- **Status:** review
- **Agent/session:** home-demo-known-customer, 2026-11-25
- **Roadmap row:** none (Rafa, 2026-11-25)

## What exists

- The home page's demo (`site/home-demo.mjs`, built into `site/home.js`) shows a buyer's agent booking an audit from Alpha Security's agent. The request names no customer to the seller.
- The protocol already models a limit on who can buy (`docs/architecture.md`, Glossary: club, member, mandate). A club operator admits members. A principal signs a mandate for its agent. `GET /v1/clubs/{id}/members/{principal}` reads a member and `GET /v1/agents/{address}` reads an agent's mandates (`docs/api.md`).
- Limits today (`docs/api.md`): admissions come from genesis, the admission route answers 501, and the reference clients don't run the mandate check in their flows.

What is left to build is the demo's wording only.

## Intent

A seller may take work only from vetted customers. The demo should show that a seller's agent can sell automatically and still limit who it sells to. When the request reaches Alpha Security, it names the customer. A Crow line says that the customer is a verified member of the Alpha Partner Club, and that its agent's mandate covers the purchase. Alpha Security's agent then takes the job under its own rule. Anyone else would wait for approval from a person at Alpha Security.

Crow vets no company and keeps no identities (D35). The wording ties "verified" to membership of a club, the Alpha Partner Club, and the mandate to the buyer's agent. The rule about whom to serve is the seller's own.

Non-goals: protocol, API or reference-client changes; the `/demo/` and `/visualdemo/` pages (PR 778); a deploy.

## Context

- `docs/api.md`: "Per-deal keys", "Where a mandate's limits hold (ADR-0038)", the club and agent rows.
- `docs/architecture.md`: Glossary.
- Earlier demo pull requests: 755 and 764.

## Acceptance criteria

- [x] The request names Fernhollow Co.'s agent, acting for Fernhollow Co.
- [x] A Crow line confirms the membership of the Alpha Partner Club and the mandate.
- [x] Alpha Security's agent takes the job under its own rule, and says what happens to other buyers.
- [x] The rest of the conversation, the playback button, the pause off screen and reduced motion are unchanged.
- [x] The site build, both site checks, lint and the site tests pass.
- [x] The page reads well at phone and desktop width.

## Out of scope

- A visible "example" label (Rafa removed it).

## Evidence

All measured on 2026-11-25, on `main` after PR 778, unless a line says otherwise.

- `corepack pnpm install --frozen-lockfile` and `corepack pnpm build`: pass.
- `node site/build.mjs`, then `node site/check.mjs`: pass.
- `node site/build.mjs --out reports/site-out --op1 https://api.crow.direct --op2 https://api2.crow.direct`, then `node site/check.mjs`: pass, with `reports/site-out/` built from empty. Without that, the check failed on `reports/site-out/visualdemo/`, a page this session had built before PR 778 removed it. The publish build does not empty its output folder.
- `corepack pnpm lint`: pass. `corepack pnpm exec vitest run tests/site-*.test.ts`: 58 of 58 tests pass.
- The build changed one committed bundle, `site/home.js`. No pinned `.mjs` file changed.
- The added lines and this file against the private deny list, whole words: no term matches.
- Headless Chrome on a local server, at 390 × 844, 320 × 568 and 1440 × 900 px: no element in the demo reaches past the window, and the chat has no sideways scroll. With reduced motion, all messages show and the demo does not play. With motion, the chat follows the seller's reply to within 1 px of its end. At 320 px the page is 325 px wide, as it was with `main`'s earlier bundle. The request card is 226 px tall in a 242 px chat area.
- No snapshot changed.
- Review (the `reviewer` agent on Sonnet, one pass): two issues, both fixed. "A person here" could read as a person at the buyer, so the line names Alpha Security. This file claimed wording the page did not have.

## Decisions

- Rafa, 2026-11-25, during this task: the phrase "Security Buyers club, admitted by the club operator" reads "Alpha Partner Club". The line no longer says who admitted the customer.
- No new style: the confirmation uses the Crow cards' existing pattern, a bold lead and one sentence.
- The two steps with new text stay on screen longer: 3.8 s instead of 1.95 s, and 4.2 s instead of 3.2 s.

## Handoff

Built and checked. The pull request waits for the coordinator's merge, and the site deploy waits for Rafa's word.

Two notes from the review, neither changed here:
- The "Known customer" line sits under a Crow heading and no longer names who admitted the customer. A reader could think Crow verified Fernhollow Co. Crow vets no company (D35). Naming the club's operator in the line would remove that reading.
- The demo applies the seller's rule after the 450 tUSDC is locked. A seller that signs an offer naming its buyer would make this choice at the quote, before the buyer pays. An unknown buyer's money would otherwise stay locked while it waits for a person.
