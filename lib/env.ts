/**
 * Environment access, validated once at startup.
 *
 * Reading configuration lazily (inside functions) rather than at module top
 * level keeps `next build` from failing on a machine without secrets: the
 * build only needs to evaluate modules, not connect to anything.
 */

import { parseBooleanFlag } from './flags';

function required(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}.\n${hint}\n` +
        `Set it in .env (see .env.example) or in your hosting provider's environment settings.`
    );
  }
  return value;
}

export function databaseUrl(): string {
  return required(
    'DATABASE_URL',
    'A PostgreSQL connection string, for example:\n' +
      '  DATABASE_URL=postgresql://user:password@localhost:5432/analytics'
  );
}

/**
 * Long-lived secret mixed into the visitor hash alongside the random daily salt
 * (see lib/salts.mjs). It acts as a pepper: a copy of the database alone is not
 * enough to test IP addresses against the current day's hashes. Changing it
 * only makes the current day's visitors look new once; it no longer affects
 * history.
 */
export function visitorSalt(): string {
  return required(
    'VISITOR_SALT',
    'Generate a long random value and keep it secret and stable:\n' +
      '  openssl rand -hex 32'
  );
}

/**
 * How many reverse proxies sit in front of the app and append to
 * `x-forwarded-for`. Default 1 (one Traefik/nginx/Vercel edge). Use 2 for a CDN
 * plus a proxy, and 0 if the app is exposed directly, which makes the client IP
 * unknowable and collapses all visitors into one, so only do that deliberately.
 * Too high a value lets clients spoof their IP; too low attributes traffic to
 * your own proxy.
 */
export function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw.trim() === '') return 1;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : 1;
}

/**
 * Whether new accounts may be created. On by default. Set ALLOW_SIGNUP=false on
 * a deployment that should only serve people you have already set up: it stops
 * strangers who find the URL from creating accounts. Existing accounts and
 * sign-in are unaffected. Read on every call, so changing it only needs a
 * restart, not a rebuild.
 */
export function signupsOpen(): boolean {
  return parseBooleanFlag(process.env.ALLOW_SIGNUP, true);
}

/** Public origin, used for absolute URLs in the marketing pages and snippets. */
export function publicOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (explicit) return explicit.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export const SESSION_COOKIE = 'sa_session';

/** How long a login lasts before the user must sign in again. */
export const SESSION_TTL_DAYS = 30;

export const isProduction = process.env.NODE_ENV === 'production';
