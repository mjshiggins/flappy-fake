/**
 * Rolls a plan forward from a live state to produce a spatial preview of what
 * the bot intends to do: the bird's future path plus the pipes it must thread,
 * all in the game's native sim units.
 *
 * Coordinates use the invariant `pipeScroll + pipe.x = const`: advancePipes does
 * `pipeScroll += ta` and `pipe.x -= ta` on the same tick, so a pipe's WORLD x
 * (`pipeScroll + pipe.x`) is fixed while the bird's world x (`pipeScroll`)
 * advances. That yields the classic side-on view -- a stationary field of pipes
 * with the bird arcing through it -- with no dependency on the site's pixel
 * render transform (which lives in the bundle and is not exposed).
 *
 * Pure with respect to the game: everything goes through `ops`, so it is
 * Node-testable against a fake sim. Requires `ops.birdX` and `ops.pipes` in
 * addition to the core simOps contract.
 */
export function planTrajectory(rootState, ops, actions, { maxSteps = Infinity } = {}) {
  const s = ops.cloneFrom(rootState);
  const path = [];
  // Pipes are fixed in world space, so the same pipe reappears at ~the same
  // world x every step; key by rounded world x to dedupe as it scrolls in.
  const pipesSeen = new Map();

  const sample = (flapped) => {
    const worldX = ops.birdX(s);
    path.push({ x: worldX, y: ops.birdY(s), flap: flapped });
    for (const p of ops.pipes(s)) {
      const wx = worldX + p.x;
      pipesSeen.set(Math.round(wx), { x: wx, gapY: p.gapY, halfGap: p.halfGap });
    }
  };

  sample(false);
  const n = Math.min(actions.length, maxSteps);
  for (let i = 0; i < n; i++) {
    if (ops.isDead(s)) break;
    const a = actions[i] === true;
    if (a) ops.flap(s);
    ops.step(s);
    sample(a);
  }

  const dead = ops.isDead(s);
  ops.release(s);
  const pipes = [...pipesSeen.values()].sort((a, b) => a.x - b.x);
  return { path, pipes, dead };
}
