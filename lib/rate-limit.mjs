// @ts-check
/**
 * Fixed-window in-memory rate limiter for abuse-prone endpoints.
 *
 * Deliberately simple: a Map of counters with lazy eviction. It is per-process,
 * so N instances allow N times the configured rate. That is an acceptable trade
 * for keeping abusive traffic away from the database without adding a Redis
 * dependency; on a horizontally scaled deployment, move this to a shared store.
 */

/** @type {Map<string, { count: number, resetAt: number }>} */
const windows = new Map();
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60_000;

/**
 * @param {number} now
 * @returns {void}
 */
function sweep(now) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

/**
 * @param {string} key
 * @param {number} limit
 * @param {number} windowMs
 * @returns {{ allowed: boolean, remaining: number, retryAfter: number }}
 */
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, remaining: limit - existing.count, retryAfter: 0 };
}

/**
 * Test hook: clear all counters so cases do not leak into each other.
 * @returns {void}
 */
export function resetRateLimits() {
  windows.clear();
  lastSweep = 0;
}

/** Ingest ceiling. A pageview is one request; an SPA route change is another. */
export const INGEST_LIMIT_PER_MINUTE = 240;
export const LOGIN_LIMIT_PER_15_MIN = 12;

/** Public share pages and their realtime poll, per client IP. Each page view is a few requests. */
export const SHARE_LIMIT_PER_MINUTE = 120;
