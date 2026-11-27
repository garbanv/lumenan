// @ts-check
/**
 * Parse an on/off environment variable. Unset or empty falls back to
 * `fallback`; "false", "0", "no" and "off" (any case) are off; anything else
 * that is set is on. Deliberately forgiving, because a typo like `False` that
 * silently leaves signups open is the failure to avoid.
 *
 * @param {string | undefined} raw
 * @param {boolean} fallback
 * @returns {boolean}
 */
export function parseBooleanFlag(raw, fallback) {
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase();
  if (value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(value);
}
