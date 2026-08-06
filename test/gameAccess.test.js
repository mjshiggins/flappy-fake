import { describe, it, expect } from 'vitest';
import { inspectGame, REQUIRED_METHODS, REQUIRED_FIELDS } from '../src/main/gameAccess.js';

function fakeGame(overrides = {}) {
  const proto = {};
  for (const m of REQUIRED_METHODS) proto[m] = function () {};
  const g = Object.create(proto);
  for (const f of REQUIRED_FIELDS) g[f] = 0;
  g.pipes = []; g.prng = { state: 0n }; g.state = 'getready';
  return Object.assign(g, overrides);
}

describe('inspectGame', () => {
  it('accepts a game exposing every required method and field', () => {
    const r = inspectGame(fakeGame());
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('rejects a missing object', () => {
    expect(inspectGame(undefined).ok).toBe(false);
    expect(inspectGame(null).reason).toMatch(/not found/i);
  });

  it('reports which method is missing', () => {
    const g = fakeGame();
    delete Object.getPrototypeOf(g).flap;
    const r = inspectGame(g);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('flap');
  });

  it('reports a missing field', () => {
    const g = fakeGame();
    delete g.birdVy;
    const r = inspectGame(g);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('birdVy');
  });
});
