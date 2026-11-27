import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/api';
import { trustedProxyHops } from '@/lib/env';
import { getClientIp } from '@/lib/ingest';
import { SHARE_LIMIT_PER_MINUTE, rateLimit } from '@/lib/rate-limit';
import { REALTIME_WINDOW_MINUTES, getRealtimeVisitors } from '@/lib/realtime';
import { getSiteByShareToken } from '@/lib/sites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Current-visitor count for a publicly shared dashboard. No session: the token is the credential. */
export async function GET(req: Request, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;

  const ip = getClientIp(req.headers, trustedProxyHops());
  const limit = rateLimit(`share:${ip}`, SHARE_LIMIT_PER_MINUTE, 60_000);
  if (!limit.allowed) {
    return jsonError('Too many requests.', 429);
  }

  try {
    const site = await getSiteByShareToken(token);
    if (!site) return jsonError('Not found.', 404);

    const visitors = await getRealtimeVisitors(site.id);
    return NextResponse.json(
      { visitors, windowMinutes: REALTIME_WINDOW_MINUTES },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    console.error('Shared realtime query failed:', err);
    return jsonError('Could not load realtime visitors.', 500);
  }
}
