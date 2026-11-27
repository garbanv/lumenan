import { NextResponse } from 'next/server';
import { isCrossOrigin, jsonError } from '@/lib/api';
import { can } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { getSiteForUser } from '@/lib/sites';
import { revokeInvite } from '@/lib/team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Revoke an unused invitation (owner only). The link stops working at once. */
export async function DELETE(
  req: Request,
  props: { params: Promise<{ id: string; inviteId: string }> }
) {
  const params = await props.params;
  if (isCrossOrigin(req)) return jsonError('Cross-origin request rejected.', 403);

  const user = await getCurrentUser();
  if (!user) return jsonError('Not signed in.', 401);

  try {
    const site = await getSiteForUser(params.id, user.id);
    if (!site) return jsonError('Site not found.', 404);
    if (!can(site.role, 'team')) return jsonError('Only the owner can manage invitations.', 403);

    if (!(await revokeInvite(site.id, params.inviteId))) return jsonError('Invitation not found.', 404);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('Failed to revoke invite:', err);
    return jsonError('Could not revoke the invitation.', 500);
  }
}
