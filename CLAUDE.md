# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Split the Check is a real-time collaborative bill-splitting web app. A host scans a receipt (parsed by Claude AI), guests join via QR code or link, each guest claims their items, and the app generates a Venmo deep link for payment. The app is mobile-first (max-width 480px).

## Repository Structure

```
client/   React 19 + Vite frontend
server/   Express 5 + Socket.io + Anthropic SDK backend
```

## Development Commands

**Client** (from `client/`):
```bash
npm run dev      # Vite dev server on port 5173
npm run build    # Production build
npm run lint     # ESLint
npm run preview  # Preview production build
```

**Server** (from `server/`):
```bash
npm start        # node index.js on port 3001
```

The client's Vite dev server proxies `/api` and `/socket.io` to `http://localhost:3001`, so both processes must run concurrently during development.

**Required environment variable** — create `server/.env`:
```
ANTHROPIC_API_KEY=your_key_here
```

## Architecture

### Frontend State: SessionContext

All app state lives in `client/src/context/SessionContext.jsx` via `useReducer`. Every page imports `useSession()` from this context. The state shape is:

```js
{
  hostName, venmoHandle,
  items: [{ id, name, price, claims: [{ guestName, splitCount }], dispute }],
  subtotal, tax, tipPercent, tipMode, tipDollar, tipIncluded, tipAmount, adminFee,
  sessionId, guests: [{ name, joinedAt }],
  currentUser: { name, isHost },
  payments: [{ guestName, amount, paid }]
}
```

The context also exports `calculatePersonTotal(state, personName)` which computes a guest's share of items + proportional tax/tip/adminFee.

### Real-time Sync: Socket.io

`client/src/socket.js` exports a singleton socket instance. Pages emit events and listen for server broadcasts to keep all participants in sync. The server holds the authoritative session state in an in-memory `Map`; clients receive full or partial state updates via socket events.

Key socket event pairs (client emits → server broadcasts):
- `create-session` / `session-state`
- `join-session` / `guest-joined` + `session-state`
- `claim-item` / `item-claimed`
- `unclaim-item` / `item-unclaimed`
- `dispute-item` / `item-disputed`
- `mark-paid` / `payment-updated`

### User Flow (Route Order)

1. `/` — Host enters name + Venmo handle (verified via `/api/verify-venmo`)
2. `/scan` — Host uploads receipt image → `/api/scan-receipt` (Claude AI extracts items as JSON)
3. `/review` — Host edits items, sets tax/admin fee
4. `/tip` — Host sets tip mode (percent or dollar), generates 6-char `sessionId`, creates socket session
5. `/session/:sessionId` — Guests enter their name and join
6. `/claim/:sessionId` — Guests tap items to claim; shared items prompt for split count
7. `/host/:sessionId` — Host monitors claims in real time, marks payments
8. `/summary/:sessionId` — Guest sees itemized total + Venmo payment deep link

### Backend: `server/index.js`

Single-file Express + Socket.io server. Notable details:
- Sessions are in-memory (`Map`); they auto-expire after 4 hours via `setInterval`.
- Receipt scanning calls `claude-sonnet-4-20250514` with the image as base64. It retries up to 3 times with exponential backoff on 529 errors.
- Venmo verification scrapes the public Venmo profile HTML (no API key needed).
- `POST /api/scan-receipt` accepts `{ imageData: "<base64>", mimeType: "image/jpeg" }` and returns `{ items, tax, tipIncluded, tipAmount, adminFee }`.

### Claim & Dispute Logic

- An item with `splitCount = 1` is locked — no other guest can claim it.
- An item with `splitCount > 1` (shared) is open for additional claimers.
- Any guest can dispute a single-claimed item; the original claimer sees the dispute and can release it, at which point the disputer auto-claims.
- `calculatePersonTotal` divides each item's price by `splitCount` across all claimers for proportional cost.

## Key Conventions

- **No test suite** — there are no tests; the `npm test` script in `server/` is a placeholder.
- **CSS custom properties** — all colors and spacing use variables defined at the top of `client/src/index.css` (e.g., `--accent: #e8553d`, `--bg`, `--surface`, `--text`). New styles should use these tokens.
- **CommonJS vs ESM** — the server uses CommonJS (`require`/`module.exports`); the client uses ESM (`import`/`export`). Do not mix them.
- **No component library** — all UI is hand-rolled with plain CSS utility classes defined in `index.css` (`.mt-*`, `.mb-*`, `.gap-*`, `.flex-col`, `.text-*`, button variants `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-venmo`).
