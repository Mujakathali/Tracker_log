importScripts('lib/storage.js', 'lib/timeTracker.js');

let tkCurrentSession = null;
let tkInMemoryStats = {};
let tkIsIdle = false;
let tkSettings = null;

const TK_FLUSH_ALARM = 'tk_flush_stats';
const TK_FLUSH_INTERVAL_MIN = 1;

// Init
chrome.runtime.onInstalled.addListener(async () => {
  tkSettings = await tkGetSettings();
  await chrome.alarms.create(TK_FLUSH_ALARM, {
    periodInMinutes: TK_FLUSH_INTERVAL_MIN
  });
  chrome.idle.setDetectionInterval(tkSettings.idleTimeoutSeconds || 60);
});

chrome.runtime.onStartup.addListener(async () => {
  tkSettings = await tkGetSettings();
});

// Alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === TK_FLUSH_ALARM) {
    await tkFlushStats();
  }
});

// Tabs / windows events
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await tkSwitchActiveTab(activeInfo.tabId);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await tkCloseCurrentSession();
    return;
  }
  const [tab] = await chrome.tabs.query({
    active: true,
    windowId
  });
  if (tab) {
    await tkSwitchActiveTab(tab.id);
  } else {
    await tkCloseCurrentSession();
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tkCurrentSession || tkCurrentSession.tabId !== tabId) return;
  if (changeInfo.url) {
    await tkSwitchActiveTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tkCurrentSession && tkCurrentSession.tabId === tabId) {
    await tkCloseCurrentSession();
  }
});

// Idle detection
chrome.idle.onStateChanged.addListener(async (state) => {
  if (state === 'active') {
    tkIsIdle = false;
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    });
    if (tab) await tkSwitchActiveTab(tab.id);
  } else {
    tkIsIdle = true;
    await tkCloseCurrentSession();
  }
});

// Messages (pause/resume, debug, export helpers)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'TK_GET_TODAY_STATS') {
      const siteStats = await tkGetSiteStats();
      sendResponse({
        todayKey: tkTodayKey(),
        siteStats,
        settings: await tkGetSettings()
      });
    } else if (msg.type === 'TK_SET_PAUSED') {
      const settings = await tkGetSettings();
      settings.trackingPaused = !!msg.paused;
      await tkSetSettings(settings);
      tkSettings = settings;
      if (settings.trackingPaused) {
        await tkCloseCurrentSession();
      } else {
        const [tab] = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true
        });
        if (tab) await tkSwitchActiveTab(tab.id);
      }
      sendResponse({ success: true, settings });
    } else if (msg.type === 'TK_GET_SETTINGS') {
      sendResponse({ settings: await tkGetSettings() });
    } else if (msg.type === 'TK_SET_SETTINGS') {
      const merged = { ...(await tkGetSettings()), ...(msg.settings || {}) };
      await tkSetSettings(merged);
      tkSettings = merged;
      if (msg.settings && msg.settings.idleTimeoutSeconds) {
        chrome.idle.setDetectionInterval(msg.settings.idleTimeoutSeconds);
      }
      sendResponse({ success: true, settings: merged });
    } else if (msg.type === 'TK_EXPORT_ALL') {
      const all = await tkGetAll();
      sendResponse({ data: all });
    }
  })();
  return true; // keep message channel open for async
});

// Core tracking
async function tkSwitchActiveTab(tabId) {
  await tkCloseCurrentSession();
  if (tkIsIdle) return;
  if (!tabId && tabId !== 0) return;

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url) return;
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

  const settings = tkSettings || (await tkGetSettings());
  if (settings.trackingPaused) return;

  const domain = tkParseDomain(tab.url);
  tkCurrentSession = {
    start: Date.now(),
    tabId,
    domain,
    url: tab.url
  };
  await tkSetLastActive({
    tabId,
    domain,
    url: tab.url,
    startTimestamp: tkCurrentSession.start
  });
}

async function tkCloseCurrentSession() {
  if (!tkCurrentSession) return;
  const now = Date.now();
  const durationSec = Math.floor((now - tkCurrentSession.start) / 1000);
  if (durationSec > 0) {
    tkAddToStats(tkCurrentSession.domain, durationSec, tkCurrentSession.url);
  }
  tkCurrentSession = null;
  await tkFlushStats();
}

function tkAddToStats(domain, seconds, url) {
  const dateKey = tkTodayKey();
  if (!tkInMemoryStats[dateKey]) tkInMemoryStats[dateKey] = {};
  if (!tkInMemoryStats[dateKey][domain]) {
    tkInMemoryStats[dateKey][domain] = {
      seconds: 0,
      visits: 0,
      pages: {}
    };
  }
  const entry = tkInMemoryStats[dateKey][domain];
  entry.seconds += seconds;
  entry.visits += 1;
  entry.pages[url] = (entry.pages[url] || 0) + seconds;
}

async function tkFlushStats() {
  const memKeys = Object.keys(tkInMemoryStats);
  if (!memKeys.length) return;

  const existingStats = await tkGetSiteStats();
  for (const dateKey of memKeys) {
    existingStats[dateKey] = existingStats[dateKey] || {};
    const dayMem = tkInMemoryStats[dateKey];
    for (const domain of Object.keys(dayMem)) {
      if (!existingStats[dateKey][domain]) {
        existingStats[dateKey][domain] = {
          seconds: 0,
          visits: 0,
          pages: {}
        };
      }
      const target = existingStats[dateKey][domain];
      const src = dayMem[domain];
      target.seconds += src.seconds;
      target.visits += src.visits;
      for (const url of Object.keys(src.pages)) {
        target.pages[url] = (target.pages[url] || 0) + src.pages[url];
      }
    }
  }

  tkInMemoryStats = {};
  await tkSetSiteStats(existingStats);
}