// Per-process per-user+Brand in-memory rate limiter.
// Reset on restart; not shared across production instances.
// MVP protection — do not rely on this as a global distributed rate limiter.

const MAX_ENTRIES = 10_000;
const CLEANUP_EVERY_N_CHECKS = 100;

export function createRateLimiter({ windowMs, maxRequests }) {
  const hits = new Map();
  let checkCounter = 0;

  function lazyCleanup() {
    checkCounter = (checkCounter + 1) % CLEANUP_EVERY_N_CHECKS;
    if (checkCounter !== 0) return;
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now - entry.windowStart > windowMs) {
        hits.delete(key);
      }
    }
  }

  return {
    check(key) {
      lazyCleanup();

      const now = Date.now();
      let entry = hits.get(key);

      if (!entry || now - entry.windowStart > windowMs) {
        if (hits.size >= MAX_ENTRIES) {
          return { allowed: false, remaining: 0 };
        }
        entry = { windowStart: now, count: 0 };
        hits.set(key, entry);
      }

      entry.count++;

      if (entry.count > maxRequests) {
        const retryAfter = Math.ceil((entry.windowStart + windowMs - now) / 1000);
        return { allowed: false, remaining: 0, retryAfter };
      }

      return { allowed: true, remaining: maxRequests - entry.count };
    },
    get entryCount() {
      return hits.size;
    },
    _resetForTest() {
      hits.clear();
      checkCounter = 0;
    },
  };
}
