// @ts-check
/**
 * Password hashing.
 *
 * Plain JavaScript with JSDoc types so it runs directly under `node --test` on
 * any Node version, without a TypeScript loader. lib/password.ts re-exports it
 * with the ambient types intact.
 *
 * bcryptjs is used rather than a native binding (argon2, bcrypt): the native
 * modules are rejected by macOS code signing under some configurations and add
 * a compile step to Docker images. Pure JavaScript means the identical code
 * path runs everywhere.
 */

import bcrypt from 'bcryptjs';

/**
 * Cost 11 measured at ~145ms per hash on an M-series core: slow enough to make
 * offline cracking expensive, fast enough not to be a denial-of-service vector
 * on the login endpoint.
 */
const COST = 11;

/** bcrypt silently truncates beyond 72 bytes, so reject instead of surprising. */
export const MAX_PASSWORD_BYTES = 72;
export const MIN_PASSWORD_LENGTH = 8;

/**
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  return bcrypt.hash(password, COST);
}

/**
 * @param {string} password
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, hash) {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    // A malformed or legacy hash must read as "wrong password", never as a 500
    // that tells an attacker the account exists.
    return false;
  }
}

/**
 * A precomputed hash of an unrelated string. Comparing against this when no
 * user matches keeps the failed-login path the same cost as the success path,
 * so response timing does not reveal whether an email is registered.
 */
const DUMMY_HASH = '$2a$11$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

/**
 * @param {string} password
 * @returns {Promise<void>}
 */
export async function burnPasswordTime(password) {
  await bcrypt.compare(password, DUMMY_HASH);
}

/**
 * Shared by the signup form and the API so both enforce identical rules.
 *
 * @param {string} password
 * @returns {{ message: string } | null}
 */
export function validatePassword(password) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return { message: 'Password is too long (maximum 72 bytes).' };
  }
  return null;
}
