import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import { getSiteForUser } from '@/lib/sites';
import { REALTIME_WINDOW_MINUTES, getRealtimeVisitors } from '@/lib/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError('Not signed in.', 401);

  const siteId = new URL(req.url).searchParams.get('siteId');
  if (!siteId) return jsonError('siteId is required.', 400);

  try {
    // Ownership first, as in /api/stats: another account's site is a 404.
    const site = await getSiteForUser(siteId, user.id);
    if (!site) return jsonError('Site not found.', 404);

    const visitors = await getRealtimeVisitors(site.id);
    return NextResponse.json(
      { visitors, windowMinutes: REALTIME_WINDOW_MINUTES },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    console.error('Realtime query failed:', err);
    return jsonError('Could not load realtime visitors.', 500);
  }
}
