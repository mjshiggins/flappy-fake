# Flappy Fake

A Chrome extension that plays [flappybird.io](https://flappybird.io/) automatically
by searching the game's own simulation to decide when to flap.

It is **not** a machine-learning project. The game hands us exact state and a
public physics API, so playing well is a search problem, not a learning problem:
the extension drives the game's real dynamics forward and picks the action that
survives. In control-theory terms this is **model predictive control** — a
receding-horizon search re-planned continuously against an exact forward model.

## Download and install

Requires **Chrome 111+**. No Node or build tools needed.

1. Download the latest `flappy-fake-*.zip` from the
   [Releases](https://github.com/mjshiggins/flappy-fake/releases) page.
2. Unzip it. (Chrome cannot install a zip directly — do not try to drag the zip
   onto `chrome://extensions`.)
3. Open `chrome://extensions`, enable **Developer mode** (top-right), click
   **Load unpacked**, and select the unzipped folder (the one containing
   `manifest.json`).
4. Open <https://flappybird.io/>. The HUD appears in the top-left.

The same zip is store-ready for a manual Chrome Web Store upload.

## How it works

- **Exact state, exact physics.** `window.__game` is a live class instance
  exposing `birdY`, `pipes`, `prng`, etc., and its prototype exposes `flap()` and
  `step(dt)`. The bot clones that instance and steps the *real* simulation, so
  prediction needs no reimplemented physics and actuation needs no synthetic key
  events.
- **Beam search over flap/no-flap.** Each re-plan explores thousands of
  candidate futures over a ~2-second horizon (`D = 240` steps at 120 Hz),
  pruning any branch where the bird dies and keeping the best `K = 24` by
  clearance to the next pipe. The result is a *plan*: a `boolean[]` of per-step
  flap decisions.
- **Plan-and-verify.** A plan is executed for a bounded window (`R = 39` steps)
  and then re-planned, subject to the horizon invariant `R ≤ D − pipeSpacing`.
  Every tick a one-step drift check compares the clone's predicted `birdY`
  against reality; persistent drift disarms the bot (it means the site changed
  its physics).
- **Instance patch, not prototype.** The controller runs by patching the live
  `game.step` instance method, so it fires exactly once per simulation step even
  when the game's fixed-timestep accumulator batches several steps per frame.
  Clones inside the search use the untouched prototype and never recurse.

See [`docs/superpowers/specs/2026-08-06-flappy-bird-bot-design.md`](docs/superpowers/specs/2026-08-06-flappy-bird-bot-design.md)
for the full design and recon findings.

## Install from source

For local development (the content script runs in the `MAIN` world):

```bash
npm install
npm run build      # bundles src/main/index.js -> dist/main.js
```

Then in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** →
select this project folder. After changing code: `npm run build`, click
**reload** on the extension card, then refresh the page.

## Usage

The HUD is the only control surface (it runs in the same world as the
controller, so there is no popup or message bridge):

- **ARM / DISARM** — start or stop the bot. It never auto-arms.
- **auto-restart** — immediately restart after a game over.
- **show plan** — overlay a live preview of the planned trajectory: a stationary
  field of pipes with the bird's predicted path arcing through it, flap points
  marked. Rendered from the plan in the game's native units, so it needs no
  knowledge of the site's pixel scale.
- **press `H`** — hide/show the whole HUD.
- The colored left border is a read-only ranked indicator: **red** while a run
  would submit to the leaderboard, **green** while it would not.

## Development

```bash
npm test           # run the vitest suite (Node, against a fake sim)
npm run test:watch # watch mode
npm run build      # produce dist/main.js
npm run package    # build a store-ready flappy-fake-<version>.zip locally
```

### Releasing

CI runs tests and a build on every push/PR to `master`. To publish a downloadable
release zip:

1. Bump `"version"` in `manifest.json` if you want the source of truth to match
   (the release workflow also forces the packaged version from the tag).
2. Tag and push:

```bash
git tag v0.1.1
git push origin v0.1.1
```

The Release workflow builds, packages `manifest.json` + `dist/main.js` +
`icons/`, and attaches `flappy-fake-0.1.1.zip` to a
[GitHub Release](https://github.com/mjshiggins/flappy-fake/releases).

The search, planner, controller, and drift check are pure with respect to the
game — everything goes through the `simOps` contract — so they are tested in Node
against a deterministic fake simulation (`test/fakeSim.js`), no browser required.

### Benchmarking (on the page)

The live game class cannot cross into Node, so benchmarks run in the page.
When the extension is loaded, `window.__flappyFake` exposes the internals:

```js
const { Ctor, ops, runBenchmark, sweepK } = window.__flappyFake;

// Score histogram over fixed seeds.
await runBenchmark(Ctor, ops, { K: 24, D: 240, R: 39, games: 20 });

// Reproduce the LIVE 12ms search budget to measure exhaustion / beam-narrowing.
await runBenchmark(Ctor, ops, { K: 24, D: 240, R: 39, games: 20, budgetMs: 12 });
```

`runBenchmark` reports `min` / `median` score, `cutoffRate`, and the
`exhaustedRate` / `narrowedRate` diagnostics.

## Leaderboard note

flappybird.io has a ranked online leaderboard, and a bot run submits when
`netMode` is `online`. There is **no enforced interlock**: the bot runs only when
you explicitly arm it, and the ranked indicator in the HUD tells you which state
you are arming into. Use it responsibly — it's a toy for beating your friends'
draft order, not for polluting a public leaderboard.

## Project layout

```
manifest.json            MV3 manifest (content script, MAIN world)
build.mjs                esbuild bundle -> dist/main.js
src/main/
  index.js               boot, step patch, HUD wiring, benchmark exposure
  gameAccess.js          feature-detect the live game's shape
  simOps.js              adapter binding the simOps contract to the real class
  clonePool.js           object pool for search clones
  search.js              beam search over flap/no-flap
  planner.js             plan cache + re-plan policy (horizon invariant)
  controller.js          per-tick orchestration
  drift.js               one-step forward-model drift check
  trajectory.js          roll a plan forward for the on-page preview
  hud.js                 on-page control panel + plan overlay
  benchmark.js           in-page benchmark / sweep harness
src/shared/constants.js  DT, horizon, beam width, pipe geometry
test/                    vitest suite against a fake sim
```
