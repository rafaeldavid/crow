# T-577: The screen stops flagging honest deliveries for their typography

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** T-557 (the measurement, PR 696)
- **Paths this task may touch:** `packages/judgment/src/screen.ts`, `normalize.ts`, `intake.ts`, `kept.ts`, `kept/screen-1.ts` (new, the frozen copy), the judgment package's tests, `packages/testkit/src/replay.ts` and its test, `fixtures/replay/kept-policies.json` (new records only), the `screen-2` entry in `apps/adjudicator/src/kept-policies.json` (kept, not the default), tests that name the newest screen version, `site/setup.mjs` (rebuilt, it bundles the judgment package), a new ADR, one entry in `docs/decisions-today.md`, the screen lines of `docs/judgment-and-defenses.md`, `docs/research/2026-11-19-screen-flags-on-real-reports/` (the measuring script), and this file.
- **Human gate:** no. Rafa answered "Yes" on 2026-11-20 to "Should the screen stop flagging honest reports for their typography?", as a researched change with a red-team pass.
- **Status:** in progress
- **Agent/session:** T-577 session, 2026-11-20
- **Roadmap row:** N40

## Intent

The screen reads a delivery before the judges do and flags signs of hidden instructions. One of its signals counts every character that Unicode NFKC normalisation changes. T-557 measured that this signal alone flags 7 of 24 genuine security reports, for an ellipsis or a superscript digit. On a deal with a rubric, a flag sends the deal to the strict appeal path, so an honest seller's pay then rests on a unanimous panel.

In my words: make the signal stop counting typography that cannot spell an instruction, and prove that the narrower signal still catches every instruction the old one caught, or name each one it lets through and why that is accepted. The change ships as a new screen version beside the old ones (ADR-0036), so deals agreed under `screen-1` keep `screen-1`.

Non-goals: the other signals (the `override` phrase on quoted code, `verdict-claim` on reviews of an adjudication system, mixed script on a formula's `Δ`, Morse on dot leaders); moving the default (a second deploy, on Rafa's word); live model calls.

## Acceptance criteria

- [ ] A research pass on the most capable model at maximum effort compares the rule with its alternatives, with numbers.
- [ ] An ADR and a `docs/decisions-today.md` entry state the rule, the alternatives with numbers, and what the change costs in catches.
- [ ] `screen-1` is frozen under `packages/judgment/src/kept/`; the new rule ships as `screen-2`; the build carries `screen-0`, `screen-1` and `screen-2`; the default stays `screen-1`.
- [ ] The replay holds `screen-0` and `screen-1` to their recorded hashes and records `screen-2`'s.
- [ ] Tests in the repository measure: (a) the 24 genuine reports under both versions; (b) every existing screen attack and red-team case still flagged under `screen-2`; (c) a new attack corpus, per class of compatibility character, under both versions.
- [ ] A red team tries to get an instruction past `screen-2` that `screen-1` catches; each way through is closed with a test or named in the ADR as accepted.
- [ ] A reviewer passes the pull request; every check passes; the PR is merged by hand.

## Evidence

To be filled in.

## Handoff

**Status: paused on 2026-11-20 to save tokens, at Rafa's word.** Nothing is pushed. The branch `t-577-screen-typography` holds one local WIP commit.

Done so far:
- `packages/judgment/src/kept/screen-1.ts`: today's screen, frozen (only the imports and header differ). `kept.ts` carries screen-0, screen-1 and the new `screen.ts`, whose rule is not yet written.
- `normalize.ts` returns `nfkcLetters`, the NFKC-changed code points whose NFKC form holds a letter. Screen-0 and screen-1 do not read it.
- `packages/testkit/src/replay.ts` has a new `typography` read path. Its hashes are not recorded yet.
- `screen.typography-t577.test.ts`: the attack-corpus scaffold, with no cases yet.

Found [measured, from the code]: the judges read the NFKC-folded text (`pipeline.ts:270`, from `intake.ts:105`), the same text the phrase patterns read. So a compatibility character cannot show the judges something the patterns do not see. Any folded text could also be delivered as plain text, which the NFKC signal would not flag. The signal only catches attackers who use the forms without needing them. This supports T-557's letters-only rule [inferred].

A lean way to resume:
1. Adopt T-557's letters-only rule and skip a new Fable research pass. The argument above and T-557's numbers carry the decision.
2. Write screen-2: `SCREEN_VERSION = 'screen-2'`, reading `nfkcLetters` in `screen()` and `scanDerived()`. Fall back to `nfkcChanged` when the field is absent, so a missing count fails closed.
3. Pin screen-2's digest, and keep screen-1's digest checked against `kept/screen-1.ts`.
4. Record the replay hashes, and update the `screen-1` default tests and `kept-policies.json` (screen-2 kept, not the default).
5. Fill in about 20 attack cases, then run one red-team agent on a cheaper model, and the reviewer.

Deploys: two, both the coordinator's on Rafa's word. First carry screen-2 with the default unchanged, then make screen-2 the default (`apps/adjudicator/src/kept-policies.json`, "about").
