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
    this.lastMinWidth = null;
    // Cumulative diagnostics for "why is the search exhausting so much": how
    // many replans returned no full-horizon survivor, and how many ran under a
    // budget-narrowed beam. Not reset by invalidate() -- they measure a run.
    // resetRun() (getready) zeros them so the HUD is per-run, not per-page.
    this.exhaustedReplans = 0;
    this.narrowedReplans = 0;
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
    this.lastMinWidth = r.minWidth;
    if (r.exhausted) this.exhaustedReplans += 1;
    if (r.minWidth < K) this.narrowedReplans += 1;
    this.idx = 0;
    this.replanCount += 1;
  }

  // Clears the CURRENT status (lastExhausted) so it cannot linger on the HUD
  // across a run boundary; the cumulative counters are deliberately preserved.
  invalidate() { this.plan = null; this.idx = 0; this.lastExhausted = false; }

  // The HUD preview must render THIS, never kick off a second beam search.
  // An empty/exhausted plan returns null so the overlay shows "no plan"
  // instead of a 12ms+ unbounded search on the main thread.
  remainingActions() {
    if (this.plan && this.idx < this.plan.length) return this.plan.slice(this.idx);
    return null;
  }

  // New run: drop the plan AND the per-run counters.
  resetRun() {
    this.invalidate();
    this.replanCount = 0;
    this.exhaustedReplans = 0;
    this.narrowedReplans = 0;
    this.lastMinWidth = null;
  }
}
