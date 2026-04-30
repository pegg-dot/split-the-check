const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const anthropic = new Anthropic.default({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ===== In-memory session store =====
const sessions = new Map();

function createSession(sessionId, hostName, venmoHandle) {
  const session = {
    id: sessionId,
    hostName,
    venmoHandle,
    items: [],
    subtotal: 0,
    tax: 0,
    tipPercent: 18,
    guests: [],
    payments: [],
    createdAt: Date.now(),
  };
  sessions.set(sessionId, session);
  return session;
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

// Clean up sessions older than 4 hours
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > 4 * 60 * 60 * 1000) {
      sessions.delete(id);
    }
  }
}, 60 * 1000);

// ===== REST endpoints =====

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

app.post('/api/scan-receipt', async (req, res) => {
  try {
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

        const data = JSON.parse(jsonStr);

        // If non-USD currency detected, fetch exchange rate to USD
        const currency = (data.currency || 'USD').toUpperCase();
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
        data.currency = currency;
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
  res.json(session);
});

// ===== Socket.io real-time sync =====

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Host creates a session
  socket.on('create-session', ({ sessionId, hostName, venmoHandle, items, subtotal, tax, tipPercent, tipMode, tipDollar, tipIncluded, tipAmount, adminFee, currency, exchangeRate }) => {
    let session = getSession(sessionId);
    if (!session) {
      session = createSession(sessionId, hostName, venmoHandle);
    }
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
    socket.join(sessionId);
    console.log(`Session ${sessionId} created by ${hostName}`);
  });

  // Rejoin socket room (for reconnects / page navigations)
  socket.on('rejoin-room', ({ sessionId }) => {
    const session = getSession(sessionId);
    if (session) {
      socket.join(sessionId);
    }
  });

  // Guest joins a session
  socket.on('join-session', ({ sessionId, guestName }) => {
    const session = getSession(sessionId);
    if (!session) {
      socket.emit('error', { message: 'Session not found' });
      return;
    }

    // Add guest if not already present
    if (!session.guests.find(g => g.name === guestName)) {
      session.guests.push({ name: guestName, joinedAt: Date.now() });
    }

    socket.join(sessionId);
    // Send current session state to the joining guest
    socket.emit('session-state', session);
    // Notify everyone that a new guest joined
    io.to(sessionId).emit('guest-joined', { name: guestName, guests: session.guests });
    console.log(`${guestName} joined session ${sessionId}`);
  });

  // Someone claims an item
  socket.on('claim-item', ({ sessionId, itemId, guestName, splitCount }) => {
    const session = getSession(sessionId);
    if (!session) return;

    const item = session.items.find(i => i.id === itemId);
    if (!item) return;

    // Don't allow claiming if someone else already claimed it (unless it's a shared/split item)
    const existingClaim = item.claims.find(c => c.guestName === guestName);
    if (existingClaim) return;

    item.claims.push({ guestName, splitCount });
    // Clear any dispute when item is claimed
    delete item.dispute;
    io.to(sessionId).emit('item-claimed', { itemId, guestName, splitCount, items: session.items });
  });

  // Someone unclaims an item
  socket.on('unclaim-item', ({ sessionId, itemId, guestName }) => {
    const session = getSession(sessionId);
    if (!session) return;

    const item = session.items.find(i => i.id === itemId);
    if (!item) return;

    // If there's an active dispute, auto-assign to the disputer
    const dispute = item.dispute;
    item.claims = item.claims.filter(c => c.guestName !== guestName);

    if (dispute && dispute.by !== guestName) {
      // Auto-claim for the disputer
      item.claims.push({ guestName: dispute.by, splitCount: 1 });
      delete item.dispute;
      console.log(`Auto-assigned "${item.name}" to ${dispute.by} after ${guestName} released`);
    } else {
      delete item.dispute;
    }

    io.to(sessionId).emit('item-unclaimed', { itemId, guestName, items: session.items });
  });

  // Someone disputes another person's claim
  socket.on('dispute-item', ({ sessionId, itemId, disputerName }) => {
    const session = getSession(sessionId);
    if (!session) return;

    const item = session.items.find(i => i.id === itemId);
    if (!item) return;

    item.dispute = { by: disputerName };
    console.log(`Dispute: ${disputerName} disputes item "${item.name}" in session ${sessionId}`);
    io.to(sessionId).emit('item-disputed', { itemId, disputerName, items: session.items });
  });

  // Someone cancels their dispute
  socket.on('cancel-dispute', ({ sessionId, itemId, disputerName }) => {
    const session = getSession(sessionId);
    if (!session) return;

    const item = session.items.find(i => i.id === itemId);
    if (!item) return;

    // Only the person who filed the dispute can cancel it
    if (item.dispute && item.dispute.by === disputerName) {
      delete item.dispute;
      console.log(`Dispute cancelled: ${disputerName} withdrew dispute on "${item.name}" in session ${sessionId}`);
      io.to(sessionId).emit('dispute-cancelled', { itemId, items: session.items });
    }
  });

  // Guest shares an already-claimed item — updates all existing claimers' splitCount
  socket.on('share-item', ({ sessionId, itemId, guestName, splitCount }) => {
    const session = getSession(sessionId);
    if (!session) return;

    const item = session.items.find(i => i.id === itemId);
    if (!item) return;

    // Guard: person already claimed this item
    if (item.claims.some(c => c.guestName === guestName)) return;

    // Minimum splitCount = existing claimers + 1
    const minCount = item.claims.length + 1;
    const finalCount = Math.max(minCount, splitCount);

    // Update every existing claim to the new splitCount
    item.claims = item.claims.map(c => ({ ...c, splitCount: finalCount }));
    // Add this person's claim
    item.claims.push({ guestName, splitCount: finalCount });
    // Clear any pending dispute
    delete item.dispute;

    console.log(`${guestName} shared "${item.name}" (${finalCount} ways) in session ${sessionId}`);
    io.to(sessionId).emit('item-claimed', { items: session.items });
  });

  // Claim N units from a quantity item (quantity > 1)
  socket.on('claim-units', ({ sessionId, itemId, guestName, units }) => {
    const session = getSession(sessionId);
    if (!session) return;
    const item = session.items.find(i => i.id === itemId);
    if (!item || (item.quantity || 1) <= 1) return;

    const totalClaimed = item.claims.reduce((sum, c) => sum + (c.units || 0), 0);
    const available    = item.quantity - totalClaimed;
    const actualUnits  = Math.min(Math.max(1, units), available);
    if (actualUnits <= 0) return;

    const existing = item.claims.find(c => c.guestName === guestName);
    if (existing) {
      existing.units = (existing.units || 0) + actualUnits;
    } else {
      item.claims.push({ guestName, units: actualUnits });
    }
    delete item.dispute;
    console.log(`${guestName} claimed ${actualUnits} units of "${item.name}" in session ${sessionId}`);
    io.to(sessionId).emit('item-claimed', { items: session.items });
  });

  // Release a guest's unit claim
  socket.on('unclaim-units', ({ sessionId, itemId, guestName }) => {
    const session = getSession(sessionId);
    if (!session) return;
    const item = session.items.find(i => i.id === itemId);
    if (!item) return;
    item.claims = item.claims.filter(c => c.guestName !== guestName);
    io.to(sessionId).emit('item-unclaimed', { items: session.items });
  });

  // Guest finished claiming
  socket.on('done-claiming', ({ sessionId, guestName }) => {
    const session = getSession(sessionId);
    if (!session) return;

    if (!session.doneClaiming) session.doneClaiming = [];
    if (!session.doneClaiming.includes(guestName)) {
      session.doneClaiming.push(guestName);
    }
    io.to(sessionId).emit('claiming-update', { doneClaiming: session.doneClaiming });
  });

  // Host marks someone as paid
  socket.on('mark-paid', ({ sessionId, guestName }) => {
    const session = getSession(sessionId);
    if (!session) return;

    const existing = session.payments.find(p => p.guestName === guestName);
    if (existing) {
      existing.paid = true;
    } else {
      session.payments.push({ guestName, amount: 0, paid: true });
    }
    io.to(sessionId).emit('payment-updated', { guestName, payments: session.payments });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

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
});
