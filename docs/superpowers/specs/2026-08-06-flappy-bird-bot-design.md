# Flappy Bird Bot — Chrome Extension Design

**Date:** 2026-08-06
**Status:** Approved, ready for planning
**Target:** https://flappybird.io/

## Purpose

A Chrome extension that plays flappybird.io automatically and near-perfectly, by
driving the game's own simulation forward to choose each action.

Explicit non-goal: this is not a machine learning project. See "Why not a model".

## Recon findings

These findings are the evidence base for the entire design. All were verified
against the live site on 2026-08-06 against bundle `assets/index-CivtZRRX.js`.

### The game exposes its full state

`window.__game` is a live class instance holding:

```
state ("getready" | "play" | "gameover"), birdY, birdVy, birdRot,
pipes[], scrollX, pipeScroll, score, bestScore, elapsed, playStep,
spawnCount, prng, runSeed, simVersion, flaps[], passSteps[],
ranked, netMode, deathCause, chase, ghostReplay, …
```

Coordinates are scaled integers, not pixels (e.g. `birdY` ≈ 781431,
`halfGap` ≈ 325058). All work stays in the game's native units; no unit
conversion is required or wanted.

### The prototype exposes the simulation

Methods on `Object.getPrototypeOf(__game)`:

```
flap, step, beginRun, restart, advancePipes, nextGapY,
checkPipeCollision, seedPipes, setNetMode, setChase, reset, transition, …
```

Getters include `isRanked`, `currentSeed`, `durationSteps`, `flapTrace`,
`snapshot`.

`flap()` and `step(dt)` being public is the single most important finding:
actuation needs no synthetic events (no `isTrusted` problem) and prediction
needs no reimplemented physics.

### Pipe coordinates are bird-relative

From `advancePipes()`:

```js
this.pipes.push({ x: mf, gapY: this.nextGapY(),
                  halfGap: Jy(this.simVersion, this.spawnCount), passed: !1 });
this.pipeScroll += ta;
for (const c of this.pipes)
  c.x -= ta, !c.passed && c.x <= 0 && (c.passed = !0, this.score += 1, …);
```

Scoring triggers at `c.x <= 0`, so **`pipe.x` is already the horizontal distance
from the bird**. Controller input needs no transformation.

### The simulation is deterministic and seeded

`runSeed` (bigint), `prng` (instance with a bigint `state`), `simVersion: 4`,
and per-run recording into `flaps[]` / `passSteps[]`. `nextGapY()` draws from
`prng`, so pipe placement is fully determined by PRNG state.

### Timestep

`dt = 0.05` matches the observed `elapsed` increment and the `dS = .05` constant
in the bundle. Verified empirically: stepping a fresh instance at `0.05`
produces coherent pipe motion and scoring; `1/60` does not.

### A fresh instance runs headless and inert

Verified: `new Ctor(0)` followed by `beginRun()` and repeated `step(0.05)` runs a
complete game — pipes spawn, score increments, `state` reaches `"gameover"`,
`deathCause` populates (`"pipeTop"` / `"pipeBottom"`). The instance reports
`isRanked === false` and performs no network activity.

A naive "flap if `birdY` below `gapY`" policy scored **1–2** on this harness.
That is the baseline the real controller must beat.

### Online ranked leaderboard

The site runs a ranked leaderboard: a `gameServer` module against SpacetimeDB
(`maincloud.spacetimedb.com`) with an identity token in `localStorage`, plus
`/api/board/{top,daily,total,histogram,daily-histogram,daily-total,ghost-daily}`.

Ranked status is derived at run start:

```js
beginRun() { …; this.ranked = this.netMode === "online"; … }
```

The class default is `netMode = "offline"`, flipped to `"online"` once the server
connection is live. Per-run recording of `flaps[]` alongside `runSeed` indicates
the server replay-verifies submitted scores.

## Why not a model

A learned model earns its keep when perception is hard — pixels in, state out.
Here exact state is handed to us, and what remains is a one-dimensional control
problem with a single binary action under deterministic physics. That is a search
problem, not a learning problem.

Training economics compound the point: in-browser RL at real-time framerate needs
hours for a few thousand episodes. Training at any useful speed requires porting
the physics to a headless simulator — but the game *is* a headless simulator we
can already drive, at which point search over the true dynamics strictly
dominates an approximation learned from them.

## Leaderboard decision

