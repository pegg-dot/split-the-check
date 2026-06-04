const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const Anthropic = require('@anthropic-ai/sdk');

const store = require('./store');
const { createRateLimiter } = require('./lib/rate-limit');
const { sanitizeScan } = require('./lib/sanitize');
const { sendEmail, notifyEnabled } = require('./lib/notify');
const { calculateAllPersonTotals, hasOutstandingBalance } = require('./lib/totals');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const PORT = process.env.PORT || 3001;

// Behind Railway/other proxies so req.ip / x-forwarded-for resolve correctly
// (the rate limiter keys on real client IP).
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const anthropic = new Anthropic.default({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Load persisted sessions from disk on boot (survives restarts/crashes).
store.load();

// Periodic prune of expired sessions (TTL is refreshed on every activity).
// Keep a session past its TTL while it still has an unpaid balance — never
// auto-delete a tab where money is owed (up to the store's hard cap).
const prune = setInterval(() => {
  const removed = store.pruneExpired(Date.now(), hasOutstandingBalance);
  if (removed > 0) console.log(`[store] pruned ${removed} expired session(s)`);
}, 5 * 60 * 1000);
if (prune.unref) prune.unref();

// ===== Session helpers =====
function createSession(sessionId, hostName, venmoHandle, hostDisplayName) {
  const session = {
    id: sessionId,
    hostName,
    hostDisplayName: hostDisplayName || null, // verified Venmo display name
    venmoHandle,
    items: [],
    subtotal: 0,
    tax: 0,
    tipPercent: 18,
    guests: [],
    payments: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.saveSession(session);
  return session;
}

function getSession(sessionId) {
  return store.getSession(sessionId);
}

// ===== REST endpoints =====

// Rate limit the expensive, unauthenticated AI endpoint so a stranger who finds
// the URL can't run up the Anthropic bill.
const scanLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: Number(process.env.SCAN_MAX_PER_MIN) || 6,       // per IP / minute
  dailyMax: Number(process.env.SCAN_MAX_PER_DAY) || 500, // global / day
  name: 'scan',
});

// Verify Venmo account exists
app.post('/api/verify-venmo', async (req, res) => {
  try {
    const { handle } = req.body;
    if (!handle) {
      return res.status(400).json({ valid: false, error: 'No handle provided' });
    }

    // Clean up the handle
    let username = handle.trim();

    // If it looks like a phone number or email, we can't verify — accept it
    const isPhone = /^[\d\s\-\(\)\+]+$/.test(username);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username);
    if (isPhone || isEmail) {
      return res.json({ valid: true, type: isPhone ? 'phone' : 'email', note: 'Cannot verify phone/email — make sure this is linked to a Venmo account' });
    }

    // Strip @ if present
    if (username.startsWith('@')) {
      username = username.substring(1);
    }

    // Check Venmo public profile
    const response = await fetch(`https://account.venmo.com/u/${encodeURIComponent(username)}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
      redirect: 'follow',
    });

    if (response.ok) {
      const html = await response.text();
      // Check if the page has actual profile content vs a "not found" page
      // Venmo profile pages contain the display name in an og:title meta tag
      const hasProfile = html.includes('og:title') && !html.includes('Page Not Found');

      // Try to extract display name
      let displayName = null;
      const nameMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/);
      if (nameMatch && nameMatch[1] && !nameMatch[1].includes('Venmo')) {
        displayName = nameMatch[1];
      }

      if (hasProfile) {
        return res.json({ valid: true, type: 'username', username, displayName });
      } else {
        return res.json({ valid: false, type: 'username', error: `No Venmo account found for @${username}` });
      }
    } else if (response.status === 404) {
      return res.json({ valid: false, type: 'username', error: `No Venmo account found for @${username}` });
    } else {
      // If Venmo blocks us, don't block the user — accept it with a warning
      return res.json({ valid: true, type: 'username', username, note: 'Could not verify — please double-check your Venmo username' });
    }
  } catch (err) {
    console.error('Venmo verify error:', err.message);
    // Don't block the user if verification fails
    return res.json({ valid: true, note: 'Could not verify — please double-check your Venmo info' });
  }
});

app.post('/api/scan-receipt', scanLimiter, async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'Receipt scanning is unavailable right now. You can enter items manually.' });
    }

    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid image format' });
    }

    const mediaType = match[1];
    const base64Data = match[2];

    // Retry up to 3 times on overloaded errors
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: base64Data,
                  },
                },
                {
                  type: 'text',
                  text: `Extract line items and charges from this receipt. Return ONLY valid JSON, no other text:

{
  "items": [ { "name": "Item Name", "price": 12.99 } ],
  "tax": 0.00,
  "taxNote": "",
  "tipIncluded": false,
  "tipAmount": 0.00,
  "adminFee": 0.00,
  "currency": "USD"
}

ITEMS:
- If a line has quantity > 1 (e.g. "4 Estrella Galicia 18,00" or "2x Latte 9.00"), return ONE entry: {"name":"Estrella Galicia","price":18.00,"quantity":4,"unitPrice":4.50}. "price" = total for all units. "unitPrice" = price per single unit.
- If quantity is 1 (or not stated), return {"name":"Latte","price":4.50} — omit quantity/unitPrice.
- Do NOT include subtotal, tax, tip, service charge, or total lines as items.

TAX HANDLING — this is the most important rule:
There are two types of receipts:

TYPE 1 — Tax baked into item prices (European: VAT, IVA, MwSt, BTW, incl., inclusive, etc.):
  The item prices already include tax. The receipt may show a separate "Subtotal" (pre-tax) and a tax line, but the item prices themselves are post-tax.
  Signs: keywords IVA, VAT, incl., inclusive on the receipt; sum of item prices ≈ receipt TOTAL (not the pre-tax subtotal).
  Rule: Set "tax" = 0 and "taxNote" = "Tax included in item prices" (do NOT add it separately — it's already in the prices shown).

TYPE 2 — Tax added on top (US, Canada: Sales Tax, GST, HST):
  Item prices are pre-tax. Tax is a separate line that gets added to the subtotal.
  Signs: items sum ≈ Subtotal; tax line adds to reach Total.
  Rule: Set "tax" = the tax amount shown on the receipt.

DEFAULT to TYPE 2 (tax added on top) unless there is clear evidence of TYPE 1.

OTHER CHARGES:
- "adminFee" = service charge / admin fee / surcharge added on top of items (labels: Service Charge, S/C, SC, Service Fee, Admin Fee, Gratuity, Auto-Gratuity, Couvert, Propina). 0 if none.
- "tipIncluded" = true only if a discretionary tip/gratuity line is already on the bill.
- "tipAmount" = that pre-added tip amount. Do NOT double-count in both adminFee and tipAmount.
- "currency" = ISO code from the symbol: "USD" $, "EUR" €, "GBP" £, "JPY" ¥, "CAD" C$, "AUD" A$, "MXN" for Mexican peso. Default "USD".

FINAL CHECK: sum(items) + tax + adminFee + tipAmount must equal the receipt's printed TOTAL exactly (within rounding). If it doesn't, recheck your tax categorization.`,
                },
              ],
            },
          ],
        });

        const text = response.content[0].text.trim();

        let jsonStr = text;
        const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
          jsonStr = codeBlockMatch[1].trim();
        }

        const parsed = JSON.parse(jsonStr);

        // Coerce/validate all numbers server-side so the client never sees NaN.
        const data = sanitizeScan(parsed);

        if (!data.items.length) {
          return res.status(422).json({ error: 'No items found on the receipt. Try a clearer photo.' });
        }

        // If non-USD currency detected, fetch exchange rate to USD
        const currency = data.currency;
        let exchangeRate = 1;
        if (currency !== 'USD') {
          try {
            const rateRes = await fetch(`https://open.er-api.com/v6/latest/${currency}`);
            const rateData = await rateRes.json();
            if (rateData && rateData.rates && rateData.rates.USD) {
              exchangeRate = rateData.rates.USD;
            }
          } catch (e) {
            console.error('Exchange rate fetch failed, using fallback:', e.message);
            // Fallback static rates (approximate, updated 2026)
            const fallback = { EUR: 1.09, GBP: 1.27, JPY: 0.0067, CAD: 0.74, AUD: 0.66, CHF: 1.13, CNY: 0.14, INR: 0.012, MXN: 0.058 };
            exchangeRate = fallback[currency] || 1;
          }
        }
        data.exchangeRate = exchangeRate;
        return res.json(data);
      } catch (err) {
        lastError = err;
        console.error(`Receipt scan error (attempt ${attempt + 1}):`, err.message);
        // Only retry on overloaded (529) errors
        if (err.status === 529 && attempt < 2) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        break;
      }
    }
    res.status(500).json({ error: 'Failed to scan receipt. Please try again.' });
  } catch (err) {
    console.error('Receipt scan error:', err.message);
    res.status(500).json({ error: 'Failed to scan receipt. Please try again.' });
  }
});

