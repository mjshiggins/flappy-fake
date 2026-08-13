import { inspectGame } from './gameAccess.js';
import { makeSimOps } from './simOps.js';
import { Controller } from './controller.js';
import { beamSearch } from './search.js';
import { Planner } from './planner.js';
import { D, R, K, PIPE_SPACING } from '../shared/constants.js';
import { mountHud } from './hud.js';
import { planTrajectory } from './trajectory.js';
import { runBenchmark, sweepK, cloneFidelity, planReuseCost } from './benchmark.js';

function boot() {
  const game = window.__game;
  const info = inspectGame(game);

  // Declared before mountHud so the HUD's callbacks can close over it; the
  // controller cannot be constructed until feature detection has passed.
  let controller = null;
  let showPlan = false;
  const hud = mountHud({
    onArm: (v) => { if (controller) controller.armed = v; },
    onAutoRestart: (v) => { if (controller) controller.autoRestart = v; },
    onTogglePlan: (v) => { showPlan = v; },
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
    get lastDeath() { return controller.lastDeath; },
  };

  // Instance patch, NOT prototype: clones inside the search must not recurse.
  const protoStep = Object.getPrototypeOf(game).step;
  game.step = function (dt) {
    try { controller.tick(this); } catch (e) { controller.armed = false; hud.error(String(e)); }
    return protoStep.call(this, dt);
  };

  let loggedDeath = null;
  setInterval(() => {
    const death = controller.lastDeath;
    hud.update({
      armed: controller.armed,
      isRanked: game.isRanked,        // read-only indicator; mutates nothing
      replans: controller.planner.replanCount,
      exhaustedReplans: controller.planner.exhaustedReplans,
      narrowedReplans: controller.planner.narrowedReplans,
      driftEvents: controller.driftEvents,
      deathCause: death?.deathCause,
    });
    if (showPlan) hud.drawPlan(previewTrajectory());
    if (death && death !== loggedDeath) {
      loggedDeath = death;
      const { traj: _traj, ...rest } = death;
      console.warn('[flappy-fake] death', rest);
    }
  }, 250);

  // Preview the cached plan only. A previous fallback ran an unbounded
  // beamSearch whenever the plan was empty — the exact moment a hard gap
  // exhausts the controller — so toggling "show plan" stole a full search
  // every 250ms on the main thread and the bot died.
  function previewTrajectory() {
    try {
      if (game.state === 'gameover' && controller.lastDeath?.traj) {
        return controller.lastDeath.traj;
      }
      const actions = controller.planner.remainingActions();
      if (!actions) return null;
      return planTrajectory(game, ops, actions);
    } catch {
      return null;
    }
  }
}

if (window.__game) boot();
else window.addEventListener('load', boot, { once: true });
