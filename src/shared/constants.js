// Verified against flappybird.io bundle index-CivtZRRX.js on 2026-08-06.
// See docs/superpowers/specs/2026-08-06-flappy-bird-bot-design.md

export const DT = 1 / 120;          // bundle constant Uf. NOT 0.05.
export const PIPE_SPACING = 201;    // steps between pipe spawns, constant
export const HALF_GAP_FLOOR = 246415; // gf, after the 5-pipe ramp

export const D = 240;               // search horizon, steps
export const R = 39;                // re-plan interval; MUST hold R <= D - PIPE_SPACING
export const K = 24;                // beam width, tuned by benchmark
