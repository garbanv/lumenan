import { redirect } from 'next/navigation';
import { getCurrentUser } from './session';
import type { MutationContext } from './admin';
import type { User } from './types';

/** Where a signed-in non-admin is sent instead of seeing a bare 404. */
export const ADMIN_DENIED_PATH = '/admin/no-access';

/**
 * Resolve the signed-in user, or redirect to login.
 *
 * Separate from requireUser() only in return shape: these two live together so
 * the redirect target stays consistent.
 */
export async function requireUserForAdmin(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=%2Fadmin');
  return user;
}

/**
 * Resolve an operator, or redirect to an explanatory page.
 *
 * This used to call notFound(), reasoning that a 404 avoids disclosing that an
 * admin area exists. In practice that was the wrong trade: a signed-in
 * non-admin — most often the person who just deployed the instance — saw a bare
 * 404 and could not tell whether the route was missing, the build was stale, or
 * they simply lacked the role. A dead end for a legitimate operator is a worse
 * outcome than disclosing a page's existence to an authenticated user.
 *
 * The API routes still answer 404 for non-admins (see getAdminForApi), because
 * they are called by fetch() rather than a browser navigation and the same
 * reasoning about discoverability does not apply.
 */
export async function requireAdminPage(): Promise<User> {
  const user = await requireUserForAdmin();
  if (!user.isAdmin) redirect(ADMIN_DENIED_PATH);
  return user;
}

/**
 * Operator check for API routes, returning null instead of redirecting.
 *
 * The route decides the response, because a redirect is meaningless to fetch().
 * Callers return 404 rather than 403, so an authenticated non-admin cannot use
 * the API to probe which admin endpoints exist.
 */
export async function getAdminForApi(): Promise<User | null> {
  const user = await getCurrentUser();
  if (!user || !user.isAdmin) return null;
  return user;
}

/** Builds the audit context recorded on every privileged mutation. */
export function adminIdentity(user: User): MutationContext {
  return { id: user.id, email: user.email };
}
