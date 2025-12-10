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

/* ---------- Constraints & Stats ---------- */

async function getConstraints() {
    const data = await chrome.storage.local.get(['timeConstraints']);
    return data.timeConstraints || {};
}

async function setConstraints(constraints) {
    await chrome.storage.local.set({ timeConstraints: constraints });
}

async function getTodayUsage() {
    const all = await getAllData();
    const todayKey = getDateKey(0);
    const siteStats = all.data?.siteStats || {};
    const todayData = siteStats[todayKey] || {};
    const usage = {};
    for (const [domain, info] of Object.entries(todayData)) {
        usage[domain] = info.seconds || 0;
    }
    return usage;
}

function constraintStatus(constraint, usageSeconds) {
    const limitSeconds = constraint.limit * (constraint.unit === 'hours' ? 3600 : 60);
    if (!constraint.enabled) return 'paused';
    if (usageSeconds >= limitSeconds) return 'exceeded';
    if (usageSeconds >= limitSeconds * 0.8) return 'warning';
    return 'active';
}

function renderConstraints(constraints, usageMap) {
    const container = document.getElementById('constraintsList');
    if (!container) return;
    container.innerHTML = '';

    const entries = Object.entries(constraints);
    if (!entries.length) {
        container.innerHTML = `<div class="empty-state"><p>No time constraints yet. Add one below.</p></div>`;
        return;
    }

    entries.forEach(([domain, c]) => {
        const used = usageMap[domain] || 0;
        const limitSec = c.limit * (c.unit === 'hours' ? 3600 : 60);
        const pct = Math.min(100, Math.round((used / limitSec) * 100));
        const status = constraintStatus(c, used);

        const item = document.createElement('div');
        item.className = 'constraint-item';
        item.innerHTML = `
          <div class="constraint-header">
            <div class="constraint-domain">
              <img src="${getFaviconUrl(domain)}" alt="" class="constraint-icon" onerror="this.style.display='none'">
              <span>${domain}</span>
            </div>
            <div class="constraint-status ${status}">${status}</div>
          </div>
          <div class="constraint-progress">
            <div class="progress-bar">
              <div class="progress-fill ${status}" style="width:${pct}%"></div>
            </div>
            <div class="progress-text">${formatSeconds(used)} / ${c.limit} ${c.unit}</div>
          </div>
          <div class="constraint-controls">
            <div class="constraint-input-group">
              <input type="number" class="constraint-input" data-domain="${domain}" data-field="limit" min="1" max="24" value="${c.limit}">
              <select class="constraint-select" data-domain="${domain}" data-field="unit">
                <option value="minutes" ${c.unit === 'minutes' ? 'selected' : ''}>Minutes</option>
                <option value="hours" ${c.unit === 'hours' ? 'selected' : ''}>Hours</option>
              </select>
            </div>
            <div class="constraint-toggle ${c.enabled ? 'active' : ''}" data-domain="${domain}" data-field="enabled"></div>
            <button class="constraint-delete" data-domain="${domain}">Remove</button>
          </div>
        `;
        container.appendChild(item);
    });

    // Wire events
    container.querySelectorAll('.constraint-input').forEach((el) => {
        el.addEventListener('change', async (e) => {
            const domain = e.target.dataset.domain;
            const val = parseInt(e.target.value, 10) || 1;
            constraints[domain].limit = val;
            await setConstraints(constraints);
            const usage = await getTodayUsage();
            renderConstraints(constraints, usage);
        });
    });
    container.querySelectorAll('.constraint-select').forEach((el) => {
        el.addEventListener('change', async (e) => {
            const domain = e.target.dataset.domain;
            constraints[domain].unit = e.target.value;
            await setConstraints(constraints);
            const usage = await getTodayUsage();
            renderConstraints(constraints, usage);
        });
    });
    container.querySelectorAll('.constraint-toggle').forEach((el) => {
        el.addEventListener('click', async (e) => {
            const domain = e.target.dataset.domain;
            constraints[domain].enabled = !constraints[domain].enabled;
            await setConstraints(constraints);
            const usage = await getTodayUsage();
            renderConstraints(constraints, usage);
        });
    });
    container.querySelectorAll('.constraint-delete').forEach((el) => {
        el.addEventListener('click', async (e) => {
            const domain = e.target.dataset.domain;
            delete constraints[domain];
            await setConstraints(constraints);
            const usage = await getTodayUsage();
            renderConstraints(constraints, usage);
        });
    });
}

async function updateHeaderStats(siteStats) {
    const totals = computeDomainTotals(siteStats);
    const totalSites = Object.keys(totals).length;
    const totalTime = Object.values(totals).reduce((s, v) => s + (v.seconds || 0), 0);

    const todayKey = getDateKey(0);
    const todayTime = Object.values(siteStats[todayKey] || {}).reduce(
        (s, v) => s + (v.seconds || 0),
        0
    );

    const totalSitesEl = document.getElementById('totalSites');
    const totalTimeEl = document.getElementById('totalTime');
    const todayTimeEl = document.getElementById('todayTime');
    if (totalSitesEl) totalSitesEl.textContent = totalSites;
    if (totalTimeEl) totalTimeEl.textContent = formatSeconds(totalTime);
    if (todayTimeEl) todayTimeEl.textContent = formatSeconds(todayTime);
}

