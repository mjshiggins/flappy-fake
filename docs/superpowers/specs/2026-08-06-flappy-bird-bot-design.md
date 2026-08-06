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

### Timestep and drive loop

**`dt = 1/120`.** The bundle defines `Uf = 1/120` (and `Aa = 1/120` for ghost
replay). The simulation advances at **120 steps per second**.

An earlier revision of this spec incorrectly used `dt = 0.05`, inferred from the
unrelated animation constant `dS = .05`. That is a 6× error and every number
derived from it was wrong. Corrected throughout.

The game is driven by a fixed-timestep accumulator inside a rAF loop:

```js
frame = i => {
  const s = (i - this.lastTime) / 1e3;
  this.lastTime = i;
  if (this.paused) this.timestep.reset();
  else { const d = this.timestep.advance(s);
         for (let h = 0; h < d; h++) this.game.step(Uf); }
  const c = this.game.renderSnapshot(this.timestep.alpha);
```

Two consequences:

- **Steps are batched.** `advance()` returns a count, so a single animation frame
  runs a variable number of simulation steps — about 2 per frame at 60 Hz. Any
  controller driven by its own rAF loop would desynchronise from the accumulator,
  firing once while the simulation advanced twice. Hooking `step` instead yields
  exactly one decision per simulation step regardless of batching.
- **`this.game.step(Uf)` is a property lookup at call time**, and a bundle scan
  for captured references (`x.step.bind(...)`, `const f = x.step`) returns none.
  Instance patching therefore intercepts the real calls. This is verified, not
  assumed, and it is the load-bearing assumption of the Actuation section.

### Pipe kinematics

Measured on a headless instance at `dt = 1/120`:

| Quantity | Value |
|---|---|
| Pipe-to-pipe spacing | **201 steps** (~1.68 s) |
| Spawn → scoring transit | **240 steps** (~2.0 s) |
| Spawn x | 1253049 |
| First spawn | step 257 |

The 201-step spacing sets the required lookahead horizon. See "Search".

### Tab visibility

The game does not advance while the tab is hidden: `visibilitychange` handling
sets `paused`, and rAF is suspended regardless. Verified — a run started in a
hidden tab sat in `state: "play"` at `playStep: 0` indefinitely. The bot
therefore only operates on a visible tab. This is acceptable (a human player has
the same constraint) but means benchmark and measurement runs cannot be performed
in a background tab.

### A fresh instance runs headless and inert

Verified: `new Ctor(0)` followed by `beginRun()` and repeated `step(0.05)` runs a
complete game — pipes spawn, score increments, `state` reaches `"gameover"`,
`deathCause` populates (`"pipeTop"` / `"pipeBottom"`). The instance reports
`isRanked === false` and performs no network activity.

A naive "flap if `birdY` below `gapY`" policy, run at the correct `dt = 1/120`
across five seeds, scored **1, 1, 1, 4, 2**. That is the baseline the real
controller must beat.

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

Beam search over per-step decisions, producing a **plan**: a sequence of actions
over the horizon.

- Node: `{ clone, stepsAhead }`
- Each node branches into `{ flap, no-flap }`; rank all successors; keep best K
- Prune any branch reaching `state === "gameover"`
- Rank: alive first, then by `|birdY - gapY|` against the next unpassed pipe
- If every branch dies, take the longest-surviving branch

**Horizon.** D must cover at least one pipe-to-pipe spacing (201 steps), or the
controller commits to clearing the current gap while blind to the next one —
the exact failure mode a greedy policy dies to. **D = 240** (2.0 s) gives one
full spacing plus margin. An earlier revision specified D = 80, which was
derived from the incorrect 0.05 timestep and covers only 40% of a spacing.

### Plan-and-verify, not search-every-step

**The plan is computed once and executed over many steps.** Re-planning every
step is not merely unaffordable — it is redundant.

The forward model is *exact*. The clone carries live PRNG state, so the search
observes the true future, and nothing external perturbs the simulation between
steps. A plan optimal at step *T* is therefore still optimal at *T+1*; a
per-step re-plan recomputes a bit-identical answer at full cost.

The drift check (below) is what licenses this. It is not a diagnostic here — it
is the correctness guard. If prediction and reality ever disagree, the exactness
premise has failed and the plan is immediately discarded.

Re-plan when, and only when:

- the plan falls below a low-water mark of remaining steps (re-plan early, so
  there is always runway and re-plans stay staggered)
- the drift check fires
- the run state changes (new run, `restart()`)

**Budget.** Measured 2026-08-06: clone plus one step **0.61 µs**; bare step
**0.15 µs**. A K = 24, D = 240 beam is ≈11,520 expansions ≈ **7 ms per search**.

At 120 steps/s, searching every step would cost ~840 ms per second of wall clock
— 84% of a core, and unshippable. Under plan-and-verify the same search runs
roughly once per 180 steps (~1.5 s), amortising to well under 1% of a core. The
per-step cost in steady state is one clone, one step, and one comparison for the
drift check.

Because the 7 ms search is bursty rather than continuous, it must not land inside
a frame that also owes 2 accumulator steps. Re-planning at a low-water mark
rather than at exhaustion is what gives the scheduler slack to place it.

**Clone pooling is required, not optional.** Cloning (0.61 µs) dominates stepping
(0.15 µs) by 4×, so the search cost is mostly allocation. A pool of reusable
clone objects is the highest-leverage optimisation available and should be built
in from the start rather than retrofitted if the budget tightens.

K and D remain tuning knobs to be validated against the benchmark, not fixed
architecture.

### Actuation

Patch the **instance**, not the prototype:

```js
live.step = function (dt) { controller.tick(this); return proto.step.call(this, dt); };
```

