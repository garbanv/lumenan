import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { getSiteForUser } from '@/lib/sites';
import { getStats } from '@/lib/stats';
import { resolveRange } from '@/lib/ranges';
import { Skeleton, StatCardSkeleton, PanelSkeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { RangePicker } from './range-picker';
import { Dashboard } from './dashboard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function SiteDashboardPage(
  props: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ range?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const user = await requireUser(`/sites/${params.id}`);
  const site = await getSiteForUser(params.id, user.id);
  if (!site) notFound();

  const spec = resolveRange(searchParams.range);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {spec.label}
          {spec.interval === 'hour' ? ' · hourly' : ' · daily'}
        </p>
        <RangePicker />
      </div>

      {/*
        Keyed on the range so switching ranges re-suspends into the skeleton
        rather than showing numbers from the previous selection.
      */}
      <Suspense key={spec.key} fallback={<DashboardSkeleton />}>
        <StatsSection siteId={site.id} range={searchParams.range} />
      </Suspense>
    </div>
  );
}

async function StatsSection({ siteId, range }: { siteId: string; range?: string }) {
  const spec = resolveRange(range);
  const stats = await getStats(siteId, spec);

  return <Dashboard stats={stats} installHref={`/sites/${encodeURIComponent(siteId)}/code`} />;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading stats…</span>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[220px] w-full" />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index}>
            <CardHeader>
              <Skeleton className="h-4 w-28" />
            </CardHeader>
            <CardContent>
              <PanelSkeleton rows={5} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
