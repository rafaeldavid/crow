# T-496: try.mjs carries its two packages, names its roles and source commit, and keeps an opt-in record

- **Lane:** demo (the one-command test deal)
- **Phase:** 2
- **Depends on:** T-495 on the try path, which gives the prompt its roles, exposure and permission flag (roadmap row N168)
- **Paths this task may touch:** `examples/try.ts`, `examples/try.test.ts`, `site/build.mjs`, `site/try.mjs`, `site/index.html`, `site/llms.txt` (the try section's wording about npm), `tests/site-bundles.test.ts` (new), the tests that pin the try command's text, this file.
- **Human gate:** the site deploy that publishes the new `try.mjs` and its hash, Rafa's.
- **Status:** in progress
- **Agent/session:** the try-bundle session, 2026-11-16, branch `t-496-try-bundle`.
- **Roadmap row:** N169
- **Change kind:** 3 (a published command and its page)

## Intent

Restated in my own words.

The first outside run of the test deal, on 2026-11-15, found four problems with `try.mjs`, the one-command buyer demo. It asks for an npm install whose transitive packages resolve on the stranger's machine. One log line says "the seller's own terms" when the buyer sent its own terms. The run keeps nothing. And an agent cannot cheaply confirm what the 2,255-line file imports and calls. Each fix changes the file, and so its pinned SHA-256, so all of them go in one change. Copies of the old command then fail their hash check, which is the safe way to fail.

The change:

1. `site/build.mjs` bundles viem and tweetnacl into `try.mjs`, as it already does for the goal commands. The home page's command becomes curl, the hash check and Node, with no npm.
2. The proposal line says the buyer sent its own terms.
3. One line names who runs each role: the buyer is this script, and Crow runs the test seller, the three adjudicators and both operators.
4. The faucet's limit on a stopped run is the one the code allows.
5. `--out <dir>` writes the terms, the transaction hashes, the data and its SHA-256. Without it the script writes nothing.
6. The banner names the commit of the bundle's sources.
7. The last line names the report route.
8. A site test pins every bundle's imports and literal hosts, and refuses `import()`, `require`, `eval`, `new Function` and `child_process`.

Non-goals: the prompt's approval, roles and exposure text and the permission flag (T-495); a pause before funding and a `--plan` mode (Rafa's choice, D1 and D2 in the triage).

## Acceptance criteria

- [ ] `site/try.mjs` imports nothing from npm; the try command has no `npm`.
- [ ] The run prints the buyer's own terms, a roles line, the faucet's real limit and the report route.
- [ ] `--out <dir>` writes the record; a run without it writes no file.
- [ ] The banner names the source commit, and the publish build refuses when that commit's sources differ from the tree.
- [ ] `tests/site-bundles.test.ts` fails on a new import, a new host or a dynamic load in any bundle.
- [ ] The new SHA-256 is in `site/index.html` and in the filled `llms.txt`.

## Evidence

To fill in before review.

## Decisions

To fill in.

## Handoff

To fill in.
