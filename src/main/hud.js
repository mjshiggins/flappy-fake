/**
 * On-page control panel and status display.
 *
 * Deliberately the ONLY user surface. An earlier version put the controls in an
 * extension popup, which meant routing a boolean through chrome.tabs.sendMessage
 * -> ISOLATED-world bridge -> window.postMessage -> MAIN world. Three hops across
 * two execution worlds to toggle a flag, with a silent failure at every link.
 * The HUD runs in the same world as the controller, so it just calls it.
 */

const HUD_WIDTH = 240;
const CANVAS_H = 130;
const HIDE_KEY = 'h';

export function mountHud({ onArm, onAutoRestart, onTogglePlan }) {
  const el = document.createElement('div');
  // A FIXED width (not min-width) plus border-box keeps the panel from
  // reflowing every 250ms as digits, warnings, and status strings change
  // length -- the resize jitter this is meant to avoid.
  el.style.cssText = [
    'position:fixed', 'top:8px', 'left:8px', 'z-index:2147483647',
    'box-sizing:border-box', `width:${HUD_WIDTH}px`,
    'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
    'background:rgba(0,0,0,.85)', 'color:#eee', 'padding:10px 12px',
    'border-radius:8px', 'pointer-events:auto', 'user-select:none',
    'box-shadow:0 2px 12px rgba(0,0,0,.4)',
  ].join(';');

  const armBtn = document.createElement('button');
  armBtn.textContent = 'ARM';
  armBtn.style.cssText = [
    'width:100%', 'padding:7px', 'margin-bottom:8px', 'cursor:pointer',
    'font:600 12px/1 ui-monospace,Menlo,monospace', 'letter-spacing:.08em',
    'border:0', 'border-radius:5px', 'background:#30a46c', 'color:#fff',
  ].join(';');

  const autoLabel = document.createElement('label');
  autoLabel.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;cursor:pointer';
  const autoBox = document.createElement('input');
  autoBox.type = 'checkbox';
  autoBox.style.cssText = 'cursor:pointer;margin:0';
  autoLabel.append(autoBox, document.createTextNode('auto-restart'));

  const planLabel = document.createElement('label');
  planLabel.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;cursor:pointer';
  const planBox = document.createElement('input');
  planBox.type = 'checkbox';
  planBox.style.cssText = 'cursor:pointer;margin:0';
  planLabel.append(planBox, document.createTextNode('show plan'));

  // Fixed height and no dropped lines: the body always renders the same number
  // of rows so the panel never grows or shrinks as warnings toggle. pre-wrap
  // contains the occasional long status string inside the fixed width.
  const body = document.createElement('div');
  body.style.cssText = 'white-space:pre-wrap;word-break:break-word;font-size:11px;line-height:1.55';

  const canvasWrap = document.createElement('div');
  canvasWrap.style.cssText = `display:none;margin-top:8px`;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `width:100%;height:${CANVAS_H}px;display:block;border-radius:5px;background:#0b0b0b`;
  canvasWrap.append(canvas);

  const hint = document.createElement('div');
  hint.textContent = `press ${HIDE_KEY.toUpperCase()} to hide`;
  hint.style.cssText = 'margin-top:8px;font-size:10px;color:#888;text-align:center';

  el.append(armBtn, autoLabel, planLabel, body, canvasWrap, hint);
  document.body.appendChild(el);

  let armed = false;
  const paint = () => {
    armBtn.textContent = armed ? '■ DISARM' : '▶ ARM';
    armBtn.style.background = armed ? '#e5484d' : '#30a46c';
  };
  paint();

  armBtn.addEventListener('click', () => { armed = !armed; paint(); onArm(armed); });
  autoBox.addEventListener('change', () => onAutoRestart(autoBox.checked));
  planBox.addEventListener('change', () => {
    canvasWrap.style.display = planBox.checked ? 'block' : 'none';
    onTogglePlan?.(planBox.checked);
  });

  // Hotkey: toggle the whole panel. The listener stays live while hidden so the
  // same key brings it back. Ignored while typing into a field so it never eats
  // keystrokes meant for a form.
  let hidden = false;
  const setHidden = (v) => { hidden = v; el.style.display = hidden ? 'none' : 'block'; };
  const onKey = (e) => {
    if (e.key?.toLowerCase() !== HIDE_KEY) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    const tag = t?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
    setHidden(!hidden);
  };
  window.addEventListener('keydown', onKey, true);

  return {
    update(s) {
      armed = s.armed;
      paint();
      const drift = s.driftEvents ? `   ⚠ drift x${s.driftEvents}` : '';
      body.textContent = `replans  ${s.replans}${drift}`;
      // The colored border is the retained ranked indicator (the design doc's
      // one leaderboard mitigation): red while a run would submit, green while
      // it would not. Kept even though the text warning was removed.
      el.style.borderLeft = s.isRanked ? '3px solid #e5484d' : '3px solid #30a46c';
    },
    drawPlan(traj) {
      if (!planBox.checked) return;
      renderTrajectory(canvas, traj);
    },
    error(msg) {
      armBtn.disabled = true;
      armBtn.style.background = '#666';
      armBtn.style.cursor = 'not-allowed';
      body.textContent = `✕ ${msg}`;
      el.style.borderLeft = '3px solid #e5484d';
    },
  };
}

