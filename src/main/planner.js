import { beamSearch } from './search.js';

/**
 * Executes a cached plan for a bounded interval R, then re-plans.
 *
 * R is bounded by the horizon invariant R <= D - pipeSpacing. Reuse beyond that
 * executes plan actions chosen with less than one pipe spacing of remaining
 * lookahead -- the blind-greedy regime. Plan reuse is an AFFORDABILITY argument,
 * not a claim that re-planning is redundant: the search uses a receding horizon,
 * so successive searches optimise different windows.
 */
export class Planner {
  constructor(ops, { K, D, R, pipeSpacing, now = () => 0, budgetMs = null }) {
    if (R > D - pipeSpacing) {
      throw new Error(
        `horizon invariant violated: R (${R}) must be <= D - pipeSpacing (${D - pipeSpacing})`
      );
    }
    this.ops = ops;
    this.cfg = { K, D, R, now, budgetMs };
    this.plan = null;
    this.idx = 0;
    this.replanCount = 0;
    this.lastExhausted = false;
  }

  nextAction(liveState, { drift = false, stateChanged = false } = {}) {
    const stale = this.plan === null || this.idx >= this.cfg.R || this.idx >= this.plan.length;
    if (stale || drift || stateChanged) this.#replan(liveState);
    const action = this.plan[this.idx] ?? false;
    this.idx += 1;
    return action === true;
  }

  #replan(liveState) {
    const { K, D, now, budgetMs } = this.cfg;
    const deadline = budgetMs === null ? null : now() + budgetMs;
    const r = beamSearch(liveState, this.ops, { K, D, deadline, now });
    this.plan = r.actions;
    this.lastExhausted = r.exhausted;
    this.idx = 0;
    this.replanCount += 1;
  }

  invalidate() { this.plan = null; this.idx = 0; }
}
