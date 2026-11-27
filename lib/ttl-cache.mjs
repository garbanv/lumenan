// @ts-check
/**
 * Small in-memory TTL cache with in-flight de-duplication.
 *
 * Concurrent callers asking for the same key share one load, so a burst of
 * dashboard views costs one set of queries instead of one set per viewer.
 * Failed loads are never cached. Per-process, like the rate limiter.
 *
 * @template T
 */
export class TtlCache {
  /**
   * @param {{ ttlMs: number, maxEntries?: number, now?: () => number }} options
   */
  constructor({ ttlMs, maxEntries = 500, now = Date.now }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    /** @type {Map<string, { value: T, expiresAt: number }>} */
    this.entries = new Map();
    /** @type {Map<string, Promise<T>>} */
    this.inflight = new Map();
  }

  /**
   * @param {string} key
   * @param {() => Promise<T>} load
   * @returns {Promise<T>}
   */
  async get(key, load) {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.value;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = load()
      .then((value) => {
        this.#store(key, value);
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }

  /** @param {string} key @param {T} value */
  #store(key, value) {
    const now = this.now();
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      for (const [k, e] of this.entries) {
        if (e.expiresAt <= now) this.entries.delete(k);
      }
      // Still full: evict the oldest insertion (Map iterates in insertion order).
      if (this.entries.size >= this.maxEntries) {
        const oldest = this.entries.keys().next();
        if (!oldest.done) this.entries.delete(oldest.value);
      }
    }
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
  }

  clear() {
    this.entries.clear();
  }
}