function showStatus(msg, type = 'success') {
    const statusEl = document.getElementById('status');
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = type === 'error' ? '#dc2626' : '#16a34a';
    setTimeout(() => {
        statusEl.textContent = '';
        statusEl.style.color = '#16a34a';
    }, 2000);
}

/* ---------- Init ---------- */

async function init() {
    const idleInput = document.getElementById('idleTimeout');
    const saveBtn = document.getElementById('saveBtn');
    const exportJsonBtn = document.getElementById('exportJsonBtn');
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    const importFile = document.getElementById('importFile');
    const usageTimeRangeSelect = document.getElementById('usageTimeRange');
    const usageSortBySelect = document.getElementById('usageSortBy');
    const usageSearchBox = document.getElementById('usageSearchBox');
    const addConstraintBtn = document.getElementById('addConstraintBtn');
    const constraintDomainSelect = document.getElementById('constraintDomainSelect');
    const constraintDomainInput = document.getElementById('constraintDomain');
    const constraintLimitInput = document.getElementById('constraintLimit');
    const constraintUnitSelect = document.getElementById('constraintUnit');

    // Track latest site stats in-memory for reuse
    let cachedSiteStats = {};

    // Settings
    const settingsResp = await getSettings();
    const settings = settingsResp.settings;
    if (idleInput) idleInput.value = settings.idleTimeoutSeconds || 60;

    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const idleVal = parseInt(idleInput.value, 10) || 60;
            await setSettings({ idleTimeoutSeconds: idleVal });
            showStatus('Settings saved');
        });
    }

    // Export / Import
    if (exportJsonBtn) {
        exportJsonBtn.addEventListener('click', async () => {
            const all = await getAllData();
            downloadFile('timekeeper-export.json', JSON.stringify(all.data, null, 2), 'application/json');
        });
    }
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', async () => {
            const all = await getAllData();
            const csv = buildCsv(all.data.siteStats || {});
            downloadFile('timekeeper-export.csv', csv, 'text/csv');
        });
    }
    if (importFile) {
        importFile.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                await chrome.storage.local.set(data);
                showStatus('Imported');
                await refreshAll();
            } catch (err) {
                console.error(err);
                showStatus('Import failed (invalid JSON)', 'error');
            }
        });
    }

    // Load and render
    async function refreshAll() {
        const all = await getAllData();
        cachedSiteStats = all.data.siteStats || {};
        await updateHeaderStats(cachedSiteStats);
        updateUsageDisplay(cachedSiteStats);
        const constraints = await getConstraints();
        const usage = await getTodayUsage();
        renderConstraints(constraints, usage);
        populateConstraintSelect(cachedSiteStats);
    }

    function updateUsageDisplay(siteStats) {
        const rangeType = usageTimeRangeSelect?.value || 'all';
        const sortBy = usageSortBySelect?.value || 'time-desc';
        const searchTerm = usageSearchBox?.value || '';
        renderUsageGrid(siteStats, rangeType, sortBy, searchTerm);
    }

    function populateConstraintSelect(siteStats) {
        if (!constraintDomainSelect) return;
        const totals = computeDomainTotals(siteStats);
        const domains = Object.keys(totals).sort();
        const current = constraintDomainSelect.value;
        constraintDomainSelect.innerHTML = '<option value=\"\">Select tracked site…</option>';
        domains.forEach((d) => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = `${d} (${formatSeconds(totals[d].seconds || 0)})`;
            constraintDomainSelect.appendChild(opt);
        });
        // restore selection if still present
        if (current && domains.includes(current)) {
            constraintDomainSelect.value = current;
        }
    }

    // Event listeners for usage controls
    usageTimeRangeSelect?.addEventListener('change', async () => {
        const all = await getAllData();
        updateUsageDisplay(all.data.siteStats || {});
    });
    usageSortBySelect?.addEventListener('change', async () => {
        const all = await getAllData();
        updateUsageDisplay(all.data.siteStats || {});
    });
    usageSearchBox?.addEventListener('input', async () => {
        const all = await getAllData();
        updateUsageDisplay(all.data.siteStats || {});
    });

    // Constraint add
    if (addConstraintBtn) {
        addConstraintBtn.addEventListener('click', async () => {
            const selected = constraintDomainSelect?.value || '';
            const typed = (constraintDomainInput?.value || '').trim();
            const domain = selected || typed;
            const limit = parseInt(constraintLimitInput?.value || '0', 10);
            const unit = constraintUnitSelect?.value || 'minutes';
            if (!domain || isNaN(limit) || limit <= 0) {
                showStatus('Enter a valid domain and limit', 'error');
                return;
            }
            const constraints = await getConstraints();
            constraints[domain] = { domain, limit, unit, enabled: true };
            await setConstraints(constraints);
            const usage = await getTodayUsage();
            renderConstraints(constraints, usage);
            if (constraintDomainInput) constraintDomainInput.value = '';
            if (constraintDomainSelect) constraintDomainSelect.value = '';
            if (constraintLimitInput) constraintLimitInput.value = '30';
            if (constraintUnitSelect) constraintUnitSelect.value = 'minutes';
            showStatus('Constraint added');
        });
    }

    // Initial draw + periodic refresh
    await refreshAll();
    setInterval(refreshAll, 60_000); // refresh every minute
}

document.addEventListener('DOMContentLoaded', init);