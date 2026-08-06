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

### Difficulty ramp is bounded, and the game becomes stationary

`halfGap` comes from `Jy(simVersion, spawnCount)`:

```js
function Jy(l, i) { return l < 2 ? gf : (i < vf.length ? vf[i] : gf) }
```

`vf` is a lookup table, not a formula. Measured by driving `advancePipes()` on a
headless instance with no bird:

```
vf = [325058, 309330, 293601, 277872, 262144]   (−15728 per pipe)
gf = 246415                                     (floor, forever after)
```

The ramp lasts exactly **5 pipes**, then `halfGap` is constant at 246415 — 75.8%
of the opening gap. Pipe spacing is constant at 201 steps throughout.

**Therefore the game is stationary from spawn 5 onward.** Both difficulty
parameters are fixed; only `gapY` continues to vary, drawn from the PRNG. Three
consequences:

- The search must be tuned against the **floor** `halfGap = 246415`, never the
  opening 325058. Early pipes are the easy case.
- The horizon invariant rests on the 201-step spacing, which is now confirmed
  constant for all pipes rather than measured only on the opening few.
- A benchmark cutoff is **principled evidence**, not a pragmatic compromise: past
  pipe ~6 every pipe presents identical parameters, so a controller that clears
  20 is in the same regime it would face at 20,000.

The remaining variation is vertical — consecutive `gapY` draws can demand a large
climb or descent between adjacent gaps. That, not difficulty escalation, is where
a hard case lives, and it is bounded by the `gapY` range and directly
constructible as a test.

### Tab visibility

The game does not advance while the tab is hidden: `visibilitychange` handling
sets `paused`, and rAF is suspended regardless. Verified — a run started in a
hidden tab sat in `state: "play"` at `playStep: 0` indefinitely. The bot
therefore only operates on a visible tab. This is acceptable (a human player has
the same constraint) but means benchmark and measurement runs cannot be performed
in a background tab.

### A fresh instance runs headless and inert

Verified: `new Ctor(0)` followed by `beginRun()` and repeated `step(1/120)` runs a
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

**A plan is computed once and executed for a bounded interval R.** Plan reuse is
an affordability argument over a bounded window — *not* a claim that re-planning
is redundant.

An earlier revision justified reuse by arguing the forward model is exact, so a
plan optimal at step *T* is still optimal at *T+1*. **That reasoning is wrong**
and is recorded here so it is not reintroduced. It invokes Bellman's principle of
optimality, which applies to subproblems of the same problem. The search at *T*
optimises over `[T, T+D]` against a terminal heuristic; the search at *T+1*
optimises over `[T+1, T+1+D]`. This is a *receding horizon*: the tail of the *T*
plan was scored against a boundary the *T+1* search sees past. Exactness
guarantees the predicted state trajectory is correct; it guarantees nothing about
the truncated objective being invariant. Nothing-external-perturbs is necessary,
not sufficient. Model-predictive control re-plans continuously for this reason
despite having exact models.

### The horizon invariant

Every executed action must be backed by at least one full pipe spacing of
lookahead. An action executed at offset *r* into a D-step plan was chosen with
only `D − r` steps of remaining lookahead, so:

> **R ≤ D − 201**

With D = 240 this gives **R ≤ 39 steps** (~325 ms). Reusing a plan for longer
puts its tail in exactly the blind-greedy regime that "Horizon" above forbids —
the failure would look like an inexplicable death near a gap, not like a budget
problem.

R, D, and K trade off against each other under this constraint:

| D | R (= D − 201) | Expansions (K=24) | Burst | Amortised |
|---|---|---|---|---|
| 240 | 39 | 11,520 | ~7.0 ms | ~2.2% core |
| 440 | 239 | 21,120 | ~12.9 ms | ~0.65% core |

Larger D amortises better but bursts harder, and the burst is synchronous inside
a frame (see Budget). Halving K halves both. Starting point: **D = 240, R = 39,
K = 24**, with the invariant as the hard constraint and the rest tuned against
the benchmark.

Re-plan when, and only when:

- R steps have elapsed since the last plan (the horizon invariant)
- the drift check fires
- the run state changes (new run, `restart()`)

Plan-and-verify still clearly beats per-step search. Holding the invariant, an
every-step search must keep D ≥ 201 at ~1 ms/step, which forces K ≈ 4 — a beam
too narrow to trust. Reuse buys beam quality with the CPU it saves.

**Budget.** Measured 2026-08-06: clone plus one step **0.61 µs**; bare step
**0.15 µs**. A K = 24, D = 240 beam is ≈11,520 expansions ≈ **7 ms per search**.

At 120 steps/s, searching every step would cost ~840 ms per second of wall clock
— 84% of a core, and unshippable. Under plan-and-verify at R = 39 the search runs
once per ~325 ms, amortising to **~2.2% of a core**. The per-step cost in steady
state is one clone, one step, and one comparison for the drift check.

**The 7 ms burst is synchronous and unavoidably inside a frame.** The controller
runs only from `controller.tick`, which runs inside the patched `live.step`,
which is called only from the accumulator's batch loop inside a rAF frame. There
is no execution opportunity outside a frame, and staggering re-plans only chooses
*which* step pays the cost — it does not move the cost out of the frame. Two
options, and the plan must pick one explicitly:

