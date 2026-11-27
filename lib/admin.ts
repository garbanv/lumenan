import { query, transaction } from './db';
import { SUBSCRIPTION_STATUSES, normalizeStatus } from './users';
import type {
  AdminAuditEntry,
  AdminMetrics,
  AdminUserDetail,
  AdminUserSummary,
  Plan,
  SubscriptionStatus,
} from './types';

/**
 * Platform-operator queries.
 *
 * Everything here reads across tenants and is therefore only ever called from
 * the /admin surface behind requireAdmin(). Nothing in this module is reachable
 * from a normal user session, and no function takes a user id from the caller
 * without the caller having been authorised first.
 */

const PAGE_SIZE = 25;

function toPlan(value: string): Plan {
  return value === 'pro' ? 'pro' : 'free';
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  is_admin: boolean;
  subscription_status: string;
  price_per_month: number | null;
  currency: string;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  created_at: Date;
  site_count: number;
  pageviews_7d: number;
  pageviews_total: number;
  last_event_at: Date | null;
}

function toSummary(row: AdminUserRow): AdminUserSummary {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    plan: toPlan(row.plan),
    isAdmin: row.is_admin,
    subscriptionStatus: normalizeStatus(row.subscription_status),
    pricePerMonth: row.price_per_month,
    currency: row.currency,
    currentPeriodEnd: row.current_period_end?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    createdAt: row.created_at.toISOString(),
    siteCount: row.site_count,
    pageviews7d: row.pageviews_7d,
    pageviewsTotal: row.pageviews_total,
    lastEventAt: row.last_event_at?.toISOString() ?? null,
  };
}

/**
 * Per-user columns plus activity, as a reusable LATERAL-joined projection.
 *
 * Aggregates are computed per user in a lateral subquery rather than by joining
 * and grouping the whole events table, so adding a metric does not fan out the
 * result set.
 */
const USER_LIST_COLUMNS = `
  u.id, u.email, u.name, u.plan, u.is_admin, u.subscription_status,
  u.price_per_month, u.currency, u.current_period_end, u.cancel_at_period_end,
  u.created_at,
  coalesce(site_stats.site_count, 0)::int      AS site_count,
  coalesce(ev.pageviews_7d, 0)::int            AS pageviews_7d,
  coalesce(ev.pageviews_total, 0)::int         AS pageviews_total,
  ev.last_event_at`;

const USER_LIST_JOINS = `
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS site_count FROM sites s WHERE s.user_id = u.id
  ) site_stats ON true
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE e.created_at > now() - interval '7 days')::int AS pageviews_7d,
           count(*)::int                                                          AS pageviews_total,
           max(e.created_at)                                                      AS last_event_at
      FROM events e
      JOIN sites s2 ON s2.id = e.site_id
     WHERE s2.user_id = u.id
       AND e.event_type = 'pageview'
  ) ev ON true`;

export interface ListUsersOptions {
  search?: string;
  plan?: Plan | 'all';
  status?: SubscriptionStatus | 'all';
  page?: number;
  /** Column to sort by; whitelisted, never interpolated from raw input. */
  sort?: 'created' | 'pageviews' | 'sites' | 'email';
  direction?: 'asc' | 'desc';
}

