function formatSeconds(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h.toString().padStart(2, '0')}:` +
         `${m.toString().padStart(2, '0')}:` +
         `${s.toString().padStart(2, '0')}`;
}

async function loadStats() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'TK_GET_TODAY_STATS' }, resolve);
  });
}

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'TK_GET_SETTINGS' }, resolve);
  });
}

async function setPaused(paused) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'TK_SET_PAUSED', paused }, resolve);
  });
}

async function init() {
  const pauseBtn = document.getElementById('pauseBtn');
  const totalTimeEl = document.getElementById('totalTime');
  const statusEl = document.getElementById('status');
  const siteListEl = document.getElementById('siteList');

  const [{ todayKey, siteStats, settings }, settingsResp] = await Promise.all([
    loadStats(),
    loadSettings()
  ]);

  const s = settingsResp.settings || settings;
  pauseBtn.textContent = s.trackingPaused ? 'Resume' : 'Pause';
  statusEl.textContent = s.trackingPaused ? 'Paused' : 'Tracking';

  const todayData = (siteStats && siteStats[todayKey]) || {};
  const entries = Object.entries(todayData);

  let totalSec = 0;
  for (const [, info] of entries) {
    totalSec += info.seconds || 0;
  }
  totalTimeEl.textContent = formatSeconds(totalSec);

  siteListEl.innerHTML = '';
  entries
    .sort((a, b) => (b[1].seconds || 0) - (a[1].seconds || 0))
    .slice(0, 20)
    .forEach(([domain, info]) => {
      const li = document.createElement('li');
      const nameSpan = document.createElement('span');
      const timeSpan = document.createElement('span');
      nameSpan.textContent = domain;
      nameSpan.className = 'domain';
      timeSpan.textContent = formatSeconds(info.seconds || 0);
      li.appendChild(nameSpan);
      li.appendChild(timeSpan);
      siteListEl.appendChild(li);
    });

  pauseBtn.addEventListener('click', async () => {
    const currentPaused = pauseBtn.textContent === 'Pause';
    const resp = await setPaused(currentPaused);
    const newSettings = resp.settings;
    pauseBtn.textContent = newSettings.trackingPaused ? 'Resume' : 'Pause';
    statusEl.textContent = newSettings.trackingPaused ? 'Paused' : 'Tracking';
  });
}

document.addEventListener('DOMContentLoaded', init);