// @ts-check
/**
 * Download the DB-IP "IP to Country Lite" database (CC BY 4.0, no account or
 * key needed) to data/geoip/dbip-country-lite.csv.gz.
 *
 * Used by scripts/download-geoip.mjs (build time, or by hand) and by the app
 * itself, which refreshes a stale file in the background (lib/geoip.ts).
 *
 * DB-IP publishes a new file on the 1st of every month, so this tries the
 * current month and then the previous one. The download is validated by parsing
 * it, and only then moved into place, so a failed or bogus download (an HTML
 * error page, a truncated file) can never replace a working database.
 *
 * Only this URL is contacted, and nothing about your visitors is sent to it.
 */

import { mkdir, rename, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { buildGeoDb } from './geoip.mjs';

export const DEFAULT_OUT = path.join('data', 'geoip', 'dbip-country-lite.csv.gz');

/** The real file has several hundred thousand ranges; far fewer means it is wrong. */
export const MIN_ROWS = 50_000;

/**
 * @param {Date} now
 * @returns {string[]} newest first
 */
export function monthUrls(now) {
  const urls = [];
  for (let back = 0; back < 2; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    urls.push(`https://download.db-ip.com/free/dbip-country-lite-${month}.csv.gz`);
  }
  return urls;
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.out]
 * @param {Date} [options.now]
 * @param {number} [options.minRows]
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<{ url: string, rows: number, out: string }>}
 */
export async function downloadGeoIp({
  fetchImpl = fetch,
  out = DEFAULT_OUT,
  now = new Date(),
  minRows = MIN_ROWS,
  log = () => {},
} = {}) {
  await mkdir(path.dirname(out), { recursive: true });

  /** @type {string[]} */
  const problems = [];
  for (const url of monthUrls(now)) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) {
        problems.push(`${url}: HTTP ${response.status}`);
        continue;
      }

      const compressed = Buffer.from(await response.arrayBuffer());
      const db = buildGeoDb(gunzipSync(compressed).toString('utf8'));
      if (db.rows < minRows) {
        problems.push(`${url}: only ${db.rows} ranges, expected at least ${minRows}`);
        continue;
      }

      const temp = `${out}.${process.pid}.tmp`;
      try {
        await writeFile(temp, compressed);
        await rename(temp, out); // atomic: readers see the old file or the new one
      } catch (err) {
        await rm(temp, { force: true });
        throw err;
      }
      log(`GeoIP: saved ${db.rows} ranges from ${url}`);
      return { url, rows: db.rows, out };
    } catch (err) {
      problems.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`Could not download the GeoIP database.\n  ${problems.join('\n  ')}`);
}
