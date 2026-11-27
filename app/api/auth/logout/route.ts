import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth-routes';
import { isCrossOrigin, jsonError } from '@/lib/api';
import { destroySession, SESSION_COOKIE_NAME } from '@/lib/session';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (isCrossOrigin(req)) return jsonError('Cross-origin request rejected.', 403);

  // Delete the server-side row first; clearing the cookie alone would leave a
  // valid session in the database that a stolen cookie could still use.
  try {
    await destroySession((await cookies()).get(SESSION_COOKIE_NAME)?.value);
  } catch (err) {
    // Log but still clear the cookie: the user asked to be signed out, and a
    // stale row expires on its own.
    console.error('Failed to revoke session:', err);
  }

  return clearSessionCookie(NextResponse.json({ ok: true }));
}
