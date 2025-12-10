// Helpers
function formatSeconds(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h.toString().padStart(2, '0')}:` +
        `${m.toString().padStart(2, '0')}:` +
        `${s.toString().padStart(2, '0')}`;
}

function getFaviconUrl(domain) {
    return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
}

function getTodayKey() {
    return new Date().toISOString().slice(0, 10);
}

function getDateKey(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().slice(0, 10);
}

// Message helpers
async function loadStats() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'TK_GET_TODAY_STATS' }, resolve);
    });
}

async function loadAllData() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'TK_EXPORT_ALL' }, resolve);
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

// Aggregate stats by domain across selected date range
function aggregateStatsByRange(siteStats, rangeType) {
    const totals = {};
    const today = getTodayKey();

    let daysToInclude = 1; // today
    if (rangeType === '7days') daysToInclude = 7;
    else if (rangeType === '30days') daysToInclude = 30;
    else if (rangeType === 'all') daysToInclude = 999; // effectively all

    for (let i = 0; i < daysToInclude; i++) {
        const dateKey = getDateKey(i);
        const dayData = siteStats[dateKey] || {};
        for (const [domain, info] of Object.entries(dayData)) {
            if (!totals[domain]) {
                totals[domain] = { seconds: 0, visits: 0 };
            }
            totals[domain].seconds += info.seconds || 0;
            totals[domain].visits += info.visits || 0;
        }
    }

    return totals;
}

// Filter and sort entries
function filterAndSortEntries(entries, searchTerm, sortBy) {
    let filtered = entries;

    // Filter by search term
    if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        filtered = entries.filter(([domain]) => domain.toLowerCase().includes(term));
    }

    // Sort
    if (sortBy === 'time-desc') {
        filtered.sort((a, b) => (b[1].seconds || 0) - (a[1].seconds || 0));
    } else if (sortBy === 'time-asc') {
        filtered.sort((a, b) => (a[1].seconds || 0) - (b[1].seconds || 0));
    } else if (sortBy === 'name-asc') {
        filtered.sort((a, b) => a[0].localeCompare(b[0]));
    } else if (sortBy === 'visits-desc') {
        filtered.sort((a, b) => (b[1].visits || 0) - (a[1].visits || 0));
    }

    return filtered;
}

// Render site cards
function renderSites(entries, siteListEl, emptyStateEl) {
    siteListEl.innerHTML = '';

    if (!entries.length) {
        emptyStateEl.style.display = 'block';
        return;
    }

    emptyStateEl.style.display = 'none';

    entries.forEach(([domain, info]) => {
        const card = document.createElement('div');
        card.className = 'site-card';

        const faviconUrl = getFaviconUrl(domain);
        const seconds = info.seconds || 0;
        const visits = info.visits || 0;

        card.innerHTML = `
      <div class="site-icon-wrapper">
        <img
          src="${faviconUrl}"
          alt=""
          class="site-icon"
          onerror="this.classList.add('site-icon--hidden')"
        />
      </div>
      <div class="site-info">
        <div class="site-domain" title="${domain}">${domain}</div>
        <div class="site-meta">
          <span class="site-visits">${visits} visit${visits === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div class="site-time">${formatSeconds(seconds)}</div>
    `;

        siteListEl.appendChild(card);
    });
}

// Main init
async function init() {
    const pauseBtn = document.getElementById('pauseBtn');
    const totalTimeEl = document.getElementById('totalTime');
    const statusEl = document.getElementById('status');
    const siteListEl = document.getElementById('siteList');
    const emptyStateEl = document.getElementById('emptyState');
    const timeRangeSelect = document.getElementById('timeRange');
    const sortBySelect = document.getElementById('sortBy');
    const searchBox = document.getElementById('searchBox');
    const openOptionsBtn = document.getElementById('openOptionsBtn');

    // Load data
    const [statsResp, settingsResp, allDataResp] = await Promise.all([
        loadStats(),
        loadSettings(),
        loadAllData()
    ]);

    const settings = settingsResp.settings;
    const siteStats = allDataResp.data.siteStats || {};

    // Update pause button and status
    pauseBtn.textContent = settings.trackingPaused ? 'Resume' : 'Pause';
    statusEl.textContent = settings.trackingPaused ? 'Paused' : 'Tracking';

    // Render function (called on filter/sort/range change)
    function updateDisplay() {
        const rangeType = timeRangeSelect.value;
        const sortBy = sortBySelect.value;
        const searchTerm = searchBox.value;

        const aggregated = aggregateStatsByRange(siteStats, rangeType);
        let entries = Object.entries(aggregated);
        entries = filterAndSortEntries(entries, searchTerm, sortBy);

        // Update total time
        let totalSec = 0;
        for (const [, info] of Object.entries(aggregated)) {
            totalSec += info.seconds || 0;
        }
        totalTimeEl.textContent = formatSeconds(totalSec);

        // Render sites
        renderSites(entries, siteListEl, emptyStateEl);
    }

    // Initial render
    updateDisplay();

    // Event listeners
    timeRangeSelect.addEventListener('change', updateDisplay);
    sortBySelect.addEventListener('change', updateDisplay);
    searchBox.addEventListener('input', updateDisplay);

    pauseBtn.addEventListener('click', async () => {
        const currentPaused = pauseBtn.textContent === 'Pause';
        const resp = await setPaused(currentPaused);
        const newSettings = resp.settings;
        pauseBtn.textContent = newSettings.trackingPaused ? 'Resume' : 'Pause';
        statusEl.textContent = newSettings.trackingPaused ? 'Paused' : 'Tracking';
    });

    openOptionsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });
}

document.addEventListener('DOMContentLoaded', init);