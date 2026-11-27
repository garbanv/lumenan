import { NextResponse } from 'next/server';
import { isCrossOrigin, jsonError, readJson } from '@/lib/api';
import { adminIdentity, getAdminForApi } from '@/lib/admin-auth';
import { getUserDetail, setAdminFlag, updateUserAsAdmin } from '@/lib/admin';
import type { Plan, SubscriptionStatus } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_PLANS: readonly string[] = ['free', 'pro'];
const VALID_STATUSES: readonly string[] = ['none', 'active', 'past_due', 'canceled', 'paused'];

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, props: RouteContext) {
  const params = await props.params;
  const admin = await getAdminForApi();
  if (!admin) return jsonError('Not found.', 404);

  try {
    const detail = await getUserDetail(params.id);
    if (!detail) return jsonError('User not found.', 404);
    return NextResponse.json(detail, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('Admin user detail failed:', err);
    return jsonError('Could not load this user.', 500);
  }
}

interface UpdateBody {
  plan?: string;
  subscriptionStatus?: string;
  pricePerMonth?: number | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  internalNote?: string | null;
  isAdmin?: boolean;
}

/**
 * Apply an administrative change.
 *
 * Two distinct operations share the route because they share the authorization
 * and audit concerns: a plan/billing change (PATCH body without isAdmin) and a
 * role change (isAdmin). They are validated separately because they fail for
 * different reasons.
 */
export async function PATCH(req: Request, props: RouteContext) {
  const params = await props.params;
  if (isCrossOrigin(req)) return jsonError('Cross-origin request rejected.', 403);

  const admin = await getAdminForApi();
  if (!admin) return jsonError('Not found.', 404);

  const { data, error } = await readJson<UpdateBody>(req);
  if (error) return error;

  const fields: Record<string, string> = {};

  if (data?.plan !== undefined && !VALID_PLANS.includes(data.plan)) {
    fields.plan = 'Plan must be free or pro.';
  }
  if (
    data?.subscriptionStatus !== undefined &&
    !VALID_STATUSES.includes(data.subscriptionStatus)
  ) {
    fields.subscriptionStatus = `Status must be one of: ${VALID_STATUSES.join(', ')}.`;
  }
  if (
    data?.pricePerMonth !== undefined &&
    data.pricePerMonth !== null &&
    (!Number.isInteger(data.pricePerMonth) || data.pricePerMonth < 0 || data.pricePerMonth > 100_000)
  ) {
    fields.pricePerMonth = 'Price must be a whole number of currency units, 0 or more.';
  }
  if (
    data?.currentPeriodEnd !== undefined &&
    data.currentPeriodEnd !== null &&
    Number.isNaN(Date.parse(data.currentPeriodEnd))
  ) {
    fields.currentPeriodEnd = 'Enter a valid date.';
  }
  if (data?.internalNote !== undefined && data.internalNote !== null && data.internalNote.length > 2000) {
    fields.internalNote = 'Note is too long (maximum 2000 characters).';
  }

  if (Object.keys(fields).length > 0) {
    return jsonError('Please fix the highlighted fields.', 400, fields);
  }

  const context = adminIdentity(admin);

  try {
    // Role changes are handled first and independently: they are a different
    // class of operation with their own invariants (never remove the last
    // operator, never demote yourself out of your own session).
    if (data?.isAdmin !== undefined) {
      const result = await setAdminFlag(params.id, data.isAdmin, context);
      if (!result.ok) {
        if (result.reason === 'not_found') return jsonError('User not found.', 404);
        if (result.reason === 'self') {
          return jsonError('You cannot remove your own admin access.', 400);
        }
        if (result.reason === 'last_admin') {
          return jsonError(
            'This is the only administrator. Promote someone else first.',
            400
          );
        }
      }
    }

    const hasBillingChange =
      data?.plan !== undefined ||
      data?.subscriptionStatus !== undefined ||
      data?.pricePerMonth !== undefined ||
      data?.currentPeriodEnd !== undefined ||
      data?.cancelAtPeriodEnd !== undefined ||
      data?.internalNote !== undefined;

    if (hasBillingChange) {
      const result = await updateUserAsAdmin(
        params.id,
        {
          ...(data?.plan !== undefined ? { plan: data.plan as Plan } : {}),
          ...(data?.subscriptionStatus !== undefined
            ? { subscriptionStatus: data.subscriptionStatus as SubscriptionStatus }
            : {}),
          ...(data?.pricePerMonth !== undefined ? { pricePerMonth: data.pricePerMonth } : {}),
          ...(data?.currentPeriodEnd !== undefined
            ? { currentPeriodEnd: data.currentPeriodEnd }
            : {}),
          ...(data?.cancelAtPeriodEnd !== undefined
            ? { cancelAtPeriodEnd: data.cancelAtPeriodEnd }
            : {}),
          ...(data?.internalNote !== undefined ? { internalNote: data.internalNote } : {}),
        },
        context
      );

      if (!result.ok) return jsonError('User not found.', 404);
      return NextResponse.json(result.detail);
    }

    // Role-only change: return the refreshed detail so the client has one shape
    // to handle regardless of what changed.
    const detail = await getUserDetail(params.id);
    if (!detail) return jsonError('User not found.', 404);
    return NextResponse.json(detail);
  } catch (err) {
    console.error('Admin update failed:', err);
    return jsonError('Could not update this user.', 500);
  }
}
