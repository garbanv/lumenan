import { NextResponse } from 'next/server';
import { isCrossOrigin, jsonError } from '@/lib/api';
import { deleteGoal } from '@/lib/goals';
import { getCurrentUser } from '@/lib/session';
import { getSiteForUser } from '@/lib/sites';
import { invalidateStatsCache } from '@/lib/stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  req: Request,
  props: { params: Promise<{ id: string; goalId: string }> }
) {
  const params = await props.params;
  if (isCrossOrigin(req)) return jsonError('Cross-origin request rejected.', 403);

  const user = await getCurrentUser();
  if (!user) return jsonError('Not signed in.', 401);

  try {
    const site = await getSiteForUser(params.id, user.id);
    if (!site) return jsonError('Site not found.', 404);

    // Scoped by site id as well, so a goal of another site can never be removed here.
    if (!(await deleteGoal(site.id, params.goalId))) return jsonError('Goal not found.', 404);

    invalidateStatsCache();
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('Failed to delete goal:', err);
    return jsonError('Could not delete the goal.', 500);
  }
}
