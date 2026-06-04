// ============================================================================
// Lightweight in-memory rate limiter (no external deps)
// ----------------------------------------------------------------------------
// Protects the expensive, unauthenticated /api/scan-receipt endpoint from
// running up the Anthropic bill. Two layers:
//   1. Per-IP fixed window  — stops one abuser hammering the endpoint.
//   2. Global daily cap     — a hard ceiling on total scans/day as a backstop
//                             against a distributed flood.
// In-memory is fine for a single instance; swap for Redis if you scale out.
// ============================================================================

function createRateLimiter({ windowMs, max, dailyMax, name = 'rl' }) {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const hits = new Map();
  let day = { count: 0, resetAt: startOfNextDay() };

  function startOfNextDay() {
    return Date.now() + 24 * 60 * 60 * 1000;
  }

  // Periodically clear stale per-IP buckets so the map can't grow unbounded.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, b] of hits) if (now > b.resetAt) hits.delete(ip);
  }, windowMs);
  if (sweep.unref) sweep.unref();

  return function middleware(req, res, next) {
    const now = Date.now();

    // Global daily cap
    if (now > day.resetAt) day = { count: 0, resetAt: startOfNextDay() };
    if (dailyMax && day.count >= dailyMax) {
      console.warn(`[${name}] global daily cap (${dailyMax}) reached`);
      return res.status(429).json({
        error: 'This service is busy right now. Please try again later.',
        retryAfter: Math.ceil((day.resetAt - now) / 1000),
      });
    }

    // Per-IP window
    const ip = clientIp(req);
    let b = hits.get(ip);
    if (!b || now > b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      hits.set(ip, b);
    }
    if (b.count >= max) {
      const retryAfter = Math.ceil((b.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: `Too many requests. Try again in ${retryAfter}s.`,
        retryAfter,
      });
    }

    b.count++;
    day.count++;
    next();
  };
}

function clientIp(req) {
  // Railway/most proxies set x-forwarded-for: "client, proxy1, proxy2"
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

module.exports = { createRateLimiter, clientIp };