/**
 * Renders a planTrajectory() result into the canvas: a stationary field of
 * pipes with the planned bird path arcing through it. Auto-fits to the data,
 * so it needs no knowledge of the site's pixel scale. y is drawn up-positive
 * (a flap raises birdY), matching the on-screen orientation.
 */
function renderTrajectory(canvas, traj) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || canvas.width;
  const H = CANVAS_H;
  if (canvas.width !== Math.round(W * dpr)) canvas.width = Math.round(W * dpr);
  if (canvas.height !== Math.round(H * dpr)) canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  if (!traj || traj.path.length === 0) {
    ctx.fillStyle = '#666';
    ctx.font = '11px ui-monospace,Menlo,monospace';
    ctx.fillText('no plan', 8, 18);
    return;
  }

  const M = 6;
  const xs = traj.path.map((p) => p.x).concat(traj.pipes.map((p) => p.x));
  let xMin = Math.min(...xs);
  let xMax = Math.max(...xs);
  const ys = traj.path.map((p) => p.y);
  for (const p of traj.pipes) { ys.push(p.gapY - p.halfGap, p.gapY + p.halfGap); }
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  xMin -= xSpan * 0.02; xMax += xSpan * 0.02;
  yMin -= ySpan * 0.05; yMax += ySpan * 0.05;

  const sx = (x) => M + ((x - xMin) / (xMax - xMin)) * (W - 2 * M);
  const sy = (y) => M + ((yMax - y) / (yMax - yMin)) * (H - 2 * M); // up-positive

  ctx.fillStyle = 'rgba(229,72,77,.28)';
  ctx.strokeStyle = 'rgba(48,163,108,.9)';
  ctx.lineWidth = 1;
  for (const p of traj.pipes) {
    const px = sx(p.x);
    const topEdge = sy(p.gapY + p.halfGap);
    const botEdge = sy(p.gapY - p.halfGap);
    const w = 5;
    ctx.fillRect(px - w / 2, 0, w, topEdge);
    ctx.fillRect(px - w / 2, botEdge, w, H - botEdge);
    ctx.beginPath();
    ctx.moveTo(px - w / 2, sy(p.gapY));
    ctx.lineTo(px + w / 2, sy(p.gapY));
    ctx.stroke();
  }

  ctx.strokeStyle = traj.dead ? '#e5484d' : '#38bdf8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  traj.path.forEach((p, i) => {
    const X = sx(p.x); const Y = sy(p.y);
    if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
  });
  ctx.stroke();

  ctx.fillStyle = '#fde047';
  for (const p of traj.path) {
    if (!p.flap) continue;
    ctx.beginPath();
    ctx.arc(sx(p.x), sy(p.y), 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  const start = traj.path[0];
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(sx(start.x), sy(start.y), 3, 0, Math.PI * 2);
  ctx.fill();
}
