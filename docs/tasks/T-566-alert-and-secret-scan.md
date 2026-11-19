# T-566: Settle code-scanning alert 38 and add a secret scan to the private repository

- **Lane:** infra
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `docs/reviews/`, `docs/tasks/T-566-alert-and-secret-scan.md`; in the private repository, one workflow, its gitleaks config and ignore files, and a note in `company-ops/`
- **Human gate:** no (Rafa approved the dismissal of alert 38 and the private workflow on 2026-11-19; making either check required is a repository setting and stays his)
- **Status:** done
- **Agent/session:** T-566 session, 2026-11-19
- **Roadmap row:** N182, N183

## Intent

Close the one open code-scanning alert on holdback. Fix it at the cause if it is in Crow's code. If it sits in a dependency and is harmless in this use, dismiss it with the reasoning on record. Separately, run gitleaks on every push to the private repository, after a first scan over its whole history. Non-goals: re-pinning `site/buy.mjs`, `site/try.mjs` or `site/setup.mjs`, rewriting history, and changing any repository setting.

## Acceptance criteria

- [x] Alert 38 is mapped to its source package, version and lines, with a verdict.
- [x] The alert is dismissed with its reasoning on record, read back through `gh api`.
- [x] The private repository has a gitleaks workflow pinned to holdback's action commit, with read-only permissions and no secret of its own.
- [x] A first full-history scan is recorded by rule and location only, and every false positive has a reason.
- [x] The workflow has a green run on the private `main`.

## Evidence

- **Alert 38: a false positive in a bundled dependency** [measured]. The flagged line, `site/try.mjs:5228` columns 17 to 38, is `hex[hi] + hex[hi + 1]` in `hexToBytes` of `@noble/curves@1.9.1` (`esm/abstract/utils.js` line 85), which viem 2.57.13 bundles in. The `+` joins two characters for the error message thrown on a non-hex input. No random number goes through it, and the decode `n1 * 16 + n2` is one-to-one, so it adds no bias. The reasoning is in `docs/reviews/2026-11-19-alert-38-biased-random.md`.
- **Dismissal** [measured]: `gh api -X PATCH repos/rafaeldavid/holdback/code-scanning/alerts/38` with `state=dismissed`, `dismissed_reason="false positive"` and a comment citing the package, line and review note. Read back: `state: dismissed`, `dismissed_reason: false positive`, at 2026-11-19T16:03:21Z. Open alerts on holdback: 0.
- **Pinned bundles** [measured]: `site/buy.mjs`, `site/try.mjs` and `site/setup.mjs` are unchanged; this branch touches only the two docs.
- **Private secret scan** [measured]: the workflow is in place, and the full-history scan found 110 `generic-api-key` matches, none a secret. 106 are public EVM addresses, allowed by a config regex. The other 4, a commitment ID, a public access audience tag twice and a block hash, plus 1 truncated address, are fingerprinted with reasons. Push run and full-history run both green, "no leaks found" over 1,341 commits. The findings by file and commit are in the private repository's `company-ops/` note of 2026-11-19.

## Decisions

- The private workflow pins `GITLEAKS_VERSION` 8.30.1 (released 2026-03-21). The action's default 8.24.3 may not read the `[[allowlists]]` table with `targetRules`.
- EVM addresses are allowlisted by regex, not fingerprint. Every new deal record names its token contract, so fingerprints would turn each new record into a failed run. A 40-hex address cannot be a 64-hex private key.

## Handoff

Done. Two optional settings are Rafa's to change:

- **Require the private scan.** In crow-private, go to Settings → Rules → Rulesets and add a branch ruleset for `main`. Turn on "Require status checks to pass" and add `gitleaks`. This gates pull requests only, because most private commits go straight to `main`.
- **Require code scanning on holdback.** The `main` ruleset requires `check`, `gitleaks` and `id-check`, but not code scanning [measured]. In holdback, go to Settings → Rules → Rulesets, open the `main` ruleset and turn on "Require code scanning results" for CodeQL.
