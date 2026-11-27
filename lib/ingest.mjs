// @ts-check
/**
 * Visitor identification, request metadata and event filtering.
 *
 * All functions here take Web-standard `Headers`, so they work unchanged in a
 * Next.js route handler and in a unit test.
 */

import { createHmac } from 'node:crypto';
import { UAParser } from 'ua-parser-js';
import { domainHost, hostMatchesRule } from './slug.mjs';

/**
 * The UTC calendar day, as YYYY-MM-DD. Visitors are counted per day, and each
 * day has its own random salt (see lib/salts.mjs).
 *
 * @param {Date} [now]
 * @returns {string} YYYY-MM-DD in UTC
 */
export function visitorDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Visitor identification, without cookies and without storing anyone's IP.
 *
 * The key is the server secret plus a random salt that exists for one UTC day
 * and is deleted afterwards (lib/salts.mjs). The same person therefore produces
 * a different identifier tomorrow and cannot be followed across days, and
 * because the old salt is gone, nobody can recompute a past day's identifiers
 * from an IP address, not even someone holding the database and the secret. The
 * raw IP is used only as hash input and is never persisted.
 *
 * The consequence worth understanding: "unique visitors" is really "unique
 * visitor-days". A person who visits on three days counts three times in a
 * seven-day window. That is the honest trade for not tracking people.
 *
 * @param {string} ip
 * @param {string} userAgent
 * @param {string} siteId
 * @param {string} secret long-lived server secret (VISITOR_SALT), acting as a pepper
 * @param {string} dailySalt random salt for the current UTC day
 * @returns {string} 32 hex characters
 */
