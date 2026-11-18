# T-495: The try path asks one yes after naming its roles and exposure, and runs under Node's permission flag

- **Lane:** agent access (the site's guides and the home page's prompt)
- **Phase:** 2
- **Depends on:** T-469 (the goal commands), T-491 (the report route and the preflight)
- **Paths this task may touch:** `site/build.mjs` (the prompt and the command lines, not the bundles), `site/llms.txt`, `site/ref/intake.txt`, `site/trust.mjs`, `site/check.mjs`, the files `node site/build.mjs` writes from them (`site/index.html`, `site/trust.html`, `site/trust.txt`), this file. Two tests that pin the command and fill `llms.txt` themselves, outside the site lane: one line in `examples/try.test.ts` and two in `tools/duet/world.ts`.
- **Human gate:** the site deploy, Rafa's.
- **Status:** done (pull request 600, merged 2026-11-16 as `bd440f9f`; live by the site deploy of 2026-11-17 05:51 UTC)
- **Agent/session:** a session started from the first-outside-run triage, 2026-11-16, branch `t-495-try-roles-exposure`.
- **Roadmap row:** N168
- **Change kind:** 1 (copy and agent docs), with the four goal commands' run line changed. No bundle changes.

## Intent

Restated in my own words.

On 2026-11-15 the first outside tester ran the home page's try command through their own coding agent. The agent ran it at once, because the prompt said "run this command as written", while `llms.txt` asked for the principal's approval first. Neither page said that Crow runs every role but the buyer, or what the run exposes. The command also ran with all of Node's permissions. This task closes those gaps in words and in the command line, and keeps every bundle's SHA-256 the same:

1. The home page's prompt and the try section of `llms.txt` have the agent show its principal the command, say who runs each role and what the run exposes, and wait for one yes.
2. The four goal commands run under `node --permission --allow-fs-read=.`, and the pages say Node 22.18 or later.
3. The try section asks for one first-deal report after the deal, with the principal's yes.
4. The trust page answers how to check a command before running it.

The source is the private triage file of 2026-11-16 on the first outside run, its "Fix now" items 1 to 4. Non-goals: the "Fix soon" items, which change `try.mjs` and so its hash.

## Acceptance criteria

- [x] The prompt and "Try it" ask for one yes before the command, name Crow as the other party, the three adjudicators and both operators, and list what a run exposes: a public deal on Sepolia; the IP address seen by Crow's site and operators, request lines kept without it for the retention in `apps/demo-cloud/src/telemetry.ts`, and npm at the install; the work readable by Crow's adjudicators and not by the operators.
- [x] The try command and the three other goal commands run `node --permission --allow-fs-read=.`; each ran once live under the flag on Node 22.18 or later before the change.
- [x] "Try it" and the prompt say Node 22.18 or later; no page on the try path says Node 20.
- [x] "Try it" and the prompt ask for one first-deal report after the deal (`ref/limits.txt`, "Reporting a problem").
- [x] `trust.txt` and `/trust` answer "How do I check a command before I run it?", with what a matching hash proves and does not prove.
- [x] No bundle's SHA-256 changes.
- [x] The plain-HTTP buyer's path stays within its budget (`tests/site-guides.test.ts`), and the home page within its 8,000 bytes (`site/check.mjs`).
- [x] `site/check.mjs` fails if a goal command loses the flag, or if the prompt or "Try it" loses the yes, the roles, the exposure or the report.

## Evidence

All measured on 2026-11-16 unless labelled.