export interface ListUsersResult {
  users: AdminUserSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * The admin user list.
 *
 * Filtering happens in SQL rather than in the client, because the whole point of
 * this screen is answering "how many users do we have and who are they" once
 * there are more accounts than fit on one page.
 */
export async function listUsers(options: ListUsersOptions = {}): Promise<ListUsersResult> {
  const search = options.search?.trim() ?? '';
  const plan = options.plan && options.plan !== 'all' ? options.plan : null;
  const status = options.status && options.status !== 'all' ? options.status : null;
  const page = Math.max(1, Math.floor(options.page ?? 1));

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    // Matches email, display name, or a site id, so an operator can find an
    // account from any identifier a customer might quote at them.
    conditions.push(
      `(lower(u.email) LIKE $${params.length}
        OR lower(coalesce(u.name, '')) LIKE $${params.length}
        OR EXISTS (
             SELECT 1 FROM sites s3
              WHERE s3.user_id = u.id AND lower(s3.id) LIKE $${params.length}
           ))`
    );
  }
  if (plan) {
    params.push(plan);
    conditions.push(`u.plan = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`u.subscription_status = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Whitelisted ordering. Interpolating a column name from user input would be
  // an injection point even though the values themselves are parameterised.
  const sortColumn =
    options.sort === 'pageviews'
      ? 'coalesce(ev.pageviews_total, 0)'
      : options.sort === 'sites'
        ? 'coalesce(site_stats.site_count, 0)'
        : options.sort === 'email'
          ? 'lower(u.email)'
          : 'u.created_at';
  const direction = options.direction === 'asc' ? 'ASC' : 'DESC';

  const countResult = await query<{ total: number }>(
    `SELECT count(*)::int AS total FROM users u ${where}`,
    params
  );
  const total = countResult.rows[0]?.total ?? 0;

  const limit = PAGE_SIZE;
  const offset = (page - 1) * limit;

  const { rows } = await query<AdminUserRow>(
    `SELECT ${USER_LIST_COLUMNS}
       FROM users u
       ${USER_LIST_JOINS}
       ${where}
      ORDER BY ${sortColumn} ${direction}, u.id ASC
      LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  return {
    users: rows.map(toSummary),
    total,
    page,
    pageSize: limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

/**
 * Platform-wide rollup for the admin overview.
 *
 * All the counts are computed in one round trip via scalar subqueries. At a few
 * thousand accounts this is a handful of index scans; if it ever becomes slow,
 * the fix is a materialised view refreshed on a schedule, not more indexes.
 */
export async function getAdminMetrics(): Promise<AdminMetrics> {
  const totals = await query<{
    total_users: number;
    new_users_7d: number;
    new_users_30d: number;
    admin_count: number;
    mrr: number;
    paying_users: number;
    total_sites: number;
    sites_with_traffic_7d: number;
    events_7d: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM users)                                              AS total_users,
       (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS new_users_7d,
       (SELECT count(*)::int FROM users WHERE created_at > now() - interval '30 days') AS new_users_30d,
       (SELECT count(*)::int FROM users WHERE is_admin)                                AS admin_count,
       -- MRR counts accounts that are actually paying. past_due is included
       -- because retries are still running; canceled is not, because the
       -- subscription is over.
       (SELECT coalesce(sum(price_per_month), 0)::int FROM users
         WHERE subscription_status IN ('active', 'past_due'))                        AS mrr,
       (SELECT count(*)::int FROM users
         WHERE subscription_status IN ('active', 'past_due'))                        AS paying_users,
       (SELECT count(*)::int FROM sites)                                              AS total_sites,
       (SELECT count(DISTINCT e.site_id)::int FROM events e
         WHERE e.created_at > now() - interval '7 days')                             AS sites_with_traffic_7d,
       (SELECT count(*)::int FROM events e
         WHERE e.created_at > now() - interval '7 days'
           AND e.event_type = 'pageview')                                            AS events_7d`
  );

  const byPlan = await query<{ plan: string; count: number }>(
    `SELECT plan, count(*)::int AS count FROM users GROUP BY plan ORDER BY count DESC`
  );

  const byStatus = await query<{ status: string; count: number }>(
    `SELECT subscription_status AS status, count(*)::int AS count
       FROM users GROUP BY subscription_status ORDER BY count DESC`
  );

  const row = totals.rows[0];
  const totalUsers = row?.total_users ?? 0;
  const payingUsers = row?.paying_users ?? 0;

  return {
    totalUsers,
    newUsers7d: row?.new_users_7d ?? 0,
    newUsers30d: row?.new_users_30d ?? 0,
    adminCount: row?.admin_count ?? 0,
    byPlan: byPlan.rows.map((r) => ({ plan: toPlan(r.plan), count: r.count })),
    byStatus: byStatus.rows.map((r) => ({
      status: normalizeStatus(r.status),
      count: r.count,
    })),
    mrr: row?.mrr ?? 0,
    payingUsers,
    conversionRate: totalUsers > 0 ? (payingUsers / totalUsers) * 100 : 0,
    totalSites: row?.total_sites ?? 0,
    sitesWithTraffic7d: row?.sites_with_traffic_7d ?? 0,
    events7d: row?.events_7d ?? 0,
  };
}

export async function getUserDetail(userId: string): Promise<AdminUserDetail | null> {
  const { rows } = await query<AdminUserRow & {
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    internal_note: string | null;
    events_30d: number;
  }>(
    `SELECT ${USER_LIST_COLUMNS},
            u.stripe_customer_id, u.stripe_subscription_id, u.internal_note,
            coalesce(ev30.events_30d, 0)::int AS events_30d
       FROM users u
       ${USER_LIST_JOINS}
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS events_30d
           FROM events e
           JOIN sites s4 ON s4.id = e.site_id
          WHERE s4.user_id = u.id
            AND e.created_at > now() - interval '30 days'
       ) ev30 ON true
      WHERE u.id = $1`,
    [userId]
  );

  const row = rows[0];
  if (!row) return null;

  const sitesResult = await query<{
    id: string;
    name: string;
    domain: string;
    created_at: Date;
    pageviews: number;
  }>(
    `SELECT s.id, s.name, s.domain, s.created_at,
            coalesce((
              SELECT count(*)::int FROM events e
               WHERE e.site_id = s.id AND e.event_type = 'pageview'
            ), 0) AS pageviews
       FROM sites s
      WHERE s.user_id = $1
      ORDER BY s.created_at DESC`,
    [userId]
  );

  const auditResult = await query<{
    id: string;
    operator_email: string;
    action: string;
    details: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT id, operator_email, action, details, created_at
       FROM admin_audit_log
      WHERE target_user_id = $1
      ORDER BY created_at DESC
      LIMIT 50`,
    [userId]
  );

  const summary = toSummary(row);
  const plan = planLimitsFor(summary.plan);

  return {
    user: summary,
    billing: {
      subscriptionStatus: summary.subscriptionStatus,
      pricePerMonth: summary.pricePerMonth,
      currency: summary.currency,
      currentPeriodEnd: summary.currentPeriodEnd,
      cancelAtPeriodEnd: summary.cancelAtPeriodEnd,
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
      internalNote: row.internal_note,
      // No payment provider is wired up in this build; the UI says so plainly
      // rather than implying these columns are backed by real invoices.
      providerConnected: false,
    },
    planLimits: plan,
    usage: {
      sites: row.site_count,
      eventsLast30d: row.events_30d,
    },
    overLimits: {
      // Sites are enforced at creation, so this can only be true after a
      // downgrade of an account that already exceeded the lower limit.
      sites: row.site_count > plan.sites,
      events: row.events_30d > plan.monthlyEvents,
    },
    sites: sitesResult.rows.map((site) => ({
      id: site.id,
      name: site.name,
      domain: site.domain,
      createdAt: site.created_at.toISOString(),
      pageviews: site.pageviews,
    })),
    audit: auditResult.rows.map(
      (entry): AdminAuditEntry => ({
        id: Number(entry.id),
        operatorEmail: entry.operator_email,
        action: entry.action,
        details: entry.details ?? {},
        createdAt: entry.created_at.toISOString(),
      })
    ),
  };
}

/** Plan limits by tier, mirroring lib/plans.ts without importing client code. */
function planLimitsFor(plan: Plan): { sites: number; monthlyEvents: number; retentionDays: number } {
  return plan === 'pro'
    ? { sites: 25, monthlyEvents: 2_000_000, retentionDays: 730 }
    : { sites: 3, monthlyEvents: 100_000, retentionDays: 90 };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface PlanChangeInput {
  plan?: Plan;
  subscriptionStatus?: SubscriptionStatus;
  pricePerMonth?: number | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  internalNote?: string | null;
}

export interface MutationContext {
  id: string;
  email: string;
}

export type UpdateUserResult =
  | { ok: true; detail: AdminUserDetail }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'self_demotion' };

/**
 * Apply an administrative change and record it in the audit log.
 *
 * The update and the audit insert run in one transaction, so a change can never
 * be applied without a corresponding log entry. That ordering is the reason this
 * is not two separate statements.
 */
export async function updateUserAsAdmin(
  userId: string,
  input: PlanChangeInput,
  context: MutationContext
): Promise<UpdateUserResult> {
  const existing = await query<{
    email: string;
    plan: string;
    is_admin: boolean;
    subscription_status: string;
    price_per_month: number | null;
    current_period_end: Date | null;
    cancel_at_period_end: boolean;
    internal_note: string | null;
  }>(
    `SELECT email, plan, is_admin, subscription_status, price_per_month,
            current_period_end, cancel_at_period_end, internal_note
       FROM users WHERE id = $1`,
    [userId]
  );

  const current = existing.rows[0];
  if (!current) return { ok: false, reason: 'not_found' };

  // Falling back to the plan's list price when switching tier keeps the billing
  // figures coherent without the operator having to type a number.
  const nextPlan: Plan = input.plan ?? toPlan(current.plan);
  const derivedPrice =
    input.pricePerMonth !== undefined
      ? input.pricePerMonth
      : input.plan !== undefined
        ? nextPlan === 'pro'
          ? 9
          : 0
        : current.price_per_month;

  const cancelAtPeriodEnd =
    input.cancelAtPeriodEnd ?? (input.subscriptionStatus === 'canceled' ? true : current.cancel_at_period_end);

  await transaction(async (client) => {
    await client.query(
      `UPDATE users
          SET plan                  = $2,
              subscription_status   = $3,
              price_per_month       = $4,
              current_period_end    = $5,
              cancel_at_period_end  = $6,
              internal_note         = $7,
              updated_at            = now()
        WHERE id = $1`,
      [
        userId,
        nextPlan,
        input.subscriptionStatus ?? normalizeStatus(current.subscription_status),
        derivedPrice,
        input.currentPeriodEnd !== undefined
          ? input.currentPeriodEnd
          : current.current_period_end,
        cancelAtPeriodEnd,
        input.internalNote !== undefined ? input.internalNote : current.internal_note,
      ]
    );

    await client.query(
      `INSERT INTO admin_audit_log
         (operator_id, operator_email, target_user_id, target_email, action, details)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        context.id,
        context.email,
        userId,
        current.email,
        'plan.updated',
        JSON.stringify({
          before: {
            plan: toPlan(current.plan),
            subscriptionStatus: normalizeStatus(current.subscription_status),
            pricePerMonth: current.price_per_month,
            cancelAtPeriodEnd: current.cancel_at_period_end,
          },
          after: {
            plan: nextPlan,
            subscriptionStatus: input.subscriptionStatus ?? normalizeStatus(current.subscription_status),
            pricePerMonth: derivedPrice,
            cancelAtPeriodEnd,
          },
        }),
      ]
    );
  });

  const detail = await getUserDetail(userId);
  if (!detail) return { ok: false, reason: 'not_found' };
  return { ok: true, detail };
}