// Return the server's LAN IP so clients can build mobile-friendly URLs
const os = require('os');
function getLanIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of (interfaces[name] || [])) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}
app.get('/api/server-ip', (req, res) => {
  res.json({ ip: getLanIP(), port: 5173 });
});

// Get session data (for initial load)
app.get('/api/session/:sessionId', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  store.touchSession(session.id); // viewing keeps it alive
  res.json(session);
});

// Optional: email a session summary (P3). Returns 202 (disabled) unless RESEND_API_KEY is set.
app.post('/api/session/:sessionId/email-summary', async (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { to } = req.body || {};
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return res.status(400).json({ error: 'Valid recipient email required' });
  }

  const { buildSummaryEmail } = require('./lib/summary-email');
  const { subject, html, text } = buildSummaryEmail(session);
  const result = await sendEmail({ to, subject, html, text });
  if (result.disabled) {
    return res.status(202).json({ ok: false, disabled: true, message: 'Email is not configured on this server.' });
  }
  return res.status(result.ok ? 200 : 502).json(result);
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    sessions: store.allSessions().length,
    aiEnabled: !!process.env.ANTHROPIC_API_KEY,
    emailEnabled: notifyEnabled,
  });
});

// ===== Socket.io real-time sync =====

// Bind each socket to a single identity so guests can only act as themselves
// (prevents spoofing other people's claims / payments via crafted payloads).
/** @type {Map<string, { sessionId: string, name: string, isHost: boolean }>} */
const socketMeta = new Map();

