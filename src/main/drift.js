/**
 * Verifies the forward model still reproduces the real game.
 *
 * GUARDS: physics fidelity (has the site changed the simulation?).
 * DOES NOT GUARD: plan quality. An exact model reproduces the trajectory
 * perfectly while a stale plan steers into a pipe it was never deep enough to
 * see. Plan quality is guarded structurally by the horizon invariant in Planner.
 */
export class DriftCheck {
  constructor(ops, { epsilon = 0 } = {}) {
    this.ops = ops;
    this.epsilon = epsilon;
    this.predicted = null;
    this.consecutive = 0;
  }

  /** Call AFTER choosing the action, BEFORE the live game steps. */
  predict(liveState, action) {
    const s = this.ops.cloneFrom(liveState);
    if (action) this.ops.flap(s);   // ordering matters: flap changes vy
    this.ops.step(s);
    this.predicted = this.ops.birdY(s);
    this.ops.release(s);
  }

  /** Call on the following tick, after the live game has stepped. */
  check(liveState) {
    if (this.predicted === null) return { drift: false, consecutive: 0, delta: 0 };
    const delta = Math.abs(this.ops.birdY(liveState) - this.predicted);
    const drift = delta > this.epsilon;
    this.consecutive = drift ? this.consecutive + 1 : 0;
    return { drift, consecutive: this.consecutive, delta };
  }

  reset() { this.predicted = null; this.consecutive = 0; }
}
