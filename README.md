# Split the Check

Snap the receipt → AI itemizes it → friends scan a QR to join live → each person taps what they
ordered → tax & tip split fairly → everyone pays the host on Venmo. No app install, no math.

**Stack:** React 19 + Vite (client) · Node + Express + Socket.IO (server) · Claude vision (receipt OCR) · Venmo deep links.

## Run locally

```bash
# server (port 3001)
cd server && npm install && npm start          # needs ANTHROPIC_API_KEY for scanning (see below)

# client (port 5173) — in a second terminal
cd client && npm install && npm run dev
```

Open http://localhost:5173. Guests on the same WiFi can scan the QR (the server resolves your LAN IP).

## Production (single URL)

`NODE_ENV=production` makes Express serve the built client, so the API, the app, and Socket.IO all
share one origin. Railway config is in `railway.toml` (`npm run build` then `node server/index.js`).

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | for AI scan | Receipt OCR. Without it, scanning returns a clear message and manual entry still works. |
| `PORT` | no | Server port (default 3001). |
| `DATA_DIR` | recommended in prod | Where sessions persist. **On Railway, point this at a mounted Volume (e.g. `/data`) for durability across redeploys.** Default: `./data`. |
| `SESSION_TTL_MS` | no | Session lifetime, refreshed on activity (default 24h). |
| `SCAN_MAX_PER_MIN` / `SCAN_MAX_PER_DAY` | no | Rate limits on the AI endpoint (defaults 6/min per IP, 500/day global). |
| `RESEND_API_KEY` / `FROM_EMAIL` | no | Enables the optional "email summary" feature. Without it, email is a graceful no-op. |

## Tests

```bash
cd server && npm test     # money math, scan sanitization, rate limiter (node:test)
cd client && npm test     # client calc functions (vitest)
node server/scripts/smoke.cjs <port>   # manual end-to-end socket test against a running server
```

## Hardening notes (what this branch adds)

This branch makes the app real for strangers-at-a-table, not just a happy-path demo. Highlights:

- **Money truth:** the host dashboard + scan flow now surface the **exact unclaimed dollar amount** so
  the host never silently eats an unsplit item. (Split *logic* is unchanged — we only warn.)
- **Honest payments:** tapping "Pay on Venmo" no longer marks you paid pre-emptively. Two states now
  exist — guest-asserted **"paid"** vs host-confirmed **"confirmed."**
- **Cost safety:** the unauthenticated AI scan endpoint is rate-limited (per-IP + global daily cap).
- **Durability:** sessions persist to disk and survive restarts/crashes; TTL refreshes on activity.
- **Integrity:** sockets are bound to one identity (guests can't act as someone else); duplicate names
  are rejected so two "Alex"es can't merge.
- **Resilience:** scanned numbers are sanitized server-side (no NaN can poison a bill); Venmo has a
  desktop **web fallback**; AI-disabled / rate-limited states degrade to manual entry.
- **Convenience:** on-device "Recent splits" history, resume-after-refresh, "remind unpaid guests"
  (native share/SMS — no provider needed), optional email summary seam.