function nameTaken(session, name) {
  const lc = name.toLowerCase();
  if ((session.hostName || '').toLowerCase() === lc) return true;
  return session.guests.some(g => g.name.toLowerCase() === lc);
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Host creates a session
  socket.on('create-session', ({ sessionId, hostName, venmoHandle, hostDisplayName, items, subtotal, tax, tipPercent, tipMode, tipDollar, tipIncluded, tipAmount, adminFee, currency, exchangeRate }) => {
    let session = getSession(sessionId);
    if (!session) {
      session = createSession(sessionId, hostName, venmoHandle, hostDisplayName);
    }
    session.hostName = hostName ?? session.hostName;
    session.venmoHandle = venmoHandle ?? session.venmoHandle;
    if (hostDisplayName) session.hostDisplayName = hostDisplayName;
    session.items = items;
    session.subtotal = subtotal;
    session.tax = tax;
    if (tipPercent !== undefined) session.tipPercent = tipPercent;
    session.tipMode = tipMode || 'percent';
    session.tipDollar = tipDollar || 0;
    session.tipIncluded = tipIncluded || false;
    session.tipAmount = tipAmount || 0;
    session.adminFee = adminFee || 0;
    session.currency = currency || 'USD';
    session.exchangeRate = exchangeRate || 1;
    store.saveSession(session);
    socket.join(sessionId);
    socketMeta.set(socket.id, { sessionId, name: hostName, isHost: true });
    // Push the latest receipt/tip/items to anyone already in the room so guests
    // who joined early (or before a tip change) re-sync automatically.
    socket.to(sessionId).emit('session-updated', session);
    console.log(`Session ${sessionId} created by ${hostName}`);
  });

  // Rejoin socket room (for reconnects / page navigations)
  socket.on('rejoin-room', ({ sessionId, guestName, isHost }) => {
    const session = getSession(sessionId);
    if (session) {
      socket.join(sessionId);
      // Re-establish identity after a navigation/reconnect.
      if (guestName) {
        socketMeta.set(socket.id, { sessionId, name: guestName, isHost: !!isHost });
      }
    }
  });

  // Guest joins a session
  socket.on('join-session', ({ sessionId, guestName }) => {
    const session = getSession(sessionId);
    if (!session) {
      socket.emit('error', { message: 'Session not found' });
      return;
    }

    const name = (guestName || '').trim();
    if (!name) {
      socket.emit('error', { message: 'Please enter a name' });
      return;
    }

    // Reject duplicate names so two people can't merge into one set of claims.
    // (Allow the SAME socket to re-emit join with its own name — reconnect.)
    const existing = socketMeta.get(socket.id);
    const isReconnectingSameName = existing && existing.name.toLowerCase() === name.toLowerCase();
    if (!isReconnectingSameName && nameTaken(session, name)) {
      socket.emit('error', { message: `"${name}" is already taken at this table. Add a last initial (e.g. "${name} B.").` });
      return;
    }

    // Add guest if not already present
    if (!session.guests.find(g => g.name === name)) {
      session.guests.push({ name, joinedAt: Date.now() });
      store.saveSession(session);
    }

    socket.join(sessionId);
    socketMeta.set(socket.id, { sessionId, name, isHost: false });
    // Send current session state to the joining guest
    socket.emit('session-state', session);
    // Notify everyone that a new guest joined
    io.to(sessionId).emit('guest-joined', { name, guests: session.guests });
    console.log(`${name} joined session ${sessionId}`);
  });

  // Resolve the acting identity for a mutation. Falls back to the payload name
  // for older clients, but a bound (guest) identity always wins.
  function actorName(payloadName) {
    const meta = socketMeta.get(socket.id);
    if (meta && !meta.isHost) return meta.name; // guests locked to themselves
    return payloadName; // host (or unbound legacy socket) may act broadly
  }

  // Someone claims an item
  socket.on('claim-item', ({ sessionId, itemId, guestName, splitCount }) => {
    const session = getSession(sessionId);
    if (!session) return;
    const actor = actorName(guestName);
    if (!actor) return;

    const item = session.items.find(i => i.id === itemId);
    if (!item) return;
    if (!Array.isArray(item.claims)) item.claims = [];

    // Don't allow claiming if this person already claimed it
    const existingClaim = item.claims.find(c => c.guestName === actor);
    if (existingClaim) return;

    item.claims.push({ guestName: actor, splitCount });
    delete item.dispute;
    store.saveSession(session);
    io.to(sessionId).emit('item-claimed', { itemId, guestName: actor, splitCount, items: session.items });
  });

  // Someone unclaims an item
  socket.on('unclaim-item', ({ sessionId, itemId, guestName }) => {
    const session = getSession(sessionId);
    if (!session) return;
    const actor = actorName(guestName);
    if (!actor) return;

    const item = session.items.find(i => i.id === itemId);
    if (!item) return;
    if (!Array.isArray(item.claims)) item.claims = [];

    // If there's an active dispute, auto-assign to the disputer
    const dispute = item.dispute;
    item.claims = item.claims.filter(c => c.guestName !== actor);

    if (dispute && dispute.by !== actor) {
      // Auto-claim for the disputer
      item.claims.push({ guestName: dispute.by, splitCount: 1 });
      delete item.dispute;
      console.log(`Auto-assigned "${item.name}" to ${dispute.by} after ${actor} released`);
    } else {
      delete item.dispute;
    }

    store.saveSession(session);
    io.to(sessionId).emit('item-unclaimed', { itemId, guestName: actor, items: session.items });
  });

  // Someone disputes another person's claim
  socket.on('dispute-item', ({ sessionId, itemId, disputerName }) => {
    const session = getSession(sessionId);
    if (!session) return;
    const actor = actorName(disputerName);
    if (!actor) return;

    const item = session.items.find(i => i.id === itemId);
    if (!item) return;

    item.dispute = { by: actor };
    store.saveSession(session);
    console.log(`Dispute: ${actor} disputes item "${item.name}" in session ${sessionId}`);
    io.to(sessionId).emit('item-disputed', { itemId, disputerName: actor, items: session.items });
  });

  // Someone cancels their dispute
  socket.on('cancel-dispute', ({ sessionId, itemId, disputerName }) => {
    const session = getSession(sessionId);
    if (!session) return;
    const actor = actorName(disputerName);

    const item = session.items.find(i => i.id === itemId);
    if (!item) return;

    // Only the person who filed the dispute can cancel it
    if (item.dispute && item.dispute.by === actor) {
      delete item.dispute;
      store.saveSession(session);
      console.log(`Dispute cancelled: ${actor} withdrew dispute on "${item.name}" in session ${sessionId}`);
      io.to(sessionId).emit('dispute-cancelled', { itemId, items: session.items });
    }
  });

  // Guest shares an already-claimed item — updates all existing claimers' splitCount
  socket.on('share-item', ({ sessionId, itemId, guestName, splitCount }) => {
    const session = getSession(sessionId);
    if (!session) return;
    const actor = actorName(guestName);
    if (!actor) return;

    const item = session.items.find(i => i.id === itemId);
    if (!item) return;
    if (!Array.isArray(item.claims)) item.claims = [];

    // Guard: person already claimed this item
    if (item.claims.some(c => c.guestName === actor)) return;

    // Minimum splitCount = existing claimers + 1
    const minCount = item.claims.length + 1;
    const finalCount = Math.max(minCount, splitCount);

    // Update every existing claim to the new splitCount
    item.claims = item.claims.map(c => ({ ...c, splitCount: finalCount }));
    // Add this person's claim
    item.claims.push({ guestName: actor, splitCount: finalCount });
    delete item.dispute;

    store.saveSession(session);
    console.log(`${actor} shared "${item.name}" (${finalCount} ways) in session ${sessionId}`);
    io.to(sessionId).emit('item-claimed', { items: session.items });
  });

  // Claim N units from a quantity item (quantity > 1)
  socket.on('claim-units', ({ sessionId, itemId, guestName, units }) => {
    const session = getSession(sessionId);
    if (!session) return;
    const actor = actorName(guestName);
    if (!actor) return;
    const item = session.items.find(i => i.id === itemId);
    if (!item || (item.quantity || 1) <= 1) return;
    if (!Array.isArray(item.claims)) item.claims = [];

    const totalClaimed = item.claims.reduce((sum, c) => sum + (c.units || 0), 0);
    const available    = item.quantity - totalClaimed;
    const actualUnits  = Math.min(Math.max(1, units), available);
    if (actualUnits <= 0) return;

    const existing = item.claims.find(c => c.guestName === actor);
    if (existing) {
      existing.units = (existing.units || 0) + actualUnits;
    } else {
      item.claims.push({ guestName: actor, units: actualUnits });
    }
    delete item.dispute;
    store.saveSession(session);
    console.log(`${actor} claimed ${actualUnits} units of "${item.name}" in session ${sessionId}`);
    io.to(sessionId).emit('item-claimed', { items: session.items });
  });

  // Release a guest's unit claim
  socket.on('unclaim-units', ({ sessionId, itemId, guestName }) => {
    const session = getSession(sessionId);
    if (!session) return;
    const actor = actorName(guestName);
    if (!actor) return;
    const item = session.items.find(i => i.id === itemId);
    if (!item) return;
    if (!Array.isArray(item.claims)) item.claims = [];
    item.claims = item.claims.filter(c => c.guestName !== actor);
    store.saveSession(session);
    io.to(sessionId).emit('item-unclaimed', { items: session.items });
  });

  // Guest finished claiming
  socket.on('done-claiming', ({ sessionId, guestName }) => {
    const session = getSession(sessionId);
    if (!session) return;
    const actor = actorName(guestName);
    if (!actor) return;

    if (!session.doneClaiming) session.doneClaiming = [];
    if (!session.doneClaiming.includes(actor)) {
      session.doneClaiming.push(actor);
    }
    store.saveSession(session);
    io.to(sessionId).emit('claiming-update', { doneClaiming: session.doneClaiming });
  });

  // Guest asserts they paid (status: 'paid'). Host may also set this for someone.
  socket.on('mark-paid', ({ sessionId, guestName }) => {
    const session = getSession(sessionId);
    if (!session) return;
    const meta = socketMeta.get(socket.id);
    // A guest can only mark THEMSELVES; a host can mark anyone.
    const target = (meta && !meta.isHost) ? meta.name : guestName;
    if (!target) return;
    setPaymentStatus(session, target, 'paid');
    store.saveSession(session);
    io.to(sessionId).emit('payment-updated', { guestName: target, payments: session.payments });
  });

  // Host confirms a payment actually arrived (status: 'confirmed').
  socket.on('confirm-paid', ({ sessionId, guestName }) => {
    const session = getSession(sessionId);
    if (!session) return;
    const meta = socketMeta.get(socket.id);
    if (!meta || !meta.isHost) return; // host-only
    setPaymentStatus(session, guestName, 'confirmed');
    store.saveSession(session);
    io.to(sessionId).emit('payment-updated', { guestName, payments: session.payments });
  });

  // Reset a payment back to unpaid (mistake fix). Guest can reset self; host anyone.
  socket.on('reset-paid', ({ sessionId, guestName }) => {
    const session = getSession(sessionId);
    if (!session) return;
    const meta = socketMeta.get(socket.id);
    const target = (meta && !meta.isHost) ? meta.name : guestName;
    if (!target) return;
    setPaymentStatus(session, target, 'unpaid');
    store.saveSession(session);
    io.to(sessionId).emit('payment-updated', { guestName: target, payments: session.payments });
  });

  // Host resolves a dispute by assigning the item to a specific person
  // (breaks deadlocks where the current claimer won't release).
  socket.on('resolve-dispute', ({ sessionId, itemId, assignTo }) => {
    const session = getSession(sessionId);
    if (!session) return;
    const meta = socketMeta.get(socket.id);
    if (!meta || !meta.isHost) return; // host-only
    const item = session.items.find(i => i.id === itemId);
    if (!item) return;
    if (!Array.isArray(item.claims)) item.claims = [];
    delete item.dispute;
    if (assignTo) {
      item.claims = [{ guestName: assignTo, splitCount: 1 }]; // sole owner
    }
    store.saveSession(session);
    io.to(sessionId).emit('item-claimed', { items: session.items });
  });

  // Host one-tap resolves the unclaimed remainder so nothing falls through.
  // mode: 'me' (host takes all unclaimed) | 'split' (even split among everyone).
  socket.on('resolve-leftover', ({ sessionId, mode }) => {
    const session = getSession(sessionId);
    if (!session) return;
    const meta = socketMeta.get(socket.id);
    if (!meta || !meta.isHost) return; // host-only
    const participants = [session.hostName, ...session.guests.map(g => g.name)].filter(Boolean);

    for (const item of session.items) {
      if (!Array.isArray(item.claims)) item.claims = [];
      if ((item.quantity || 1) > 1) {
        const claimed = item.claims.reduce((s, c) => s + (c.units || 0), 0);
        const remaining = item.quantity - claimed;
        if (remaining <= 0) continue;
        if (mode === 'me') {
          const mine = item.claims.find(c => c.guestName === session.hostName);
          if (mine) mine.units = (mine.units || 0) + remaining;
          else item.claims.push({ guestName: session.hostName, units: remaining });
        }
        // 'split' for quantity items: leave as-is (unit assignment is ambiguous)
      } else {
        const splitCount = item.claims[0]?.splitCount || 1;
        const fullyClaimed = item.claims.length >= splitCount && item.claims.length > 0;
        if (fullyClaimed) continue;
        if (mode === 'me') {
          if (!item.claims.some(c => c.guestName === session.hostName)) {
            // host absorbs: make host a claimer at the current split, filling the gap
            item.claims.push({ guestName: session.hostName, splitCount: Math.max(splitCount, item.claims.length + 1) });
          }
        } else if (mode === 'split') {
          item.claims = participants.map(name => ({ guestName: name, splitCount: participants.length }));
        }
      }
      delete item.dispute;
    }
    store.saveSession(session);
    io.to(sessionId).emit('item-claimed', { items: session.items });
  });

  // Host removes a guest (rando joined / mistake) and frees their claims.
  socket.on('remove-guest', ({ sessionId, guestName }) => {
    const session = getSession(sessionId);
    if (!session) return;
    const meta = socketMeta.get(socket.id);
    if (!meta || !meta.isHost) return; // host-only
    if (!guestName || guestName === session.hostName) return;
    session.guests = (session.guests || []).filter(g => g.name !== guestName);
    session.payments = (session.payments || []).filter(p => p.guestName !== guestName);
    if (Array.isArray(session.doneClaiming)) session.doneClaiming = session.doneClaiming.filter(n => n !== guestName);
    for (const item of session.items) {
      if (Array.isArray(item.claims)) item.claims = item.claims.filter(c => c.guestName !== guestName);
      if (item.dispute?.by === guestName) delete item.dispute;
    }
    store.saveSession(session);
    io.to(sessionId).emit('session-updated', session);
  });

  socket.on('disconnect', () => {
    socketMeta.delete(socket.id);
    console.log('Client disconnected:', socket.id);
  });
});

