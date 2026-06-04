// ============================================================================
// Persistent session store
// ----------------------------------------------------------------------------
// Replaces the old in-memory `Map` so sessions survive a server restart / crash
// / redeploy. Pluggable by design: today it's a JSON file with an in-memory
// cache and atomic, debounced writes (zero native deps, works anywhere). Swap
// the read/write internals for SQLite/Redis/Postgres later without touching
// callers.
//
// Durability notes:
//   • Local dev: fully durable across restarts.
//   • Railway/containers: the default path lives on the container filesystem,
//     which survives process restarts/crashes but is reset on redeploy unless a
//     persistent Volume is mounted. Set DATA_DIR to the volume mount path
//     (e.g. /data) for full cross-redeploy durability.
// ============================================================================
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'sessions.json');
const TMP_FILE = DATA_FILE + '.tmp';

// Sessions older than this (since last activity) are pruned.
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 24 * 60 * 60 * 1000; // 24h

/** @type {Map<string, object>} */
const cache = new Map();

let writeTimer = null;
let writePending = false;

function ensureDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error('[store] Could not create data dir:', err.message);
  }
}

// ---- Load existing sessions on boot -----------------------------------------
function load() {
  ensureDir();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const obj = JSON.parse(raw);
      let loaded = 0;
      for (const [id, session] of Object.entries(obj || {})) {
        cache.set(id, session);
        loaded++;
      }
      console.log(`[store] Loaded ${loaded} session(s) from disk`);
    }
  } catch (err) {
    console.error('[store] Failed to load sessions (starting empty):', err.message);
  }
  // Prune anything already expired at boot.
  pruneExpired();
}

// ---- Atomic, debounced persistence ------------------------------------------
function flush() {
  writeTimer = null;
  if (!writePending) return;
  writePending = false;
  ensureDir();
  try {
    const obj = Object.fromEntries(cache);
    fs.writeFileSync(TMP_FILE, JSON.stringify(obj));
    fs.renameSync(TMP_FILE, DATA_FILE); // atomic on same filesystem
  } catch (err) {
    console.error('[store] Persist failed:', err.message);
  }
}

function scheduleWrite() {
  writePending = true;
  if (writeTimer) return;
  // Debounce bursts of claim/unclaim events into a single write.
  writeTimer = setTimeout(flush, 250);
  if (writeTimer.unref) writeTimer.unref();
}

// ---- Public API -------------------------------------------------------------
function getSession(sessionId) {
  return cache.get(sessionId) || null;
}

function hasSession(sessionId) {
  return cache.has(sessionId);
}

/** Persist a session object (call after mutating one returned by getSession). */
function saveSession(session) {
  if (!session || !session.id) return;
  session.updatedAt = Date.now();
  cache.set(session.id, session);
  scheduleWrite();
  return session;
}

/** Bump last-activity so an active session isn't pruned mid-dinner. */
function touchSession(sessionId) {
  const s = cache.get(sessionId);
  if (s) {
    s.updatedAt = Date.now();
    scheduleWrite();
  }
  return s;
}

function deleteSession(sessionId) {
  if (cache.delete(sessionId)) scheduleWrite();
}

function allSessions() {
  return Array.from(cache.values());
}

/** Remove sessions whose last activity is older than the TTL. Returns count. */
function pruneExpired(now = Date.now()) {
  let removed = 0;
  for (const [id, session] of cache) {
    const last = session.updatedAt || session.createdAt || 0;
    if (now - last > SESSION_TTL_MS) {
      cache.delete(id);
      removed++;
    }
  }
  if (removed > 0) scheduleWrite();
  return removed;
}

// Best-effort flush on shutdown so the last few events aren't lost.
function flushSync() {
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  writePending = true;
  flush();
}
process.on('SIGINT', () => { flushSync(); process.exit(0); });
process.on('SIGTERM', () => { flushSync(); process.exit(0); });

module.exports = {
  load,
  getSession,
  hasSession,
  saveSession,
  touchSession,
  deleteSession,
  allSessions,
  pruneExpired,
  flushSync,
  SESSION_TTL_MS,
  DATA_FILE,
};
