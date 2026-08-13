import { Planner } from './planner.js';
import { DriftCheck } from './drift.js';
import { planTrajectory } from './trajectory.js';

/** Per-tick orchestration. Runs immediately before each real simulation step. */
export class Controller {
  constructor(ops, api, cfg) {
    this.ops = ops;
    this.api = api;
    this.cfg = cfg;
    this.planner = new Planner(ops, cfg);
    this.drift = new DriftCheck(ops, { epsilon: cfg.epsilon ?? 0 });
    this.armed = true;
    this.autoRestart = false;
    this.status = 'ok';
    this.lastState = null;
    this.driftEvents = 0;
    this.lastDeath = null;
  }

  tick(live) {
    if (!this.armed) return;

    const state = this.api.getState();
    const stateChanged = state !== this.lastState;
    this.lastState = state;

    const { drift, consecutive } = this.drift.check(live);
    if (drift) this.driftEvents += 1;
    if (consecutive > this.cfg.driftLimit) {
      this.armed = false;
      this.status = `disarmed: persistent drift (${consecutive} consecutive)`;
      return;
    }

    if (state === 'getready') {
      this.lastDeath = null;
      this.planner.resetRun();
      this.drift.reset();
      this.driftEvents = 0;
      this.api.flap();
      return;
    }

    if (state === 'gameover') {
      if (stateChanged) this.#snapshotDeath(live);
      this.planner.invalidate();
      this.drift.reset();
      if (this.autoRestart) this.api.restart();
      return;
    }

    const action = this.planner.nextAction(live, { drift, stateChanged });
    if (action) this.api.flap();
    // predict() flaps its own clone again with the same action. That is correct,
    // not a double-flap bug: flap() assigns velocity absolutely rather than
    // adding an impulse, so applying it to the clone reproduces live exactly.
    this.drift.predict(live, action);
  }

  #snapshotDeath(live) {
    const p = this.planner;
    const remaining = p.plan && p.idx < p.plan.length ? p.plan.slice(p.idx) : [];
    const pipes = Array.isArray(live.pipes)
      ? live.pipes.map((q) => ({ x: q.x, gapY: q.gapY, halfGap: q.halfGap, passed: q.passed }))
      : [];
    let traj = null;
    try { traj = planTrajectory(live, this.ops, remaining); } catch { /* fake/partial ops */ }
    this.lastDeath = {
      deathCause: live.deathCause ?? null,
      score: live.score ?? null,
      playStep: live.playStep ?? null,
      spawnCount: live.spawnCount ?? null,
      birdY: this.ops.birdY(live),
      birdVy: live.birdVy ?? null,
      pipeScroll: live.pipeScroll ?? null,
      pipes,
      plan: remaining,
      replans: p.replanCount,
      exhaustedReplans: p.exhaustedReplans,
      narrowedReplans: p.narrowedReplans,
      lastExhausted: p.lastExhausted,
      lastMinWidth: p.lastMinWidth,
      driftEvents: this.driftEvents,
      visibilityState: typeof document !== 'undefined' ? document.visibilityState : null,
      runSeed: live.runSeed != null ? String(live.runSeed) : null,
      traj,
    };
  }
}
