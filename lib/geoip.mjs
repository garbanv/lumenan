// @ts-check
/**
 * Country lookup from an IP address, against a local database.
 *
 * Why this exists: behind a plain reverse proxy (Traefik on Coolify, nginx)
 * no CDN adds a country header, so the dashboard's country panel stays empty.
 * This resolves the country on the server instead, from the free DB-IP "IP to
 * Country Lite" CSV (https://db-ip.com/db/download/ip-to-country-lite).
 *
 * Privacy properties, which are the point of doing it this way:
 *   - The lookup is a binary search in memory. The IP is never sent anywhere,
 *     never logged and never stored; only the two-letter country is kept.
 *   - Only country level. The database has no city, region or coordinates.
 *
 * The data is licensed CC BY 4.0, which requires a visible credit to DB-IP
 * (the dashboard's Countries card carries it).
 *
 * File format, one range per line, gzip optional:
 *     1.0.0.0,1.0.0.255,AU
 *     2001:200::,2001:200:ffff:ffff:ffff:ffff:ffff:ffff,JP
 */

import { isIP } from 'node:net';

/** DB-IP uses "ZZ" for "unknown"; it is not a country. */
const UNKNOWN = 'ZZ';

/**
 * @typedef {object} RangeTable4
 * @property {Uint32Array} starts
 * @property {Uint32Array} ends
 * @property {Uint16Array} codes   two ASCII letters packed as (a << 8) | b
 */

/**
 * IPv6 ranges are matched on the top 64 bits only. Registries allocate country
 * blocks no smaller than a /32, so nothing is lost, and a BigUint64Array is far
 * smaller and faster than 128-bit values.
 *
 * @typedef {object} RangeTable6
 * @property {BigUint64Array} starts
 * @property {BigUint64Array} ends
 * @property {Uint16Array} codes
 */

/**
 * @typedef {object} GeoDb
 * @property {RangeTable4} v4
 * @property {RangeTable6} v6
 * @property {number} rows     ranges loaded
 * @property {number} skipped  lines that were not valid ranges
 */

/**
 * Turn a client IP into something comparable.
 *
 * @param {unknown} ip
 * @returns {{ family: 4, value: number } | { family: 6, value: bigint } | null}
 */
export function parseIp(ip) {
  if (typeof ip !== 'string') return null;
  let text = ip.trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%'); // fe80::1%eth0
  if (zone !== -1) text = text.slice(0, zone);

  const kind = isIP(text);
  if (kind === 4) return { family: 4, value: ipv4ToInt(text) };
  if (kind !== 6) return null;

  const groups = expandIpv6(text);
  if (!groups) return null;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;

  // ::ffff:203.0.113.7 is an IPv4 client seen through a dual-stack socket.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return { family: 4, value: ((g6 << 16) | g7) >>> 0 };
  }

  const top = (BigInt(g0) << 48n) | (BigInt(g1) << 32n) | (BigInt(g2) << 16n) | BigInt(g3);
  return { family: 6, value: top };
}

/**
 * @param {string} text a valid dotted quad
 * @returns {number} unsigned 32-bit
 */
