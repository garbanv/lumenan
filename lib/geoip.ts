import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { buildGeoDb, isStale, lookupCountry } from './geoip.mjs';
import { DEFAULT_OUT, downloadGeoIp } from './geoip-download.mjs';

/**
 * Server-side country lookup. The logic and its explanation live in
 * ./geoip.mjs so it can be unit-tested directly by `node --test`; this file
 * loads the database file, keeps it in memory and keeps it fresh.
 *
 * Configuration (all optional):
 *   GEOIP_DB_PATH      where the DB-IP file lives (default data/geoip/dbip-country-lite.csv.gz)
 *   GEOIP_AUTO_UPDATE  "false" to stop the app fetching a newer monthly file itself
 *
 * Without a database file every lookup returns null and the app behaves exactly
 * as it did before this existed: country comes from CDN headers, if any.
 */

type GeoDb = ReturnType<typeof buildGeoDb>;

interface State {
  db: GeoDb | null;
  ready: Promise<void> | null;
  timer: ReturnType<typeof setInterval> | null;
}

// On globalThis so dev-mode module reloads don't load the file twice.
const holder = globalThis as typeof globalThis & { __geoip?: State };
const state: State = (holder.__geoip ??= { db: null, ready: null, timer: null });

const gunzipAsync = promisify(gunzip);
const DAY_MS = 24 * 60 * 60 * 1000;

function dbPath(): string {
  return path.resolve(process.env.GEOIP_DB_PATH || DEFAULT_OUT);
}

async function loadFromDisk(file: string): Promise<GeoDb | null> {
  let raw: Buffer;
  try {
    raw = await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`GeoIP: could not read ${file}:`, err);
    }
    return null;
  }

  try {
    const text = file.endsWith('.gz') ? (await gunzipAsync(raw)).toString('utf8') : raw.toString('utf8');
    const db = buildGeoDb(text);
    console.log(`GeoIP: loaded ${db.rows} ranges from ${file}`);
    return db;
  } catch (err) {
    console.warn(`GeoIP: ${file} is not a usable database:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Fetch a newer file when the current one is missing or older than ~40 days. */
async function refreshIfStale(file: string): Promise<void> {
  if (process.env.GEOIP_AUTO_UPDATE === 'false') return;

  let modified: number | null = null;
  try {
    modified = (await stat(file)).mtimeMs;
  } catch {
    // no file yet
  }
  if (!isStale(modified, Date.now())) return;

  try {
    await downloadGeoIp({ out: file, log: console.log });
    const fresh = await loadFromDisk(file);
    if (fresh) state.db = fresh;
  } catch (err) {
    // Keep serving from whatever is already loaded.
    console.warn('GeoIP: update failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Load the database (once) and start the daily freshness check. Safe to call
 * repeatedly; instrumentation.ts calls it at boot so the first request doesn't
 * wait for the file.
 */
export function startGeoIp(): Promise<void> {
  state.ready ??= (async () => {
    const file = dbPath();
    state.db = await loadFromDisk(file);
    if (!state.db) {
      console.warn(
        `GeoIP: no database at ${file}. Country will only come from CDN headers. ` +
          'Run `npm run geoip:update` to download one.'
      );
    }

    void refreshIfStale(file);
    state.timer = setInterval(() => void refreshIfStale(file), DAY_MS);
    state.timer.unref(); // never keep the process alive just for this
  })();
  return state.ready;
}

/**
 * Country for an IP, resolved in memory. The IP is not stored or logged here.
 */
export async function countryFromIp(ip: string): Promise<string | null> {
  await startGeoIp();
  return lookupCountry(state.db, ip);
}
