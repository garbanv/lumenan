import { NextResponse } from 'next/server';
import { isCrossOrigin, jsonError, readJson } from '@/lib/api';
import { MAX_GOALS_PER_SITE, createGoal, validateGoalInput } from '@/lib/goals';
import { getCurrentUser } from '@/lib/session';
import { can } from '@/lib/roles';
import { getSiteForUser } from '@/lib/sites';
import { invalidateStatsCache } from '@/lib/stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Create a goal on one of the signed-in user's sites. Body: { type, value, name? } */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (isCrossOrigin(req)) return jsonError('Cross-origin request rejected.', 403);

  const user = await getCurrentUser();
  if (!user) return jsonError('Not signed in.', 401);

  const { data, error } = await readJson<{ type?: unknown; value?: unknown; name?: unknown }>(req);
  if (error) return error;

  const validated = validateGoalInput(data ?? {});
  if (!validated.ok) return jsonError('Please fix the highlighted fields.', 400, validated.fields);

  try {
    // Ownership before anything is written; someone else's site is a 404.
    const site = await getSiteForUser(params.id, user.id);
    if (!site) return jsonError('Site not found.', 404);
    if (!can(site.role, 'manage')) return jsonError('You do not have permission to do that.', 403);

    const result = await createGoal(site.id, validated.goal);
    if (!result.ok) {
      return result.reason === 'limit'
        ? jsonError(`A site can have at most ${MAX_GOALS_PER_SITE} goals.`, 409)
        : jsonError('That goal already exists.', 409, { value: 'That goal already exists.' });
    }

    invalidateStatsCache();
    return NextResponse.json({ goal: result.goal }, { status: 201 });
  } catch (err) {
    console.error('Failed to create goal:', err);
    return jsonError('Could not create the goal.', 500);
  }
}
