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

  it('snapshots death diagnostics before invalidating the plan', () => {
    const h = harness('play');
    h.live.deathCause = 'pipeTop';
    h.live.score = 132;
    h.live.playStep = 26914;
    h.live.pipeScroll = 450738612;
    h.live.birdY = 900000;
    h.live.pipes = [{ x: 204649, gapY: 671092, halfGap: 246415, passed: false }];
    h.c.tick(h.live);
    const remaining = h.c.planner.plan.slice(h.c.planner.idx);
    h.live.state = 'gameover';
    h.c.tick(h.live);
    expect(h.c.planner.plan).toBeNull();
    expect(h.c.lastDeath.deathCause).toBe('pipeTop');
    expect(h.c.lastDeath.score).toBe(132);
    expect(h.c.lastDeath.playStep).toBe(26914);
    expect(h.c.lastDeath.plan).toEqual(remaining);
    expect(h.c.lastDeath.pipes).toEqual([
      { x: 204649, gapY: 671092, halfGap: 246415, passed: false },
    ]);
    expect(h.c.lastDeath.replans).toBeGreaterThan(0);
    expect(h.c.lastDeath.traj).toBeTruthy();
  });

  it('does not overwrite lastDeath on later gameover ticks', () => {
    const h = harness('play');
    h.live.deathCause = 'pipeTop';
    h.c.tick(h.live);
    h.live.state = 'gameover';
    h.c.tick(h.live);
    const first = h.c.lastDeath;
    h.live.deathCause = 'ground';
    h.c.tick(h.live);
    expect(h.c.lastDeath).toBe(first);
    expect(h.c.lastDeath.deathCause).toBe('pipeTop');
  });

  it('clears lastDeath and run counters on getready', () => {
    const h = harness('play');
    h.live.deathCause = 'pipeTop';
    h.c.tick(h.live);
    h.live.state = 'gameover';
    h.c.tick(h.live);
    expect(h.c.lastDeath).not.toBeNull();
    h.live.state = 'getready';
    h.c.tick(h.live);
    expect(h.c.lastDeath).toBeNull();
    expect(h.c.planner.replanCount).toBe(0);
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
