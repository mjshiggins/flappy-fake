/**
 * On-page control panel and status display.
 *
 * Deliberately the ONLY user surface. An earlier version put the controls in an
 * extension popup, which meant routing a boolean through chrome.tabs.sendMessage
 * -> ISOLATED-world bridge -> window.postMessage -> MAIN world. Three hops across
 * two execution worlds to toggle a flag, with a silent failure at every link.
 * The HUD runs in the same world as the controller, so it just calls it.
 */
export function mountHud({ onArm, onAutoRestart }) {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'top:8px', 'left:8px', 'z-index:2147483647',
    'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
    'background:rgba(0,0,0,.85)', 'color:#eee', 'padding:10px 12px',
    'border-radius:8px', 'pointer-events:auto', 'user-select:none',
    'min-width:210px', 'box-shadow:0 2px 12px rgba(0,0,0,.4)',
  ].join(';');

  const armBtn = document.createElement('button');
  armBtn.textContent = 'ARM';
  armBtn.style.cssText = [
    'width:100%', 'padding:7px', 'margin-bottom:8px', 'cursor:pointer',
    'font:600 12px/1 ui-monospace,Menlo,monospace', 'letter-spacing:.08em',
    'border:0', 'border-radius:5px', 'background:#30a46c', 'color:#fff',
  ].join(';');

  const autoLabel = document.createElement('label');
  autoLabel.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;cursor:pointer';
  const autoBox = document.createElement('input');
  autoBox.type = 'checkbox';
  autoBox.style.cssText = 'cursor:pointer;margin:0';
  autoLabel.append(autoBox, document.createTextNode('auto-restart'));

  const body = document.createElement('div');
  body.style.cssText = 'white-space:pre;font-size:11px;line-height:1.55';

  el.append(armBtn, autoLabel, body);
  document.body.appendChild(el);

  let armed = false;
  const paint = () => {
    armBtn.textContent = armed ? '■ DISARM' : '▶ ARM';
    armBtn.style.background = armed ? '#e5484d' : '#30a46c';
  };
  paint();

  armBtn.addEventListener('click', () => { armed = !armed; paint(); onArm(armed); });
  autoBox.addEventListener('change', () => onAutoRestart(autoBox.checked));

  return {
    update(s) {
      armed = s.armed;
      paint();
      body.textContent = [
        `score    ${s.score}`,
        `${s.isRanked ? '⚠ RANKED — this run submits' : 'unranked — not submitted'}`,
        `replans  ${s.replans}${s.driftEvents ? `   ⚠ drift x${s.driftEvents}` : ''}`,
        s.exhausted ? '⚠ search exhausted (no survivable plan)' : '',
        s.status === 'ok' ? '' : s.status,
      ].filter(Boolean).join('\n');
      el.style.borderLeft = s.isRanked ? '3px solid #e5484d' : '3px solid #30a46c';
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
