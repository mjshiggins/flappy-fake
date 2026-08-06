import { DT, PIPE_SPACING, HALF_GAP_FLOOR } from '../shared/constants.js';
import { Planner } from './planner.js';

/** Yield to the event loop so a long batch never blocks the page. */
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/**
 * Cutoff is principled, not merely pragmatic: the game is stationary past
 * spawn 5 (halfGap plateaus at 246415, spacing constant at 201), so clearing
 * ~20 pipes exercises the same parameters the controller faces indefinitely.
 */
export async function runBenchmark(Ctor, ops, { games = 20, maxScore = 25, maxSteps = 20000, K, D, R } = {}) {
  const results = [];
  for (let i = 0; i < games; i++) {
    await nextFrame();
    const sim = new Ctor(0);
    sim.nextSeed = BigInt(i + 1);        // seeding: nextSeed BEFORE beginRun
    sim.beginRun();
    sim.flap();                          // enter "play"

    const planner = new Planner(ops, { K, D, R, pipeSpacing: PIPE_SPACING });
    let steps = 0;
    while (steps < maxSteps && sim.state !== 'gameover' && sim.score < maxScore) {
      if (planner.nextAction(sim)) sim.flap();
      sim.step(DT);
      steps += 1;
    }
    results.push({ seed: i + 1, score: sim.score, steps, cutoff: sim.score >= maxScore });
  }
  const scores = results.map((r) => r.score);
  return {
    results,
    min: Math.min(...scores),
    median: scores.slice().sort((a, b) => a - b)[scores.length >> 1],
    cutoffRate: results.filter((r) => r.cutoff).length / results.length,
    halfGapFloor: HALF_GAP_FLOOR,
  };
}

/** Sweep K so the in-flight narrowing policy is measured, not assumed gentle. */
export async function sweepK(Ctor, ops, opts, ks = [4, 8, 16, 24, 32]) {
  const out = [];
  for (const K of ks) out.push({ K, ...(await runBenchmark(Ctor, ops, { ...opts, K })) });
  return out;
}

/**
 * The load-bearing evidence for plan-and-verify: reuse at interval R must cost
 * no SCORE against a per-step-re-plan reference.
 *
 * Deliberately does NOT compare action sequences. They legitimately differ —
 * the search uses a receding horizon, and beam search allocates its K slots
 * differently at T than at T+1. An action-identity assertion fails on correct
 * code and would send someone chasing a bug that does not exist.
 */
export async function planReuseCost(Ctor, ops, { seeds = 10, maxScore = 25, maxSteps = 20000, K, D, R } = {}) {
  const play = (seed, replanInterval) => {
    const sim = new Ctor(0);
    sim.nextSeed = BigInt(seed); sim.beginRun(); sim.flap();
    const planner = new Planner(ops, { K, D, R: replanInterval, pipeSpacing: PIPE_SPACING });
    let steps = 0;
    while (steps < maxSteps && sim.state !== 'gameover' && sim.score < maxScore) {
      if (planner.nextAction(sim)) sim.flap();
      sim.step(DT);
      steps += 1;
    }
    return sim.score;
  };

  const rows = [];
  for (let s = 1; s <= seeds; s++) {
    await nextFrame();
    rows.push({ seed: s, reuse: play(s, R), perStep: play(s, 1) });
  }
  const regressions = rows.filter((r) => r.reuse < r.perStep);
  return { rows, ok: regressions.length === 0, regressions };
}

/**
 * Clone fidelity over a long horizon — the defence against an incomplete clone.
 * This gate is only meaningful if it CAN fail, so it refuses to pass on a dead
 * bird or on too few compared steps.
 */
export function cloneFidelity(Ctor, ops, { steps = 2000, minCompared = 500 } = {}) {
  const live = new Ctor(0);
  live.nextSeed = 99n; live.beginRun(); live.flap();

  // Reach a mid-run state while STAYING ALIVE. An uncontrolled fall reaches
  // gameover in well under 300 steps, after which the comparison loop breaks
  // immediately and reports a vacuous pass.
  const planner = new Planner(ops, { K: 8, D: 240, R: 39, pipeSpacing: PIPE_SPACING });
  for (let i = 0; i < 300; i++) {
    if (planner.nextAction(live)) live.flap();
    live.step(DT);
  }
  if (live.state === 'gameover') {
    return { ok: false, reason: 'bird died before the clone was taken; nothing was compared' };
  }

  const c = ops.cloneFrom(live);
  let compared = 0;
  for (let i = 0; i < steps; i++) {
    live.step(DT); ops.step(c);
    compared += 1;
    if (live.birdY !== ops.birdY(c) || live.birdVy !== c.birdVy) {
      return { ok: false, divergedAt: i, field: live.birdY !== ops.birdY(c) ? 'birdY' : 'birdVy',
               live: live.birdY, clone: ops.birdY(c) };
    }
    if (live.pipes.length !== c.pipes.length) return { ok: false, divergedAt: i, field: 'pipes.length' };
    for (let p = 0; p < live.pipes.length; p++) {
      if (live.pipes[p].x !== c.pipes[p].x || live.pipes[p].gapY !== c.pipes[p].gapY) {
        return { ok: false, divergedAt: i, field: `pipes[${p}]` };
      }
    }
    if (live.state === 'gameover') break;
  }
  if (compared < minCompared) {
    return { ok: false, reason: `only ${compared} steps compared, need >= ${minCompared}`, compared };
  }
  return { ok: true, compared };
}