**Decision:** No enforced interlock. The bot runs only when explicitly armed by
the user, who takes responsibility for when that happens.

This was a deliberate choice by the project owner after the alternative — forcing
`netMode = "offline"` before every run — was recommended and declined.

**Consequence, recorded plainly:** if the bot is armed while `netMode` is
`"online"`, the run is ranked and will be submitted. Because the server replay-
verifies runs against the seed, a bot run validates as legitimate and ranks
alongside human scores.

**Mitigation retained:** the HUD displays live ranked status, read from the
existing `isRanked` getter. This is an indicator, not a control — it mutates
nothing. Its purpose is to ensure the user always knows what state they are
arming into.

The search clone is separately and structurally incapable of submitting anything
(see "Clone"), independent of this decision.

## Architecture

MV3 content scripts run in an isolated world and cannot reach `window.__game`.
The bot logic must therefore run in the MAIN world, with a conventional isolated
content script bridging to the popup.

```
manifest.json
src/main/bot.js        MAIN world — control loop, actuation, drift check
src/main/clone.js      live __game -> inert throwaway instance
src/main/search.js     beam search over flap / no-flap
src/main/hud.js        on-page overlay
src/content/bridge.js  ISOLATED world — postMessage relay
src/popup/popup.html   arm toggle, auto-restart toggle, live stats
src/popup/popup.js
```

`src/main/*` is injected via `"world": "MAIN"` in `content_scripts`
(requires Chrome 111+). The bridge relays arm/disarm commands, the auto-restart
setting, and stats between page and popup via `window.postMessage`. That is the
complete message contract; nothing else crosses the boundary.

### Clone

Construct a bare instance and overwrite fields directly. Deliberately **not**
`beginRun()`, which would draw a fresh seed and clear the pipes.

```js
const clone = new Ctor(0);                   // listener Sets start empty
Object.assign(clone, pick(live, SCALARS));   // birdY, birdVy, state, playStep, …
clone.pipes = live.pipes.map(p => ({ ...p }));
clone.prng.state = live.prng.state;          // bigint
```

Copied: `birdY`, `birdVy`, `birdRot`, `scrollX`, `pipeScroll`, `state`, `score`,
`elapsed`, `stateEnteredElapsed`, `playStep`, `spawnCount`, `pendingPasses`,
`simVersion`, `runSeed`, `deathCause`, and the `prev*` fields.

Deliberately not copied: `soundListeners` and `bestScoreListeners` (left empty so
`emitSound` is a no-op), `chase` and `ghostReplay` (left null to avoid simulating
a ghost inside the search), `netMode` and `ranked` (left at the inert defaults).

Copying `prng.state` is what makes the search exact rather than approximate:
`advancePipes()` draws future gap positions from the PRNG, so a clone carrying
live PRNG state spawns the *actual* upcoming pipes.

### Search

Beam search over per-step decisions. **The search runs on every simulation step,
and only the first action of the resulting plan is ever used** — the plan is
discarded and recomputed next step, making the controller fully closed-loop.
There is no plan-execution buffer and no skipped steps.

- Node: `{ clone, stepsAhead }`
- Each node branches into `{ flap, no-flap }`; rank all successors; keep best K
- Prune any branch reaching `state === "gameover"`
- Rank: alive first, then by `|birdY - gapY|` against the next unpassed pipe
- If every branch dies, return the first action of the longest-surviving branch

**Budget.** Measured on the live page 2026-08-06: a clone plus one step costs
**0.61 µs**; a bare step on an existing clone costs **0.15 µs**. A K = 24,
D = 80 beam is ≈3,840 expansions ≈ **2.3 ms per re-plan**. That fits within a
16.7 ms frame at 60 Hz, and still within 8.3 ms at 120 Hz, with wide margin
either way — which is why searching every step is affordable and no cadence
reduction is required.

The live step rate was deliberately not measured: the game only steps during
play, and the live instance is `netMode: "online"`, so starting a run to measure
it would have produced a ranked, submitted score. The 60 Hz worst case is used
instead, and the real figure should be recorded the first time the bot is armed.

K and D are tuning knobs to be validated against measurement, not fixed
architecture. Note that the dominant cost is cloning (0.61 µs), not stepping
(0.15 µs), so a clone object pool is the first optimisation to reach for if the
budget ever tightens — not a shallower search.

### Actuation

Patch the **instance**, not the prototype:

```js
live.step = function (dt) { controller.tick(this); return proto.step.call(this, dt); };
```