- **(a) Accept the burst.** 7 ms lands alongside ~2 sim steps and a render inside
  16.7 ms. Tight but survivable, and the fixed-timestep accumulator makes it
  safe: an overrun frame is not corrupting, the accumulator simply runs more
  steps on the next frame and the controller is still invoked for every one.
  The cost is occasional visual jank, not incorrect play.
- **(b) Incremental search.** Spread one search across several frames using the
  R-step runway. Removes the jank, but requires resumable beam state and
  partial-plan bookkeeping — a materially different search implementation.

**Start with (a)**, measure jank in the benchmark, and escalate to (b) only if it
is visible. Halving K to 12 (~3.5 ms) is the cheaper intermediate move.

**Clone pooling is required, not optional.** Cloning (0.61 µs) dominates stepping
(0.15 µs) by 4×, so the search cost is mostly allocation. A pool of reusable
clone objects is the highest-leverage optimisation available and should be built
in from the start rather than retrofitted if the budget tightens.

K and D remain tuning knobs to be validated against the benchmark, subject to the
horizon invariant. They are not fixed architecture.

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

**Order matters.** The prediction must apply the planned action before stepping:
clone the live state, apply the action the plan calls for on this step, step the
clone, and compare against the live game on the following tick. `flap()` changes
`birdVy`, so a clone stepped *without* the planned flap diverges on every flap
step — which, with auto-disarm on persistent drift, yields a bot that constantly
disarms itself.

**What the check does and does not guard.** It compares one-step-ahead predicted
`birdY` against reality, so it tests **physics fidelity only**:

1. **Exactness premise.** Divergence means the clone no longer reproduces the
   game — the forward model is wrong, so both the plan and any new search would
   be wrong. Discard the plan and force a re-plan.
2. **Site-update detection.** The same signal means the game's physics changed
   underneath us. Surfaced in the HUD rather than allowed to degrade play
   silently — necessary because `Ctor` is reached through a hash-named bundle
   class that any deploy may rename.

It does **not** guard plan quality. A perfectly exact model reproduces the
trajectory flawlessly while a stale plan steers into a pipe it was never deep
enough to see; the drift check passes silently throughout. Plan quality is
guarded separately and structurally, by the horizon invariant `R ≤ D − 201`.
An earlier revision described this check as "the correctness guard" licensing
plan reuse. It is not, and cannot be.

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

  A modest cutoff is defensible here rather than merely convenient: the game is
  stationary past spawn 5 (see "Difficulty ramp is bounded"), so clearing ~20
  pipes exercises the same parameters the controller faces indefinitely.
- **Adversarial vertical delta** — stationarity means the remaining hard case is
  a large `gapY` change between adjacent pipes. Construct that case directly
  (maximum climb and maximum descent between consecutive gaps at the floor
  `halfGap`) rather than waiting for the PRNG to produce it. This is the test
  most likely to expose an insufficient horizon.
- **Plan-reuse cost** — assert the thing that matters: plan reuse at interval R
  costs no *score* against a per-step-re-plan reference, across N seeds.

  Do **not** assert identical action sequences. They will differ, for two reasons
  that have nothing to do with model exactness. First, the receding horizon: the
  *T* and *T+1* searches optimise over different windows against a terminal
  heuristic. Second, beam suboptimality: at *T* the K slots are shared across
  descendants of both the flap and no-flap subtrees, while at *T+1*, rooted at
  the state actually reached, all K slots go to that subtree — so *T+1* explores
  branches that *T* pruned. An action-identity test would fail on a healthy
  implementation and send an implementer chasing a non-existent bug.
- **Horizon invariant** — a unit test asserting `R ≤ D − 201` for the configured
  constants, so the relationship cannot be silently broken by later tuning.
- **Score versus K** — the benchmark should sweep K and report the score curve.
  In-flight K narrowing under load (see "Budget overrun") assumes degradation is
  gentle; if K = 24 sits near a quality cliff, narrowing under load is a much
  bigger deal than "degrades smoothly" and the degradation policy needs rethinking.
- **Regression** — fixed seed implies fixed expected score; assert a threshold.
- **Clone fidelity** — clone a live mid-run state, step both clone and original,
  assert identical `birdY` / `birdVy` / `pipes`.
- **Search unit tests** — hand-constructed states with a known correct action
  (e.g. a gap reachable only by flapping immediately).

## Risks

- The beam ranking heuristic could prune the uniquely correct branch. The
  benchmark is how this would be detected; beam width is the mitigation.
- Plan-and-verify rests on the forward model being exact. The drift check guards
  it at runtime, but if some input to the simulation is not captured by the
  clone, the plan and the search would be wrong together and agree with each
  other. The clone fidelity test over a long horizon is the defence.
- ~~Spacing may vary with `spawnCount`, invalidating D and R.~~ **Resolved:**
  spacing is constant at 201 for all pipes; `halfGap` ramps over 5 pipes and then
  plateaus. See "Difficulty ramp is bounded".
- K = 24 is an unvalidated guess pending the benchmark's score-versus-K sweep.
- The search must be validated at the floor `halfGap = 246415`. A controller
  tuned only on the opening pipes would be tuned on 32% wider gaps than it faces
  for the rest of the run.
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
