import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import { getSiteForUser } from '@/lib/sites';
import { getStats, resolveRange } from '@/lib/stats';
import { parseFilters } from '@/lib/filters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError('Not signed in.', 401);

  const url = new URL(req.url);
  const siteId = url.searchParams.get('siteId');
  if (!siteId) return jsonError('siteId is required.', 400);

  try {
    // Ownership is checked before any stats query runs, so a site id belonging
    // to another account yields 404 and never touches their data.
    const site = await getSiteForUser(siteId, user.id);
    if (!site) return jsonError('Site not found.', 404);

    const spec = resolveRange(url.searchParams.get('range'));
    const stats = await getStats(site.id, spec, parseFilters(url.searchParams));

    return NextResponse.json(
      {
        site: { id: site.id, name: site.name, domain: site.domain },
        ...stats,
      },
      {
        // Per-user data must never be cached by a shared proxy.
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  } catch (err) {
    console.error('Stats query failed:', err);
    return jsonError('Could not load stats.', 500);
  }
}
