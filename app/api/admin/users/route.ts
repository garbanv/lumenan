import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/api';
import { getAdminForApi } from '@/lib/admin-auth';
import { getAdminMetrics, listUsers } from '@/lib/admin';
import type { Plan, SubscriptionStatus } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_PLANS: readonly string[] = ['free', 'pro'];
const VALID_STATUSES: readonly string[] = ['none', 'active', 'past_due', 'canceled', 'paused'];
const VALID_SORTS: readonly string[] = ['created', 'pageviews', 'sites', 'email'];

/**
 * The admin user list, with optional filtering and pagination.
 *
 * Query parameters are validated against allowlists before they reach
 * listUsers, so nothing raw is interpolated into SQL — the sort column in
 * particular is chosen by name from a fixed set, never passed through.
 */
export async function GET(req: Request) {
  const admin = await getAdminForApi();
  // 404 rather than 403, so a non-admin cannot confirm that /admin exists.
  if (!admin) return jsonError('Not found.', 404);

  const url = new URL(req.url);
  const planParam = url.searchParams.get('plan');
  const statusParam = url.searchParams.get('status');
  const sortParam = url.searchParams.get('sort');

  const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10);

  try {
    const result = await listUsers({
      search: url.searchParams.get('q') ?? undefined,
      plan: planParam && VALID_PLANS.includes(planParam) ? (planParam as Plan) : 'all',
      status:
        statusParam && VALID_STATUSES.includes(statusParam)
          ? (statusParam as SubscriptionStatus)
          : 'all',
      sort:
        sortParam && VALID_SORTS.includes(sortParam)
          ? (sortParam as 'created' | 'pageviews' | 'sites' | 'email')
          : 'created',
      direction: url.searchParams.get('dir') === 'asc' ? 'asc' : 'desc',
      page: Number.isFinite(page) ? page : 1,
    });

    return NextResponse.json(
      { ...result, metrics: await getAdminMetrics() },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    console.error('Admin user list failed:', err);
    return jsonError('Could not load users.', 500);
  }
}
