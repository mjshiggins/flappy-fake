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

describe('rank target selection', () => {
  // `passed` is a SCORING flag, set the instant a pipe reaches x <= 0. The pipe
  // still has width, so the bird stays physically between its jaws for many
  // steps afterwards. Selecting the target by `!passed` retargets to the next
  // pipe — a million units away, with an unrelated gapY — while the bird is
  // still inside the current one, and drives it straight into the jaws it just
  // cleared. Target selection must use physical clearance, not scoring.
  const state = (birdY, pipes) => Object.assign(new StubGame(), { birdY, pipes });

  it('keeps targeting a scored pipe while the bird is still inside it', () => {
    const o = ops();
    const justScored = { x: -100, gapY: 1000, halfGap: 500, passed: true };
    const nextPipe = { x: 900000, gapY: 999999, halfGap: 500, passed: false };
    const c = state(1000, [justScored, nextPipe]);
    // Bird sits exactly in the scored pipe's gap: that is the correct place to
    // be, so rank must read as ideal (0), not as "miles from the next pipe".
    expect(o.rank(c)).toBe(0);
  });

  it('advances to the next pipe once the bird is physically clear', () => {
    const o = ops();
    const longGone = { x: -900000, gapY: 1000, halfGap: 500, passed: true };
    const upcoming = { x: 400000, gapY: 7000, halfGap: 500, passed: false };
    const c = state(1000, [longGone, upcoming]);
    expect(o.rank(c)).toBe(6000);   // distance to the upcoming pipe, not 0
  });

  it('falls back to centring when no pipe is in range', () => {
    const o = ops();
    expect(o.rank(state(250, []))).toBe(250);
  });
});
