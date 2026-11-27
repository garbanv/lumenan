import { NextResponse } from 'next/server';
import { isCrossOrigin, jsonError, readJson } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import { ACCEPT_MESSAGES, acceptInvite } from '@/lib/team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Accept an invitation as the signed-in user. Body: { token }
 * The token is the credential; the session says who is using it.
 */
export async function POST(req: Request) {
  if (isCrossOrigin(req)) return jsonError('Cross-origin request rejected.', 403);

  const user = await getCurrentUser();
  if (!user) return jsonError('Sign in to accept this invitation.', 401);

  const { data, error } = await readJson<{ token?: unknown }>(req);
  if (error) return error;

  try {
    const result = await acceptInvite(typeof data?.token === 'string' ? data.token : '', user);
    if (!result.ok) return jsonError(ACCEPT_MESSAGES[result.reason], result.reason === 'invalid' ? 404 : 409);
    return NextResponse.json({ siteId: result.siteId });
  } catch (err) {
    console.error('Failed to accept invite:', err);
    return jsonError('Could not accept the invitation.', 500);
  }
}