This runs the controller immediately before each real simulation step, giving
exact frame synchronisation with no added latency. Patching the prototype would
be a defect: every clone inside the search would recursively invoke the
controller.

### Control loop by game state

- `"getready"` — call `live.flap()` to start the run
- `"play"` — run the search, and call `live.flap()` if the chosen first action is
  a flap. No other actuation path exists; `flap()` is the only input the bot uses
- `"gameover"` — call `live.restart()` if the popup's auto-restart toggle is on

All gated on the armed flag; disarming restores the original `step`.

## Failure modes

| Condition | Detection | Response |
|---|---|---|
| `window.__game` absent or renamed | Feature detection at init | Refuse to arm; HUD error |
| `flap` / `step` missing from prototype | Feature detection at init | Refuse to arm; HUD error |
| Site ships new physics (`simVersion` bump) | Drift check | HUD warning; optional auto-disarm |
| Search exceeds frame budget | Timing measurement | Reduce beam width K for that tick; never freeze |
| All search branches die | Search result | Longest-surviving branch |

### Budget overrun

The search checks the clock **between depth levels** and narrows K in flight.
Detection cannot happen after the fact — a tick that has already overrun is a
frame that has already been missed — so the budget check is part of the search
loop's structure, not a wrapper around it.

Degradation reduces the beam width K for that tick and keeps the same algorithm.
It never switches to a different policy. A narrower beam is still a search over
the true dynamics and degrades smoothly; falling back to a hand-tuned reactive
rule would mean falling back to something that scores 1–2, which is
indistinguishable from a crash.

### Drift check

Each tick, compare the clone's predicted `birdY` after one step against the value
the live game actually produces. These should agree exactly. Divergence means the
forward model no longer matches the game, and is surfaced in the HUD rather than
allowed to degrade play silently. This is the primary defence against the site
updating underneath us, and it is what converts a silent break into a visible
one — necessary because `Ctor` is reached through a hash-named bundle class.

## Testing

The controller is a pure function `(state) => boolean` over a deterministic,
headless simulation, so correctness is measurable rather than eyeballed.

**All tests run in the MAIN world on the page.** They cannot run in a Web Worker
or in Node: the simulation class is obtained as
`Object.getPrototypeOf(__game).constructor` from the live page, and a class
cannot cross a `postMessage` boundary (structured clone rejects functions). The
"runs headless and inert" finding was verified in the MAIN world specifically.
Benchmark runs are therefore chunked across `requestAnimationFrame` callbacks so
a long batch never blocks the page.

**Imposing a seed.** `beginRun()` does `this.runSeed = this.nextSeed ?? gS()`, so
a test fixes its seed by assigning `sim.nextSeed = <bigint>` *before* calling
`beginRun()`. This is the only supported seeding mechanism; writing `runSeed`
directly is overwritten by the next `beginRun()`.

- **Benchmark mode** — run ~100 games on fixed seeds; report a score histogram.
  Beats the naive baseline of 1–2 or it is not working. **Each game must carry a
  cutoff** (a max-step cap, or a target score), and reaching the cutoff counts as
  a pass. A correct controller does not lose, so an uncapped benchmark hangs
  exactly when the code is working — and at ~2.3 ms of search per step, even a
  moderate game costs seconds of wall clock.
- **Regression** — fixed seed implies fixed expected score; assert a threshold.
- **Clone fidelity** — clone a live mid-run state, step both clone and original,
  assert identical `birdY` / `birdVy` / `pipes`.
- **Search unit tests** — hand-constructed states with a known correct action
  (e.g. a gap reachable only by flapping immediately).

## Risks

- The beam ranking heuristic could prune the uniquely correct branch. The
  benchmark is how this would be detected; beam width is the mitigation.
- `Ctor` is obtained via `Object.getPrototypeOf(__game).constructor`, a
  hash-named bundle class. Covered by feature detection plus the drift check.
- `"world": "MAIN"` requires Chrome 111+.

## Out of scope

Reinforcement learning or any trained controller; support for Flappy Bird clones
other than flappybird.io; pixel-based or vision-based state extraction.

On the leaderboard specifically: no submission logic, no network calls to
`/api/board/*` or the game server, and no suppression or interception of the
site's own submissions. The read-only ranked-status HUD indicator described under
"Leaderboard decision" is explicitly **in** scope — it is the one retained
mitigation and must not be dropped.
