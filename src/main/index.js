import { inspectGame } from './gameAccess.js';
import { makeSimOps } from './simOps.js';
import { Controller } from './controller.js';
import { beamSearch } from './search.js';
import { Planner } from './planner.js';
import { D, R, K, PIPE_SPACING } from '../shared/constants.js';
import { mountHud } from './hud.js';
import { runBenchmark, sweepK, cloneFidelity, planReuseCost } from './benchmark.js';

function boot() {
  const game = window.__game;
  const info = inspectGame(game);

  // Declared before mountHud so the HUD's callbacks can close over it; the
  // controller cannot be constructed until feature detection has passed.
  let controller = null;
  const hud = mountHud({
    onArm: (v) => { if (controller) controller.armed = v; },
    onAutoRestart: (v) => { if (controller) controller.autoRestart = v; },
  });

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
  controller = new Controller(ops, api, {
    K, D, R, pipeSpacing: PIPE_SPACING, driftLimit: 3,
    now: () => performance.now(), budgetMs: 12,
  });
  controller.armed = false;   // never auto-arm; the user arms explicitly

  window.__flappyFake = {
    ops, Ctor: info.Ctor, controller, game,
    runBenchmark, sweepK, cloneFidelity, planReuseCost,
    // exposed for diagnosis: reimplementing the search in a console snippet is
    // error-prone (a double-release corrupts the clone pool silently)
    beamSearch, Planner,
  };

  // Instance patch, NOT prototype: clones inside the search must not recurse.
  const protoStep = Object.getPrototypeOf(game).step;
  game.step = function (dt) {
    try { controller.tick(this); } catch (e) { controller.armed = false; hud.error(String(e)); }
    return protoStep.call(this, dt);
  };

  setInterval(() => {
    hud.update({
      armed: controller.armed,
      status: controller.status,
      score: game.score,
      isRanked: game.isRanked,        // read-only indicator; mutates nothing
      replans: controller.planner.replanCount,
      driftEvents: controller.driftEvents,
      exhausted: controller.planner.lastExhausted,
    });
  }, 250);
}

if (window.__game) boot();
else window.addEventListener('load', boot, { once: true });