/**
 * Grant or revoke platform-operator access.
 *
 * Separate from updateUserAsAdmin because it is a different class of change:
 * it alters who can reach /admin at all, and it must refuse to remove the last
 * remaining operator or the deployment becomes unmanageable.
 */
export type AdminFlagResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'last_admin' }
  | { ok: false; reason: 'self' };

export async function setAdminFlag(
  userId: string,
  isAdmin: boolean,
  context: MutationContext
): Promise<AdminFlagResult> {
  const existing = await query<{ email: string; is_admin: boolean }>(
    'SELECT email, is_admin FROM users WHERE id = $1',
    [userId]
  );
  const current = existing.rows[0];
  if (!current) return { ok: false, reason: 'not_found' };

  if (current.is_admin === isAdmin) return { ok: true };

  if (!isAdmin) {
    // Refusing both cases explicitly, with different reasons, so the UI can
    // explain which rule was hit rather than showing a generic failure.
    if (userId === context.id) return { ok: false, reason: 'self' };

    const { rows } = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM users WHERE is_admin'
    );
    if ((rows[0]?.n ?? 0) <= 1) return { ok: false, reason: 'last_admin' };
  }

  await transaction(async (client) => {
    await client.query('UPDATE users SET is_admin = $2, updated_at = now() WHERE id = $1', [
      userId,
      isAdmin,
    ]);
    // Revoking admin does not revoke sessions: the role is re-read from the
    // database on every request, so the next request is already unauthorised.
    await client.query(
      `INSERT INTO admin_audit_log
         (operator_id, operator_email, target_user_id, target_email, action, details)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        context.id,
        context.email,
        userId,
        current.email,
        isAdmin ? 'admin.granted' : 'admin.revoked',
        JSON.stringify({ before: { isAdmin: current.is_admin }, after: { isAdmin } }),
      ]
    );
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Promote `userId` to admin, but only while no admin exists.
 *
 * This is how a self-hosted deployment gets its first operator: the person who
 * sets the instance up claims it. The "no admins exist" condition is checked
 * inside the same statement as the update, so two concurrent claims cannot both
 * succeed, and once an operator exists the door is closed permanently — it is
 * not an "anyone can become admin" endpoint.
 */
export async function claimFirstAdmin(userId: string): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE users
        SET is_admin = true, updated_at = now()
      WHERE id = $1
        AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin)`,
    [userId]
  );
  return (rowCount ?? 0) > 0;
}

/** True while the deployment has no operator at all. */
export async function needsFirstAdmin(): Promise<boolean> {
  const { rows } = await query<{ n: number }>(
    'SELECT count(*)::int AS n FROM users WHERE is_admin'
  );
  return (rows[0]?.n ?? 0) === 0;
}

/**
 * How many operators exist.
 *
 * Used to explain a denial accurately: "nobody can grant this yet, so claim it"
 * and "ask an existing administrator" are different situations, and the UI
 * should not have to guess between them.
 */
export async function adminCount(): Promise<number> {
  const { rows } = await query<{ n: number }>(
    'SELECT count(*)::int AS n FROM users WHERE is_admin'
  );
  return rows[0]?.n ?? 0;
}

/** Exposed so the API can validate status input without importing the union. */
export { SUBSCRIPTION_STATUSES };
