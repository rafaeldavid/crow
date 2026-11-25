// ADR-0051: the held reject's rule, run by the service (service.ts, decideTask). It lives in @holdback/judgment, so the
// scenario runner (packages/testkit) runs the same rule without carrying this service into the bundles that use it.
export { HOLD_MARGIN_SEC, HOLD_MAX_SEC, hasRubric, holdUntil, type HoldTask } from '@holdback/judgment';
