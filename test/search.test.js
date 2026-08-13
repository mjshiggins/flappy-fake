import { describe, it, expect } from 'vitest';
import { beamSearch } from '../src/main/search.js';
import { makeFakeOps } from './fakeSim.js';

describe('beamSearch', () => {
  it('returns a plan of the requested horizon when survival is possible', () => {
    const ops = makeFakeOps();
    const r = beamSearch(ops.initial(), ops, { K: 8, D: 60 });
    expect(r.actions).toHaveLength(60);
    expect(r.exhausted).toBe(false);
  });

  it('produces a plan that actually survives when replayed', () => {
    const ops = makeFakeOps();
    const r = beamSearch(ops.initial(), ops, { K: 8, D: 60 });
    const s = ops.cloneFrom(ops.initial());
    for (const a of r.actions) { if (a) ops.flap(s); ops.step(s); }
    expect(ops.isDead(s)).toBe(false);
  });

  it('flaps immediately when only an immediate flap survives', () => {
    // start at the floor with downward velocity: not flapping now is fatal
    const ops = makeFakeOps();
    const root = { y: -290, vy: -8, t: 0, dead: false };
    const r = beamSearch(root, ops, { K: 8, D: 20 });
    expect(r.actions[0]).toBe(true);
  });

  it('returns the longest-surviving prefix when every branch dies', () => {
    // Adjusted from the original { y: -299, vy: -50 } floor scenario: under
    // fakeSim's physics, flap() sets vy absolutely (not additively) to a
    // fixed positive value, so any downward-velocity/floor state is always
    // recoverable by flapping immediately — it can never be truly doomed.
    // The genuinely unrecoverable case is the ceiling instead: starting near
    // the top boundary with high upward velocity, even the flap branch's
    // minimal net ascent (+11/step) overshoots the corridor.
    const ops = makeFakeOps();
    const doomed = { y: 295, vy: 50, t: 0, dead: false };
    const r = beamSearch(doomed, ops, { K: 4, D: 40 });
    expect(r.exhausted).toBe(true);
    expect(r.actions.length).toBeLessThan(40);
  });

  it('never returns a plan longer than D', () => {
    const ops = makeFakeOps();
    const r = beamSearch(ops.initial(), ops, { K: 4, D: 15 });
    expect(r.actions.length).toBeLessThanOrEqual(15);
  });

  it('reports the narrowed beam width when the deadline is exceeded', () => {
    // With an already-elapsed deadline, width halves once. minWidth exposes
    // that so a caller can tell the plan was produced under a reduced beam.
    const ops = makeFakeOps();
    let t = 0;
    const r = beamSearch(ops.initial(), ops, { K: 8, D: 30, deadline: 0, now: () => (t += 10) });
    expect(r.minWidth).toBeLessThan(8);
  });

  it('does not keep halving after the deadline has already been missed', () => {
    // now() is past the deadline at every depth. Repeated >>1 would collapse
    // K=8 to 2 within three levels, then search the rest of the horizon —
    // including the next pipe — at width 2. One in-flight narrow leaves K/2.
    const ops = makeFakeOps();
    const r = beamSearch(ops.initial(), ops, { K: 8, D: 30, deadline: 0, now: () => 1 });
    expect(r.minWidth).toBe(4);
    expect(r.exhausted).toBe(false);
  });

  it('reports full width when never budget-limited', () => {
    const ops = makeFakeOps();
    const r = beamSearch(ops.initial(), ops, { K: 8, D: 30 });
    expect(r.minWidth).toBe(8);
  });

  it('releases every outstanding clone, including the surviving beam', () => {
    // fakeSim's own release() is a no-op, so it can't detect a leak on its
    // own: wrap it with a counter that tracks cloneFrom/release calls.
    const base = makeFakeOps();
    let outstanding = 0;
    const counting = {
      ...base,
      cloneFrom: (s) => { outstanding += 1; return base.cloneFrom(s); },
      release: (s) => { outstanding -= 1; base.release(s); },
    };
    beamSearch(counting.initial(), counting, { K: 8, D: 30 });
    expect(outstanding).toBe(0);
  });
});
