import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'sa_session';

/**
 * Optimistic routing guard.
 *
 * This file was `middleware.ts` before Next.js 16. The proxy runs on the Node.js
 * runtime, so it could reach the database, but it deliberately does not: a
 * session lookup on every navigation would put a query in front of every page.
 * All it does is bounce requests that carry no session cookie at all, which
 * avoids rendering a protected page shell for an obviously-signed-out visitor.
 * The authoritative check is `requireUser()` in lib/auth.ts, which every
 * protected page and API route calls. This is a UX optimisation, not the
 * security boundary.
 */
const PROTECTED_PREFIXES = ['/sites', '/dashboard', '/settings', '/admin'];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (!isProtected) return NextResponse.next();

  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const loginUrl = new URL('/login', req.url);
  // Preserve where the user was heading so login can return them there.
  loginUrl.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Skip static assets, the tracker, and API routes (which return JSON 401s
  // rather than redirects).
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|track.js|.*\\..*).*)'],
};
