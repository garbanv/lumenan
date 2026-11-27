import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import type { User } from '@/lib/types';

/**
 * Resolve the signed-in user or redirect to the login page.
 *
 * Every authenticated page calls this. The proxy (proxy.ts) only checks that a
 * cookie is present and does not query the database, so this is the
 * authoritative check and must not be skipped.
 */
export async function requireUser(returnTo?: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    const target = returnTo ? `?next=${encodeURIComponent(returnTo)}` : '';
    redirect(`/login${target}`);
  }
  return user;
}

/** For pages that should not be reachable while signed in (login, signup). */
export async function redirectIfSignedIn(to = '/sites'): Promise<void> {
  const user = await getCurrentUser();
  if (user) redirect(to);
}