- **The four commands, live under the flag, before the change.** Node v22.22.2, each command as published on crow.direct with `node --permission --allow-fs-read=.` in place of `node`, each in its own empty folder, all four at once. Every hash check printed `OK`.

  | Command | Last line | Exit |
  |---|---|---|
  | try (`try.mjs --seller …/test-seller`) | `done      commitment 0x83bf51a0…67e3 Released` | 0 |
  | sell (`try-sell.mjs`) | `done      commitment 0x50ec20c8…2540 Released` | 0 |
  | judged (`try-judged.mjs`), live panel of three pinned models | `done      commitment 0x1645628f…1246 Released` | 0 |
  | reclaim (`try-reclaim.mjs`), never delivered by design | `done      commitment 0x5968946a…f3ac Refunded` | 0 |

  After the runs each folder held only the downloaded file (and, for try, `crow-try` with its npm install). Under the same flags in the same folder, `fs.writeFileSync` and `child_process.execSync` both threw `ERR_ACCESS_DENIED`. Node 22.18 itself was not run; the permission model is stable from 22.13 [inferred, Node's release notes].
- **Hashes.** `shasum -a 256 -c` of all seven bundles (`try`, `try-sell`, `try-judged`, `try-reclaim`, `preflight`, `buy`, `setup`) before and after `node site/build.mjs`: all `OK`. `try.mjs` stays `04ef4434…75c8`.
- **Budgets.** The plain-HTTP buyer's path was 9,442 tokens before the change and is 9,449 of 9,450 after (bytes divided by four). The first-deal paths: buyer 4,623 and seller 4,254 of 5,000. `site/index.html` is 7,987 of 8,000 bytes.
- **Checks.** `node site/build.mjs && node site/check.mjs`: PASS. `pnpm typecheck` and `pnpm lint`: no findings. `pnpm test`: the first run failed 7 tests in 2 files, both pinned to the old shape (`examples/try.test.ts` expected the old try command; `tools/duet/world.ts` fills `llms.txt` itself and did not know the two new placeholders). Both now use the build's own values (`fillFacts` in `site/build.mjs`); `vitest run examples/try.test.ts tools/duet/duet.test.ts tests/site-guides.test.ts`: 3 files, 61 tests passed. The rest of the first run: 237 files passed.

- **Review (2026-11-16, `reviewer` agent): ISSUES, all fixed in the second commit.** The structure passed. No bundle changed. Every new check fails when its text is removed (measured by mutation). Nothing moved out of `llms.txt` is lost downstream. The five issues and their fixes:
  1. The text said the flag confines the file. It does not limit environment variables or the network (measured on Node 22.22.2: 75 env keys readable, `fetch` returns 200). The prompt, "Try it" and the trust answer now say so.
  2. The trust answer said "as the commands do"; the preflight and setup commands run without the flag. It now says "as the four goal commands do", says Node calls the flag a safeguard for trusted code, not a sandbox, and says to run the command in a shell whose environment holds no secrets.
  3. The rebuild step named no commit. It now finds the commit whose `site/try.mjs` has the command's hash, and a hash match claims the public source only after a rebuild.
  4. The rubric exposure now says the public judgment record quotes the work (`ref/limits.txt`, "Public terms").
  5. `--work <file>` reads under the flag only inside the command's folder. `ref/intake.txt` now says so.
- **After the fixes (measured):** `node site/check.mjs`: PASS. The plain-HTTP buyer's path is 9,450 of 9,450 tokens. The home page is 7,990 of 8,000 bytes. All seven bundle hashes are unchanged. The 3 test files pass (61 tests); `pnpm lint` reports no findings. To pay for the fixes: the prompt points to llms.txt for the report route, and `llms.txt` drops the line that the buyer's and the seller's tools pin the deployment themselves.

## Decisions

- **Where the budget came from.** The try section's new text cost about 200 tokens. To pay for it on the plain-HTTP buyer's path:
  - the sell command's sample flags moved to `ref/intake.txt`, "Sell to Crow's test buyer";
  - the opening "open protocol" paragraph became the first line of "How a deal works";
  - the deployment's field-by-field glossary became a pointer to `ref/signing.txt` and `ref/http-buyer.txt`, which state each field's use;
  - "How a deal works" lost the operator fee and appeal detail that `ref/limits.txt`, "Honest limits", already states;
  - the line on block times went; each goal still states its duration.

  The path now has 1 token of headroom, so the next addition to `llms.txt` needs a move first.
- **The request log's retention is a variable.** `llms.txt` carries `{{REQUEST_LOG_DAYS}}` and the prompt reads the same number, both from `apps/demo-cloud/src/telemetry.ts` through `trustFacts()`, as the trust page does. `{{NODE_MIN}}` fills the Node version from `NODE_MIN` in `site/build.mjs`.
- **The exposure line names Crow's site too,** since the command fetches from crow.direct, and says the request lines hold no IP address, as the trust page's "What does an operator log for each request?" says. The rubric goal adds the judges' two model providers, as `ref/limits.txt`, "Public terms", says.
- **The preflight command keeps its plain `node`.** It is not a goal command, and the task named four. Adding the flag there is a one-line follow-up.

## Handoff

- **Done:** the four items, in one PR. Nothing is deployed: crow.direct still serves the old prompt and commands until Rafa's word on the site deploy (`docs/operations.md`).
- **Not done, for the next change to `try.mjs`** (the triage's "Fix soon"): bundle viem and tweetnacl into `try.mjs`, which removes the npm line from the exposure; fix the "seller's own terms" line; an opt-in `--out <dir>`; the banner's source commit and the report route on the last line. The banners inside the bundles still say Node 20 until then, because changing them changes the hashes.
- **Seen, out of scope:** `trust.txt`'s "Where do I report any other problem?" and "Does an operator store problem reports?" still say the report route is off, though both operators take reports since T-491. The preflight command could carry the permission flag too.
