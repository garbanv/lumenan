/**
 * Metrics helpers safe to import from a `'use client'` component.
 *
 * Kept separate from lib/stats.ts, which imports the database pool. Importing a
 * single function from that module would pull `pg` into the browser bundle.
 */

/**
 * Percentage change between two periods.
 *
 * Returns null when there is no basis for comparison: a change from zero is
 * undefined, not 100%, and rendering "+100%" next to a site's first-ever
 * pageview would be a lie.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
