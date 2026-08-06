import { inspectGame } from './gameAccess.js';
import { makeSimOps } from './simOps.js';
import { Controller } from './controller.js';
import { beamSearch } from './search.js';
import { Planner } from './planner.js';
import { D, R, K, PIPE_SPACING } from '../shared/constants.js';
import { mountHud } from './hud.js';
import { runBenchmark, sweepK, cloneFidelity, planReuseCost } from './benchmark.js';

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

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.data?.channel !== CHANNEL) return;
    const { type, value } = ev.data;
    if (type === 'arm') controller.armed = !!value;
    if (type === 'autoRestart') controller.autoRestart = !!value;
  });

  setInterval(() => {
    const stats = {
      armed: controller.armed,
      status: controller.status,
      score: game.score,
      isRanked: game.isRanked,        // read-only indicator; mutates nothing
      replans: controller.planner.replanCount,
      driftEvents: controller.driftEvents,
    };
    hud.update(stats);
    window.postMessage({ channel: CHANNEL, type: 'stats', value: stats }, '*');
  }, 250);
}

if (window.__game) boot();
else window.addEventListener('load', boot, { once: true });
