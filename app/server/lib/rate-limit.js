// Fixed-window per-IP rate limiting.
//
// Per-instance and in-memory: scaling out multiplies the effective limit. That is
// acceptable here because this is defence in depth, not a quota. Front Door or APIM
// is the right control once the app runs on more than one instance.

export const RATE_WINDOW_MS = 60_000;
// Backstop: bounds each map so a flood of distinct source IPs can't exhaust memory
// between sweeps.
export const RATE_MAX_KEYS = 50_000;

export function createRateLimiter({ windowMs = RATE_WINDOW_MS, maxKeys = RATE_MAX_KEYS } = {}) {
  const buckets = [];

  function limit(max) {
    const hits = new Map();
    buckets.push(hits);
    return (req, res, next) => {
      const now = Date.now();
      let rec = hits.get(req.ip);
      if (!rec || now - rec.start > windowMs) {
        if (!rec && hits.size >= maxKeys) hits.clear();
        rec = { count: 0, start: now };
        hits.set(req.ip, rec);
      }
      rec.count += 1;
      if (rec.count > max) {
        res.setHeader('Retry-After', Math.max(Math.ceil((rec.start + windowMs - now) / 1000), 1));
        return res.status(429).json({ error: 'Too many requests. Please slow down.' });
      }
      return next();
    };
  }

  // Expired entries are only overwritten when that IP comes back, so sweep them.
  function sweep(now = Date.now()) {
    const cutoff = now - windowMs;
    let dropped = 0;
    for (const hits of buckets) {
      for (const [ip, rec] of hits) {
        if (rec.start < cutoff) { hits.delete(ip); dropped += 1; }
      }
    }
    return dropped;
  }

  // .unref() so the timer can never hold the process open.
  function startSweeper() {
    return setInterval(sweep, windowMs).unref();
  }

  const size = () => buckets.reduce((n, hits) => n + hits.size, 0);

  return { limit, sweep, startSweeper, size };
}
