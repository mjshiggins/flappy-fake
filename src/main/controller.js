import { Planner } from './planner.js';
import { DriftCheck } from './drift.js';

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
      this.planner.invalidate();
      this.drift.reset();
      this.api.flap();
      return;
    }

    if (state === 'gameover') {
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
}
