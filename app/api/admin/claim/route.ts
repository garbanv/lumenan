import { NextResponse } from 'next/server';
import { isCrossOrigin, jsonError } from '@/lib/api';
import { claimFirstAdmin, needsFirstAdmin } from '@/lib/admin';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * First-operator bootstrap.
 *
 * GET is intentionally reachable without admin rights: a fresh deployment has no
 * operator, so someone has to be able to discover that claiming is possible. It
 * leaks nothing but a boolean and whether the caller is signed in.
 *
 * POST is guarded by "no admin exists" inside the UPDATE itself (see
 * claimFirstAdmin), so it cannot be used to escalate once the deployment is set
 * up. After that, promoting an account is an in-app admin action with an audit
 * entry.
 */
export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({
    signedIn: !!user,
    isAdmin: user?.isAdmin ?? false,
    // Only offer the claim when there is genuinely nobody who can administer
    // the deployment yet.
    needsFirstAdmin: user ? await needsFirstAdmin() : false,
  });
}

export async function POST(req: Request) {
  if (isCrossOrigin(req)) return jsonError('Cross-origin request rejected.', 403);

  const user = await getCurrentUser();
  if (!user) return jsonError('Not signed in.', 401);

  const claimed = await claimFirstAdmin(user.id);
  if (!claimed) {
    return jsonError('This deployment already has an administrator.', 409);
  }

  return NextResponse.json({ ok: true, isAdmin: true });
}
