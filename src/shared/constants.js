// Verified against flappybird.io bundle index-CivtZRRX.js on 2026-08-06.
// See docs/superpowers/specs/2026-08-06-flappy-bird-bot-design.md

export const DT = 1 / 120;          // bundle constant Uf. NOT 0.05.
export const PIPE_SPACING = 201;    // steps between pipe spawns, constant
export const HALF_GAP_FLOOR = 246415; // gf, after the 5-pipe ramp

// A pipe stops being able to kill the bird somewhere between x = -200000 and
// x = -250000 (measured by placing a pipe at swept x values and stepping into
// it). Until then the bird is still physically between its jaws, even though
// the pipe was marked `passed` back at x <= 0. Target selection uses this, NOT
// `passed`, which is a scoring flag and fires far too early.
export const PIPE_CLEAR_X = -350000;

export const D = 240;               // search horizon, steps
export const R = 39;                // re-plan interval; MUST hold R <= D - PIPE_SPACING
export const K = 24;                // beam width, tuned by benchmark
