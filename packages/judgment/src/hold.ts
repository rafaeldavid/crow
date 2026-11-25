// ADR-0051: Crow's reference adjudicators hold a reject on a deal whose terms carry a rubric, so the parties have the
// turn's window to settle or, before an escalation, for the buyer to accept, with the moves today's contracts allow
// before a decision. It is the interim for ADR-0048, which puts the same period in the next contract version.
//
// The rule is fixed and reads only the signed terms, the turn and the outcome: no per-deal setting and no choice.
// - An accept, an escalation, the fallback's turn, a party appeal (SimChain) and a deal decided by checks alone: at once.
// - A reject by the primary: at the record's decidedAt plus judgeWithinSec (judgeBy - deliverBy) minus HOLD_MARGIN_SEC.
// - A reject by the appeal adjudicator after an escalation: at decidedAt plus appealDecideSec minus HOLD_MARGIN_SEC.
// - Never longer than HOLD_MAX_SEC (a day), whatever the window: the parties choose the window, not how long Crow's
//   adjudicators delay a reject (red team M1).
// - Never later than the turn's deadline minus HOLD_MARGIN_SEC, so the decision lands before the deadline.
// - A window of HOLD_MARGIN_SEC or less holds nothing, so today's short windows sign at once.
//
// It lives in @holdback/judgment so the adjudicator service and the scenario runner (packages/testkit) run one rule.
import { toTimestamp, type DecisionOutcome, type Timestamp } from '@holdback/core';

/** What the rule reads of a decision task: the signed terms, the role, the turn's deadline and any first outcome. */
export interface HoldTask {
  commitment: { timing: { deliverBy: Timestamp; judgeBy: Timestamp; appealDecideSec: number }; acceptance?: { rubric?: { criteria?: readonly unknown[] } } };
  role: 'primary' | 'fallback' | 'appeal';
  deadline: Timestamp;
  /** Set on a party appeal (SimChain); absent after an escalation. */
  firstOutcome?: 'accept' | 'reject';
}

/** Seconds a held reject is signed before its turn's deadline: Sepolia takes about a minute a transaction, and a relay retries. */
export const HOLD_MARGIN_SEC = 600;

/** The longest hold, in seconds: one day. A longer window holds a day and then signs. */
export const HOLD_MAX_SEC = 86_400;

/** True when the terms carry a rubric with at least one criterion, so a panel scores the work (ADR-0051). */
export function hasRubric(c: { acceptance?: { rubric?: { criteria?: readonly unknown[] } } }): boolean {
  return (c.acceptance?.rubric?.criteria?.length ?? 0) > 0;
}

const seconds = (ts: Timestamp): number => Math.floor(Date.parse(ts) / 1000);

/**
 * When this adjudicator signs `outcome` on `task`, whose record was decided at `decidedAt`: a whole-second timestamp, or
 * null to sign at once. A time already passed means sign now. Malformed times hold nothing.
 */
export function holdUntil(task: HoldTask, outcome: DecisionOutcome | null, decidedAt: Timestamp): Timestamp | null {
  if (outcome !== 'reject' || !hasRubric(task.commitment)) return null;
  const t = task.commitment.timing;
  let window: number;
  let deadline = seconds(task.deadline);
  if (task.role === 'primary') {
    window = seconds(t.judgeBy) - seconds(t.deliverBy);
    // The signed terms' judgeBy bounds the primary's turn whatever the task says.
    deadline = Math.min(deadline, seconds(t.judgeBy));
  } else if (task.role === 'appeal' && task.firstOutcome === undefined) {
    window = t.appealDecideSec;
  } else {
    return null;
  }
  const from = seconds(decidedAt);
  if (![window, deadline, from].every(Number.isSafeInteger)) return null;
  const until = Math.min(from + Math.min(window - HOLD_MARGIN_SEC, HOLD_MAX_SEC), deadline - HOLD_MARGIN_SEC);
  return until > from ? toTimestamp(until * 1000) : null;
}
