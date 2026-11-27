// @ts-check
/**
 * Dashboard filters: which dimension values narrow every number on the page.
 *
 * Filters arrive from the URL, so they are untrusted. Two rules keep them safe:
 * only the keys listed here are ever read, and each value is passed to
 * PostgreSQL as a bound parameter. The SQL text is assembled only from the
 * fixed column expressions below, never from user input.
 */

/** @typedef {'page' | 'referrer' | 'country' | 'device' | 'browser' | 'os'} FilterKey */
/** @typedef {Partial<Record<FilterKey, string>>} Filters */

/** @type {readonly FilterKey[]} */
export const FILTER_KEYS = ['page', 'referrer', 'country', 'device', 'browser', 'os'];

/** @type {Record<FilterKey, string>} */
export const FILTER_LABELS = {
  page: 'Page',
  referrer: 'Referrer',
  country: 'Country',
  device: 'Device',
  browser: 'Browser',
  os: 'OS',
};

const MAX_VALUE_LENGTH = 512;

/**
 * Column expressions match the labels the breakdowns display, so clicking a
 * row filters on exactly what the row said ("Direct", "Unknown").
 * `p` is an optional table alias prefix such as "e.".
 *
 * @type {Record<FilterKey, (p: string) => string>}
 */
const COLUMNS = {
  page: (p) => `${p}path`,
  referrer: (p) => `coalesce(${p}referrer_domain, 'Direct')`,
  country: (p) => `${p}country`,
  device: (p) => `coalesce(${p}device, 'Unknown')`,
  browser: (p) => `coalesce(${p}browser, 'Unknown')`,
  os: (p) => `coalesce(${p}os, 'Unknown')`,
};

/**
 * Read filters from anything with a `get(name)` method (URLSearchParams).
 * Unknown keys, empty values and malformed countries are dropped.
 *
 * @param {{ get(name: string): string | null }} params
 * @returns {Filters}
 */
export function parseFilters(params) {
  /** @type {Filters} */
  const filters = {};
  for (const key of FILTER_KEYS) {
    const raw = params.get(key);
    if (typeof raw !== 'string') continue;
    const value = raw.trim().slice(0, MAX_VALUE_LENGTH);
    if (!value) continue;
    if (key === 'country') {
      const code = value.toUpperCase();
      if (/^[A-Z]{2}$/.test(code)) filters.country = code;
      continue;
    }
    filters[key] = value;
  }
  return filters;
}

/** @param {Filters} filters */
export function hasFilters(filters) {
  return FILTER_KEYS.some((key) => filters[key] !== undefined);
}

/**
 * Stable string for cache keys: same filters, same key, whatever the order.
 * @param {Filters} filters
 */
export function filtersKey(filters) {
  return JSON.stringify(FILTER_KEYS.map((key) => filters[key] ?? null));
}

/**
 * SQL fragment (starting with " AND ") plus its bound parameters.
 *
 * @param {Filters} filters
 * @param {number} firstParam the number of the first placeholder to use ($n)
 * @param {string} [alias] table alias prefix including the dot, e.g. "e."
 * @returns {{ sql: string, params: string[] }}
 */
export function buildFilterClause(filters, firstParam, alias = '') {
  let sql = '';
  /** @type {string[]} */
  const params = [];
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value === undefined) continue;
    params.push(value);
    sql += ` AND ${COLUMNS[key](alias)} = $${firstParam + params.length - 1}`;
  }
  return { sql, params };
}
