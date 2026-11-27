import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE_NAME,
  createSession,
  pruneExpiredSessions,
  sessionCookieOptions,
} from '@/lib/session';

/** Shared by the login and signup routes, which differ only in authorization. */
export async function startSession(
  userId: string,
  userAgent: string | null
): Promise<NextResponse> {
  const { token, expiresAt } = await createSession(userId, userAgent);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(expiresAt));

  // Housekeeping on a code path that already writes to the sessions table, so
  // it costs nothing extra and stops expired rows accumulating forever.
  await pruneExpiredSessions();

  return response;
}

/** Expire the cookie immediately; the server-side row goes too. */
export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    ...sessionCookieOptions(new Date(0)),
    maxAge: 0,
  });
  return response;
}

export function userAgentOf(req: Request): string | null {
  return req.headers.get('user-agent');
}
