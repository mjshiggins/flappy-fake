export function mountHud() {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'top:8px', 'left:8px', 'z-index:2147483647',
    'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
    'background:rgba(0,0,0,.82)', 'color:#eee', 'padding:8px 10px',
    'border-radius:6px', 'pointer-events:none', 'white-space:pre',
  ].join(';');
  document.body.appendChild(el);

  return {
    update({ armed, status, score, isRanked, replans, driftEvents = 0 }) {
      el.textContent = [
        `${armed ? '● ARMED' : '○ idle'}   score ${score}`,
        `${isRanked ? '⚠ RANKED — this run submits' : 'unranked'}`,
        `replans ${replans}${driftEvents ? `   ⚠ drift x${driftEvents}` : ''}`,
        status,
      ].join('\n');
      el.style.borderLeft = isRanked ? '3px solid #e5484d' : '3px solid #30a46c';
    },
    error(msg) {
      el.textContent = `✕ ${msg}`;
      el.style.borderLeft = '3px solid #e5484d';
    },
  };
}
