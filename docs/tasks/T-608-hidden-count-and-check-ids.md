# T-608: the hidden-character count reads decoded JSON strings; check ids are unique

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `packages/judgment/src/checks/index.ts`, `packages/judgment/src/hidden.ts`, `packages/core/src/parse.ts`, `packages/core/src/parse.test.ts`, `examples/check-terms.ts`, `docs/decisions-today.md`, `site/setup.mjs` (built), this file.
- **Human gate:** no. The deploy waits for Rafa.
- **Status:** in review
- **Agent/session:** hidden-and-ids, 2026-11-25; branch `judgment-hidden-and-ids`
- **Roadmap row:** none (security fix, 2026-11-25)
- **Change kind:** 4 (judgment)

## Intent

The hidden-character count reads decoded JSON strings, as a buyer's own reader does (D99). Check ids are unique within the terms, and each check's result stays under its own id (D100).

## Changes

- `hiddenText` and `decodeJsonEscapes`: the count for `application/json` reads the decoded text; one charge per delivery.
- `repeatedCheckId` in the parser's commitment rules; a warning in `check-terms`; `runChecks` reports each check under its own id.

## Evidence

- Public tests: a commitment with a repeated check id is refused.
- Further tests are kept in the private repository until the deploy.
- Checks: see the PR.

## Handoff

- The PR "every judgment step is charged to the check budget" also edits `checks/index.ts` and `site/setup.mjs`. Whichever merges second merges origin/main in (no rebase) and rebuilds the bundles.
- The private tests move into `packages/judgment/src/checks/` after the deploy.
