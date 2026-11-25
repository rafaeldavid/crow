# T-588: A warning before signing

- **Lane:** api
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `examples/check-terms.ts`, `examples/check-terms.test.ts`, `docs/tasks/T-588-warning-before-signing.md`
- **Human gate:** no
- **Status:** review
- **Agent/session:** p09-check-terms
- **Roadmap row:** none (plan P-09, new row)

## What exists

Read on 2026-11-25. Each tool below covers part of the job, and none takes a deal's terms and warns on them.

- `examples/seller-adapter-core.ts` refuses a placeholder that its filler can read and the scope rules do not define. The filler reads names of letters and digits only. It does not see `{{order_text}}`, so that text reaches the offer as written (inferred from the `PLACEHOLDER` expression).
- `examples/setup-work-api.ts` refuses any `{{` in a work template. It runs only on the setup command's `--template` file.
- `examples/verify.ts` compares a prepared message with the buyer's intent before signing. It does not read the checks' text.

## Intent

Give an agent one command to run on a deal's terms before it signs. The command reads one JSON file, or standard input, and prints a warning for each of three mistakes. It never refuses terms (D31), and each party decides whether to run it (D32).

- **Inputs:** a deal's terms, or a seller's template.
- **Outputs:** one warning a line on standard error. Each names the field path, what the command found and why it may matter.
- **Non-goals:** no schema validation, no network, no keys, no change to the seller adapter (plan task P-10) or to a pinned bundle in `site/`.

## Context

- D31 and D32 in `CLAUDE.md`.
- `spec/schemas/commitment.schema.json` and `common.schema.json` (`TokenAmount`).
- `packages/judgment/src/checks/safe-regex.ts`: the engine that runs a deal's patterns.

## Acceptance criteria

- [x] It warns on an unfilled placeholder, such as `{{order_text}}` left in a template.
- [x] It warns on a pattern over 10,000 characters. It warns from 201 characters, where Crow's engine starts to refuse (Decisions).
- [x] It warns on a price that is not a base-unit decimal string.
- [x] It exits 0 on any input it can parse, with or without warnings.
- [x] It is silent on every shipped template, and the test finds new template files by their name or shape.

## Out of scope

- Making the template filler refuse names it cannot fill (plan task P-10).
- A page on the site that tells agents to run the command.

## Evidence

All measured on 2026-11-25, on the maintainer's Mac with Node 22.23.4.

- `corepack pnpm build`, `corepack pnpm typecheck` and `corepack pnpm lint` pass.
- `corepack pnpm vitest run examples/check-terms.test.ts`: 43 tests pass.
- Full local suite (`corepack pnpm test`): 5,496 tests passed, 288 skipped and 3 failed. The 3 are time-limit tests in `packages/judgment` (`preflight.test.ts`, `screen.test.ts`), which this change does not touch. The two files then passed on their own, 99 of 99, with the Mac's load average near 300. Load is the likely cause (inferred). This run overlapped the review fixes, so it did not test the final form of the new test file; the line above does.
- The command prints nothing on `spec/examples/commitment.example.json` and exits 0.
- On a document with the price "2.50" and `{{order_text}}`, it prints one price warning and one placeholder warning, and exits 0.
- The tests run each shipped template, and the terms that the adapter's own filler makes from it. None gets a warning.
- One `reviewer` pass returned ISSUES. This change fixes its findings on the command and its tests: a crash on very wide input, compiling the other party's pattern, the line cap hiding a price warning, one overstated warning text, false warnings on schema notes, a long path losing its quotes, the untested 200-character limit, and the `submit.body` shape of the operator's prepare answer.

## Decisions

- **Two pattern limits.** `safe-regex.ts` refuses a pattern over 200 characters, and it never matches a string over 10,000 characters. The command warns on a pattern over 200 characters, which includes every pattern over 10,000. It also warns when a JSON Schema field has a `pattern` and a `minLength` or `maxLength` over 10,000. The plan row's "pattern over 10,000 characters" may mean the second limit (inferred).
- **It compares lengths only.** The command never compiles the other party's pattern, and it says nothing about unsupported syntax.
- **Templates and terms.** Shipped templates hold placeholders on purpose. A document with `deliverable` and `checks` at the top, and no `price` and no `acceptance`, counts as a template. There, a name that the adapter's filler reads gets no warning. In any other document, each placeholder gets one.
- **Fees too.** The price warning also covers `fee` and `adjudication.fee`. A bare base-unit string is accepted, as in the setup command's work template.
- **Output.** One line for each warning on standard error, and at most 50 lines. Money comes first, then patterns, then placeholders.
- **Exit codes.** Exit 1 means that the command checked nothing: it could not read the input, the input is not JSON, or the command line is wrong. It prints one line and no warnings then.
- **No package import.** The command runs with Node alone, without a build.

## Handoff

The command and its tests are done. No pinned bundle in `site/` and no adapter file changed.

- **For P-10:** the test "reads as fillable exactly what the adapter fills" calls `fill` on names the filler does not read. It expects the text back unchanged. When P-10 makes `fill` refuse such a name, update that test to expect the refusal. P-10 can also export the filler's expression, so this command stops holding a copy.
- No agent page names the command yet.
