import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { getSiteForUser } from '@/lib/sites';
import { getStats } from '@/lib/stats';
import { resolveRange } from '@/lib/ranges';
import { filtersKey, hasFilters, parseFilters, type Filters } from '@/lib/filters';
import { RangePicker } from './range-picker';
import { FilterBar } from './filter-bar';
import { RealtimeBadge } from './realtime-badge';
import { Dashboard } from './dashboard';
import { DashboardSkeleton } from './dashboard-skeleton';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function SiteDashboardPage(
  props: {
    params: Promise<{ id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const user = await requireUser(`/sites/${params.id}`);
  const site = await getSiteForUser(params.id, user.id);
  if (!site) notFound();

  const range = typeof searchParams.range === 'string' ? searchParams.range : undefined;
  const spec = resolveRange(range);
  // Repeated query keys arrive as arrays; only the first value is used.
  const filters = parseFilters({
    get: (name) => {
      const value = searchParams[name];
      return (Array.isArray(value) ? value[0] : value) ?? null;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <p className="text-sm text-muted-foreground">
            {spec.label}
            {spec.interval === 'hour' ? ' · hourly' : ' · daily'}
          </p>
          <RealtimeBadge endpoint={`/api/stats/realtime?siteId=${encodeURIComponent(site.id)}`} />
        </div>
        <RangePicker />
      </div>

      <FilterBar />

      {/*
        Keyed on the range so switching ranges re-suspends into the skeleton
        rather than showing numbers from the previous selection.
      */}
      <Suspense key={`${spec.key}|${filtersKey(filters)}`} fallback={<DashboardSkeleton />}>
        <StatsSection siteId={site.id} range={range} filters={filters} />
      </Suspense>
    </div>
  );
}

async function StatsSection({
  siteId,
  range,
  filters,
}: {
  siteId: string;
  range?: string;
  filters: Filters;
}) {
  const spec = resolveRange(range);
  const stats = await getStats(siteId, spec, filters);

  return (
    <Dashboard
      stats={stats}
      installHref={`/sites/${encodeURIComponent(siteId)}/code`}
      filtered={hasFilters(filters)}
      goalsHref={`/sites/${encodeURIComponent(siteId)}/settings#goals`}
    />
  );
}
