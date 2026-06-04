// ============================================================================
// On-device split history (P3) — "Recent splits" with zero backend/accounts.
// Stored per-browser; lets a host resume or revisit recent splits they hosted.
// ============================================================================
const KEY = 'stc_history_v1';
const MAX = 10;

export function getHistory() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

// Upsert a hosted split into history (keyed by sessionId).
export function recordSplit({ sessionId, hostName, currency, total, guests }) {
  if (!sessionId) return;
  try {
    const list = getHistory().filter(s => s.id !== sessionId);
    list.unshift({
      id: sessionId,
      hostName: hostName || '',
      currency: currency || 'USD',
      total: Number(total) || 0,
      guests: Number(guests) || 0,
      updatedAt: Date.now(),
    });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch { /* ignore */ }
}

export function removeSplit(sessionId) {
  try {
    localStorage.setItem(KEY, JSON.stringify(getHistory().filter(s => s.id !== sessionId)));
  } catch { /* ignore */ }
}
