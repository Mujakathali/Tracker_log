const TK_STORAGE_KEYS = {
  SITE_STATS: 'siteStats',
  SETTINGS: 'settings',
  LAST_ACTIVE: 'lastActive'
};

const TK_DEFAULT_SETTINGS = {
  timeGranularity: 'seconds',
  trackingPaused: false,
  dailyResetHour: 0,
  cloudSyncEnabled: false,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  idleTimeoutSeconds: 60,
  retentionDays: 90
};

async function tkGetAll() {
  return await chrome.storage.local.get(null);
}

async function tkGetSiteStats() {
  const data = await chrome.storage.local.get([TK_STORAGE_KEYS.SITE_STATS]);
  return data[TK_STORAGE_KEYS.SITE_STATS] || {};
}

async function tkSetSiteStats(siteStats) {
  await chrome.storage.local.set({ [TK_STORAGE_KEYS.SITE_STATS]: siteStats });
}

async function tkGetSettings() {
  const data = await chrome.storage.local.get([TK_STORAGE_KEYS.SETTINGS]);
  return { ...TK_DEFAULT_SETTINGS, ...(data[TK_STORAGE_KEYS.SETTINGS] || {}) };
}

async function tkSetSettings(settings) {
  await chrome.storage.local.set({ [TK_STORAGE_KEYS.SETTINGS]: settings });
}

async function tkGetLastActive() {
  const data = await chrome.storage.local.get([TK_STORAGE_KEYS.LAST_ACTIVE]);
  return data[TK_STORAGE_KEYS.LAST_ACTIVE] || null;
}

async function tkSetLastActive(lastActive) {
  await chrome.storage.local.set({ [TK_STORAGE_KEYS.LAST_ACTIVE]: lastActive });
}