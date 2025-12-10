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
  return rows.map(r => r.map(String).join(',')).join('\n');
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

async function init() {
  const idleInput = document.getElementById('idleTimeout');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const importFile = document.getElementById('importFile');

  const settingsResp = await getSettings();
  const settings = settingsResp.settings;
  idleInput.value = settings.idleTimeoutSeconds || 60;

  saveBtn.addEventListener('click', async () => {
    const idleVal = parseInt(idleInput.value, 10) || 60;
    await setSettings({ idleTimeoutSeconds: idleVal });
    statusEl.textContent = 'Saved!';
    setTimeout(() => (statusEl.textContent = ''), 1500);
  });

  exportJsonBtn.addEventListener('click', async () => {
    const all = await getAllData();
    downloadFile('timekeeper-export.json', JSON.stringify(all.data, null, 2), 'application/json');
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
      setTimeout(() => (statusEl.textContent = ''), 1500);
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'Import failed (invalid JSON)';
      statusEl.style.color = 'red';
      setTimeout(() => {
        statusEl.textContent = '';
        statusEl.style.color = 'green';
      }, 2000);
    }
  });
}

document.addEventListener('DOMContentLoaded', init);