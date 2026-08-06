// ISOLATED world. Relays arm/disarm, auto-restart, and stats. Nothing else
// crosses this boundary.
const CHANNEL = 'flappy-fake';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.channel !== CHANNEL) return;
  window.postMessage({ channel: CHANNEL, type: msg.type, value: msg.value }, '*');
  sendResponse({ ok: true });
  return true;
});

window.addEventListener('message', (ev) => {
  if (ev.source !== window || ev.data?.channel !== CHANNEL) return;
  if (ev.data.type !== 'stats') return;
  chrome.runtime.sendMessage({ channel: CHANNEL, type: 'stats', value: ev.data.value }).catch(() => {});
});