export function hashVisitor(ip, userAgent, siteId, secret, dailySalt) {
  // An empty salt would quietly degrade to a hash that is the same every day,
  // which is exactly the cross-day tracking this exists to prevent.
  if (!dailySalt) throw new Error('hashVisitor requires a daily salt');

  return createHmac('sha256', `${secret}:${dailySalt}`)
    .update(`${ip}|${userAgent}|${siteId}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Client IP, taking only the part of `x-forwarded-for` that a trusted proxy
 * wrote.
 *
 * Each proxy appends the address it received the connection from, so the
 * *rightmost* entries are the trustworthy ones and the leftmost is whatever the
 * client chose to send. With `trustedHops` proxies in front of the app (1 for a
 * single Traefik/nginx, 2 for Cloudflare plus Traefik), the client is the entry
 * `trustedHops` places from the right. If the chain is shorter than that, the
 * leftmost entry is used. `0` means no proxy is trusted: forwarding headers are
 * ignored and every request maps to one placeholder, which is the safe answer
 * when the app cannot tell who is connecting.
 *
 * The result is capped in length because it is used as a rate-limit key.
 *
 * @param {Headers} headers
 * @param {number} [trustedHops]
 * @returns {string}
 */
export function getClientIp(headers, trustedHops = 1) {
  if (!(trustedHops >= 1)) return '0.0.0.0';

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const chain = forwarded
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (chain.length > 0) {
      const index = Math.max(0, chain.length - trustedHops);
      return (chain[index] ?? '0.0.0.0').slice(0, 64);
    }
  }
  return (headers.get('x-real-ip') || '0.0.0.0').trim().slice(0, 64);
}

/**
 * Country is injected by the edge (Vercel, Cloudflare); no GeoIP database and
 * no external lookup.
 *
 * @param {Headers} headers
 * @returns {string | null}
 */
export function getCountry(headers) {
  const raw =
    headers.get('x-vercel-ip-country') ||
    headers.get('cf-ipcountry') ||
    headers.get('x-country') ||
    null;
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  // "XX" and "T1" are Cloudflare/Tor anonymity markers, not countries.
  if (code === 'XX' || code === 'T1' || !/^[A-Z]{2}$/.test(code)) return null;
  return code;
}

/**
 * @param {string} userAgent
 * @returns {{ device: string, browser: string, os: string }}
 */
export function parseUserAgent(userAgent) {
  const parsed = new UAParser(userAgent).getResult();
  const rawType = parsed.device.type;
  const device =
    rawType === 'mobile' || rawType === 'tablet'
      ? rawType
      : rawType === 'smarttv' || rawType === 'console' || rawType === 'wearable'
        ? rawType
        : 'desktop';

  return {
    device,
    browser: parsed.browser.name || 'Unknown',
    os: parsed.os.name || 'Unknown',
  };
}

/**
 * @param {Headers} headers
 * @param {number} [trustedHops] see getClientIp
 * @returns {{ ip: string, country: string | null, device: string, browser: string, os: string }}
 */
export function clientMetadata(headers, trustedHops = 1) {
  const userAgent = headers.get('user-agent') || '';
  return {
    ip: getClientIp(headers, trustedHops),
    country: getCountry(headers),
    ...parseUserAgent(userAgent),
  };
}

// Deliberately broad: a false positive silently loses real traffic, so this
// catches the obvious crawlers rather than trying to be exhaustive.
const BOT_PATTERN =
  /bot\b|bots\b|crawler|crawl|spider|slurp|facebookexternalhit|embedly|quora link preview|pinterest|bitlybot|vkshare|whatsapp|telegrambot|headlesschrome|phantomjs|puppeteer|playwright|lighthouse|pingdom|uptimerobot|gtmetrix|python-requests|python-urllib|go-http-client|curl\/|wget\/|axios\/|node-fetch|okhttp/i;

/**
 * @param {string} userAgent
 * @returns {boolean}
 */
export function isLikelyBot(userAgent) {
  if (!userAgent) return true; // No UA at all is not a real browser visit.
  return BOT_PATTERN.test(userAgent);
}

/**
 * Reduce whatever the client sent as `path` to a bare pathname.
 *
 * The current tracker only sends `location.pathname`, but browsers and CDNs
 * keep serving cached copies of the old `track.js`, which sent the query string
 * too. Query strings regularly carry personal data (emails, tokens, order ids,
 * search terms), so the server enforces this rather than trusting the client:
 * everything from the first `?` or `#` is discarded before the value is
 * filtered, stored or displayed.
 *
 * Path segments themselves can still contain identifiers (`/users/jane`). That
 * is a property of the tracked site's URL design; use `excluded_paths` for
 * those routes.
 *
 * @param {unknown} raw
 * @returns {string} always starts with "/"; "" only when `raw` is not a string
 */
export function normalizePath(raw) {
  if (typeof raw !== 'string') return '';
  const bare = (raw.split(/[?#]/, 1)[0] ?? '').trim().slice(0, 2048);
  if (!bare) return '/';
  return bare.startsWith('/') ? bare : `/${bare}`;
}

/**
 * "https://news.ycombinator.com/item?id=1" -> "news.ycombinator.com"
 * @param {string | null | undefined} referrer
 * @returns {string | null}
 */
export function parseReferrer(referrer) {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Should this event be attributed to a referring site?
 *
 * Discards same-site traffic so internal navigation does not dominate the
 * referrers panel. When the site has no explicit allowed domains, its own
 * configured domain still counts as "self", which is the common case.
 *
 * @param {string | null} referrerDomain
 * @param {{ domain: string, allowedDomains: string[], excludeSelfReferrals: boolean }} site
 * @returns {boolean}
 */
export function shouldCountReferral(referrerDomain, site) {
  if (!referrerDomain) return false;
  if (!site.excludeSelfReferrals) return true;

  const selfRules =
    site.allowedDomains.length > 0 ? site.allowedDomains : [domainHost(site.domain)];
  return !selfRules.some((rule) => hostMatchesRule(referrerDomain, rule));
}

/**
 * Ingest is only for hosts the site owner has claimed.
 *
 * @param {string | null} requestHost
 * @param {{ domain: string, allowedDomains: string[] }} site
 * @returns {boolean}
 */
export function isAllowedOrigin(requestHost, site) {
  if (!requestHost) {
    // Header absent (some proxies strip it). Fall back to allowing the request
    // only when the site has no explicit allowlist; otherwise refuse, since
    // with an allowlist configured the origin is the whole point.
    return site.allowedDomains.length === 0;
  }

  if (isLocalhost(requestHost)) return true;

  const rules = site.allowedDomains.length > 0 ? site.allowedDomains : [domainHost(site.domain)];
  return rules.some((rule) => hostMatchesRule(requestHost, rule));
}

/**
 * @param {string} host
 * @returns {boolean}
 */
function isLocalhost(host) {
  const bare = domainHost(host.toLowerCase());
  return bare === 'localhost' || bare === '127.0.0.1' || bare === '::1';
}