This runs the controller immediately before each real simulation step, giving
exact synchronisation with no added latency — including when the accumulator
batches several steps into one animation frame, where a rAF-driven controller
would fire once for two or three steps.

Verified against the bundle: the drive loop calls `this.game.step(Uf)` by
property lookup and holds no captured reference, so an instance patch does
intercept it.

Patching the prototype would be a defect: every clone inside the search would
recursively invoke the controller.

### Control loop by game state

- `"getready"` — call `live.flap()` to start the run; invalidate any stale plan
- `"play"` — run the drift check; re-plan if required (see "Plan-and-verify");
  pop the next action from the plan and call `live.flap()` if it is a flap.
  No other actuation path exists; `flap()` is the only input the bot uses
- `"gameover"` — discard the plan; call `live.restart()` if the popup's
  auto-restart toggle is on

All gated on the armed flag; disarming restores the original `step`.

## Failure modes

| Condition | Detection | Response |
|---|---|---|
| `window.__game` absent or renamed | Feature detection at init | Refuse to arm; HUD error |
| `flap` / `step` missing from prototype | Feature detection at init | Refuse to arm; HUD error |
| Site ships new physics (`simVersion` bump) | Drift check | Discard plan; HUD warning; disarm on persistent drift |
| Search exceeds frame budget | Clock check between depth levels | Narrow K in flight; never truncate D; never freeze |
| Tab hidden mid-run | `visibilitychange` / `paused` | Game freezes on its own; plan stays valid, resume on visible |
| All search branches die | Search result | Longest-surviving branch |

### Budget overrun

The search checks the clock **between depth levels** and narrows K in flight.
Detection cannot happen after the fact — a search that has already overrun is a
frame that has already been missed — so the budget check is part of the search
loop's structure, not a wrapper around it.

Narrowing K mid-search is preferable to truncating D: a shallower plan is blind
past the next gap (see "Horizon"), whereas a narrower beam still spans the full
horizon with fewer alternatives considered. Depth is correctness; width is
quality.

Degradation never switches to a different policy. A narrower beam is still a
search over the true dynamics and degrades smoothly; falling back to a hand-tuned
reactive rule would mean falling back to something that scores 1–4, which is
indistinguishable from a crash.

### Drift check

Each tick, compare the clone's predicted `birdY` after one step against the value
the live game actually produces. These should agree exactly.

The check carries two distinct jobs:

1. **Correctness guard for plan reuse.** Plan-and-verify is sound only while the
   forward model is exact. The drift check is the test of that premise, run every
   step. On divergence the plan is discarded immediately and a re-plan is forced.
   Without this check, reusing a plan would be an assumption; with it, the
   assumption is continuously verified. This is why the per-step cost is one
   clone and one step rather than zero — the verification is the point.
2. **Site-update detection.** Divergence also means the game's physics changed
   underneath us. Surfaced in the HUD rather than allowed to degrade play
   silently — necessary because `Ctor` is reached through a hash-named bundle
   class that any deploy may rename.

Persistent drift (divergence on consecutive steps, rather than a one-off) should
disarm rather than thrash between re-plans that all immediately fail.

## Testing

The controller is a pure function `(state) => boolean` over a deterministic,
headless simulation, so correctness is measurable rather than eyeballed.

**All tests run in the MAIN world on the page, in a visible tab.** They cannot
run in a Web Worker or in Node: the simulation class is obtained as
`Object.getPrototypeOf(__game).constructor` from the live page, and a class
cannot cross a `postMessage` boundary (structured clone rejects functions). The
"runs headless and inert" finding was verified in the MAIN world specifically.
Benchmark runs are chunked across `requestAnimationFrame` callbacks so a long
batch never blocks the page — which also means a hidden tab suspends the
benchmark, since rAF is throttled to a halt (see "Tab visibility").

**Imposing a seed.** `beginRun()` does `this.runSeed = this.nextSeed ?? gS()`, so
a test fixes its seed by assigning `sim.nextSeed = <bigint>` *before* calling
`beginRun()`. This is the only supported seeding mechanism; writing `runSeed`
directly is overwritten by the next `beginRun()`.

- **Benchmark mode** — run ~100 games on fixed seeds; report a score histogram.
  Beats the naive baseline of 1–4 or it is not working. **Each game must carry a
  cutoff** (a max-step cap, or a target score), and reaching the cutoff counts as
  a pass. A correct controller does not lose, so an uncapped benchmark hangs
  exactly when the code is working. Budget the cap deliberately: at 120 steps/s,
  a score of 50 is ~10,000 steps, and every step costs a clone plus a step for
  the drift check even when no re-plan is triggered.
- **Plan-reuse equivalence** — the load-bearing claim of plan-and-verify is that
  re-planning every step yields the same actions as executing a cached plan.
  Assert it directly: run a seed under both policies and require identical action
  sequences. If this fails, the exactness premise is wrong and the whole design
  needs revisiting.
- **Regression** — fixed seed implies fixed expected score; assert a threshold.
- **Clone fidelity** — clone a live mid-run state, step both clone and original,
  assert identical `birdY` / `birdVy` / `pipes`.
- **Search unit tests** — hand-constructed states with a known correct action
  (e.g. a gap reachable only by flapping immediately).

## Risks

- The beam ranking heuristic could prune the uniquely correct branch. The
  benchmark is how this would be detected; beam width is the mitigation.
- Plan-and-verify rests on the forward model being exact. The drift check guards
  it at runtime and the plan-reuse equivalence test guards it at build time, but
  if some input to the simulation is not captured by the clone, both the plan and
  the search would be wrong together and agree with each other. The clone
  fidelity test over a long horizon is the defence.
- K = 24 and D = 240 are unvalidated starting values. D = 240 is grounded in the
  measured 201-step pipe spacing; K = 24 is a guess pending the benchmark.
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
