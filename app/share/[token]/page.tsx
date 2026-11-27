import { Suspense } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Logo } from '@/components/logo';
import { trustedProxyHops } from '@/lib/env';
import { filtersKey, hasFilters, parseFilters, type Filters } from '@/lib/filters';
import { getClientIp } from '@/lib/ingest';
import { SHARE_LIMIT_PER_MINUTE, rateLimit } from '@/lib/rate-limit';
import { getSiteByShareToken } from '@/lib/sites';
import { getStats } from '@/lib/stats';
import { toPublicStats } from '@/lib/public-stats';
import { resolveRange } from '@/lib/ranges';
import { Dashboard } from '@/app/sites/[id]/dashboard';
import { DashboardSkeleton } from '@/app/sites/[id]/dashboard-skeleton';
import { FilterBar } from '@/app/sites/[id]/filter-bar';
import { RangePicker } from '@/app/sites/[id]/range-picker';
import { RealtimeBadge } from '@/app/sites/[id]/realtime-badge';

export const dynamic = 'force-dynamic';

// The token is in the URL, so keep it out of search engines and out of the
// Referer header of any link followed from this page.
export const metadata: Metadata = {
  title: 'Shared dashboard',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

/**
 * Public, read-only dashboard.
 *
 * No session: possession of the unguessable token in the URL is the credential,
 * and it only ever resolves to one site's aggregate stats. Nothing here links
 * to settings, tracking code or any other site.
 */
export default async function SharedDashboardPage(props: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await props.params;
  const searchParams = await props.searchParams;

  const ip = getClientIp(await headers(), trustedProxyHops());
  if (!rateLimit(`share:${ip}`, SHARE_LIMIT_PER_MINUTE, 60_000).allowed) {
    return (
      <main className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-lg font-semibold">Too many requests</h1>
        <p className="mt-2 text-sm text-muted-foreground">Please wait a minute and try again.</p>
      </main>
    );
  }

  const site = await getSiteByShareToken(token);
  if (!site) notFound();

  const range = typeof searchParams.range === 'string' ? searchParams.range : undefined;
  const spec = resolveRange(range);
  const filters = parseFilters({
    get: (name) => {
      const value = searchParams[name];
      return (Array.isArray(value) ? value[0] : value) ?? null;
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Logo />
          <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
            Public dashboard · read-only
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{site.name}</h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">{site.domain}</p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <p className="text-sm text-muted-foreground">
              {spec.label}
              {spec.interval === 'hour' ? ' · hourly' : ' · daily'}
            </p>
            <RealtimeBadge endpoint={`/api/share/${encodeURIComponent(token)}/realtime`} />
          </div>
          <RangePicker />
        </div>

        <FilterBar />

        <Suspense key={`${spec.key}|${filtersKey(filters)}`} fallback={<DashboardSkeleton />}>
          <SharedStats siteId={site.id} range={range} filters={filters} />
        </Suspense>
      </main>
    </div>
  );
}

async function SharedStats({
  siteId,
  range,
  filters,
}: {
  siteId: string;
  range?: string;
  filters: Filters;
}) {
  const stats = await getStats(siteId, resolveRange(range), filters);
  // Strip individual visits from the data itself: see lib/public-stats.mjs.
  const publicStats = toPublicStats(stats);
  return <Dashboard stats={publicStats} installHref="" filtered={hasFilters(filters)} readOnly />;
}
