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
src/popup/popup.html   arm toggle, live stats
src/popup/popup.js
```

`src/main/*` is injected via `"world": "MAIN"` in `content_scripts`
(requires Chrome 111+). The bridge relays only arm/disarm commands and stats
between page and popup via `window.postMessage`.

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

Beam search over per-step decisions. Only the first action is ever used; the loop
re-plans continuously, so the controller is closed-loop.

- Node: `{ clone, stepsAhead }`
- Each node branches into `{ flap, no-flap }`; rank all successors; keep best K
- Prune any branch reaching `state === "gameover"`
- Rank: alive first, then by `|birdY - gapY|` against the next unpassed pipe
- If every branch dies, return the first action of the longest-surviving branch

Starting budget: K = 24, beam depth D = 80 (≈3.8k `step()` calls per re-plan),
re-planning every 3rd frame. These are tuning knobs to be measured against a real
frame budget, not fixed architecture.

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

- `"getready"` — call `flap()` to start the run
- `"play"` — plan and act each tick
- `"gameover"` — optionally `restart()` if auto-restart is enabled

All gated on the armed flag; disarming restores the original `step`.

## Failure modes

| Condition | Detection | Response |
|---|---|---|
| `window.__game` absent or renamed | Feature detection at init | Refuse to arm; HUD error |
| `flap` / `step` missing from prototype | Feature detection at init | Refuse to arm; HUD error |
| Site ships new physics (`simVersion` bump) | Drift check | HUD warning; optional auto-disarm |
| Search exceeds frame budget | Timing measurement | Fall back to reactive rule; never freeze |
| All search branches die | Search result | Longest-surviving branch |

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

- **Benchmark mode** — run ~100 full games on fixed seeds in a Web Worker;
  report a score histogram. Beats the naive baseline of 1–2 or it is not working.
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

Reinforcement learning or any trained controller; leaderboard interaction of any
kind; support for Flappy Bird clones other than flappybird.io; pixel-based or
vision-based state extraction.
