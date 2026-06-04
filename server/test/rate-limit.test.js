const { test } = require('node:test');
const assert = require('node:assert');
const { createRateLimiter } = require('../lib/rate-limit');

function fakeReqRes(ip) {
  const req = { headers: {}, ip, socket: { remoteAddress: ip } };
  const res = {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    set(k, v) { this.headers[k] = v; return this; },
  };
  return { req, res };
}

test('allows up to max, then 429s the same IP', () => {
  const mw = createRateLimiter({ windowMs: 60000, max: 2, name: 't1' });
  let nexts = 0;
  const next = () => nexts++;

  const a = fakeReqRes('1.1.1.1');
  mw(a.req, a.res, next);
  mw(a.req, a.res, next);
  assert.strictEqual(nexts, 2);

  const blocked = fakeReqRes('1.1.1.1');
  mw(blocked.req, blocked.res, next);
  assert.strictEqual(nexts, 2);               // not called again
  assert.strictEqual(blocked.res.statusCode, 429);
  assert.ok(blocked.res.headers['Retry-After']);
});

test('separate IPs have separate buckets', () => {
  const mw = createRateLimiter({ windowMs: 60000, max: 1, name: 't2' });
  let nexts = 0; const next = () => nexts++;
  const a = fakeReqRes('2.2.2.2'); mw(a.req, a.res, next);
  const b = fakeReqRes('3.3.3.3'); mw(b.req, b.res, next);
  assert.strictEqual(nexts, 2);
});

test('global daily cap blocks even fresh IPs', () => {
  const mw = createRateLimiter({ windowMs: 60000, max: 100, dailyMax: 2, name: 't3' });
  let nexts = 0; const next = () => nexts++;
  for (const ip of ['a', 'b', 'c']) { const r = fakeReqRes(ip); mw(r.req, r.res, next); }
  assert.strictEqual(nexts, 2); // 3rd blocked by daily cap
});

test('reads client IP from x-forwarded-for', () => {
  const mw = createRateLimiter({ windowMs: 60000, max: 1, name: 't4' });
  let nexts = 0; const next = () => nexts++;
  const a = fakeReqRes(); a.req.headers['x-forwarded-for'] = '9.9.9.9, 10.0.0.1';
  mw(a.req, a.res, next);
  const b = fakeReqRes(); b.req.headers['x-forwarded-for'] = '9.9.9.9';
  mw(b.req, b.res, next);
  assert.strictEqual(nexts, 1);            // same real client IP → 2nd blocked
  assert.strictEqual(b.res.statusCode, 429);
});
