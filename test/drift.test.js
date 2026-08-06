import { describe, it, expect } from 'vitest';
import { DriftCheck } from '../src/main/drift.js';
import { makeFakeOps } from './fakeSim.js';

describe('DriftCheck', () => {
  it('reports no drift when the action is applied before stepping', () => {
    const ops = makeFakeOps();
    const live = ops.initial();
    const d = new DriftCheck(ops);
    d.predict(live, true);
    ops.flap(live); ops.step(live);
    expect(d.check(live).drift).toBe(false);
  });

  it('detects drift when reality diverges from the prediction', () => {
    const ops = makeFakeOps();
    const live = ops.initial();
    const d = new DriftCheck(ops);
    d.predict(live, false);
    ops.flap(live); ops.step(live);   // reality flapped; prediction did not
    expect(d.check(live).drift).toBe(true);
  });

  it('reports no drift before any prediction exists', () => {
    const ops = makeFakeOps();
    expect(new DriftCheck(ops).check(ops.initial()).drift).toBe(false);
  });

  it('counts consecutive drift and clears the streak on agreement', () => {
    const ops = makeFakeOps();
    const live = ops.initial();
    const d = new DriftCheck(ops);
    d.predict(live, false); ops.flap(live); ops.step(live);
    expect(d.check(live).consecutive).toBe(1);
    d.predict(live, false); ops.flap(live); ops.step(live);
    expect(d.check(live).consecutive).toBe(2);
    d.predict(live, true); ops.flap(live); ops.step(live);
    expect(d.check(live).consecutive).toBe(0);
  });
});
