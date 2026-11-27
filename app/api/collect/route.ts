import { NextResponse } from 'next/server';
import {
  clientMetadata,
  hashVisitor,
  isAllowedOrigin,
  isLikelyBot,
  normalizePath,
  parseReferrer,
  shouldCountReferral,
  visitorDay,
} from '@/lib/ingest';
import { visitorSalt } from '@/lib/env';
import { enqueueEvent } from '@/lib/queue';
import { countryFromIp } from '@/lib/geoip';
import { getDailySalt } from '@/lib/salts';
import { getIngestSiteConfig } from '@/lib/sites';
import { isExcludedPath } from '@/lib/slug';
import { INGEST_LIMIT_PER_MINUTE, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/** Browsers may POST here from any tracked origin, so CORS is permissive. */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
} as const;

interface CollectPayload {
  siteId?: string;
  path?: string;
  referrer?: string;
  eventType?: string;
  eventName?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

/** Always 204: a tracking script must never surface errors to the host page. */
function accepted(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  const userAgent = req.headers.get('user-agent') || '';

  // Cheapest rejection first, before reading the body.
  if (isLikelyBot(userAgent)) return accepted();

  let body: CollectPayload;
  try {
    // The tracker sends via sendBeacon, which cannot set Content-Type to
    // application/json without triggering a preflight, so the body arrives as
    // text/plain. Parsing the text as JSON avoids that round-trip.
    const raw = await req.text();
    body = JSON.parse(raw) as CollectPayload;
  } catch {
    return accepted();
  }

  const siteId = typeof body.siteId === 'string' ? body.siteId.slice(0, 64) : '';
  const rawPath = typeof body.path === 'string' ? body.path.slice(0, 2048) : '';

  if (!siteId || !rawPath) return accepted();

  // Pathname only. Anything after "?" or "#" is dropped here even though the
  // current tracker never sends it, because cached copies of the old tracker do.
  const path = normalizePath(rawPath);

  const meta = clientMetadata(req.headers);

  const limit = rateLimit(`ingest:${siteId}:${meta.ip}`, INGEST_LIMIT_PER_MINUTE, 60_000);
  if (!limit.allowed) {
    return new NextResponse(null, {
      status: 429,
      headers: { ...CORS_HEADERS, 'Retry-After': String(limit.retryAfter) },
    });
  }

  try {
    const site = await getIngestSiteConfig(siteId);
    if (!site) {
      // Silently drop: a stray or misconfigured tag on someone else's page
      // should not be a visible failure for their visitors. Logged so the
      // mistake is still findable.
      console.warn(`Dropped event for unknown site_id: "${siteId}"`);
      return accepted();
    }

    // Origin check. `Origin` is the browser-enforced source; fall back to the
    // Referer's host when the request came from a same-origin beacon.
    const originHost = hostOf(req.headers.get('origin')) ?? hostOf(req.headers.get('referer'));
    if (!isAllowedOrigin(originHost, site)) {
      console.warn(
        `Dropped event for site "${siteId}" from disallowed origin: "${originHost ?? 'unknown'}"`
      );
      return accepted();
    }

    if (isExcludedPath(path, site.excludedPaths)) return accepted();

    const referrer = typeof body.referrer === 'string' ? body.referrer : null;
    const referrerDomain = parseReferrer(referrer);
    const countsAsReferral = shouldCountReferral(referrerDomain, site);

    const isCustom = body.eventType === 'custom';
    const eventName = isCustom
      ? (typeof body.eventName === 'string' ? body.eventName.slice(0, 128) : 'unnamed')
      : null;

    // The day is read once so the hash and the visitors row always agree, even
    // for an event that arrives as UTC midnight passes.
    // A CDN header wins when present; otherwise resolve it here from the local
    // DB-IP database. The IP is only read in memory and the country is all that is kept.
    const country = meta.country ?? (await countryFromIp(meta.ip));

    const day = visitorDay();
    const dailySalt = await getDailySalt(day);

    enqueueEvent({
      siteId: site.id,
      visitorHash: hashVisitor(meta.ip, userAgent, site.id, visitorSalt(), dailySalt),
      visitorDay: day,
      path,
      // Domain only: the full referrer URL can carry a query string with
      // personal data and the dashboard never needs more than the host.
      // Suppressing self-referrals keeps the referrers panel free of the site's
      // own internal navigation.
      referrerDomain: countsAsReferral ? referrerDomain : null,
      utmSource: str(body.utmSource, 128),
      utmMedium: str(body.utmMedium, 128),
      utmCampaign: str(body.utmCampaign, 128),
      country,
      device: meta.device,
      browser: meta.browser,
      os: meta.os,
      eventType: isCustom ? 'custom' : 'pageview',
      eventName,
    });
  } catch (err) {
    // Never fail the host page because analytics broke.
    console.error('Ingest failed:', err);
  }

  return accepted();
}

function str(value: unknown, max: number): string | null {
  return typeof value === 'string' && value ? value.slice(0, max) : null;
}

/** "https://example.com/x" -> "example.com"; returns null when unparseable. */
function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}
