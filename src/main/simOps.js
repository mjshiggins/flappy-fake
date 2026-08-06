// Binds the simOps contract to the real game class. `gameAccess.js` and
// `simOps.js` are the only files permitted to know the real game exists --
// this module still never references `window` directly; it receives the
// game constructor as an argument, so it stays Node-testable.

import { DT } from '../shared/constants.js';
import { ClonePool } from './clonePool.js';

const SCALARS = [
  'birdY', 'birdVy', 'birdRot', 'scrollX', 'pipeScroll', 'state', 'score',
  'elapsed', 'stateEnteredElapsed', 'playStep', 'spawnCount', 'pendingPasses',
  'simVersion', 'runSeed', 'deathCause',
  'prevBirdY', 'prevBirdRot', 'prevScrollX', 'prevPipeScroll',
];

/** Adapter binding the simOps contract to the real game class. */
export function makeSimOps(Ctor, { dt = DT } = {}) {
  const pool = new ClonePool(() => new Ctor(0));

  return {
    pool,
    cloneFrom(live) {
      const c = pool.acquire();
      for (const k of SCALARS) if (k in live) c[k] = live[k];
      c.pipes = live.pipes.map((p) => ({ x: p.x, gapY: p.gapY, halfGap: p.halfGap, passed: p.passed }));
      c.prng.state = live.prng.state;
      // deliberately NOT copied: soundListeners, bestScoreListeners (stay empty
      // so emitSound is a no-op), chase, ghostReplay (stay null), netMode,
      // ranked (stay at the inert class defaults -- a clone cannot submit).
      return c;
    },
    release: (c) => pool.release(c),
    flap: (c) => c.flap(),
    step: (c) => c.step(dt),
    isDead: (c) => c.state === 'gameover',
    birdY: (c) => c.birdY,
    rank(c) {
      const p = c.pipes.find((q) => !q.passed);
      return p ? Math.abs(c.birdY - p.gapY) : Math.abs(c.birdY);
    },
  };
}
