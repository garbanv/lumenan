import { NextResponse } from 'next/server';
import { isCrossOrigin, jsonError, readJson } from '@/lib/api';
import { can } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { getSiteForUser } from '@/lib/sites';
import {
  MAX_MEMBERS,
  MAX_PENDING_INVITES,
  createInvite,
  validateInviteInput,
} from '@/lib/team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Create an invitation link for a site (owner only).
 * Body: { role: 'manager' | 'viewer', email?: string }
 * Responds with the raw token exactly once; only its hash is stored.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (isCrossOrigin(req)) return jsonError('Cross-origin request rejected.', 403);

  const user = await getCurrentUser();
  if (!user) return jsonError('Not signed in.', 401);

  const { data, error } = await readJson<{ role?: unknown; email?: unknown }>(req);
  if (error) return error;

  const input = validateInviteInput(data ?? {});
  if (!input.ok) return jsonError('Please fix the highlighted fields.', 400, input.fields);

  try {
    const site = await getSiteForUser(params.id, user.id);
    if (!site) return jsonError('Site not found.', 404);
    if (!can(site.role, 'team')) return jsonError('Only the owner can invite people.', 403);

    const result = await createInvite(site.id, user.id, { role: input.role, email: input.email });
    if (!result.ok) {
      return jsonError(
        result.reason === 'too_many_invites'
          ? `A site can have at most ${MAX_PENDING_INVITES} open invitations. Revoke one first.`
          : `A site can have at most ${MAX_MEMBERS} people with access.`,
        409
      );
    }

    return NextResponse.json(
      { invite: result.invite, token: result.token },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    console.error('Failed to create invite:', err);
    return jsonError('Could not create the invitation.', 500);
  }
}
