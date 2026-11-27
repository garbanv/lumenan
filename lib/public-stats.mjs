// @ts-check
/**
 * What a public share link is allowed to carry.
 *
 * The dashboard is a client component, so every field of the stats object is
 * serialised into the page a viewer receives, whether or not it is drawn. The
 * per-visit activity feed (path, referrer, country, device, browser and exact
 * time of each recent visit) must therefore be removed from the data itself.
 * Anything added to the stats later that describes individual visits belongs
 * here too.
 *
 * Returns a copy; the cached object shared with the owner's dashboard is not
 * modified.
 *
 * @template {{ recent: unknown[] }} T
 * @param {T} stats
 * @returns {T}
 */
export function toPublicStats(stats) {
  return { ...stats, recent: [] };
}
