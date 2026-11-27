'use client';

import { ArrowRight, Code2, FilterX } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { AreaChart } from '@/components/charts/area-chart';
import { BreakdownList } from '@/components/charts/breakdown-list';
import { DonutChart } from '@/components/charts/donut-chart';
import { CountryLabel, PathLabel } from '@/components/path-label';
import { MiniStat, StatCard } from '@/components/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { percentChange } from '@/lib/client-metrics';
import { formatExact, formatNumber, formatPercent, formatRelative } from '@/lib/utils';
import { RANGES } from '@/lib/ranges';
import type { GoalResult, StatsResponse } from '@/lib/types';
import type { BreakdownRow } from '@/lib/types';
import type { FilterKey } from '@/lib/filters';

interface DashboardProps {
  stats: StatsResponse;
  /** Drives the "no data yet" install hint. */
  installHref: string;
  /** True when at least one filter is active, so "no data" means "nothing matches". */
  filtered?: boolean;
  /**
   * Public share view: no install hints, and no per-event activity feed. A
   * shared link shows aggregates only, so a viewer cannot read individual
   * visits with their timestamps.
   */
  readOnly?: boolean;
  /** Where goals are managed; the empty Goals card links here. Omitted when read-only. */
  goalsHref?: string;
}

export function Dashboard({
  stats,
  installHref,
  filtered = false,
  readOnly = false,
  goalsHref,
}: DashboardProps) {
  const searchParams = useSearchParams();
  const { summary, previous, timeseries } = stats;

  /** Link that applies one filter on top of the current URL (range and other filters kept). */
  const filterHref = (key: FilterKey) => (row: BreakdownRow) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, row.label);
    return `?${params.toString()}`;
  };
  const rangeLabel = RANGES[stats.range].label.toLowerCase();

  const hasAnyData = summary.pageviews > 0 || summary.events > 0;
  if (!hasAnyData) {
    return filtered ? (
      <NoMatches />
    ) : (
      <NoDataYet installHref={installHref} readOnly={readOnly} />
    );
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
          detail={`${formatExact(summary.visitors)} ${summary.visitors === 1 ? 'visitor-day' : 'visitor-days'} (a returning person counts once per day)`}
        />
        <StatCard
          label="Bounce rate"
          value={formatPercent(summary.bounceRate, 0)}
          detail={
            summary.visitors > 0
              ? `${formatPercent(summary.bounceRate, 0)} of visits were a single page`
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
              hrefFor={filterHref('page')}
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
              hrefFor={filterHref('referrer')}
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
            <DonutChart data={stats.devices} hrefFor={filterHref('device')} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Countries</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topCountries.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {readOnly ? (
                  'No country data yet.'
                ) : (
                  <>
                No country data yet. Visits from private or local addresses (localhost, Docker,
                an internal network) cannot be located, so test traffic stays empty here. On a
                public site it fills in from the DB-IP database or a CDN header
                (<code className="rounded bg-secondary px-1 py-0.5 text-xs">x-vercel-ip-country</code>{' '}
                or <code className="rounded bg-secondary px-1 py-0.5 text-xs">cf-ipcountry</code>).
                If it stays empty there, run{' '}
                <code className="rounded bg-secondary px-1 py-0.5 text-xs">npm run geoip:update</code>.
                  </>
                )}
              </p>
            ) : (
              <BreakdownList
                data={stats.topCountries}
                hrefFor={filterHref('country')}
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
            <BreakdownList data={stats.browsers} showBar={false} hrefFor={filterHref('browser')} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Operating systems</CardTitle>
          </CardHeader>
          <CardContent>
            <BreakdownList data={stats.operatingSystems} showBar={false} hrefFor={filterHref('os')} />
          </CardContent>
        </Card>
      </div>

      {/* ---------------- goals ---------------- */}
      {(stats.goals.length > 0 || (!readOnly && goalsHref)) && (
        <Card>
          <CardHeader>
            <CardTitle>Goals</CardTitle>
            {!readOnly && goalsHref && (
              <a href={goalsHref} className="text-xs text-primary underline-offset-4 hover:underline">
                Manage goals
              </a>
            )}
          </CardHeader>
          <CardContent>
            {stats.goals.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No goals yet. A goal counts a custom event or a page visit, such as a signup or a
                thank-you page, and shows how many visitors reach it.{' '}
                <a href={goalsHref} className="text-primary underline-offset-4 hover:underline">
                  Add a goal
                </a>
                .
              </p>
            ) : (
              <GoalsTable goals={stats.goals} />
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------------- events + live feed ---------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Custom events</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.customEvents.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {readOnly ? (
                  'None recorded.'
                ) : (
                  <>
                    None yet. Call{' '}
                    <code className="rounded bg-secondary px-1 py-0.5 text-xs">
                      trackEvent(&apos;signup&apos;)
                    </code>{' '}
                    on your site to record one.
                  </>
                )}
              </p>
            ) : (
              <BreakdownList data={stats.customEvents} />
            )}
          </CardContent>
        </Card>

        {!readOnly && (
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
        )}
      </div>
    </div>
  );
}

function GoalsTable({ goals }: { goals: GoalResult[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="pb-2 pr-4 font-medium">Goal</th>
            <th scope="col" className="pb-2 pr-4 text-right font-medium">Visitors</th>
            <th scope="col" className="pb-2 pr-4 text-right font-medium">Total</th>
            <th scope="col" className="pb-2 text-right font-medium">Conversion</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {goals.map((goal) => (
            <tr key={goal.id}>
              <th scope="row" className="py-2.5 pr-4 text-left font-normal">
                <span className="block truncate font-medium">{goal.name}</span>
                <span className="block truncate font-mono text-2xs text-muted-foreground">
                  {goal.type === 'event' ? 'event' : 'page'} · {goal.value}
                </span>
              </th>
              <td className="tabular py-2.5 pr-4 text-right">{formatExact(goal.visitors)}</td>
              <td className="tabular py-2.5 pr-4 text-right text-muted-foreground">
                {formatExact(goal.conversions)}
              </td>
              <td className="tabular py-2.5 text-right font-medium">
                {goal.conversionRate === null ? '—' : formatPercent(goal.conversionRate, 1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Shown when filters are active and nothing in the range matches them. */
function NoMatches() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <FilterX className="h-5 w-5" aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-base font-semibold">Nothing matches these filters</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        No events in this date range fit the active filters. Remove a filter above, or widen the range.
      </p>
    </div>
  );
}

/**
 * Shown when a site exists but has never received an event. This is the most
 * important state in the product — it is where every new user starts — so it
 * points directly at the install step rather than reporting an absence of data.
 */
function NoDataYet({ installHref, readOnly }: { installHref: string; readOnly: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Code2 className="h-5 w-5" aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-base font-semibold">
        {readOnly ? 'No data yet' : 'Waiting for the first pageview'}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        {readOnly
          ? 'This site has not recorded any visits in this date range.'
          : 'This site is set up but has not received any events yet. Add the tracking snippet to your site — the dashboard fills in as soon as someone visits.'}
      </p>
      {!readOnly && (
        <a
          href={installHref}
          className="mt-6 inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Get the tracking code
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </a>
      )}

      <div className="mx-auto mt-8 grid max-w-lg gap-3 text-left sm:grid-cols-2">
        <MiniStat label="Pageviews" value="—" />
        <MiniStat label="Visitors" value="—" />
      </div>
    </div>
  );
}
