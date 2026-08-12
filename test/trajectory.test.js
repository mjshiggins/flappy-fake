import { describe, it, expect } from 'vitest';
import { planTrajectory } from '../src/main/trajectory.js';

// Minimal fake obeying the pipeScroll invariant: the bird advances by DX each
// step and every pipe's relative x drops by the same DX, so its world x
// (birdX + pipe.x) is fixed -- exactly the property the preview relies on.
const DX = 10, G = -1, FLAP = 12;
function makeFakeOps() {
  return {
    cloneFrom: (s) => ({ ...s, pipes: s.pipes.map((p) => ({ ...p })) }),
    release: () => {},
    flap: (s) => { s.vy = FLAP; },
    step: (s) => { s.x += DX; s.vy += G; s.y += s.vy; for (const p of s.pipes) p.x -= DX; },
    isDead: (s) => s.dead,
    birdX: (s) => s.x,
    birdY: (s) => s.y,
    pipes: (s) => s.pipes,
  };
}
const root = () => ({ x: 0, y: 0, vy: 0, dead: false, pipes: [{ x: 100, gapY: 5, halfGap: 20 }] });

describe('planTrajectory', () => {
  it('samples the start plus one point per action', () => {
    const ops = makeFakeOps();
    const t = planTrajectory(root(), ops, [false, true, false]);
    expect(t.path).toHaveLength(4);
  });

  it('records which sampled points were flaps', () => {
    const ops = makeFakeOps();
    const actions = [false, true, false, true];
    const t = planTrajectory(root(), ops, actions);
    expect(t.path[0].flap).toBe(false); // start sample is never a flap
    expect(t.path.slice(1).map((p) => p.flap)).toEqual(actions);
  });

  it('reports pipes at a fixed world x as the bird scrolls past them', () => {
    const ops = makeFakeOps();
    const t = planTrajectory(root(), ops, Array(30).fill(false));
    // world x = birdX + pipe.x is invariant, so despite 30 steps of scrolling
    // the single pipe dedupes to one entry at its original world x of 100.
    expect(t.pipes).toHaveLength(1);
    expect(t.pipes[0].x).toBe(100);
    expect(t.pipes[0].halfGap).toBe(20);
  });

  it('does not roll past a requested maxSteps', () => {
    const ops = makeFakeOps();
    const t = planTrajectory(root(), ops, Array(100).fill(false), { maxSteps: 5 });
    expect(t.path).toHaveLength(6);
  });

  it('leaks no clones', () => {
    const base = makeFakeOps();
    let outstanding = 0;
    const counting = {
      ...base,
      cloneFrom: (s) => { outstanding += 1; return base.cloneFrom(s); },
      release: (s) => { outstanding -= 1; base.release(s); },
    };
    planTrajectory(root(), counting, [false, true, false]);
    expect(outstanding).toBe(0);
  });
});
