import { randomUUID } from 'node:crypto';
import { isUniqueViolation, query } from './db';
import { slugify } from './slug';
import { generateShareToken, isShareToken } from './share';
import type { Site, SiteSummary } from './types';

interface SiteRow {
  id: string;
  name: string;
  domain: string;
  allowed_domains: string[] | null;
  excluded_paths: string[] | null;
  exclude_self_referrals: boolean;
  share_token: string | null;
  created_at: Date;
}

function toSite(row: SiteRow): Site {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    allowedDomains: row.allowed_domains ?? [],
    excludedPaths: row.excluded_paths ?? [],
    excludeSelfReferrals: row.exclude_self_referrals,
    shareToken: row.share_token,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * 8 hex characters of a random UUID appended to a readable slug, so ids are not
 * guessable ("my-blog-3f9a1c7e" rather than "my-blog"). Total length <= 48.
 *
 * Note this is a *tracking* key, not a secret: it is embedded in page source on
 * every tracked site. It grants write access to a site's event stream and
 * nothing else — reading a dashboard requires a session.
 */
export function generateSiteId(name: string, domain: string): string {
  const base = (slugify(name) || slugify(domain) || 'site').slice(0, 39).replace(/-+$/, '');
  return `${base}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

const SITE_COLUMNS = `id, name, domain, allowed_domains, excluded_paths,
                      exclude_self_referrals, share_token, created_at`;

/** Same columns, qualified for queries that join other tables. */
const SITE_COLUMNS_QUALIFIED = `s.id, s.name, s.domain, s.allowed_domains,
                                s.excluded_paths, s.exclude_self_referrals, s.share_token, s.created_at`;

/**
 * All sites owned by a user, each with headline numbers for the last 7 days and
 * the 7 days before that so the list can show a trend.
 */
export async function listSitesForUser(userId: string): Promise<SiteSummary[]> {
  const { rows } = await query<
    SiteRow & { pageviews: number; visitors: number; previous_pageviews: number }
  >(
    `SELECT ${SITE_COLUMNS_QUALIFIED},
            coalesce(cur.pageviews, 0)::int  AS pageviews,
            coalesce(cur.visitors, 0)::int   AS visitors,
            coalesce(prev.pageviews, 0)::int AS previous_pageviews
       FROM sites s
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE event_type = 'pageview') AS pageviews,
                count(*) FILTER (WHERE is_new_visitor)           AS visitors
           FROM events e
          WHERE e.site_id = s.id
            AND e.created_at > now() - interval '7 days'
       ) cur ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE event_type = 'pageview') AS pageviews
           FROM events e
          WHERE e.site_id = s.id
            AND e.created_at > now() - interval '14 days'
            AND e.created_at <= now() - interval '7 days'
       ) prev ON true
      WHERE s.user_id = $1
      ORDER BY s.created_at DESC`,
    [userId]
  );

  return rows.map((row) => ({
    ...toSite(row),
    pageviews: row.pageviews,
    visitors: row.visitors,
    previousPageviews: row.previous_pageviews,
  }));
}

export async function getSiteForUser(siteId: string, userId: string): Promise<Site | null> {
  const { rows } = await query<SiteRow>(
    `SELECT ${SITE_COLUMNS} FROM sites WHERE id = $1 AND user_id = $2`,
    [siteId, userId]
  );
  const row = rows[0];
  return row ? toSite(row) : null;
}

export type ShareAction = 'enable' | 'regenerate' | 'disable';

/**
 * Turn the public link on, replace it, or turn it off. Scoped by user_id like
 * every other write. `enable` keeps an existing token so pressing it twice does
 * not silently break a link someone already has; `regenerate` is the explicit
 * way to revoke the old one.
 */
export async function setSharingForUser(
  siteId: string,
  userId: string,
  action: ShareAction
): Promise<Site | null> {
  const { rows } = await query<SiteRow>(
    `UPDATE sites
        SET share_token = CASE $3
                            WHEN 'disable'    THEN NULL
                            WHEN 'regenerate' THEN $4
                            ELSE COALESCE(share_token, $4)
                          END,
            updated_at  = now()
      WHERE id = $1 AND user_id = $2
      RETURNING ${SITE_COLUMNS}`,
    [siteId, userId, action, generateShareToken()]
  );
  const row = rows[0];
  return row ? toSite(row) : null;
}

/** Resolve a public link. Malformed tokens never reach the database. */
export async function getSiteByShareToken(token: string): Promise<Site | null> {
  if (!isShareToken(token)) return null;
  const { rows } = await query<SiteRow>(
    `SELECT ${SITE_COLUMNS} FROM sites WHERE share_token = $1`,
    [token]
  );
  const row = rows[0];
  return row ? toSite(row) : null;
}

export interface CreateSiteInput {
  name: string;
  domain: string;
  allowedDomains?: string[];
  excludedPaths?: string[];
  excludeSelfReferrals?: boolean;
}

export type CreateSiteResult =
  | { ok: true; site: Site }
  | { ok: false; reason: 'id_collision'; attempts: number };

export async function createSite(
  userId: string,
  input: CreateSiteInput
): Promise<CreateSiteResult> {
  const attempts = 5;
  for (let i = 0; i < attempts; i++) {
    const id = generateSiteId(input.name, input.domain);
    try {
      const { rows } = await query<SiteRow>(
        `INSERT INTO sites (id, user_id, name, domain, allowed_domains, excluded_paths, exclude_self_referrals)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${SITE_COLUMNS}`,
        [
          id,
          userId,
          input.name.slice(0, 120),
          input.domain,
          input.allowedDomains ?? [],
          input.excludedPaths ?? [],
          input.excludeSelfReferrals ?? true,
        ]
      );
      const row = rows[0];
      if (!row) throw new Error('INSERT ... RETURNING produced no row');
      return { ok: true, site: toSite(row) };
    } catch (err) {
      // A generated id collided (astronomically unlikely, but a retry is
      // cheaper than surfacing a 500 for a recoverable conflict).
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  return { ok: false, reason: 'id_collision', attempts };
}

export interface UpdateSiteInput {
  name?: string;
  domain?: string;
  allowedDomains?: string[];
  excludedPaths?: string[];
  excludeSelfReferrals?: boolean;
}

/** Scoped by user_id, so a wrong owner updates nothing and gets null back. */
export async function updateSiteForUser(
  siteId: string,
  userId: string,
  input: UpdateSiteInput
): Promise<Site | null> {
  const { rows } = await query<SiteRow>(
    `UPDATE sites
        SET name                   = COALESCE($3, name),
            domain                 = COALESCE($4, domain),
            allowed_domains        = COALESCE($5, allowed_domains),
            excluded_paths         = COALESCE($6, excluded_paths),
            exclude_self_referrals = COALESCE($7, exclude_self_referrals),
            updated_at             = now()
      WHERE id = $1 AND user_id = $2
      RETURNING ${SITE_COLUMNS}`,
    [
      siteId,
      userId,
      input.name ?? null,
      input.domain ?? null,
      input.allowedDomains ?? null,
      input.excludedPaths ?? null,
      input.excludeSelfReferrals ?? null,
    ]
  );
  const row = rows[0];
  return row ? toSite(row) : null;
}

export async function deleteSiteForUser(siteId: string, userId: string): Promise<boolean> {
  const { rowCount } = await query('DELETE FROM sites WHERE id = $1 AND user_id = $2', [
    siteId,
    userId,
  ]);
  // Events, visitors and any dependent rows go with it via ON DELETE CASCADE.
  return (rowCount ?? 0) > 0;
}

export async function countSitesForUser(userId: string): Promise<number> {
  const { rows } = await query<{ n: number }>(
    'SELECT count(*)::int AS n FROM sites WHERE user_id = $1',
    [userId]
  );
  return rows[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Ingestion lookup
// ---------------------------------------------------------------------------

export interface IngestSiteConfig {
  id: string;
  allowedDomains: string[];
  excludedPaths: string[];
  excludeSelfReferrals: boolean;
  domain: string;
}

/**
 * Site configuration for the ingest path, cached per process.
 *
 * The collect endpoint is the highest-volume route in the app and must not do a
 * database round-trip per event. Two properties make this safe:
 *   - a miss triggers at most one re-read per MISS_REFRESH_MS, so a flood of
 *     bogus site ids cannot become a flood of queries;
 *   - config changes (allowed domains, excluded paths) are eventual within
 *     REFRESH_INTERVAL_MS, which is acceptable for ingest filtering.
 */
const REFRESH_INTERVAL_MS = 30_000;
const MISS_REFRESH_MS = 5_000;

let cache = new Map<string, IngestSiteConfig>();
let lastRefresh = 0;
let inFlight: Promise<void> | null = null;

async function refresh(): Promise<void> {
  const { rows } = await query<{
    id: string;
    domain: string;
    allowed_domains: string[] | null;
    excluded_paths: string[] | null;
    exclude_self_referrals: boolean;
  }>(
    `SELECT id, domain, allowed_domains, excluded_paths, exclude_self_referrals
       FROM sites`
  );
  cache = new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        domain: row.domain,
        allowedDomains: row.allowed_domains ?? [],
        excludedPaths: row.excluded_paths ?? [],
        excludeSelfReferrals: row.exclude_self_referrals,
      },
    ])
  );
  lastRefresh = Date.now();
}

async function ensureRefreshed(): Promise<void> {
  // Collapse concurrent refreshes into a single query.
  inFlight = inFlight ?? refresh().finally(() => { inFlight = null; });
  await inFlight;
}

/** Call after creating, updating or deleting a site. */
export function invalidateSiteCache(): void {
  lastRefresh = 0;
}

export async function getIngestSiteConfig(
  siteId: string
): Promise<IngestSiteConfig | null> {
  if (cache.size === 0 || Date.now() - lastRefresh > REFRESH_INTERVAL_MS) {
    await ensureRefreshed();
  }
  const hit = cache.get(siteId);
  if (hit) return hit;

  // Not in cache. The site may have been created moments ago, possibly on
  // another instance, so re-read once — but no more often than MISS_REFRESH_MS.
  if (Date.now() - lastRefresh > MISS_REFRESH_MS) {
    await ensureRefreshed();
    return cache.get(siteId) ?? null;
  }
  return null;
}
