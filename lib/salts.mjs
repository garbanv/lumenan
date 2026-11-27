// @ts-check
/**
 * Random per-day salts for the visitor hash.
 *
 * The visitor identifier is an HMAC of IP, User-Agent and site, and its whole
 * privacy story is that it cannot be linked across days. That only holds if
 * nobody can recompute yesterday's hashes. Deriving the key from a long-lived
 * secret plus the date, as this used to, means anyone who ever holds the
 * database and that secret can enumerate IPv4 addresses against any past day.
 *
 * Instead each UTC day gets a random salt stored in `daily_salts`, and salts
 * for days that are over are deleted. After that, nothing exists that could be
 * used to recompute that day's hashes, not even for the operator.
 *
 * It lives in the database rather than in memory so that every instance agrees
 * on the day's salt and a restart mid-day does not make returning visitors look
 * new. The insert is `ON CONFLICT DO NOTHING` followed by a read, so whichever
 * instance creates the row first wins and every other instance reads the same
 * value.
 *
 * Plain JavaScript with an injected query function, so the logic runs under
 * `node --test` with no database and the SQL is exercised against real
 * PostgreSQL by db/verify-schema.mjs.
 */

import { randomBytes } from 'node:crypto';

/** The only SQL this module runs. Exported so db/verify-schema.mjs can check it. */
export const SALT_SQL = {
  create: `INSERT INTO daily_salts (day, salt) VALUES ($1::date, $2) ON CONFLICT (day) DO NOTHING`,
  read: `SELECT salt FROM daily_salts WHERE day = $1::date`,
  purge: `DELETE FROM daily_salts WHERE day < $1::date`,
};

/**
 * 256 bits of randomness, hex encoded.
 * @returns {string}
 */
export function generateSalt() {
  return randomBytes(32).toString('hex');
}

/**
 * @typedef {(text: string, params?: unknown[]) => Promise<{ rows: any[] }>} QueryFn
 */

/**
 * @param {QueryFn} query
 * @param {{ generate?: () => string, onError?: (err: unknown) => void }} [options]
 * @returns {{ getDailySalt: (day: string) => Promise<string> }}
 */
export function createSaltResolver(query, options = {}) {
  const generate = options.generate ?? generateSalt;
  const onError =
    options.onError ?? ((err) => console.error('Failed to delete expired daily salts:', err));

  /** @type {Map<string, string>} */
  const cache = new Map();
  /** @type {Map<string, Promise<string>>} concurrent first requests share one lookup */
  const inFlight = new Map();
  /** @type {string | null} */
  let purgedFor = null;

  /**
   * @param {string} day
   * @returns {Promise<string>}
   */
  async function load(day) {
    await query(SALT_SQL.create, [day, generate()]);
    const { rows } = await query(SALT_SQL.read, [day]);
    const salt = rows[0]?.salt;
    if (typeof salt !== 'string' || salt.length === 0) {
      throw new Error(`No visitor salt available for ${day}`);
    }
    return salt;
  }

  /**
   * Delete the salts of days that are over, once per process per day.
   *
   * Fire-and-forget: a failed delete must never block ingest, and the next day
   * tries again. A process whose clock lags another instance's by a few seconds
   * around midnight can briefly ask for a day that was just purged; it then
   * simply creates a fresh salt for it, which is harmless and is deleted again
   * the next day.
   *
   * @param {string} day
   */
  function purgeBefore(day) {
    if (purgedFor === day) return;
    purgedFor = day;
    // ISO dates sort lexicographically, so this drops every earlier day.
    for (const cached of cache.keys()) {
      if (cached < day) cache.delete(cached);
    }
    query(SALT_SQL.purge, [day]).catch(onError);
  }

  /**
   * @param {string} day YYYY-MM-DD in UTC
   * @returns {Promise<string>}
   */
  async function getDailySalt(day) {
    const cached = cache.get(day);
    if (cached) return cached;

    let pending = inFlight.get(day);
    if (!pending) {
      pending = load(day)
        .then((salt) => {
          cache.set(day, salt);
          purgeBefore(day);
          return salt;
        })
        .finally(() => {
          inFlight.delete(day);
        });
      inFlight.set(day, pending);
    }
    return pending;
  }

  return { getDailySalt };
}
