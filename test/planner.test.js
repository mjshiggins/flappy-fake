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
});
