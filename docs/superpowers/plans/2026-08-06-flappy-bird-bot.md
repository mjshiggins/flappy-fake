# Flappy Bird Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome extension that plays flappybird.io near-perfectly by running the game's own simulation forward to choose each action.

**Architecture:** MV3 extension with logic injected into the MAIN world (isolated-world scripts cannot see `window.__game`). A beam search drives clones of the live game state through the game's own `step()` to produce a plan; the plan is executed for a bounded interval and re-planned under a horizon invariant. All search and planner logic depends on an injected sim-operations interface, so it is unit-testable in Node against a fake sim.

**Tech Stack:** Vanilla JS, esbuild (bundling ES modules for MV3), Vitest (Node unit tests), Chrome MV3 with `"world": "MAIN"` (Chrome 111+).

**Spec:** `docs/superpowers/specs/2026-08-06-flappy-bird-bot-design.md`

---

## Critical Constants (from spec — do not re-derive)

| Constant | Value | Source |
|---|---|---|
| `DT` | `1/120` | bundle `Uf = 1/120`. **Not 0.05** |
| `PIPE_SPACING` | `201` steps | measured, constant for all pipes |
| `HALF_GAP_FLOOR` | `246415` | `gf`, after 5-pipe ramp |
| `D` (horizon) | `240` | ≥ PIPE_SPACING + margin |
| `R` (re-plan interval) | `39` | **invariant: `R ≤ D − PIPE_SPACING`** |
| `K` (beam width) | `24` | unvalidated, tuned by benchmark |

## File Structure

```
package.json                  npm scripts, deps
vitest.config.js              Node test config
build.mjs                     esbuild bundle src/main/index.js -> dist/main.js
manifest.json                 MV3, world:MAIN content script
src/shared/constants.js       DT, D, R, K, PIPE_SPACING, HALF_GAP_FLOOR
src/main/search.js            beam search (pure; takes simOps)
src/main/planner.js           plan buffer, re-plan policy, horizon invariant
src/main/drift.js             drift check (predict/compare, correct ordering)
src/main/clonePool.js         reusable clone objects
src/main/gameAccess.js        locate __game, feature-detect, expose Ctor
src/main/simOps.js            real adapter: clone/step/flap/isDead/rank/release
src/main/controller.js        per-tick orchestration
src/main/hud.js               on-page overlay
src/main/benchmark.js         in-page benchmark + K sweep
src/main/index.js             entry: wiring, instance patch, lifecycle
src/content/bridge.js         ISOLATED world postMessage relay
src/popup/popup.html
src/popup/popup.js
test/fakeSim.js               test double implementing the simOps contract
test/*.test.js                Vitest suites
```

**Responsibility boundaries.** `search.js` and `planner.js` never reference `__game`, `window`, or `document` — they only touch `simOps`. That is what makes them testable in Node. `simOps.js` and `gameAccess.js` are the only files that know the real game exists.

### The simOps contract

Every consumer of a simulation goes through this interface:

```js
{
  cloneFrom(live),   // -> new sim state (from live game or another clone)
  release(state),    // return to pool
  flap(state),       // apply flap
  step(state),       // advance one DT
  isDead(state),     // -> boolean
  rank(state),       // -> number, LOWER is better
  birdY(state),      // -> number (drift comparison)
}
```

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `vitest.config.js`, `.gitignore` (already exists — verify)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "flappy-fake",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "node build.mjs"
  },
  "devDependencies": {
    "esbuild": "^0.23.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.js'] },
});
```

- [ ] **Step 3: Install and verify the runner works**

Run: `npm install && npx vitest run --passWithNoTests`
Expected: exits 0, "No test files found" is fine.

- [ ] **Step 4: Commit**

```bash
git add package.json vitest.config.js package-lock.json
git commit -m "chore: scaffold npm project with vitest"
```

---

## Task 2: Constants and the horizon invariant

The invariant `R ≤ D − PIPE_SPACING` is the load-bearing correctness property of the whole design. Encode it as a test so later tuning cannot silently break it.

**Files:**
- Create: `src/shared/constants.js`
- Test: `test/constants.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { DT, D, R, K, PIPE_SPACING, HALF_GAP_FLOOR } from '../src/shared/constants.js';

