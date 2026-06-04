const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Point the store at a throwaway dir before requiring it.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stc-prune-'));
process.env.SESSION_TTL_MS = '1000'; // 1s TTL for the test
const store = require('../store');

test('pruneExpired removes an old session but KEEPS one shouldKeep() protects', () => {
  store.load();
  const old = Date.now() - 5000; // older than the 1s TTL

  // saveSession stamps updatedAt=now, so age the records afterward (same refs).
  const a = { id: 'expired' }; store.saveSession(a); a.updatedAt = old;
  const b = { id: 'owes' };    store.saveSession(b); b.updatedAt = old;

  // Keep only the one with an "outstanding balance".
  const removed = store.pruneExpired(Date.now(), (s) => s.id === 'owes');

  assert.strictEqual(removed, 1);
  assert.strictEqual(store.getSession('expired'), null);
  assert.ok(store.getSession('owes'), 'session with balance must survive past TTL');
});
