function downloadFile(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function buildCsv(siteStats) {
    const rows = [['date', 'domain', 'seconds', 'visits']];
    for (const [date, domains] of Object.entries(siteStats || {})) {
        for (const [domain, info] of Object.entries(domains || {})) {
            rows.push([
                date,
                domain,
                info.seconds || 0,
                info.visits || 0
            ]);
        }
    }
    return rows.map((r) => r.join(',')).join('\n');
}

async function getAllData() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'TK_EXPORT_ALL' }, resolve);
    });
}

async function getSettings() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'TK_GET_SETTINGS' }, resolve);
    });
}

async function setSettings(settings) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'TK_SET_SETTINGS', settings }, resolve);
    });
}

/* ---------- Usage rendering helpers ---------- */

function formatSeconds(totalSec) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return [
        h.toString().padStart(2, '0'),
        m.toString().padStart(2, '0'),
        s.toString().padStart(2, '0')
    ].join(':');
}

// Aggregate across all days: { date -> { domain -> info } } => { domain -> totals }
function computeDomainTotals(siteStats) {
    const totals = {};
    for (const [, domains] of Object.entries(siteStats || {})) {
        for (const [domain, info] of Object.entries(domains || {})) {
            if (!totals[domain]) {
                totals[domain] = { seconds: 0, visits: 0 };
            }
            totals[domain].seconds += info.seconds || 0;
            totals[domain].visits += info.visits || 0;
        }
    }
    return totals;
}

// Use a favicon service so we don't need to store icons ourselves
function getFaviconUrl(domain) {
    // DuckDuckGo icon service; works for most domains
    return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
}

// Get date key for N days ago
function getDateKey(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().slice(0, 10);
}

// Aggregate stats by domain across selected date range
function aggregateStatsByRange(siteStats, rangeType) {
    const totals = {};
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

function renderUsageGrid(siteStats, rangeType, sortBy, searchTerm) {
    const container = document.getElementById('usageGrid');
    if (!container) return;

    // Aggregate by range
    const aggregated = aggregateStatsByRange(siteStats, rangeType);
    let entries = Object.entries(aggregated);

    // Filter and sort
    entries = filterAndSortEntries(entries, searchTerm, sortBy);

    container.innerHTML = '';

    if (!entries.length) {
        const p = document.createElement('p');
        p.className = 'empty-state';
        p.textContent =
            'No usage data yet. Browse as usual and return here to see your top sites.';
        container.appendChild(p);
        return;
    }

    const maxSec =
        entries.reduce((max, [, info]) => Math.max(max, info.seconds || 0), 0) || 1;

    entries.forEach(([domain, info]) => {
        const seconds = info.seconds || 0;
        const visits = info.visits || 0;
        const pct = Math.max(4, Math.round((seconds / maxSec) * 100));

        const card = document.createElement('div');
        card.className = 'usage-card';

        const faviconUrl = getFaviconUrl(domain);

        card.innerHTML = `
      <div class="usage-card-main">
        <div class="usage-card-left">
          <div class="site-icon-wrapper">
            <img
              src="${faviconUrl}"
              alt=""
              class="site-icon"
              onerror="this.classList.add('site-icon--hidden')"
            />
          </div>
          <div class="site-meta">
            <div class="site-domain" title="${domain}">${domain}</div>
            <div class="site-sub">${visits} visit${visits === 1 ? '' : 's'}</div>
          </div>
        </div>
        <div class="usage-time">${formatSeconds(seconds)}</div>
      </div>
      <div class="usage-bar-outer">
        <div class="usage-bar-inner" style="width:${pct}%"></div>
      </div>
    `;

        container.appendChild(card);
    });
}

/* ---------- Init ---------- */

async function init() {
    const idleInput = document.getElementById('idleTimeout');
    const saveBtn = document.getElementById('saveBtn');
    const statusEl = document.getElementById('status');
    const exportJsonBtn = document.getElementById('exportJsonBtn');
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    const importFile = document.getElementById('importFile');
    const usageTimeRangeSelect = document.getElementById('usageTimeRange');
    const usageSortBySelect = document.getElementById('usageSortBy');
    const usageSearchBox = document.getElementById('usageSearchBox');

    // Load settings
    const settingsResp = await getSettings();
    const settings = settingsResp.settings;
    idleInput.value = settings.idleTimeoutSeconds || 60;

    saveBtn.addEventListener('click', async () => {
        const idleVal = parseInt(idleInput.value, 10) || 60;
        await setSettings({ idleTimeoutSeconds: idleVal });
        statusEl.textContent = 'Saved!';
        statusEl.style.color = '#16a34a';
        setTimeout(() => (statusEl.textContent = ''), 1500);
    });

    // Export / Import
    exportJsonBtn.addEventListener('click', async () => {
        const all = await getAllData();
        downloadFile(
            'timekeeper-export.json',
            JSON.stringify(all.data, null, 2),
            'application/json'
        );
    });

    exportCsvBtn.addEventListener('click', async () => {
        const all = await getAllData();
        const csv = buildCsv(all.data.siteStats || {});
        downloadFile('timekeeper-export.csv', csv, 'text/csv');
    });

    importFile.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        try {
            const data = JSON.parse(text);
            await chrome.storage.local.set(data);
            statusEl.textContent = 'Imported!';
            statusEl.style.color = '#16a34a';
            setTimeout(() => (statusEl.textContent = ''), 1500);
        } catch (err) {
            console.error(err);
            statusEl.textContent = 'Import failed (invalid JSON)';
            statusEl.style.color = 'red';
            setTimeout(() => {
                statusEl.textContent = '';
                statusEl.style.color = '#16a34a';
            }, 2000);
        }
    });

    // Load usage data
    const all = await getAllData();
    const siteStats = all.data.siteStats || {};

    // Render function (called on filter/sort/range change)
    function updateUsageDisplay() {
        const rangeType = usageTimeRangeSelect.value;
        const sortBy = usageSortBySelect.value;
        const searchTerm = usageSearchBox.value;
        renderUsageGrid(siteStats, rangeType, sortBy, searchTerm);
    }

    // Initial render
    updateUsageDisplay();

    // Event listeners for usage controls
    usageTimeRangeSelect.addEventListener('change', updateUsageDisplay);
    usageSortBySelect.addEventListener('change', updateUsageDisplay);
    usageSearchBox.addEventListener('input', updateUsageDisplay);
}

document.addEventListener('DOMContentLoaded', init);