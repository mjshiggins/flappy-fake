// Feature-detects the live game object. The real Ctor is reached via a
// hash-named bundle class that any deploy may rename, so this module never
// hardcodes the class name -- it only checks shape. `gameAccess.js` and
// `simOps.js` are the only files permitted to know the real game exists, and
// even they receive the game object/constructor as arguments rather than
// reading `window` directly, so they stay Node-testable.

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
