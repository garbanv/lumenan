import { NextResponse } from 'next/server';
import { isCrossOrigin, jsonError, readJson } from '@/lib/api';
import { can, MEMBER_ROLES } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { getSiteForUser } from '@/lib/sites';
import { removeMember, setMemberRole } from '@/lib/team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string; userId: string }> };

/** Change a member's role (owner only). Body: { role: 'manager' | 'viewer' } */
export async function PATCH(req: Request, props: Context) {
  const params = await props.params;
  if (isCrossOrigin(req)) return jsonError('Cross-origin request rejected.', 403);

  const user = await getCurrentUser();
  if (!user) return jsonError('Not signed in.', 401);

  const { data, error } = await readJson<{ role?: unknown }>(req);
  if (error) return error;
  const role = MEMBER_ROLES.find((candidate) => candidate === data?.role);
  if (!role) return jsonError('role must be manager or viewer.', 400);

  try {
    const site = await getSiteForUser(params.id, user.id);
    if (!site) return jsonError('Site not found.', 404);
    if (!can(site.role, 'team')) return jsonError('Only the owner can change roles.', 403);

    if (!(await setMemberRole(site.id, params.userId, role))) return jsonError('Member not found.', 404);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Failed to change role:', err);
    return jsonError('Could not change the role.', 500);
  }
}

/**
 * Remove someone's access. The owner can remove anyone; a member can remove
 * themselves ("leave this site").
 */
export async function DELETE(req: Request, props: Context) {
  const params = await props.params;
  if (isCrossOrigin(req)) return jsonError('Cross-origin request rejected.', 403);

  const user = await getCurrentUser();
  if (!user) return jsonError('Not signed in.', 401);

  try {
    const site = await getSiteForUser(params.id, user.id);
    if (!site) return jsonError('Site not found.', 404);

    const leaving = params.userId === user.id;
    if (!leaving && !can(site.role, 'team')) {
      return jsonError('Only the owner can remove people.', 403);
    }

    if (!(await removeMember(site.id, params.userId))) return jsonError('Member not found.', 404);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('Failed to remove member:', err);
    return jsonError('Could not remove that person.', 500);
  }
}
