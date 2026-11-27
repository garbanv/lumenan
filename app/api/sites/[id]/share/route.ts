import { NextResponse } from 'next/server';
import { isCrossOrigin, jsonError, readJson } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import { setSharingForUser, type ShareAction } from '@/lib/sites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS: readonly ShareAction[] = ['enable', 'regenerate', 'disable'];

/**
 * Manage the public share link of one site (owner only).
 * Body: { "action": "enable" | "regenerate" | "disable" }
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (isCrossOrigin(req)) return jsonError('Cross-origin request rejected.', 403);

  const user = await getCurrentUser();
  if (!user) return jsonError('Not signed in.', 401);

  const { data, error } = await readJson<{ action?: string }>(req);
  if (error) return error;

  const action = ACTIONS.find((candidate) => candidate === data?.action);
  if (!action) return jsonError('action must be enable, regenerate or disable.', 400);

  try {
    const site = await setSharingForUser(params.id, user.id, action);
    // Someone else's site is reported as missing, as everywhere else.
    if (!site) return jsonError('Site not found.', 404);
    return NextResponse.json(
      { shareToken: site.shareToken },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    console.error('Failed to update sharing:', err);
    return jsonError('Could not update sharing.', 500);
  }
}