describe('constants', () => {
  it('uses the verified timestep, not the 0.05 that was wrong', () => {
    expect(DT).toBeCloseTo(1 / 120, 10);
  });

  it('satisfies the horizon invariant R <= D - PIPE_SPACING', () => {
    expect(R).toBeLessThanOrEqual(D - PIPE_SPACING);
  });

  it('has a horizon covering at least one full pipe spacing', () => {
    expect(D).toBeGreaterThanOrEqual(PIPE_SPACING);
  });

  it('exposes the measured difficulty floor', () => {
    expect(HALF_GAP_FLOOR).toBe(246415);
    expect(PIPE_SPACING).toBe(201);
    expect(K).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/constants.test.js`
Expected: FAIL — cannot resolve `../src/shared/constants.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// Verified against flappybird.io bundle index-CivtZRRX.js on 2026-08-06.
// See docs/superpowers/specs/2026-08-06-flappy-bird-bot-design.md

export const DT = 1 / 120;          // bundle constant Uf. NOT 0.05.
export const PIPE_SPACING = 201;    // steps between pipe spawns, constant
export const HALF_GAP_FLOOR = 246415; // gf, after the 5-pipe ramp

export const D = 240;               // search horizon, steps
export const R = 39;                // re-plan interval; MUST hold R <= D - PIPE_SPACING
export const K = 24;                // beam width, tuned by benchmark
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/constants.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/constants.js test/constants.test.js
git commit -m "feat: add verified constants with horizon invariant test"
```

---

## Task 3: The fake sim test double

This is what makes Tasks 4–7 testable without a browser. It implements the simOps contract with simple, fully-deterministic physics — it does **not** need to match the real game, only to be a coherent simulation with gravity, a flap impulse, and lethal obstacles.

**Files:**
- Create: `test/fakeSim.js`
- Test: `test/fakeSim.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { makeFakeOps } from './fakeSim.js';

describe('fakeSim', () => {
  it('falls under gravity', () => {
    const ops = makeFakeOps();
    const s = ops.cloneFrom(ops.initial());
    const y0 = ops.birdY(s);
    ops.step(s);
    expect(ops.birdY(s)).toBeLessThan(y0);
  });

  it('rises after a flap', () => {
    const ops = makeFakeOps();
    const s = ops.cloneFrom(ops.initial());
    const y0 = ops.birdY(s);
    ops.flap(s); ops.step(s);
    expect(ops.birdY(s)).toBeGreaterThan(y0);
  });

  it('dies when it leaves the corridor', () => {
    const ops = makeFakeOps();
    const s = ops.cloneFrom(ops.initial());
    for (let i = 0; i < 500; i++) ops.step(s);
    expect(ops.isDead(s)).toBe(true);
  });

  it('clones independently', () => {
    const ops = makeFakeOps();
    const a = ops.cloneFrom(ops.initial());
    const b = ops.cloneFrom(a);
    ops.flap(b); ops.step(b); ops.step(a);
    expect(ops.birdY(a)).not.toBe(ops.birdY(b));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/fakeSim.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/fakeSim.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add test/fakeSim.js test/fakeSim.test.js
git commit -m "test: add fake sim implementing the simOps contract"
```

---

## Task 4: Beam search

**Files:**
- Create: `src/main/search.js`
- Test: `test/search.test.js`

**Design note — use parent pointers, not action arrays.** Copying `[...node.actions, a]` per node is O(D) per expansion: at K=24, D=240 that is ~2.7M element copies per search. Store `{ state, action, parent }` and walk backwards once at the end.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { beamSearch } from '../src/main/search.js';
import { makeFakeOps } from './fakeSim.js';

describe('beamSearch', () => {
  it('returns a plan of the requested horizon when survival is possible', () => {
    const ops = makeFakeOps();
    const r = beamSearch(ops.initial(), ops, { K: 8, D: 60 });
    expect(r.actions).toHaveLength(60);
    expect(r.exhausted).toBe(false);
  });

  it('produces a plan that actually survives when replayed', () => {
    const ops = makeFakeOps();
    const r = beamSearch(ops.initial(), ops, { K: 8, D: 60 });
    const s = ops.cloneFrom(ops.initial());
    for (const a of r.actions) { if (a) ops.flap(s); ops.step(s); }
    expect(ops.isDead(s)).toBe(false);
  });

  it('flaps immediately when only an immediate flap survives', () => {
    // start at the floor with downward velocity: not flapping now is fatal
    const ops = makeFakeOps();
    const root = { y: -290, vy: -8, t: 0, dead: false };
    const r = beamSearch(root, ops, { K: 8, D: 20 });
    expect(r.actions[0]).toBe(true);
  });

  it('returns the longest-surviving prefix when every branch dies', () => {
    const ops = makeFakeOps();
    const doomed = { y: -299, vy: -50, t: 0, dead: false };
    const r = beamSearch(doomed, ops, { K: 4, D: 40 });
    expect(r.exhausted).toBe(true);
    expect(r.actions.length).toBeLessThan(40);
  });

  it('never returns a plan longer than D', () => {
    const ops = makeFakeOps();
    const r = beamSearch(ops.initial(), ops, { K: 4, D: 15 });
    expect(r.actions.length).toBeLessThanOrEqual(15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/search.test.js`
Expected: FAIL — `beamSearch` is not defined.

- [ ] **Step 3: Write minimal implementation**

```js
/**
 * Beam search over per-step flap/no-flap decisions.
 * Pure with respect to the game: everything goes through `ops` (the simOps
 * contract), which is what allows Node-side testing against a fake sim.
 *
 * Returns { actions: boolean[], exhausted: boolean, depth: number }.
 * `exhausted` means every branch died; actions is then the longest survivor.
 */
export function beamSearch(rootState, ops, { K, D, deadline = null, now = () => 0 }) {
  let beam = [{ state: ops.cloneFrom(rootState), action: null, parent: null }];
  let best = beam[0];
  let width = K;

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

    if (next.length === 0) return { actions: unwind(best), exhausted: true, depth };

    next.sort((a, b) => ops.rank(a.state) - ops.rank(b.state));

    // Budget check BETWEEN depth levels: narrow K in flight, never truncate D.
    // Depth is correctness (horizon invariant); width is only quality.
    if (deadline !== null && now() > deadline) width = Math.max(2, width >> 1);

    for (let i = width; i < next.length; i++) ops.release(next[i].state);
    beam = next.slice(0, width);
    best = beam[0];
  }
  return { actions: unwind(best), exhausted: false, depth: D };
}

function unwind(node) {
  const out = [];
  for (let n = node; n && n.parent !== null; n = n.parent) out.push(n.action);
  return out.reverse();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/search.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/search.js test/search.test.js
git commit -m "feat: add beam search with parent-pointer plan reconstruction"
```

---

## Task 5: Planner and the re-plan policy

**Files:**
- Create: `src/main/planner.js`
- Test: `test/planner.test.js`

**Design note.** The planner enforces `R ≤ D − PIPE_SPACING` at construction. Do not make this a warning — a violated invariant silently degrades play into the blind-greedy regime, which looks like a tuning problem rather than a bug.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi } from 'vitest';
import { Planner } from '../src/main/planner.js';
import { makeFakeOps } from './fakeSim.js';

const cfg = { K: 8, D: 60, R: 10, pipeSpacing: 40 };

describe('Planner', () => {
  it('rejects a configuration violating the horizon invariant', () => {
    expect(() => new Planner(makeFakeOps(), { ...cfg, R: 30, D: 60, pipeSpacing: 40 }))
      .toThrow(/horizon invariant/i);
  });

  it('plans on the first tick', () => {
    const ops = makeFakeOps();
    const p = new Planner(ops, cfg);
    expect(p.replanCount).toBe(0);
    p.nextAction(ops.initial());
    expect(p.replanCount).toBe(1);
  });

  it('reuses the plan for exactly R steps', () => {
    const ops = makeFakeOps();
    const p = new Planner(ops, cfg);
    for (let i = 0; i < cfg.R; i++) p.nextAction(ops.initial());
    expect(p.replanCount).toBe(1);
    p.nextAction(ops.initial());
    expect(p.replanCount).toBe(2);
  });

  it('re-plans immediately when drift is reported', () => {
    const ops = makeFakeOps();
    const p = new Planner(ops, cfg);
    p.nextAction(ops.initial());
    p.nextAction(ops.initial(), { drift: true });
    expect(p.replanCount).toBe(2);
  });

  it('re-plans immediately on a run-state change', () => {
    const ops = makeFakeOps();
    const p = new Planner(ops, cfg);
    p.nextAction(ops.initial());
    p.nextAction(ops.initial(), { stateChanged: true });
    expect(p.replanCount).toBe(2);
  });

  it('returns booleans', () => {
    const ops = makeFakeOps();
    const p = new Planner(ops, cfg);
    expect(typeof p.nextAction(ops.initial())).toBe('boolean');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/planner.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
import { beamSearch } from './search.js';

/**
 * Executes a cached plan for a bounded interval R, then re-plans.
 *
 * R is bounded by the horizon invariant R <= D - pipeSpacing. Reuse beyond that
 * executes plan actions chosen with less than one pipe spacing of remaining
 * lookahead — the blind-greedy regime. Plan reuse is an AFFORDABILITY argument,
 * not a claim that re-planning is redundant: the search uses a receding horizon,
 * so successive searches optimise different windows.
 */
export class Planner {
  constructor(ops, { K, D, R, pipeSpacing, now = () => 0, budgetMs = null }) {
    if (R > D - pipeSpacing) {
      throw new Error(
        `horizon invariant violated: R (${R}) must be <= D - pipeSpacing (${D - pipeSpacing})`
      );
    }
    this.ops = ops;
    this.cfg = { K, D, R, now, budgetMs };
    this.plan = null;
    this.idx = 0;
    this.replanCount = 0;
    this.lastExhausted = false;
  }

  nextAction(liveState, { drift = false, stateChanged = false } = {}) {
    const stale = this.plan === null || this.idx >= this.cfg.R || this.idx >= this.plan.length;
    if (stale || drift || stateChanged) this.#replan(liveState);
    const action = this.plan[this.idx] ?? false;
    this.idx += 1;
    return action === true;
  }

  #replan(liveState) {
    const { K, D, now, budgetMs } = this.cfg;
    const deadline = budgetMs === null ? null : now() + budgetMs;
    const r = beamSearch(liveState, this.ops, { K, D, deadline, now });
    this.plan = r.actions;
    this.lastExhausted = r.exhausted;
    this.idx = 0;
    this.replanCount += 1;
  }

  invalidate() { this.plan = null; this.idx = 0; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/planner.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/planner.js test/planner.test.js
git commit -m "feat: add planner enforcing the horizon invariant"
```

---

## Task 6: Drift check

**Files:**
- Create: `src/main/drift.js`
- Test: `test/drift.test.js`

**Design note — ordering is the trap.** The prediction must apply the planned action *before* stepping. A clone stepped without the planned flap diverges on every flap step, and with auto-disarm on persistent drift that yields a bot that constantly disarms itself. The check guards **physics fidelity only** — it cannot detect a stale plan.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { DriftCheck } from '../src/main/drift.js';
import { makeFakeOps } from './fakeSim.js';

describe('DriftCheck', () => {
  it('reports no drift when the action is applied before stepping', () => {
    const ops = makeFakeOps();
    const live = ops.initial();
    const d = new DriftCheck(ops);
    // predict a flap step, then actually perform that same flap step
    d.predict(live, true);
    ops.flap(live); ops.step(live);
    expect(d.check(live).drift).toBe(false);
  });

  it('detects drift when reality diverges from the prediction', () => {
    const ops = makeFakeOps();
    const live = ops.initial();
    const d = new DriftCheck(ops);
    d.predict(live, false);
    ops.flap(live); ops.step(live);   // reality flapped; prediction did not
    expect(d.check(live).drift).toBe(true);
  });

  it('reports no drift before any prediction exists', () => {
    const ops = makeFakeOps();
    expect(new DriftCheck(ops).check(ops.initial()).drift).toBe(false);
  });

  it('counts consecutive drift and clears the streak on agreement', () => {
    const ops = makeFakeOps();
    const live = ops.initial();
    const d = new DriftCheck(ops);
    d.predict(live, false); ops.flap(live); ops.step(live);
    expect(d.check(live).consecutive).toBe(1);
    d.predict(live, false); ops.flap(live); ops.step(live);
    expect(d.check(live).consecutive).toBe(2);
    d.predict(live, true); ops.flap(live); ops.step(live);
    expect(d.check(live).consecutive).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/drift.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
/**
 * Verifies the forward model still reproduces the real game.
 *
 * GUARDS: physics fidelity (has the site changed the simulation?).
 * DOES NOT GUARD: plan quality. An exact model reproduces the trajectory
 * perfectly while a stale plan steers into a pipe it was never deep enough to
 * see. Plan quality is guarded structurally by the horizon invariant in Planner.
 */
export class DriftCheck {
  constructor(ops, { epsilon = 0 } = {}) {
    this.ops = ops;
    this.epsilon = epsilon;
    this.predicted = null;
    this.consecutive = 0;
  }

  /** Call AFTER choosing the action, BEFORE the live game steps. */
  predict(liveState, action) {
    const s = this.ops.cloneFrom(liveState);
    if (action) this.ops.flap(s);   // ordering matters: flap changes vy
    this.ops.step(s);
    this.predicted = this.ops.birdY(s);
    this.ops.release(s);
  }

  /** Call on the following tick, after the live game has stepped. */
  check(liveState) {
    if (this.predicted === null) return { drift: false, consecutive: 0, delta: 0 };
    const delta = Math.abs(this.ops.birdY(liveState) - this.predicted);
    const drift = delta > this.epsilon;
    this.consecutive = drift ? this.consecutive + 1 : 0;
    return { drift, consecutive: this.consecutive, delta };
  }

  reset() { this.predicted = null; this.consecutive = 0; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/drift.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/drift.js test/drift.test.js
git commit -m "feat: add drift check with action-before-step ordering"
```

---

## Task 7: Clone pool

Cloning (0.61 µs) dominates stepping (0.15 µs) by 4×, so search cost is mostly allocation. Build the pool in from the start.

**Files:**
- Create: `src/main/clonePool.js`
- Test: `test/clonePool.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { ClonePool } from '../src/main/clonePool.js';

describe('ClonePool', () => {
  it('constructs a fresh object when the pool is empty', () => {
    const pool = new ClonePool(() => ({ tag: 'new' }));
    expect(pool.acquire().tag).toBe('new');
    expect(pool.created).toBe(1);
  });

  it('reuses a released object instead of constructing', () => {
    const pool = new ClonePool(() => ({ tag: 'new' }));
    const a = pool.acquire();
    pool.release(a);
    const b = pool.acquire();
    expect(b).toBe(a);
    expect(pool.created).toBe(1);
  });

  it('tracks outstanding objects so leaks are visible', () => {
    const pool = new ClonePool(() => ({}));
    const a = pool.acquire(); pool.acquire();
    expect(pool.outstanding).toBe(2);
    pool.release(a);
    expect(pool.outstanding).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/clonePool.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
/** Reuses simulation objects; search cost is dominated by allocation. */
export class ClonePool {
  constructor(construct) {
    this.construct = construct;
    this.free = [];
    this.created = 0;
    this.outstanding = 0;
  }

  acquire() {
    this.outstanding += 1;
    const obj = this.free.pop();
    if (obj) return obj;
    this.created += 1;
    return this.construct();
  }

  release(obj) {
    if (!obj) return;
    this.outstanding -= 1;
    this.free.push(obj);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/clonePool.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/clonePool.js test/clonePool.test.js
git commit -m "feat: add clone pool"
```

---

## Task 8: Game access and feature detection

The extension must refuse to arm rather than misbehave when the site changes. `Ctor` is reached through a hash-named bundle class that any deploy may rename.

**Files:**
- Create: `src/main/gameAccess.js`
- Test: `test/gameAccess.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/gameAccess.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
export const REQUIRED_METHODS = ['flap', 'step', 'beginRun', 'restart', 'advancePipes'];
export const REQUIRED_FIELDS = [
  'birdY', 'birdVy', 'birdRot', 'scrollX', 'pipeScroll', 'score',
  'elapsed', 'playStep', 'spawnCount', 'pendingPasses', 'simVersion',
];

/** Feature-detect the live game. Refuse to arm rather than misbehave. */
export function inspectGame(game) {
  if (!game) return { ok: false, reason: 'window.__game not found', missing: [] };
  const proto = Object.getPrototypeOf(game);
  if (!proto) return { ok: false, reason: 'game has no prototype', missing: [] };

  const missing = [
    ...REQUIRED_METHODS.filter((m) => typeof proto[m] !== 'function'),
    ...REQUIRED_FIELDS.filter((f) => !(f in game)),
  ];
  if (!('pipes' in game) || !Array.isArray(game.pipes)) missing.push('pipes');
  if (!game.prng || typeof game.prng.state !== 'bigint') missing.push('prng.state');

  return missing.length
    ? { ok: false, reason: `game shape changed: missing ${missing.join(', ')}`, missing }
    : { ok: true, reason: null, missing: [], Ctor: proto.constructor, proto };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/gameAccess.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/gameAccess.js test/gameAccess.test.js
git commit -m "feat: add feature detection for the live game object"
```

---

## Task 9: Real sim adapter

**Files:**
- Create: `src/main/simOps.js`
- Test: `test/simOps.test.js` (uses a stub class mimicking the real one's shape)

**Design note.** Construct with `new Ctor(0)` and assign fields directly — deliberately **not** `beginRun()`, which draws a fresh seed and clears pipes. Do not copy `soundListeners`/`bestScoreListeners` (leave empty so `emitSound` is a no-op), `chase`/`ghostReplay` (leave null), or `netMode`/`ranked` (leave at inert defaults).

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/simOps.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
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

  const ops = {
    pool,
    cloneFrom(live) {
      const c = pool.acquire();
      for (const k of SCALARS) if (k in live) c[k] = live[k];
      // reuse the array where possible; search churns these hard
      c.pipes = live.pipes.map((p) => ({ x: p.x, gapY: p.gapY, halfGap: p.halfGap, passed: p.passed }));
      c.prng.state = live.prng.state;
      // deliberately NOT copied: soundListeners, bestScoreListeners (stay empty
      // so emitSound is a no-op), chase, ghostReplay (stay null), netMode,
      // ranked (stay at the inert class defaults — a clone cannot submit).
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
  return ops;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/simOps.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/simOps.js test/simOps.test.js
git commit -m "feat: add real sim adapter with inert clones"
```

---

## Task 10: Controller orchestration

**Files:**
- Create: `src/main/controller.js`
- Test: `test/controller.test.js`

**Tick order** (this ordering is the contract):
1. `check()` the previous tick's prediction against the live game
2. handle game state (`getready` → flap to start; `gameover` → invalidate plan)
3. `nextAction()` from the planner, passing drift/stateChanged
4. actuate: `live.flap()` if the action is a flap
5. `predict()` for the next tick, using that same action

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { Controller } from '../src/main/controller.js';
import { makeFakeOps } from './fakeSim.js';

const cfg = { K: 4, D: 60, R: 10, pipeSpacing: 40, driftLimit: 3 };

function harness(state = 'play') {
  const ops = makeFakeOps();
  const live = { ...ops.initial(), state, flaps: 0, restarts: 0 };
  const api = {
    flap: () => { ops.flap(live); live.flaps += 1; },
    restart: () => { live.restarts += 1; },
    getState: () => live.state,
  };
  return { ops, live, api, c: new Controller(ops, api, cfg) };
}

describe('Controller', () => {
  it('flaps to start a run from getready', () => {
    const h = harness('getready');
    h.c.tick(h.live);
    expect(h.live.flaps).toBe(1);
  });

  it('does not actuate while armed is false', () => {
    const h = harness('play');
    h.c.armed = false;
    h.c.tick(h.live);
    expect(h.live.flaps).toBe(0);
  });

  it('invalidates the plan on gameover', () => {
    const h = harness('play');
    h.c.tick(h.live);
    h.live.state = 'gameover';
    h.c.tick(h.live);
    expect(h.c.planner.plan).toBeNull();
  });

  it('restarts on gameover only when autoRestart is set', () => {
    const h = harness('play');
    h.live.state = 'gameover';
    h.c.tick(h.live);
    expect(h.live.restarts).toBe(0);
    h.c.autoRestart = true;
    h.c.tick(h.live);
    expect(h.live.restarts).toBe(1);
  });

  it('disarms after driftLimit consecutive drifts', () => {
    const h = harness('play');
    h.c.tick(h.live);
    for (let i = 0; i < cfg.driftLimit + 1; i++) {
      h.live.y += 999;          // force divergence from the prediction
      h.c.tick(h.live);
    }
    expect(h.c.armed).toBe(false);
    expect(h.c.status).toMatch(/drift/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/controller.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
import { Planner } from './planner.js';
import { DriftCheck } from './drift.js';

/** Per-tick orchestration. Runs immediately before each real simulation step. */
export class Controller {
  constructor(ops, api, cfg) {
    this.ops = ops;
    this.api = api;
    this.cfg = cfg;
    this.planner = new Planner(ops, cfg);
    this.drift = new DriftCheck(ops, { epsilon: cfg.epsilon ?? 0 });
    this.armed = true;
    this.autoRestart = false;
    this.status = 'ok';
    this.lastState = null;
  }

  tick(live) {
    if (!this.armed) return;

    const state = this.api.getState();
    const stateChanged = state !== this.lastState;
    this.lastState = state;

    const { drift, consecutive } = this.drift.check(live);
    if (consecutive > this.cfg.driftLimit) {
      this.armed = false;
      this.status = `disarmed: persistent drift (${consecutive} consecutive)`;
      return;
    }

    if (state === 'getready') {
      this.planner.invalidate();
      this.drift.reset();
      this.api.flap();
      return;
    }

    if (state === 'gameover') {
      this.planner.invalidate();
      this.drift.reset();
      if (this.autoRestart) this.api.restart();
      return;
    }

    const action = this.planner.nextAction(live, { drift, stateChanged });
    if (action) this.api.flap();
    this.drift.predict(live, action);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/controller.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/controller.js test/controller.test.js
git commit -m "feat: add controller orchestration with drift disarm"
```

---

## Task 11: Build and manifest

**Files:**
- Create: `build.mjs`, `manifest.json`, `src/main/index.js`, `src/content/bridge.js`

**Design note.** Patch the **instance**, not the prototype. Patching the prototype would make every clone inside the search recursively invoke the controller. Verified: the drive loop calls `this.game.step(Uf)` by property lookup and holds no captured reference, so an instance patch does intercept it.

- [ ] **Step 1: Create `build.mjs`**

```js
import { build } from 'esbuild';
const common = { bundle: true, format: 'iife', target: 'chrome111', logLevel: 'info' };
await build({ ...common, entryPoints: ['src/main/index.js'], outfile: 'dist/main.js' });
await build({ ...common, entryPoints: ['src/content/bridge.js'], outfile: 'dist/bridge.js' });
await build({ ...common, entryPoints: ['src/popup/popup.js'], outfile: 'dist/popup.js' });
```

- [ ] **Step 2: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Flappy Fake",
  "version": "0.1.0",
  "description": "Plays flappybird.io by searching the game's own simulation.",
  "minimum_chrome_version": "111",
  "content_scripts": [
    {
      "matches": ["https://flappybird.io/*"],
      "js": ["dist/main.js"],
      "world": "MAIN",
      "run_at": "document_idle"
    },
    {
      "matches": ["https://flappybird.io/*"],
      "js": ["dist/bridge.js"],
      "world": "ISOLATED",
      "run_at": "document_idle"
    }
  ],
  "action": { "default_popup": "src/popup/popup.html" }
}
```

- [ ] **Step 3: Create `src/main/index.js`**

```js
import { inspectGame } from './gameAccess.js';
import { makeSimOps } from './simOps.js';
import { Controller } from './controller.js';
import { D, R, K, PIPE_SPACING } from '../shared/constants.js';
import { mountHud } from './hud.js';

const CHANNEL = 'flappy-fake';

function boot() {
  const game = window.__game;
  const info = inspectGame(game);
  const hud = mountHud();

  if (!info.ok) {
    hud.error(info.reason);
    return;
  }

  const ops = makeSimOps(info.Ctor);
  const api = {
    flap: () => game.flap(),
    restart: () => game.restart(),
    getState: () => game.state,
  };
  const controller = new Controller(ops, api, {
    K, D, R, pipeSpacing: PIPE_SPACING, driftLimit: 3,
    now: () => performance.now(), budgetMs: 12,
  });
  controller.armed = false;   // never auto-arm; the user arms explicitly

  // Instance patch, NOT prototype: clones inside the search must not recurse.
  const protoStep = Object.getPrototypeOf(game).step;
  game.step = function (dt) {
    try { controller.tick(this); } catch (e) { controller.armed = false; hud.error(String(e)); }
    return protoStep.call(this, dt);
  };

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.data?.channel !== CHANNEL) return;
    const { type, value } = ev.data;
    if (type === 'arm') controller.armed = !!value;
    if (type === 'autoRestart') controller.autoRestart = !!value;
  });

  setInterval(() => {
    hud.update({
      armed: controller.armed,
      status: controller.status,
      score: game.score,
      isRanked: game.isRanked,        // read-only indicator; mutates nothing
      replans: controller.planner.replanCount,
    });
    window.postMessage({
      channel: CHANNEL, type: 'stats',
      value: { armed: controller.armed, score: game.score, isRanked: game.isRanked, status: controller.status },
    }, '*');
  }, 250);
}

if (window.__game) boot();
else window.addEventListener('load', boot, { once: true });
```

- [ ] **Step 4: Create `src/content/bridge.js`**

```js
// ISOLATED world. Relays arm/disarm, auto-restart, and stats. Nothing else
// crosses this boundary.
const CHANNEL = 'flappy-fake';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.channel !== CHANNEL) return;
  window.postMessage({ channel: CHANNEL, type: msg.type, value: msg.value }, '*');
  sendResponse({ ok: true });
  return true;
});

window.addEventListener('message', (ev) => {
  if (ev.source !== window || ev.data?.channel !== CHANNEL) return;
  if (ev.data.type !== 'stats') return;
  chrome.runtime.sendMessage({ channel: CHANNEL, type: 'stats', value: ev.data.value }).catch(() => {});
});
```

- [ ] **Step 5: Build and verify output exists**

Run: `npm run build && ls -la dist/`
Expected: `dist/main.js`, `dist/bridge.js` present, no esbuild errors.

- [ ] **Step 6: Commit**

```bash
git add build.mjs manifest.json src/main/index.js src/content/bridge.js
git commit -m "feat: add MV3 manifest, build, and MAIN-world entry point"
```

---

## Task 12: HUD and popup

**Files:**
- Create: `src/main/hud.js`, `src/popup/popup.html`, `src/popup/popup.js`

**Design note.** The ranked indicator is read-only (`game.isRanked`). It mutates nothing — its purpose is to make the state visible before the user arms.

- [ ] **Step 1: Create `src/main/hud.js`**

```js
export function mountHud() {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'top:8px', 'left:8px', 'z-index:2147483647',
    'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
    'background:rgba(0,0,0,.82)', 'color:#eee', 'padding:8px 10px',
    'border-radius:6px', 'pointer-events:none', 'white-space:pre',
  ].join(';');
  document.body.appendChild(el);

  return {
    update({ armed, status, score, isRanked, replans }) {
      el.textContent = [
        `${armed ? '● ARMED' : '○ idle'}   score ${score}`,
        `${isRanked ? '⚠ RANKED — this run submits' : 'unranked'}`,
        `replans ${replans}   ${status}`,
      ].join('\n');
      el.style.borderLeft = isRanked ? '3px solid #e5484d' : '3px solid #30a46c';
    },
    error(msg) {
      el.textContent = `✕ ${msg}`;
      el.style.borderLeft = '3px solid #e5484d';
    },
  };
}
```

- [ ] **Step 2: Create `src/popup/popup.html`**

```html
<!doctype html>
<meta charset="utf-8">
<style>
  body { font: 13px/1.5 system-ui, sans-serif; width: 220px; margin: 0; padding: 12px; }
  label { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  #stats { font-family: ui-monospace, monospace; font-size: 12px; color: #555; white-space: pre; }
  .ranked { color: #c62828; font-weight: 600; }
</style>
<label><input type="checkbox" id="arm"> Arm bot</label>
<label><input type="checkbox" id="auto"> Auto-restart</label>
<div id="stats">not connected</div>
<script src="../../dist/popup.js"></script>
```

- [ ] **Step 3: Create `src/popup/popup.js`**

```js
const CHANNEL = 'flappy-fake';

async function send(type, value) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { channel: CHANNEL, type, value }).catch(() => {});
}

document.getElementById('arm').addEventListener('change', (e) => send('arm', e.target.checked));
document.getElementById('auto').addEventListener('change', (e) => send('autoRestart', e.target.checked));

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.channel !== CHANNEL || msg.type !== 'stats') return;
  const { armed, score, isRanked, status } = msg.value;
  const el = document.getElementById('stats');
  el.textContent = `${armed ? 'armed' : 'idle'}  score ${score}\n${isRanked ? 'RANKED — submits' : 'unranked'}\n${status}`;
  el.className = isRanked ? 'ranked' : '';
});
```

- [ ] **Step 4: Build and load the unpacked extension**

Run: `npm run build`
Then load `/Users/mac/Developer/flappy-fake` as an unpacked extension at `chrome://extensions` (Developer mode on), open https://flappybird.io/, and confirm the HUD appears reading `○ idle`.

- [ ] **Step 5: Commit**

```bash
git add src/main/hud.js src/popup/popup.html src/popup/popup.js
git commit -m "feat: add HUD with ranked indicator and popup controls"
```

---

## Task 13: In-page verification harness

These cannot run in Node or a Worker: the simulation class comes from the live page, and a class cannot cross a `postMessage` boundary. They also require a **visible** tab — a hidden tab suspends rAF and freezes the game entirely.

**Files:**
- Create: `src/main/benchmark.js`
- Modify: `src/main/index.js` (expose `window.__flappyFake` for console-driven runs)

- [ ] **Step 1: Create `src/main/benchmark.js`**

```js
import { DT, PIPE_SPACING, HALF_GAP_FLOOR } from '../shared/constants.js';
import { Planner } from './planner.js';

/**
 * Cutoff is principled, not merely pragmatic: the game is stationary past
 * spawn 5 (halfGap plateaus at 246415, spacing constant at 201), so clearing
 * ~20 pipes exercises the same parameters the controller faces indefinitely.
 */
export function runBenchmark(Ctor, ops, { games = 20, maxScore = 25, maxSteps = 20000, K, D, R } = {}) {
  const results = [];
  for (let i = 0; i < games; i++) {
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
export function sweepK(Ctor, ops, opts, ks = [4, 8, 16, 24, 32]) {
  return ks.map((K) => ({ K, ...runBenchmark(Ctor, ops, { ...opts, K }) }));
}

/** Clone fidelity over a long horizon: the defence against an incomplete clone. */
export function cloneFidelity(Ctor, ops, steps = 2000) {
  const live = new Ctor(0);
  live.nextSeed = 99n; live.beginRun(); live.flap();
  for (let i = 0; i < 300; i++) live.step(DT);      // reach a mid-run state
  const c = ops.cloneFrom(live);
  for (let i = 0; i < steps; i++) {
    live.step(DT); ops.step(c);
    if (live.birdY !== ops.birdY(c)) return { ok: false, divergedAt: i, live: live.birdY, clone: ops.birdY(c) };
    if (live.state === 'gameover') break;
  }
  return { ok: true, steps };
}
```

- [ ] **Step 2: Expose the harness from `src/main/index.js`**

Add inside `boot()`, after `ops` is created:

```js
window.__flappyFake = { ops, Ctor: info.Ctor, controller, game };
```

- [ ] **Step 3: Run clone fidelity on the live page**

Build, reload the extension, open https://flappybird.io/ in a **visible** tab, and in the console:

```js
const { runBenchmark, sweepK, cloneFidelity } = window.__flappyFake;
cloneFidelity(window.__flappyFake.Ctor, window.__flappyFake.ops);
```

Expected: `{ ok: true, steps: 2000 }`. If it reports `divergedAt`, the clone is missing a field — add it to `SCALARS` in `simOps.js` and re-run before proceeding. **Do not continue past a failing fidelity check**; every downstream result depends on it.

- [ ] **Step 4: Run the benchmark**

```js
runBenchmark(window.__flappyFake.Ctor, window.__flappyFake.ops, { K: 24, D: 240, R: 39 });
```

Expected: `min` well above the naive baseline of 1–4, and `cutoffRate` near 1.0. A `cutoffRate` of 1.0 means every game hit the score cap alive — the target outcome.

- [ ] **Step 5: Commit**

```bash
git add src/main/benchmark.js src/main/index.js
git commit -m "feat: add in-page benchmark, K sweep, and clone fidelity harness"
```

---

## Task 14: Tune and validate

- [ ] **Step 1: Confirm the adversarial vertical case**

Stationarity means the remaining hard case is a large `gapY` change between adjacent pipes at the floor `halfGap`. In the console, construct a sim with two consecutive gaps at the extremes of the `gapY` range and confirm the controller clears it. This is the case most likely to expose an insufficient horizon.

- [ ] **Step 2: Run the K sweep and record the score curve**

```js
sweepK(window.__flappyFake.Ctor, window.__flappyFake.ops, { D: 240, R: 39 });
```

If the score collapses sharply below some K, in-flight narrowing under load is **not** a gentle degradation and `budgetMs` must be raised (or K lowered permanently and D held). Record the curve in the spec.

- [ ] **Step 3: Measure jank with the bot armed**

Arm the bot on a visible tab and watch for dropped frames. The 7 ms search burst is synchronous and unavoidably inside a frame. If jank is visible, halve K to 12 (~3.5 ms) before considering incremental search — the accumulator makes an overrun frame non-corrupting, so this is a smoothness problem, not a correctness one.

- [ ] **Step 4: Record the live step rate**

The spec left this unmeasured. With the bot armed on a visible tab, count `controller.tick` invocations per second and record the real figure in the spec's Budget section, replacing the 60 Hz worst-case assumption.

- [ ] **Step 5: Commit tuned constants and measurements**

```bash
git add src/shared/constants.js docs/superpowers/specs/2026-08-06-flappy-bird-bot-design.md
git commit -m "perf: tune beam width and record measured step rate"
```

---

## Notes for the implementer

- **Never call `beginRun()` when cloning mid-run state.** It draws a fresh seed and clears pipes. Construct with `new Ctor(0)` and assign fields. `beginRun()` is correct only for fresh benchmark instances, where the seed comes from `nextSeed` assigned *before* the call.
- **Do not assert that plan reuse yields identical action sequences.** They legitimately differ — the search uses a receding horizon, and beam search shares its K slots differently at *T* than at *T+1*. Assert score cost instead. An action-identity test fails on correct code.
- **The drift check guards physics fidelity only.** It cannot detect a stale plan steering into a pipe it never saw. That is the horizon invariant's job.
- **A hidden tab freezes the game.** Benchmarks and measurements require a visible tab.
- The clone is structurally inert (`netMode` stays `"offline"`, `ranked` stays `false`, listener sets stay empty), so nothing the search does can reach the network. The **live** game's ranked state is a separate matter, surfaced by the HUD indicator.
