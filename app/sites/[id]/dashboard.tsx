'use client';

import { ArrowRight, Code2 } from 'lucide-react';
import { AreaChart } from '@/components/charts/area-chart';
import { BreakdownList } from '@/components/charts/breakdown-list';
import { DonutChart } from '@/components/charts/donut-chart';
import { CountryLabel, PathLabel } from '@/components/path-label';
import { MiniStat, StatCard } from '@/components/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { percentChange } from '@/lib/client-metrics';
import { formatExact, formatNumber, formatPercent, formatRelative } from '@/lib/utils';
import { RANGES } from '@/lib/ranges';
import type { StatsResponse } from '@/lib/types';

interface DashboardProps {
  stats: StatsResponse;
  /** Drives the "no data yet" install hint. */
  installHref: string;
}

export function Dashboard({ stats, installHref }: DashboardProps) {
  const { summary, previous, timeseries } = stats;
  const rangeLabel = RANGES[stats.range].label.toLowerCase();

  const hasAnyData = summary.pageviews > 0 || summary.events > 0;
  if (!hasAnyData) {
    return <NoDataYet installHref={installHref} />;
  }

  const pageviewChange = percentChange(summary.pageviews, previous.pageviews);
  const visitorChange = percentChange(summary.visitors, previous.visitors);
  const visitorsShare =
    summary.visitors > 0 ? (summary.newVisitors / summary.visitors) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* ---------------- headline numbers ---------------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Pageviews"
          value={formatNumber(summary.pageviews)}
          change={pageviewChange}
          detail={`${formatExact(summary.pageviews)} in ${rangeLabel}`}
        />
        <StatCard
          label="Visitors"
          value={formatNumber(summary.visitors)}
          change={visitorChange}
          detail={`${formatExact(summary.visitors)} unique visitor-days`}
        />
        <StatCard
          label="Bounce rate"
          value={formatPercent(summary.bounceRate, 0)}
          detail={
            summary.visitors > 0
              ? `${formatPercent(100 - summary.bounceRate, 0)} viewed more than one page`
              : undefined
          }
          // A higher bounce rate is worse, so the colour coding inverts.
          higherIsBetter={false}
        />
        <StatCard
          label="Pages / visit"
          value={summary.pagesPerVisit.toFixed(2)}
          detail={`${formatExact(summary.events)} custom events recorded`}
        />
      </div>

      {/* ---------------- timeseries ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Traffic over time</CardTitle>
          <p className="text-xs text-muted-foreground">
            Bucketed by {stats.interval === 'hour' ? 'hour' : 'day'}
          </p>
        </CardHeader>
        <CardContent>
          <AreaChart
            data={timeseries}
            interval={stats.interval}
            // At hourly resolution a visitor line is dominated by the same
            // person refreshing, so only the daily view shows it.
            showVisitors={stats.interval === 'day'}
          />
        </CardContent>
      </Card>

      {/* ---------------- breakdowns ---------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top pages</CardTitle>
          </CardHeader>
          <CardContent>
            <BreakdownList
              data={stats.topPages}
              renderLabel={(label) => <PathLabel path={label} />}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Referrers</CardTitle>
          </CardHeader>
          <CardContent>
            <BreakdownList
              data={stats.topReferrers}
              emptyMessage="No referrers recorded — all traffic arrived directly."
              renderLabel={(label) =>
                label === 'Direct' ? (
                  <span className="text-muted-foreground">Direct / none</span>
                ) : (
                  <span className="font-mono text-xs">{label}</span>
                )
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Devices</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart data={stats.devices} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Countries</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topCountries.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No country data yet. It is resolved from the visitor&apos;s IP against a local
                DB-IP database (run <code className="rounded bg-secondary px-1 py-0.5 text-xs">npm run geoip:update</code>),
                or taken from the CDN header{' '}
                <code className="rounded bg-secondary px-1 py-0.5 text-xs">x-vercel-ip-country</code>{' '}
                or <code className="rounded bg-secondary px-1 py-0.5 text-xs">cf-ipcountry</code>.
              </p>
            ) : (
              <BreakdownList
                data={stats.topCountries}
                renderLabel={(label) => <CountryLabel code={label} />}
              />
            )}
            {/* Required by the CC BY 4.0 licence of the DB-IP Lite database. */}
            <p className="mt-3 text-[11px] text-muted-foreground">
              <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer" className="underline">
                IP Geolocation by DB-IP
              </a>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Browsers</CardTitle>
          </CardHeader>
          <CardContent>
            <BreakdownList data={stats.browsers} showBar={false} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Operating systems</CardTitle>
          </CardHeader>
          <CardContent>
            <BreakdownList data={stats.operatingSystems} showBar={false} />
          </CardContent>
        </Card>
      </div>

      {/* ---------------- events + live feed ---------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Custom events</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.customEvents.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                None yet. Call{' '}
                <code className="rounded bg-secondary px-1 py-0.5 text-xs">
                  trackEvent(&apos;signup&apos;)
                </code>{' '}
                on your site to record one.
              </p>
            ) : (
              <BreakdownList data={stats.customEvents} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" aria-hidden="true" />
              live
            </span>
          </CardHeader>
          <CardContent>
            {stats.recent.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {stats.recent.map((event, index) => (
                  <li
                    key={`${event.createdAt}-${index}`}
                    className="flex items-center justify-between gap-4 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        {event.eventType === 'custom' ? (
                          <span className="truncate font-medium">
                            {event.eventName ?? 'unnamed'}
                          </span>
                        ) : (
                          <PathLabel path={event.path} />
                        )}
                        {event.isNewVisitor && (
                          <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-2xs text-accent-foreground">
                            new
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-2xs text-muted-foreground">
                        {event.referrer && <span className="truncate">{event.referrer}</span>}
                        {event.country && <span>{event.country}</span>}
                        {event.device && <span className="capitalize">{event.device}</span>}
                      </span>
                    </span>
                    <span className="shrink-0 text-2xs text-muted-foreground">
                      {formatRelative(event.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * Shown when a site exists but has never received an event. This is the most
 * important state in the product — it is where every new user starts — so it
 * points directly at the install step rather than reporting an absence of data.
 */
function NoDataYet({ installHref }: { installHref: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Code2 className="h-5 w-5" aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-base font-semibold">Waiting for the first pageview</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        This site is set up but has not received any events yet. Add the tracking snippet to your
        site — the dashboard fills in as soon as someone visits.
      </p>
      <a
        href={installHref}
        className="mt-6 inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Get the tracking code
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </a>

      <div className="mx-auto mt-8 grid max-w-lg gap-3 text-left sm:grid-cols-2">
        <MiniStat label="Pageviews" value="—" />
        <MiniStat label="Visitors" value="—" />
      </div>
    </div>
  );
}
