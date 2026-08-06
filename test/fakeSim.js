// Deterministic stand-in for the real game, implementing the simOps contract.
// Physics need not match flappybird.io — only be coherent and deterministic.
const GRAVITY = -1, FLAP_VY = 12, CORRIDOR = 300;

export function makeFakeOps({ gapAt = () => 0, halfGap = 80 } = {}) {
  return {
    initial: () => ({ y: 0, vy: 0, t: 0, dead: false }),
    cloneFrom: (s) => ({ ...s }),
    release: () => {},
    flap: (s) => { s.vy = FLAP_VY; },
    step: (s) => {
      if (s.dead) return;
      s.vy += GRAVITY; s.y += s.vy; s.t += 1;
      if (Math.abs(s.y) > CORRIDOR) { s.dead = true; return; }
      const g = gapAt(s.t);
      if (s.t % 50 === 0 && Math.abs(s.y - g) > halfGap) s.dead = true;
    },
    isDead: (s) => s.dead,
    rank: (s) => Math.abs(s.y - gapAt(s.t)),
    birdY: (s) => s.y,
  };
}
