/**
 * Beam search over per-step flap/no-flap decisions.
 * Pure with respect to the game: everything goes through `ops` (the simOps
 * contract), which is what allows Node-side testing against a fake sim.
 *
 * Returns { actions: boolean[], exhausted: boolean, depth: number, minWidth: number }.
 * `exhausted` means every branch died; actions is then the longest survivor.
 * `minWidth` is the narrowest the beam was pruned to (== K unless the budget
 * deadline forced in-flight narrowing); it is diagnostic only.
 */
export function beamSearch(rootState, ops, { K, D, deadline = null, now = () => 0 }) {
  let beam = [{ state: ops.cloneFrom(rootState), action: null, parent: null }];
  let best = beam[0];
  let width = K;
  let minWidth = K;

  for (let depth = 0; depth < D; depth++) {
    const next = [];
    for (const node of beam) {
      for (const action of [false, true]) {
        const s = ops.cloneFrom(node.state);
        if (action) ops.flap(s);
        ops.step(s);
        if (ops.isDead(s)) { ops.release(s); continue; }
        next.push({ state: s, action, parent: node });
      }
    }
    for (const node of beam) ops.release(node.state);

    if (next.length === 0) return { actions: unwind(best), exhausted: true, depth, minWidth };

    next.sort((a, b) => ops.rank(a.state) - ops.rank(b.state));

    // Budget check BETWEEN depth levels: narrow K in flight, never truncate D.
    // Depth is correctness (horizon invariant); width is only quality.
    if (deadline !== null && now() > deadline) width = Math.max(2, width >> 1);
    if (width < minWidth) minWidth = width;

    for (let i = width; i < next.length; i++) ops.release(next[i].state);
    beam = next.slice(0, width);
    best = beam[0];
  }
  // Loop completed without exhausting the beam: `beam` still holds the final
  // surviving states (K of them) and must be released before returning.
  // `best` is beam[0] itself, so releasing `beam` covers it exactly once —
  // no double release. unwind() only walks action/parent pointers, never
  // state, so computing actions before releasing (or after) is equally safe;
  // it is done first here for clarity.
  const actions = unwind(best);
  for (const node of beam) ops.release(node.state);
  return { actions, exhausted: false, depth: D, minWidth };
}

function unwind(node) {
  const out = [];
  for (let n = node; n && n.parent !== null; n = n.parent) out.push(n.action);
  return out.reverse();
}