// payment.status: 'unpaid' | 'paid' (guest asserts) | 'confirmed' (host verified)
// We snapshot `paidTotal` = what the person owed at the moment they were marked
// paid, so the dashboard can detect when later claim changes make that stale.
function setPaymentStatus(session, guestName, status) {
  if (!Array.isArray(session.payments)) session.payments = [];
  const now = Date.now();
  const paid = status === 'paid' || status === 'confirmed';
  const snapshot = paid ? (calculateAllPersonTotals(session)[guestName]?.total ?? 0) : null;
  const existing = session.payments.find(p => p.guestName === guestName);
  if (existing) {
    existing.status = status;
    existing.paid = paid; // backward-compat boolean
    if (status === 'paid') { existing.paidAt = now; existing.paidTotal = snapshot; }
    if (status === 'confirmed') { existing.confirmedAt = now; if (existing.paidTotal == null) existing.paidTotal = snapshot; }
    if (status === 'unpaid') { delete existing.paidAt; delete existing.confirmedAt; delete existing.paidTotal; }
  } else {
    session.payments.push({
      guestName,
      amount: 0,
      status,
      paid,
      paidAt: status === 'paid' ? now : undefined,
      confirmedAt: status === 'confirmed' ? now : undefined,
      paidTotal: snapshot,
    });
  }
}

// In production, serve the built React app from Express so everything
// runs on a single URL (no CORS, no proxy, socket.io just works).
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../client/dist');
  app.use(express.static(clientDist));
  // Send index.html for any route not matched by the API (client-side routing)
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  console.log(`AI scan: ${process.env.ANTHROPIC_API_KEY ? 'enabled' : 'DISABLED (set ANTHROPIC_API_KEY)'} · Email: ${notifyEnabled ? 'enabled' : 'disabled'}`);
});

module.exports = { app, server };
