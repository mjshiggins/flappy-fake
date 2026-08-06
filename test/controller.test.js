import { describe, it, expect } from 'vitest';
import { Controller } from '../src/main/controller.js';
import { makeFakeOps } from './fakeSim.js';

const cfg = { K: 4, D: 60, R: 10, pipeSpacing: 40, driftLimit: 3 };

function harness(state = 'play') {
  const ops = makeFakeOps();
  const live = { ...ops.initial(), state, flaps: 0, restarts: 0 };
  const api = {
    flap: () => { ops.flap(live); live.flaps += 1; },
    restart: () => { live.restarts += 1; },
    getState: () => live.state,
  };
  return { ops, live, api, c: new Controller(ops, api, cfg) };
}

describe('Controller', () => {
  it('flaps to start a run from getready', () => {
    const h = harness('getready');
    h.c.tick(h.live);
    expect(h.live.flaps).toBe(1);
  });

  it('does not actuate while armed is false', () => {
    const h = harness('play');
    h.c.armed = false;
    h.c.tick(h.live);
    expect(h.live.flaps).toBe(0);
  });

  it('invalidates the plan on gameover', () => {
    const h = harness('play');
    h.c.tick(h.live);
    h.live.state = 'gameover';
    h.c.tick(h.live);
    expect(h.c.planner.plan).toBeNull();
  });

  it('restarts on gameover only when autoRestart is set', () => {
    const h = harness('play');
    h.live.state = 'gameover';
    h.c.tick(h.live);
    expect(h.live.restarts).toBe(0);
    h.c.autoRestart = true;
    h.c.tick(h.live);
    expect(h.live.restarts).toBe(1);
  });

  it('disarms after driftLimit consecutive drifts', () => {
    const h = harness('play');
    h.c.tick(h.live);
    for (let i = 0; i < cfg.driftLimit + 1; i++) {
      h.live.y += 999;          // force divergence from the prediction
      h.c.tick(h.live);
    }
    expect(h.c.armed).toBe(false);
    expect(h.c.status).toMatch(/drift/i);
  });
});
