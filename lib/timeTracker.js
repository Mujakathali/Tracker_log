// Core time tracking helpers used by background.js

function tkTodayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC-based)
}

function tkParseDomain(url) {
  try {
    return new URL(url).hostname || 'unknown';
  } catch {
    return 'unknown';
  }
}

function tkFormatSeconds(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [
    h.toString().padStart(2, '0'),
    m.toString().padStart(2, '0'),
    s.toString().padStart(2, '0')
  ].join(':');
}