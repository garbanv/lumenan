import { query } from './db';
import { TtlCache } from './ttl-cache.mjs';

/** A visitor counts as "current" if they sent an event in this many minutes. */
export const REALTIME_WINDOW_MINUTES = 5;

/**
 * Cached for a few seconds so many open dashboards polling the same site cost
 * one query between them. State lives on globalThis for the same reason as the
 * stats cache (dev hot reloads, separately bundled modules).
 */
const REALTIME_CACHE_TTL_MS = 5_000;
const globalCache = globalThis as typeof globalThis & {
  __analyticsRealtimeCache?: TtlCache<number>;
};
const cache = (globalCache.__analyticsRealtimeCache ??= new TtlCache<number>({
  ttlMs: REALTIME_CACHE_TTL_MS,
}));

/**
 * Distinct visitors with an event in the last few minutes, across the whole
 * site (dashboard filters do not apply: "who is here right now" is not a
 * property of the selected date range).
 */
export function getRealtimeVisitors(siteId: string): Promise<number> {
  return cache.get(siteId, async () => {
    const result = await query<{ visitors: number }>(
      `SELECT count(DISTINCT visitor_hash)::int AS visitors
         FROM events
        WHERE site_id = $1
          AND created_at > now() - make_interval(mins => $2::int)`,
      [siteId, REALTIME_WINDOW_MINUTES]
    );
    return result.rows[0]?.visitors ?? 0;
  });
}
