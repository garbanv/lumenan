import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Plus } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { ClaimAdminBanner } from '@/components/claim-admin-banner';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { requireUser } from '@/lib/auth';
import { listSitesForUser, countSitesForUser } from '@/lib/sites';
import { PLAN_LIMITS } from '@/lib/plans';
import { formatExact, formatPercent } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sites',
  robots: { index: false, follow: false },
};

export default async function SitesPage(
  props: {
    searchParams: Promise<{ welcome?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const user = await requireUser('/sites');
  const [sites, siteCount] = await Promise.all([
    listSitesForUser(user.id),
    countSitesForUser(user.id),
  ]);

  const limit = PLAN_LIMITS[user.plan].sites;
  const atLimit = siteCount >= limit;
  const isFirstRun = searchParams.welcome === '1' && sites.length === 0;

  return (
    <AppShell user={user} sites={sites}>
      {/* Shown only while the deployment has no operator; renders nothing
          otherwise. */}
      <div className="mb-6 empty:mb-0">
        <ClaimAdminBanner />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isFirstRun ? 'Add your first site' : 'Your sites'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isFirstRun
              ? 'Paste one script tag and events start arriving immediately.'
              : `${siteCount} of ${limit} sites used on the ${user.plan} plan.`}
          </p>
        </div>

        {!atLimit && (
          <Link
            href="/sites/new"
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add site
          </Link>
        )}
      </div>

      {atLimit && (
        <div className="mt-6 rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            You have reached the {limit}-site limit on the {user.plan} plan.{' '}
          </span>
          <Link href="/settings" className="font-medium text-primary hover:underline">
            Compare plans
          </Link>
        </div>
      )}

      <div className="mt-8">
        {sites.length === 0 ? (
          <EmptyState
            icon={<Plus className="h-5 w-5" />}
            title="No sites yet"
            description="Add the domain you want to track. You will get a script tag to paste into your site's HTML, or a snippet for a Next.js root layout."
            action={
              <Link
                href="/sites/new"
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add your first site
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {sites.map((site) => {
              const change =
                site.previousPageviews === 0
                  ? null
                  : ((site.pageviews - site.previousPageviews) / site.previousPageviews) * 100;

              return (
                <li key={site.id}>
                  <Link
                    href={`/sites/${encodeURIComponent(site.id)}`}
                    className="group flex items-center gap-5 rounded-xl border border-border bg-card px-5 py-4 transition-colors hover:border-primary/40 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{site.name}</span>
                        {site.role !== 'owner' && (
                          <Badge variant="outline">
                            {site.role === 'manager' ? 'Manager' : 'Viewer'}
                          </Badge>
                        )}
                        {change !== null && Math.abs(change) >= 0.1 && (
                          <Badge variant={change > 0 ? 'success' : 'destructive'}>
                            {change > 0 ? '+' : '−'}
                            {formatPercent(Math.abs(change), 0)}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">{site.domain}</p>
                      {/* The site id is the tracking key; viewers have no use for it. */}
                      {site.role !== 'viewer' && (
                        <p className="mt-1 truncate font-mono text-2xs text-muted-foreground/70">
                          {site.id}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="tabular text-xl font-semibold">
                        {formatExact(site.pageviews)}
                      </p>
                      <p className="text-2xs text-muted-foreground">pageviews · 7d</p>
                    </div>

                    <ArrowRight
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
