import { describe, it, expect } from 'vitest';
import { makeFakeOps } from './fakeSim.js';

describe('fakeSim', () => {
  it('falls under gravity', () => {
    const ops = makeFakeOps();
    const s = ops.cloneFrom(ops.initial());
    const y0 = ops.birdY(s);
    ops.step(s);
    expect(ops.birdY(s)).toBeLessThan(y0);
  });

  it('rises after a flap', () => {
    const ops = makeFakeOps();
    const s = ops.cloneFrom(ops.initial());
    const y0 = ops.birdY(s);
    ops.flap(s); ops.step(s);
    expect(ops.birdY(s)).toBeGreaterThan(y0);
  });

  it('dies when it leaves the corridor', () => {
    const ops = makeFakeOps();
    const s = ops.cloneFrom(ops.initial());
    for (let i = 0; i < 500; i++) ops.step(s);
    expect(ops.isDead(s)).toBe(true);
  });

  it('clones independently', () => {
    const ops = makeFakeOps();
    const a = ops.cloneFrom(ops.initial());
    const b = ops.cloneFrom(a);
    ops.flap(b); ops.step(b); ops.step(a);
    expect(ops.birdY(a)).not.toBe(ops.birdY(b));
  });
});
