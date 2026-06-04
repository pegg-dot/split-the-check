# CLAUDE.md — Split the Check

> Standalone project. **Not** related to any other repo. Open it on its own:
> `cd /Users/natepegg/split-the-check && claude`

## What this is
A real-time bill-splitting web app. A host snaps a photo of a restaurant receipt → Claude vision
itemizes it → friends scan a QR to join live → each person taps what they ordered → tax/tip/discount
split proportionally → everyone pays the host on Venmo. No accounts, no app install.

## Stack
- **client/** — React 19 + Vite (port 5173 in dev). State in one `SessionContext` (useReducer) with
  localStorage persistence. Real-time via socket.io-client.
- **server/** — Node + Express + Socket.IO (port 3001). Persistent session store (`server/store.js`,
  JSON file under `DATA_DIR`, default `./data`). Claude vision for receipt OCR.
- Prod: `NODE_ENV=production` makes Express serve the built client on one origin. Railway-ready
  (`railway.toml`).

## Run it
```bash
cd server && npm install && npm start      # :3001  (needs ANTHROPIC_API_KEY for scanning)
cd client && npm install && npm run dev    # :5173
```
The Anthropic key lives in `server/.env` (gitignored) as `ANTHROPIC_API_KEY=...`. Without it,
scanning is disabled but manual entry still works. On Railway, set the key in Variables (not a file).

## Test
```bash
cd server && npm test                  # node:test — money math, sanitize, rate limiter, prune
cd client && npm test                  # vitest — per-person totals + discount parity
node server/scripts/smoke.cjs 3001     # end-to-end socket smoke vs a running server
```

## Architecture notes
- **Money math is the riskiest surface.** Canonical logic lives in `client/src/context/SessionContext.jsx`
  (`calculatePersonTotal`, `calculateAllPersonTotals`, `calculateUnaccounted`) and is mirrored server-side
  in `server/lib/totals.js` for summaries/tests. Uses largest-remainder distribution so per-person
  amounts sum EXACTLY to the bill (tax, adminFee, tip, and discount all distributed proportionally).
  If you touch one, update BOTH and the tests.
- **Identity:** sockets are bound to one name server-side (`socketMeta`) so guests can't act as others;
  duplicate names are rejected; names are sanitized (`server/lib/sanitize.js`).
- **Payments are two-state:** guest-asserted `paid` vs host-`confirmed` (Venmo has no API to verify).
  A pay-time `paidTotal` snapshot powers the "your total changed after you paid" flag.
- **Scan output is sanitized server-side** (`sanitizeScan`) — coerces numbers, captures printed `total`
  + `discount`, guards tax-included double-counting. The Review screen reconciles against the printed total.
- **Durability:** sessions persist to disk and survive restarts; TTL refreshes on activity; sessions
  with an unpaid balance are never auto-pruned.

## Conventions
- Keep visual tokens consistent with the existing inline-style system (accent, success, warning vars).
- No texts/emails by product choice — automations live in-app (reminders use the native share/SMS sheet).
- This is a fork of `Jackson-Pegg/split-the-check`; the hardening work lives on branch `harden/p0-p4`.
  `upstream` = Jackson's repo, `origin` = this fork (`pegg-dot/split-the-check`).
