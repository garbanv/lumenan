import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { query } from './db';
import { SESSION_COOKIE, SESSION_TTL_DAYS, isProduction } from './env';
import { findUserById } from './users';
import type { User } from './types';

/**
 * Sessions are opaque server-side records.
 *
 * The browser holds a 256-bit random token; the database holds only its
 * SHA-256. That way a database disclosure yields no usable session tokens, and
 * logout/revocation is a real delete rather than a signed-cookie expiry dance.
 * A plain SHA-256 (not bcrypt) is correct here because the token is already
 * high-entropy: there is no dictionary to attack.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  userId: string,
  userAgent: string | null
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO sessions (user_id, token_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, hashToken(token), userAgent?.slice(0, 512) ?? null, expiresAt]
  );

  return { token, expiresAt };
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

export function sessionCookieOptions(expiresAt: Date) {
  return {
    // httpOnly: not readable from JavaScript, so XSS cannot exfiltrate it.
    httpOnly: true,
    // lax: sent on top-level navigations (so a link into /dashboard works) but
    // not on cross-site POSTs, which blocks CSRF for state-changing requests.
    sameSite: 'lax' as const,
    secure: isProduction,
    path: '/',
    expires: expiresAt,
  };
}

/**
 * Resolve the signed-in user from the session cookie, or null.
 *
 * Two queries rather than one join. That is deliberate: mapping a users row to
 * the `User` type lives in exactly one place (lib/users.ts), and a join here
 * would need its own copy of that mapping — which is precisely how the two
 * drifted apart when `is_admin` was added. Both statements are primary-key
 * lookups, so the extra round trip is immaterial next to getting the shape
 * wrong.
 */
export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const { rows } = await query<{ user_id: string; session_id: string }>(
    `SELECT user_id, id AS session_id
       FROM sessions
      WHERE token_hash = $1
        AND expires_at > now()`,
    [hashToken(token)]
  );

  const row = rows[0];
  if (!row) return null;

  // Fire-and-forget; must not block or fail the request.
  maybeRefresh(row.session_id, token);

  return findUserById(row.user_id);
}

/**
 * Extend a session that is more than a third of the way through its life.
 *
 * Deliberately fire-and-forget: a failed refresh must not fail the request,
 * and the common case (a session hours old) does no work at all. Doing this on
 * every request would mean a write per page view of the dashboard.
 */
const refreshing = new Set<string>();
function maybeRefresh(sessionId: string, token: string): void {
  if (refreshing.has(sessionId)) return;
  refreshing.add(sessionId);
  void (async () => {
    try {
      const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
      await query(
        `UPDATE sessions
            SET expires_at = $2
          WHERE token_hash = $1
            AND expires_at < now() + ($3 || ' days')::interval`,
        [hashToken(token), expiresAt, String(SESSION_TTL_DAYS / 3)]
      );
    } catch {
      // Ignore: the session simply expires at its original time.
    } finally {
      refreshing.delete(sessionId);
    }
  })();
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

/** Used when a password changes, to sign out every other device. */
export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

/** Best-effort cleanup of expired rows; safe to call on any login. */
export async function pruneExpiredSessions(): Promise<void> {
  try {
    await query('DELETE FROM sessions WHERE expires_at < now()');
  } catch {
    // Housekeeping only; never block a login on it.
  }
}
