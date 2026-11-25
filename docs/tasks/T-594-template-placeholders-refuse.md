# T-594: Template placeholders refuse names they cannot fill

- **Lane:** api
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `examples/seller-adapter-core.ts`, `examples/seller-adapter-placeholders.test.ts`, `examples/check-terms.test.ts`, the pinned bundles built by `site/build.mjs`
- **Human gate:** yes for the bundle deploy only (Rafa's)
- **Status:** review
- **Agent/session:** p10-placeholders
- **Roadmap row:** N167

## What exists

The seller tool's filler (`fill` in `examples/seller-adapter-core.ts`) reads `{{name}}` of letters and digits, with or without `.length`. It left any other `{{...}}`, such as `{{order_text}}`, in the offered terms. `check-terms` (T-588, P-09) warns about it after the fact.

## Intent

Refuse a placeholder the filler cannot fill when the seller tool loads the template, before any offer is signed. The error names the placeholder, where it sits and the scope fields.

## Acceptance criteria

- [x] `{{order_text}}` fails at load, naming the placeholder and its place in the template.
- [x] A known placeholder still fills; a template with none is unchanged; every shipped template fills with its own scope.
- [x] `\{{name}}` stays the escape for literal text, for any name.
- [ ] The new bundle hash is published (Rafa's deploy).
- [x] `node site/build.mjs && node site/check.mjs` pass.

## Out of scope

- Placeholders in field names (still warned by `check-terms`, never filled).

## Evidence

See the PR body.

## Handoff

Rafa deploys the site to publish the new `setup.mjs` hash.
