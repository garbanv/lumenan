// @ts-check
/**
 * Public share links.
 *
 * The token is a bearer secret: whoever has the URL can read that site's
 * aggregate stats. 32 random bytes (256 bits) make it unguessable, so a lookup
 * by token needs no further rate limiting to be safe from enumeration.
 */
import { randomBytes } from 'node:crypto';

/** 43 URL-safe characters (32 bytes, base64url, no padding). */
export function generateShareToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Cheap shape check done before any database lookup, so junk in the URL never
 * becomes a query.
 *
 * @param {unknown} value
 * @returns {value is string}
 */
export function isShareToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}
