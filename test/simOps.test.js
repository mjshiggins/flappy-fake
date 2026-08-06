import { describe, it, expect } from 'vitest';
import { makeSimOps } from '../src/main/simOps.js';

class StubGame {
  birdY = 0; birdVy = 0; birdRot = 0; scrollX = 0; pipeScroll = 0;
  score = 0; elapsed = 0; playStep = 0; spawnCount = 0; pendingPasses = 0;
  simVersion = 4; state = 'play'; deathCause = null;
  pipes = []; prng = { state: 0n };
  soundListeners = new Set(); bestScoreListeners = new Set();
  chase = null; ghostReplay = null; netMode = 'offline'; ranked = false;
  flap() { this.birdVy = 10; }
  step() { this.birdVy -= 1; this.birdY += this.birdVy; this.playStep += 1; }
}

const ops = () => makeSimOps(StubGame);

describe('makeSimOps', () => {
  it('deep-copies pipes so clones do not alias', () => {
    const live = new StubGame();
    live.pipes = [{ x: 5, gapY: 1, halfGap: 2, passed: false }];
    const c = ops().cloneFrom(live);
    c.pipes[0].x = 99;
    expect(live.pipes[0].x).toBe(5);
  });

  it('copies bigint prng state', () => {
    const live = new StubGame();
    live.prng.state = 1234n;
    expect(ops().cloneFrom(live).prng.state).toBe(1234n);
  });

  it('leaves the clone inert: empty listeners, offline, unranked', () => {
    const c = ops().cloneFrom(new StubGame());
    expect(c.soundListeners.size).toBe(0);
    expect(c.netMode).toBe('offline');
    expect(c.ranked).toBe(false);
    expect(c.ghostReplay).toBeNull();
  });

  it('copies scalar state', () => {
    const live = new StubGame();
    live.birdY = 42; live.birdVy = -3; live.playStep = 7;
    const c = ops().cloneFrom(live);
    expect(c.birdY).toBe(42);
    expect(c.birdVy).toBe(-3);
    expect(c.playStep).toBe(7);
  });

  it('steps a clone without touching the live game', () => {
    const o = ops();
    const live = new StubGame();
    const c = o.cloneFrom(live);
    o.flap(c); o.step(c);
    expect(live.birdY).toBe(0);
    expect(o.birdY(c)).not.toBe(0);
  });
});
