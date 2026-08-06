const CHANNEL = 'flappy-fake';

async function send(type, value) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { channel: CHANNEL, type, value }).catch(() => {});
}

document.getElementById('arm').addEventListener('change', (e) => send('arm', e.target.checked));
document.getElementById('auto').addEventListener('change', (e) => send('autoRestart', e.target.checked));

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.channel !== CHANNEL || msg.type !== 'stats') return;
  const { armed, score, isRanked, status } = msg.value;
  const el = document.getElementById('stats');
  el.textContent = `${armed ? 'armed' : 'idle'}  score ${score}\n${isRanked ? 'RANKED — submits' : 'unranked'}\n${status}`;
  el.className = isRanked ? 'ranked' : '';
});