function ipv4ToInt(text) {
  const [a = 0, b = 0, c = 0, d = 0] = text.split('.').map(Number);
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

/**
 * Expand a valid IPv6 literal to eight 16-bit groups.
 *
 * @param {string} text
 * @returns {number[] | null}
 */
function expandIpv6(text) {
  let work = text;

  // A trailing dotted quad (::ffff:1.2.3.4) is two groups.
  const lastColon = work.lastIndexOf(':');
  const tail = work.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (isIP(tail) !== 4) return null;
    const n = ipv4ToInt(tail);
    work = `${work.slice(0, lastColon + 1)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }

  const halves = work.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;

  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  if (all.length !== 8) return null;

  const groups = all.map((g) => parseInt(g, 16));
  return groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff) ? null : groups;
}

/**
 * @param {string} code
 * @returns {number}
 */
function packCode(code) {
  return (code.charCodeAt(0) << 8) | code.charCodeAt(1);
}

/**
 * @param {number} packed
 * @returns {string}
 */
function unpackCode(packed) {
  return String.fromCharCode(packed >> 8, packed & 0xff);
}

/**
 * Parse the DB-IP country CSV into compact, sorted lookup tables.
 *
 * Bad lines are counted and skipped rather than fatal, but a file that yields no
 * usable rows at all throws: that means the wrong file (an HTML error page, say),
 * and silently running with no data would look exactly like "no country data".
 *
 * @param {string} csv
 * @returns {GeoDb}
 */
export function buildGeoDb(csv) {
  /** @type {Array<[number, number, number]>} */
  const rows4 = [];
  /** @type {Array<[bigint, bigint, number]>} */
  const rows6 = [];
  let skipped = 0;

  for (const raw of csv.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    const parts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
    const from = parts[0] ?? '';
    const to = parts[1] ?? '';
    const code = parts[2] ?? '';
    if (parts.length < 3 || !/^[A-Za-z]{2}$/.test(code)) {
      skipped++;
      continue;
    }

    const upper = code.toUpperCase();
    if (upper === UNKNOWN) continue; // valid, just not a country

    const start = parseIp(from);
    const end = parseIp(to);
    if (!start || !end || start.family !== end.family) {
      skipped++;
      continue;
    }

    if (start.family === 4 && end.family === 4) {
      if (end.value < start.value) skipped++;
      else rows4.push([start.value, end.value, packCode(upper)]);
    } else if (start.family === 6 && end.family === 6) {
      if (end.value < start.value) skipped++;
      else rows6.push([start.value, end.value, packCode(upper)]);
    }
  }

  if (rows4.length + rows6.length === 0) {
    throw new Error(`No usable ranges found in the GeoIP file (${skipped} unreadable line(s))`);
  }

  rows4.sort((x, y) => x[0] - y[0]);
  rows6.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));

  const v4 = {
    starts: Uint32Array.from(rows4, (r) => r[0]),
    ends: Uint32Array.from(rows4, (r) => r[1]),
    codes: Uint16Array.from(rows4, (r) => r[2]),
  };
  const v6 = {
    starts: BigUint64Array.from(rows6, (r) => r[0]),
    ends: BigUint64Array.from(rows6, (r) => r[1]),
    codes: Uint16Array.from(rows6, (r) => r[2]),
  };

  return { v4, v6, rows: rows4.length + rows6.length, skipped };
}

/**
 * Index of the last range whose start is <= value, or -1.
 *
 * @param {Uint32Array | BigUint64Array} starts
 * @param {number | bigint} value
 * @returns {number}
 */
function floorIndex(starts, value) {
  let low = 0;
  let high = starts.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const at = starts[mid];
    if (at !== undefined && at <= value) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * @param {GeoDb | null | undefined} db
 * @param {unknown} ip
 * @returns {string | null} ISO 3166-1 alpha-2, or null when unknown or unroutable
 */
export function lookupCountry(db, ip) {
  if (!db) return null;
  const parsed = parseIp(ip);
  if (!parsed) return null;

  const table = parsed.family === 4 ? db.v4 : db.v6;
  const i = floorIndex(table.starts, parsed.value);
  if (i === -1) return null;
  const end = table.ends[i];
  const code = table.codes[i];
  if (end === undefined || code === undefined || end < parsed.value) return null;
  return unpackCode(code);
}

/**
 * True when the database file is old enough that a newer monthly release
 * should exist. DB-IP publishes on the 1st of each month.
 *
 * @param {number | null} modifiedMs file mtime, or null when there is no file
 * @param {number} nowMs
 * @param {number} [maxAgeDays]
 * @returns {boolean}
 */
export function isStale(modifiedMs, nowMs, maxAgeDays = 40) {
  if (modifiedMs === null) return true;
  return nowMs - modifiedMs > maxAgeDays * 24 * 60 * 60 * 1000;
}
