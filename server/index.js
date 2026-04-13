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
                  text: `Extract every line item from this receipt. Return ONLY valid JSON in this exact format, no other text:

{
  "items": [
    { "name": "Item Name", "price": 12.99 }
  ],
  "tax": 0.00,
  "tipIncluded": false,
  "tipAmount": 0.00,
  "adminFee": 0.00
}

Rules:
- ALWAYS break quantities into individual items. If the receipt says "2x Latte 4.50 = 9.00", return TWO separate entries each with "name": "Latte" and "price": 4.50. Never group multiples into one line.
- "name" is the item description (clean it up if abbreviated)
- "price" is the per-unit price, NOT the line total
- "tax" is the tax amount if visible on the receipt, otherwise 0
- "tipIncluded" is true if the receipt shows a gratuity/tip/service charge already added
- "tipAmount" is the tip amount if already included on the receipt, otherwise 0
- "adminFee" is any admin fee, service fee, or surcharge on the receipt (not tax), otherwise 0
- Do NOT include the total line, subtotal line, tax line, tip line, or admin/service fee as items
- Prices should be numbers, not strings`,
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
  socket.on('create-session', ({ sessionId, hostName, venmoHandle, items, subtotal, tax, tipPercent, tipMode, tipDollar, tipIncluded, tipAmount, adminFee }) => {
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

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
