// Manual end-to-end socket smoke test (not part of `npm test`).
// Usage: PORT must already be running. node server/test/smoke.cjs <port>
const path = require('path');
const { io } = require(path.join(__dirname, '..', '..', 'client', 'node_modules', 'socket.io-client'));
const PORT = process.argv[2] || '3011';
const URL = `http://localhost:${PORT}`;
const SID = 'smoke_' + Date.now(); // unique per run (sessions persist across runs)
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const conn = () => io(URL, { transports: ['websocket'], forceNew: true });

(async () => {
  const results = [];
  const log = (k, v) => results.push(`${v ? 'PASS' : 'FAIL'}  ${k}`);

  const host = conn(); await new Promise(r => host.on('connect', r));
  host.emit('create-session', { sessionId: SID, hostName: 'Nate', venmoHandle: '@nate', hostDisplayName: 'Nate P.',
    items: [{ id: 0, name: 'Burger', price: 20, claims: [] }, { id: 1, name: 'Wine', price: 10, claims: [] }],
    subtotal: 30, tax: 3, tipPercent: 20, currency: 'USD', exchangeRate: 1 });
  await wait(150);

  const alex = conn(); await new Promise(r => alex.on('connect', r));
  let alexState = null;
  alex.on('session-state', s => alexState = s);
  alex.emit('join-session', { sessionId: SID, guestName: 'Alex' });
  await wait(200);
  log('guest Alex receives session-state w/ host display name', alexState && alexState.hostDisplayName === 'Nate P.');

  const alex2 = conn(); await new Promise(r => alex2.on('connect', r));
  let dupErr = null; alex2.on('error', e => dupErr = e);
  alex2.emit('join-session', { sessionId: SID, guestName: 'alex' });
  await wait(200);
  log('duplicate name rejected', !!dupErr && /taken/i.test(dupErr.message || ''));

  alex.emit('claim-item', { sessionId: SID, itemId: 0, guestName: 'Alex', splitCount: 1 });
  await wait(120);
  // SPOOF: Alex's socket claims Wine AS "Bob" — server must rebind to Alex
  alex.emit('claim-item', { sessionId: SID, itemId: 1, guestName: 'Bob', splitCount: 1 });
  await wait(200);

  alex.emit('mark-paid', { sessionId: SID, guestName: 'Alex' });
  await wait(120);
  host.emit('confirm-paid', { sessionId: SID, guestName: 'Alex' });
  await wait(150);

  let s = await (await fetch(`${URL}/api/session/${SID}`)).json();
  const burger = s.items.find(i => i.id === 0);
  const wine = s.items.find(i => i.id === 1);
  log('Alex claim recorded', burger.claims.some(c => c.guestName === 'Alex'));
  log('spoofed Bob claim rebound to Alex', wine.claims.length === 1 && wine.claims[0].guestName === 'Alex');
  const pay = s.payments.find(p => p.guestName === 'Alex');
  log('payment two-state = confirmed', pay && pay.status === 'confirmed');
  log('pay-time snapshot stored (paidTotal)', pay && typeof pay.paidTotal === 'number');
  log('exactly one Alex in guests', s.guests.filter(g => g.name.toLowerCase() === 'alex').length === 1);

  // --- Automation events ---
  // Live sync: a host edit broadcasts session-updated to already-joined guests.
  let gotUpdate = false;
  alex.on('session-updated', () => { gotUpdate = true; });
  host.emit('create-session', { sessionId: SID, hostName: 'Nate', venmoHandle: '@nate',
    items: s.items, subtotal: 30, tax: 3, tipPercent: 25, currency: 'USD', exchangeRate: 1 });
  await wait(200);
  log('host edit broadcasts session-updated to guests', gotUpdate);

  // Leftover resolve: add an unclaimed item, host covers it.
  host.emit('create-session', { sessionId: SID, hostName: 'Nate', venmoHandle: '@nate',
    items: [...s.items, { id: 2, name: 'Dessert', price: 8, claims: [] }],
    subtotal: 38, tax: 3, tipPercent: 0, currency: 'USD', exchangeRate: 1 });
  await wait(150);
  host.emit('resolve-leftover', { mode: 'me', sessionId: SID });
  await wait(200);
  s = await (await fetch(`${URL}/api/session/${SID}`)).json();
  const dessert = s.items.find(i => i.id === 2);
  log('resolve-leftover assigned unclaimed Dessert to host', dessert.claims.some(c => c.guestName === 'Nate'));

  // Remove guest (host-only)
  host.emit('remove-guest', { sessionId: SID, guestName: 'Alex' });
  await wait(200);
  s = await (await fetch(`${URL}/api/session/${SID}`)).json();
  log('remove-guest dropped Alex + released claims', s.guests.length === 0 && !s.items.some(i => (i.claims || []).some(c => c.guestName === 'Alex')));

  // Authorization: a guest cannot remove the host.
  const eve = conn(); await new Promise(r => eve.on('connect', r));
  eve.emit('join-session', { sessionId: SID, guestName: 'Eve' });
  await wait(150);
  eve.emit('remove-guest', { sessionId: SID, guestName: 'Nate' }); // must be ignored
  await wait(200);
  s = await (await fetch(`${URL}/api/session/${SID}`)).json();
  log('guest CANNOT remove host (authorization holds)', s.hostName === 'Nate' && s.guests.some(g => g.name === 'Eve'));

  console.log('\n' + results.join('\n'));
  host.close(); alex.close(); alex2.close(); eve.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error('SMOKE ERROR', e); process.exit(2); });
