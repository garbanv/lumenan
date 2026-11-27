import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, Users } from 'lucide-react';
import { AdminShell } from '@/components/admin-shell';
import { EmptyState } from '@/components/empty-state';
import { PlanBadge, StatusBadge } from '@/components/plan-badge';
import { Card, CardContent } from '@/components/ui/card';
import { requireAdminPage } from '@/lib/admin-auth';
import { listUsers } from '@/lib/admin';
import { formatExact, formatRelative } from '@/lib/utils';
import type { Plan, SubscriptionStatus } from '@/lib/types';
import { UserFilters, UserPagination } from './user-filters';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Users',
  robots: { index: false, follow: false },
};

interface SearchParams {
  q?: string;
  plan?: string;
  status?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

const VALID_PLANS: readonly string[] = ['free', 'pro'];
const VALID_STATUSES: readonly string[] = ['none', 'active', 'past_due', 'canceled', 'paused'];
const VALID_SORTS = ['created', 'pageviews', 'sites', 'email'] as const;

export default async function AdminUsersPage(
  props: {
    searchParams: Promise<SearchParams>;
  }
) {
  const searchParams = await props.searchParams;
  const admin = await requireAdminPage();

  const sortParam = searchParams.sort;
  const result = await listUsers({
    search: searchParams.q,
    plan:
      searchParams.plan && VALID_PLANS.includes(searchParams.plan)
        ? (searchParams.plan as Plan)
        : 'all',
    status:
      searchParams.status && VALID_STATUSES.includes(searchParams.status)
        ? (searchParams.status as SubscriptionStatus)
        : 'all',
    sort:
      sortParam && (VALID_SORTS as readonly string[]).includes(sortParam)
        ? (sortParam as (typeof VALID_SORTS)[number])
        : 'created',
    direction: searchParams.dir === 'asc' ? 'asc' : 'desc',
    page: Number.parseInt(searchParams.page ?? '1', 10) || 1,
  });

  const hasFilters = !!(searchParams.q || searchParams.plan || searchParams.status);

  return (
    <AdminShell user={admin}>
      <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every account on this deployment. Open one to change its plan or billing state.
      </p>

      <div className="mt-6">
        <UserFilters total={result.total} />
      </div>

      <div className="mt-6">
        {result.users.length === 0 ? (
          hasFilters ? (
            <EmptyState
              icon={<Users className="h-5 w-5" />}
              title="No users match those filters"
              description="Try a different search term, or clear the plan and status filters."
              action={
                <Link
                  href="/admin/users"
                  className="inline-flex h-9 items-center rounded-lg border border-input px-4 text-sm font-medium transition-colors hover:bg-secondary"
                >
                  Clear filters
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={<Users className="h-5 w-5" />}
              title="No users yet"
              description="Accounts appear here as soon as people sign up for your deployment."
            />
          )
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">
                    Accounts, with plan, billing status, usage and signup date
                  </caption>
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th scope="col" className="px-5 py-3 font-medium text-muted-foreground">
                        Account
                      </th>
                      <th scope="col" className="px-3 py-3 font-medium text-muted-foreground">
                        Plan
                      </th>
                      <th scope="col" className="px-3 py-3 font-medium text-muted-foreground">
                        Billing
                      </th>
                      <th scope="col" className="px-3 py-3 text-right font-medium text-muted-foreground">
                        Sites
                      </th>
                      <th scope="col" className="px-3 py-3 text-right font-medium text-muted-foreground">
                        Pageviews
                      </th>
                      <th scope="col" className="px-3 py-3 font-medium text-muted-foreground">
                        Last seen
                      </th>
                      <th scope="col" className="px-5 py-3 text-right font-medium text-muted-foreground">
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.users.map((user) => (
                      <tr
                        key={user.id}
                        className="border-b border-border last:border-0 transition-colors hover:bg-secondary/40"
                      >
                        <td className="px-5 py-3">
                          <Link
                            href={`/admin/users/${user.id}`}
                            className="group block min-w-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="flex items-center gap-2">
                              <span className="truncate font-medium group-hover:text-primary">
                                {user.email}
                              </span>
                              {user.isAdmin && (
                                <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-2xs font-medium text-destructive">
                                  admin
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
                              {user.name ? `${user.name} · ` : ''}
                              joined {formatRelative(user.createdAt)}
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-3">
                          <PlanBadge plan={user.plan} />
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col items-start gap-1">
                            <StatusBadge status={user.subscriptionStatus} />
                            {user.pricePerMonth !== null && user.pricePerMonth > 0 && (
                              <span className="tabular text-2xs text-muted-foreground">
                                ${formatExact(user.pricePerMonth)}/mo
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="tabular px-3 py-3 text-right">{user.siteCount}</td>
                        <td className="tabular px-3 py-3 text-right">
                          <span className="block">{formatExact(user.pageviewsTotal)}</span>
                          <span className="block text-2xs text-muted-foreground">
                            {formatExact(user.pageviews7d)} · 7d
                          </span>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">
                          {user.lastEventAt ? formatRelative(user.lastEventAt) : 'never'}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Link
                            href={`/admin/users/${user.id}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            aria-label={`Manage ${user.email}`}
                          >
                            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="mt-4">
        <UserPagination page={result.page} totalPages={result.totalPages} />
      </div>
    </AdminShell>
  );
}
