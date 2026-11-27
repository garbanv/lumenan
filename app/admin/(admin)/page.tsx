import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Users } from 'lucide-react';
import { AdminShell } from '@/components/admin-shell';
import { DonutChart } from '@/components/charts/donut-chart';
import { StatCard } from '@/components/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireAdminPage } from '@/lib/admin-auth';
import { getAdminMetrics, listUsers } from '@/lib/admin';
import { PLAN_LIMITS } from '@/lib/plans';
import { formatDateTime, formatExact, formatNumber, formatPercent } from '@/lib/utils';
import { PlanBadge, StatusBadge, statusLabel } from '@/components/plan-badge';
import type { BreakdownRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin overview',
  robots: { index: false, follow: false },
};

export default async function AdminOverviewPage() {
  const admin = await requireAdminPage();

  // The five newest accounts double as a "what happened recently" signal; the
  // full list lives on /admin/users.
  const [metrics, recent] = await Promise.all([
    getAdminMetrics(),
    listUsers({ sort: 'created', direction: 'desc', page: 1 }),
  ]);

  const planBreakdown: BreakdownRow[] = metrics.byPlan.map((row) => ({
    label: row.plan === 'pro' ? 'Pro' : 'Free',
    value: row.count,
    meta: null,
  }));

  const statusBreakdown: BreakdownRow[] = metrics.byStatus.map((row) => ({
    label: statusLabel(row.status),
    value: row.count,
    meta: null,
  }));

  return (
    <AdminShell user={admin}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Platform overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Across every account on this deployment.
          </p>
        </div>
        <Link
          href="/admin/users"
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Users className="h-4 w-4" aria-hidden="true" />
          Manage users
        </Link>
      </div>

      {/* ---------------- headline numbers ---------------- */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total users"
          value={formatNumber(metrics.totalUsers)}
          detail={`${formatExact(metrics.newUsers7d)} new in the last 7 days`}
        />
        <StatCard
          label="Paying users"
          value={formatNumber(metrics.payingUsers)}
          detail={`${formatPercent(metrics.conversionRate, 1)} of all accounts`}
        />
        <StatCard
          label="MRR"
          value={`$${formatExact(metrics.mrr)}`}
          detail={`${formatExact(metrics.totalUsers - metrics.payingUsers)} on the free plan`}
        />
        <StatCard
          label="Pageviews · 7d"
          value={formatNumber(metrics.events7d)}
          detail={`${formatExact(metrics.sitesWithTraffic7d)} of ${formatExact(
            metrics.totalSites
          )} sites received traffic`}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="New users · 30d"
          value={formatNumber(metrics.newUsers30d)}
          detail="Signups in the last 30 days"
        />
        <StatCard
          label="Sites"
          value={formatNumber(metrics.totalSites)}
          detail={`${formatExact(metrics.sitesWithTraffic7d)} active this week`}
        />
        <StatCard
          label="Administrators"
          value={formatNumber(metrics.adminCount)}
          detail="Accounts that can reach this page"
        />
        <StatCard
          label="Free plan limit"
          value={`${PLAN_LIMITS.free.sites} sites`}
          detail={`${formatExact(PLAN_LIMITS.pro.sites)} on Pro`}
        />
      </div>

      {/* ---------------- distributions ---------------- */}
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Users by plan</CardTitle>
          </CardHeader>
          <CardContent>
            {planBreakdown.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No accounts yet.</p>
            ) : (
              <DonutChart data={planBreakdown} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Users by billing status</CardTitle>
          </CardHeader>
          <CardContent>
            {statusBreakdown.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No accounts yet.</p>
            ) : (
              <DonutChart data={statusBreakdown} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------------- recent signups ---------------- */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Newest accounts</CardTitle>
          <Link
            href="/admin/users"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View all
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </CardHeader>
        <CardContent>
          {recent.users.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No accounts yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.users.slice(0, 5).map((user) => (
                <li key={user.id}>
                  <Link
                    href={`/admin/users/${user.id}`}
                    className="flex items-center justify-between gap-4 rounded-md px-2 py-3 transition-colors hover:bg-secondary"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{user.email}</span>
                        {user.isAdmin && <span className="text-2xs text-muted-foreground">admin</span>}
                      </span>
                      <span className="mt-0.5 block text-2xs text-muted-foreground">
                        Joined {formatDateTime(user.createdAt)} · {user.siteCount} sites
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <PlanBadge plan={user.plan} />
                      <StatusBadge status={user.subscriptionStatus} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </AdminShell>
  );
}
