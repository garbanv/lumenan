// @ts-check
/**
 * Download the DB-IP country database.
 *
 *   node scripts/download-geoip.mjs            exit 1 on failure
 *   node scripts/download-geoip.mjs --soft     warn and exit 0 on failure (Docker build)
 *   node scripts/download-geoip.mjs --out=PATH write somewhere else
 *
 * The logic and the explanation live in lib/geoip-download.mjs.
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { downloadGeoIp, DEFAULT_OUT } from '../lib/geoip-download.mjs';

const soft = process.argv.includes('--soft');
const outArg = process.argv.find((a) => a.startsWith('--out='));
const out = outArg ? outArg.slice('--out='.length) : DEFAULT_OUT;

try {
  await downloadGeoIp({ out, log: console.log });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (soft) {
    // Do not fail a deploy over an optional data file; the app runs without
    // country data until the file is present, and tries to fetch it itself.
    await mkdir(path.dirname(out), { recursive: true });
    console.warn(`WARNING: ${message}\nContinuing without a GeoIP database.`);
  } else {
    console.error(message);
    process.exit(1);
  }
}
