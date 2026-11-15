const LOOPBACK_PROXY_IPS = new Set(['127.0.0.1', '::1']);

function normalizeIp(value) {
  const ip = String(value || '').trim().toLowerCase();
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function trustedProxySetting(value) {
  const configured = String(value || '')
    .split(',')
    .map(normalizeIp)
    .filter(Boolean);
  const trusted = new Set(configured.length ? configured : LOOPBACK_PROXY_IPS);
  return (ip) => trusted.has(normalizeIp(ip));
}

class SlidingWindowLimiter {
  constructor({ max, windowMs, maxKeys = 4096, now = () => Date.now() }) {
    this.max = max;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.now = now;
    this.entries = new Map();
  }

  consume(key) {
    const now = this.now();
    const current = this.entries.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.prune(now);
      this.entries.set(key, { count: 1, startedAt: now });
      return { allowed: true, remaining: Math.max(0, this.max - 1) };
    }
    current.count += 1;
    if (current.count > this.max) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((this.windowMs - (now - current.startedAt)) / 1000)), remaining: 0 };
    }
    return { allowed: true, remaining: Math.max(0, this.max - current.count) };
  }

  clear(key) { this.entries.delete(key); }

  prune(now = this.now()) {
    for (const [key, entry] of this.entries) {
      if (now - entry.startedAt >= this.windowMs) this.entries.delete(key);
    }
    while (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

module.exports = { normalizeIp, trustedProxySetting, SlidingWindowLimiter };
