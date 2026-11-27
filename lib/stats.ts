import { query } from './db';
import { RANGES, resolveRange, type RangeSpec } from './ranges';
import type {
  BreakdownRow,
  StatsResponse,
  TimeseriesPoint,
} from './types';

// Re-exported so server code can import ranges from one place. Client
// components must import from ./ranges directly.
export { RANGES, RANGE_ORDER, isRangeKey, resolveRange } from './ranges';
export type { RangeSpec } from './ranges';

// Interval strings are chosen from this map and interpolated, never taken from
// user input, so no untrusted value reaches the SQL text.
function intervalFor(spec: RangeSpec, multiplier = 1): string {
  return `${spec.hours * multiplier} hours`;
}

interface CountsRow {
  pageviews: number;
  visitors: number;
  events: number;
}

interface SummaryRow extends CountsRow {
  new_visitors: number;
  single_page_visitors: number;
}

/**
 * Everything the dashboard needs, in one call.
 *
 * Runs its queries against the raw `events`/`visitors` tables. `events` is
 * indexed on (site_id, created_at DESC), so each aggregate is an index scan
 * limited to one tenant's slice of one time window. Beyond roughly ten million
 * rows per site this should read from a rollup table instead; the shape of
 * this function is the seam where that swap happens.
 */
export async function getStats(siteId: string, spec: RangeSpec): Promise<StatsResponse> {
  const window = intervalFor(spec);
  const previousWindowStart = intervalFor(spec, 2);
  const bucket = spec.interval;

  const [
    summaryResult,
    previousResult,
    timeseriesResult,
    topPagesResult,
    referrersResult,
    countriesResult,
    devicesResult,
    browsersResult,
    operatingSystemsResult,
    customEventsResult,
    recentResult,
  ] = await Promise.all([
    // --- current window summary -------------------------------------------
    // One pass over the window in a CTE: per-visitor pageview counts, then
    // scalar aggregates over that. `visitors` is count(DISTINCT ...) and must
    // not be confused with pageviews.
    query<SummaryRow>(
      `WITH bounds AS (
         SELECT now() - $2::interval AS start_at, now() AS end_at
       ),
       per_visitor AS (
         SELECT e.visitor_hash,
                bool_or(e.is_new_visitor)                                   AS is_new,
                count(*) FILTER (WHERE e.event_type = 'pageview')::int      AS pageviews
           FROM events e, bounds b
          WHERE e.site_id = $1
            AND e.created_at > b.start_at
            AND e.created_at <= b.end_at
          GROUP BY e.visitor_hash
       )
       SELECT
         coalesce((SELECT sum(pageviews) FROM per_visitor), 0)::int          AS pageviews,
         (SELECT count(*) FROM per_visitor)::int                             AS visitors,
         (SELECT count(*) FROM per_visitor WHERE is_new)::int                AS new_visitors,
         (SELECT count(*) FROM per_visitor WHERE pageviews <= 1)::int        AS single_page_visitors,
         (SELECT count(*)::int FROM events e, bounds b
           WHERE e.site_id = $1
             AND e.created_at > b.start_at
             AND e.created_at <= b.end_at
             AND e.event_type = 'custom')                                    AS events`,
      [siteId, window]
    ),

    // --- preceding window, for the delta indicators ------------------------
    query<CountsRow>(
      `SELECT
         count(*) FILTER (WHERE event_type = 'pageview')::int AS pageviews,
         count(*) FILTER (WHERE is_new_visitor)::int          AS visitors,
         0::int                                               AS events
         FROM events
        WHERE site_id = $1
          AND created_at > now() - $2::interval
          AND created_at <= now() - $3::interval`,
      [siteId, previousWindowStart, window]
    ),

    // --- timeseries, bucketed by hour or day depending on the range --------
    // Previously this always used date_trunc('day', ...), so the 24-hour range
    // produced a two-point chart. The bucket size now follows the range.
    //
    // The series is anchored to the window, not to the calendar: bucket 0 starts
    // exactly `window` ago and the final bucket ends at now(), so the chart sums
    // to the same total as the summary card above it. Anchoring with
    // date_trunc() instead would make the first bucket reach up to one period
    // further back than the window and inflate the total.
    //
    // The step is built as `1 <unit>` rather than `<unit> 1`: Postgres parses
    // 'hour 1' as the interval 00:00:01 (a bare number applies to seconds and the
    // trailing word is ignored), which would generate one bucket per second.
    query<{ bucket: Date; pageviews: number; visitors: number }>(
      `WITH b AS (
         SELECT now() - $2::interval AS start_at,
                now()                AS end_at,
                ('1 ' || $3)::interval AS step
       ),
       buckets AS (
         SELECT generate_series(b.start_at, b.end_at - b.step, b.step) AS bucket
           FROM b
       )
       SELECT bk.bucket,
              count(e.id) FILTER (WHERE e.event_type = 'pageview')::int AS pageviews,
              count(DISTINCT e.visitor_hash)::int                      AS visitors
         FROM buckets bk
         LEFT JOIN events e
           ON e.site_id = $1
          AND e.created_at >= bk.bucket
          AND e.created_at < bk.bucket + ('1 ' || $3)::interval
        GROUP BY bk.bucket
        ORDER BY bk.bucket ASC`,
      [siteId, window, bucket]
    ),

    // --- breakdowns -------------------------------------------------------
    // Grouped by path only, not path+referrer, so the numbers agree with the
    // summary card above.
    query<{ label: string; value: number }>(
      `SELECT path AS label, count(*)::int AS value
         FROM events
        WHERE site_id = $1
          AND created_at > now() - $2::interval
          AND event_type = 'pageview'
        GROUP BY path
        ORDER BY value DESC, label ASC
        LIMIT 10`,
      [siteId, window]
    ),

    query<{ label: string; value: number }>(
      `SELECT coalesce(referrer_domain, 'Direct') AS label, count(*)::int AS value
         FROM events
        WHERE site_id = $1
          AND created_at > now() - $2::interval
          AND event_type = 'pageview'
        GROUP BY referrer_domain
        ORDER BY value DESC, label ASC
        LIMIT 10`,
      [siteId, window]
    ),

    query<{ label: string; value: number }>(
      `SELECT country AS label, count(*)::int AS value
         FROM events
        WHERE site_id = $1
          AND created_at > now() - $2::interval
          AND country IS NOT NULL
        GROUP BY country
        ORDER BY value DESC, label ASC
        LIMIT 10`,
      [siteId, window]
    ),

    query<{ label: string; value: number }>(
      `SELECT coalesce(device, 'Unknown') AS label, count(*)::int AS value
         FROM events
        WHERE site_id = $1 AND created_at > now() - $2::interval
        GROUP BY device
        ORDER BY value DESC, label ASC`,
      [siteId, window]
    ),

    query<{ label: string; value: number }>(
      `SELECT coalesce(browser, 'Unknown') AS label, count(*)::int AS value
         FROM events
        WHERE site_id = $1 AND created_at > now() - $2::interval
        GROUP BY browser
        ORDER BY value DESC, label ASC
        LIMIT 8`,
      [siteId, window]
    ),

    query<{ label: string; value: number }>(
      `SELECT coalesce(os, 'Unknown') AS label, count(*)::int AS value
         FROM events
        WHERE site_id = $1 AND created_at > now() - $2::interval
        GROUP BY os
        ORDER BY value DESC, label ASC
        LIMIT 8`,
      [siteId, window]
    ),

    query<{ label: string; value: number }>(
      `SELECT coalesce(event_name, 'unnamed') AS label, count(*)::int AS value
         FROM events
        WHERE site_id = $1
          AND created_at > now() - $2::interval
          AND event_type = 'custom'
        GROUP BY event_name
        ORDER BY value DESC, label ASC
        LIMIT 10`,
      [siteId, window]
    ),

    query<{
      path: string;
      referrer_domain: string | null;
      country: string | null;
      device: string | null;
      browser: string | null;
      event_type: string;
      event_name: string | null;
      is_new_visitor: boolean;
      created_at: Date;
    }>(
      `SELECT path, referrer_domain, country, device, browser,
              event_type, event_name, is_new_visitor, created_at
         FROM events
        WHERE site_id = $1
        ORDER BY created_at DESC
        LIMIT 12`,
      [siteId]
    ),
  ]);

  const summaryRow = summaryResult.rows[0];
  const previousRow = previousResult.rows[0];

  const pageviews = summaryRow?.pageviews ?? 0;
  const visitors = summaryRow?.visitors ?? 0;
  const singlePageVisitors = summaryRow?.single_page_visitors ?? 0;

  return {
    range: spec.key,
    interval: spec.interval,
    summary: {
      pageviews,
      visitors,
      newVisitors: summaryRow?.new_visitors ?? 0,
      bounceRate: visitors > 0 ? (singlePageVisitors / visitors) * 100 : 0,
      events: summaryRow?.events ?? 0,
      pagesPerVisit: visitors > 0 ? Math.round((pageviews / visitors) * 100) / 100 : 0,
    },
    previous: {
      pageviews: previousRow?.pageviews ?? 0,
      visitors: previousRow?.visitors ?? 0,
    },
    timeseries: timeseriesResult.rows.map(
      (row): TimeseriesPoint => ({
        bucket: row.bucket.toISOString(),
        pageviews: row.pageviews,
        visitors: row.visitors,
      })
    ),
    topPages: toBreakdown(topPagesResult.rows),
    topReferrers: toBreakdown(referrersResult.rows),
    topCountries: toBreakdown(countriesResult.rows),
    devices: toBreakdown(devicesResult.rows),
    browsers: toBreakdown(browsersResult.rows),
    operatingSystems: toBreakdown(operatingSystemsResult.rows),
    customEvents: toBreakdown(customEventsResult.rows),
    recent: recentResult.rows.map((row) => ({
      path: row.path,
      referrer: row.referrer_domain,
      country: row.country,
      device: row.device,
      browser: row.browser,
      eventType: row.event_type,
      eventName: row.event_name,
      isNewVisitor: row.is_new_visitor,
      createdAt: row.created_at.toISOString(),
    })),
  };
}

function toBreakdown(rows: { label: string; value: number }[]): BreakdownRow[] {
  return rows.map((row) => ({ label: row.label, value: row.value, meta: null }));
}
