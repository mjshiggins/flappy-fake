import { describe, it, expect } from 'vitest';
import { Planner } from '../src/main/planner.js';
import { makeFakeOps } from './fakeSim.js';

const cfg = { K: 8, D: 60, R: 10, pipeSpacing: 40 };

describe('Planner', () => {
  it('rejects a configuration violating the horizon invariant', () => {
    expect(() => new Planner(makeFakeOps(), { ...cfg, R: 30, D: 60, pipeSpacing: 40 }))
      .toThrow(/horizon invariant/i);
  });

  it('plans on the first tick', () => {
    const ops = makeFakeOps();
    const p = new Planner(ops, cfg);
    expect(p.replanCount).toBe(0);
    p.nextAction(ops.initial());
    expect(p.replanCount).toBe(1);
  });

  it('reuses the plan for exactly R steps', () => {
    const ops = makeFakeOps();
    const p = new Planner(ops, cfg);
    for (let i = 0; i < cfg.R; i++) p.nextAction(ops.initial());
    expect(p.replanCount).toBe(1);
    p.nextAction(ops.initial());
    expect(p.replanCount).toBe(2);
  });

  it('re-plans immediately when drift is reported', () => {
    const ops = makeFakeOps();
    const p = new Planner(ops, cfg);
    p.nextAction(ops.initial());
    p.nextAction(ops.initial(), { drift: true });
    expect(p.replanCount).toBe(2);
  });

  it('re-plans immediately on a run-state change', () => {
    const ops = makeFakeOps();
    const p = new Planner(ops, cfg);
    p.nextAction(ops.initial());
    p.nextAction(ops.initial(), { stateChanged: true });
    expect(p.replanCount).toBe(2);
  });

  it('returns booleans', () => {
    const ops = makeFakeOps();
    const p = new Planner(ops, cfg);
    expect(typeof p.nextAction(ops.initial())).toBe('boolean');
  });

  it('remainingActions is the unexecuted tail, and null when there is no plan', () => {
    const ops = makeFakeOps();
    const p = new Planner(ops, cfg);
    expect(p.remainingActions()).toBeNull();
    p.nextAction(ops.initial());
    expect(p.remainingActions()).toEqual(p.plan.slice(p.idx));
    p.invalidate();
    expect(p.remainingActions()).toBeNull();
  });

  it('remainingActions is null for an exhausted empty plan, not a cue to search again', () => {
    const ops = makeFakeOps();
    const p = new Planner(ops, { K: 4, D: 40, R: 10, pipeSpacing: 20 });
    p.nextAction({ y: 295, vy: 50, t: 0, dead: false });
    p.plan = [];
    p.idx = 0;
    expect(p.remainingActions()).toBeNull();
  });

  it('records lastMinWidth from a budget-narrowed search', () => {
    const ops = makeFakeOps();
    let t = 0;
    const p = new Planner(ops, {
      K: 8, D: 30, R: 10, pipeSpacing: 20,
      budgetMs: 0, now: () => ++t,
    });
    p.nextAction(ops.initial());
    expect(p.lastMinWidth).toBe(4);
    expect(p.narrowedReplans).toBe(1);
  });

  it('resetRun zeros run counters and clears the plan', () => {
    const ops = makeFakeOps();
    const p = new Planner(ops, cfg);
    p.nextAction(ops.initial());
    expect(p.replanCount).toBe(1);
    p.resetRun();
    expect(p.replanCount).toBe(0);
    expect(p.exhaustedReplans).toBe(0);
    expect(p.narrowedReplans).toBe(0);
    expect(p.lastMinWidth).toBeNull();
    expect(p.plan).toBeNull();
  });

  it('counts exhausted replans and clears lastExhausted on invalidate', () => {
    // A doomed root (near the ceiling with high upward velocity) has no
    // survivable plan, so the first replan is exhausted. lastExhausted must NOT
    // then linger across a run boundary -- invalidate() (called on gameover /
    // getready) has to clear it, or the HUD keeps showing a stale warning.
    const ops = makeFakeOps();
    const p = new Planner(ops, { K: 4, D: 40, R: 10, pipeSpacing: 20 });
    p.nextAction({ y: 295, vy: 50, t: 0, dead: false });
    expect(p.lastExhausted).toBe(true);
    expect(p.exhaustedReplans).toBe(1);
    p.invalidate();
    expect(p.lastExhausted).toBe(false);
    expect(p.exhaustedReplans).toBe(1); // cumulative diagnostic, not reset
  });
});
