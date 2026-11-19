# T-553: Crow buys the review of its contract fixes through a deal on Crow

- **Lane:** docs
- **Phase:** 2
- **Depends on:** T-523 (the first scan's triage), the fixes on the lane `contracts-audit-ready` at `d621291e`
- **Paths this task may touch:** `docs/operations.md` (the deploy record), this file. Everything else is private (`docs/private-materials.md`).
- **Human gate:** yes. Rafa creates or approves the machine, the model key, the seller's redeploy, the terms and the one start.
- **Status:** done
- **Agent/session:** the T-553 session, 2026-11-19
- **Roadmap row:** N203
- **Change kind:** docs only

## Intent

Crow buys the outside review of its contract fixes from design partner A, the reviewers of the first scan, through a deal on Crow. The buyer is a new agent on a new machine that starts cold from `https://crow.direct/llms.txt`. The seller is Crow's own hosted seller, `pilot-scan-2`. The deal is Crow's own case study, and its transcript shows where an outside buyer's agent stumbles.

## Acceptance criteria

- [x] The deal is Released on Sepolia, or closed by a refund both sides sign.
- [x] The review was started once, on Rafa's go, after a free price check in both modes.
- [x] The review and the buyer agent's transcript are kept privately, with a timeline, a review of the stumbles and a triage note.
- [x] A one-page reading for Rafa: whether each change closes its findings, what is new, and what must change before a deploy.
- [x] No contract code changed.

## Evidence

All measured on 2026-11-19 unless marked.

- **The deal:** `0x5533006ae164c48e5d4894f7313abe77a125b3fcb0268f0e0478fa24f2bd913a`. Both `api.crow.direct` and `api2.crow.direct` read `escrowState` `Released`, `appealState` `none`, `attempt` 1, the same delivery hash, settled and final at 10:58:12 UTC (read at 10:59:42 UTC).
- **Price:** the reviewers quoted 0 credits in both modes, and the operators allow a price of 0 when a fee is set. The deal held price 0 tUSDC plus a 50 tUSDC adjudication fee. The operator fee was 0.
- **Stages (UTC):**
  - the buyer agent's first command 08:59:28;
  - the offer 09:01:07;
  - Rafa's one approval 09:03:41;
  - funded 09:04:24;
  - the review job created at the reviewers 09:04:43;
  - the job completed 10:56:32 (a run of 5,613 s);
  - delivered 10:58:00;
  - accepted and Released 10:58:12.
- **The buyer agent:**
  - from the first command to funded: 4 min 59 s, 21 commands with 1 failed, 1 approval;
  - whole run: 28 model calls and 1,187,621 tokens, mostly cache reads;
  - the deal record: 15 checks passed, 0 failed, 5 not run, no disagreement between the operators.
- **The judgment:** all five required checks passed; the rubric is empty, so no panel ran. The screen flagged the review's own wording, and under the default rules that does not stop an accept.
- **The review:** nothing is rated above Informational. Five changes close their findings. The beacon probe closes its finding only in part, and the review reports what is left as a new Informational finding. Two earlier findings stayed open for Rafa's choice. He kept both as known limits for phase one and put their fixes in the next contract version (D85). The findings stay private until they are addressed.
- **The seller's deploy:** "Crow's own seller, pilot-scan-2, sells a fix review" in `docs/operations.md`, Deploy record.

## Handoff

Done. The private records are in the private repository, under the first partner's folder: the review as delivered, its reading, the buyer agent's run and the triage note. Rafa has asked for a separate session to publish the audit and update the Trust page; that work is not part of this task.
