// @ts-check
/**
 * Unit tests for visitor hashing, bot filtering and origin checks.
 *
 * These cover the privacy guarantees and the multi-tenant write boundary, which
 * are the two things most expensive to get wrong: a mis-hashed visitor inflates
 * every historical metric, and a permissive origin check lets a stranger write
 * events into someone else's site.
 *
 * Run with:  npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  visitorDay,
  hashVisitor,
  getClientIp,
  getCountry,
  parseUserAgent,
  isLikelyBot,
  normalizePath,
  parseReferrer,
  shouldCountReferral,
  isAllowedOrigin,
} from '../lib/ingest.mjs';

const SECRET = 'test-secret';

function headers(init = {}) {
  return new Headers(init);
}

// ---------------------------------------------------------------------------
// Visitor hashing
// ---------------------------------------------------------------------------

const SALT_MON = 'a'.repeat(64);
const SALT_TUE = 'b'.repeat(64);

test('the same visitor with the same daily salt hashes identically', () => {
  const a = hashVisitor('1.2.3.4', 'UA', 'site', SECRET, SALT_MON);
  const b = hashVisitor('1.2.3.4', 'UA', 'site', SECRET, SALT_MON);
  assert.equal(a, b, 'the hash must be stable for as long as the day\'s salt is');
});

test('a new daily salt gives the same visitor a different hash', () => {
  const monday = hashVisitor('1.2.3.4', 'UA', 'site', SECRET, SALT_MON);
  const tuesday = hashVisitor('1.2.3.4', 'UA', 'site', SECRET, SALT_TUE);
  assert.notEqual(monday, tuesday, 'a rotating identifier is the whole privacy story');
});

test('the hash does not depend on the clock, only on the salt', () => {
  // The old scheme derived its key from the date, which meant anyone holding
  // the secret could recompute any past day. The salt is the only thing that
  // distinguishes days now, and it is deleted once the day is over.
  //
  // Both `new Date()` and `Date.now()` are frozen to different instants, because
  // a regression could reach the clock through either.
  const RealDate = Date;
  function withClock(iso, fn) {
    const instant = new RealDate(iso).getTime();
    globalThis.Date = class extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(instant);
        else super(...args);
      }
      static now() {
        return instant;
      }
    };
    try {
      return fn();
    } finally {
      globalThis.Date = RealDate;
    }
  }

  const monday = withClock('2026-10-19T10:00:00Z', () =>
    hashVisitor('1.2.3.4', 'UA', 'site', SECRET, SALT_MON)
  );
  const yearsLater = withClock('2031-03-01T23:59:59Z', () =>
    hashVisitor('1.2.3.4', 'UA', 'site', SECRET, SALT_MON)
  );

  assert.equal(monday, yearsLater);
});

test('the hash separates visitors, user agents, sites, secrets and salts', () => {
  const base = hashVisitor('1.2.3.4', 'UA', 'site-a', SECRET, SALT_MON);

  assert.notEqual(base, hashVisitor('1.2.3.5', 'UA', 'site-a', SECRET, SALT_MON), 'different IP');
  assert.notEqual(base, hashVisitor('1.2.3.4', 'OTHER', 'site-a', SECRET, SALT_MON), 'different UA');
  assert.notEqual(base, hashVisitor('1.2.3.4', 'UA', 'site-b', SECRET, SALT_MON), 'different site');
  assert.notEqual(base, hashVisitor('1.2.3.4', 'UA', 'site-a', 'other', SALT_MON), 'different secret');
  assert.notEqual(base, hashVisitor('1.2.3.4', 'UA', 'site-a', SECRET, SALT_TUE), 'different salt');
});

test('the database alone is not enough: the secret is part of the key', () => {
  // Someone with a copy of the database and today's salt, but not VISITOR_SALT,
  // must not be able to reproduce a hash from a guessed IP address.
  const real = hashVisitor('203.0.113.9', 'UA', 'site', SECRET, SALT_MON);
  const guessWithoutSecret = hashVisitor('203.0.113.9', 'UA', 'site', '', SALT_MON);
  assert.notEqual(real, guessWithoutSecret);
});

test('hashVisitor refuses to run without a daily salt', () => {
  // Without one it would silently produce an identifier that is the same every
  // day: exactly the cross-day tracking this design exists to prevent.
  assert.throws(() => hashVisitor('1.2.3.4', 'UA', 'site', SECRET, ''), /daily salt/);
  assert.throws(() => hashVisitor('1.2.3.4', 'UA', 'site', SECRET, undefined), /daily salt/);
});

test('the hash is 32 hex characters and reveals no PII', () => {
  const hash = hashVisitor('203.0.113.9', 'Mozilla/5.0', 'site', SECRET, SALT_MON);
  assert.match(hash, /^[0-9a-f]{32}$/);
  assert.ok(!hash.includes('203.0.113.9'), 'the IP must not survive in the output');
});

test('visitorDay is a UTC date string', () => {
  assert.equal(visitorDay(new Date('2026-03-04T23:59:59Z')), '2026-03-04');
  assert.equal(visitorDay(new Date('2026-03-05T00:00:01Z')), '2026-03-05');
});

// ---------------------------------------------------------------------------
// Path normalisation
// ---------------------------------------------------------------------------

test('normalizePath drops the query string and fragment', () => {
  // The cached old tracker still sends these, so the server must not trust it.
  assert.equal(normalizePath('/pricing?utm_source=hn'), '/pricing');
  assert.equal(normalizePath('/signup?email=jane%40example.com&token=abc'), '/signup');
  assert.equal(normalizePath('/docs/intro#install'), '/docs/intro');
  assert.equal(normalizePath('/a?x=1#y'), '/a');
});

test('normalizePath leaves a clean pathname alone', () => {
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath('/blog/my-post'), '/blog/my-post');
  assert.equal(normalizePath('/trailing/'), '/trailing/');
});

test('normalizePath always returns a rooted path for string input', () => {
  assert.equal(normalizePath('pricing'), '/pricing');
  assert.equal(normalizePath('?only=query'), '/');
  assert.equal(normalizePath('#only-fragment'), '/');
  assert.equal(normalizePath('   '), '/');
});

test('normalizePath rejects non-strings and bounds the length', () => {
  assert.equal(normalizePath(undefined), '');
  assert.equal(normalizePath(null), '');
  assert.equal(normalizePath(42), '');
  assert.equal(normalizePath({ path: '/x' }), '');
  assert.equal(normalizePath('/' + 'a'.repeat(5000)).length, 2048);
});

// ---------------------------------------------------------------------------
// Request metadata
// ---------------------------------------------------------------------------

test('getClientIp trusts only the entries our proxies appended', () => {
  // One trusted proxy: the rightmost entry; anything to its left is client-supplied.
  assert.equal(getClientIp(headers({ 'x-forwarded-for': '6.6.6.6, 5.6.7.8' })), '5.6.7.8');
  assert.equal(getClientIp(headers({ 'x-forwarded-for': '  1.2.3.4  ' })), '1.2.3.4');
  // Two trusted hops (CDN + proxy): second from the right.
  assert.equal(getClientIp(headers({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4, 10.0.0.1' }), 2), '1.2.3.4');
  // Chain shorter than the trusted depth: fall back to the leftmost entry.
  assert.equal(getClientIp(headers({ 'x-forwarded-for': '1.2.3.4' }), 3), '1.2.3.4');
  // No trusted proxy: forwarding headers are ignored entirely.
  assert.equal(getClientIp(headers({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '9.9.9.9' }), 0), '0.0.0.0');
  // Capped, since it becomes a rate-limit key.
  assert.equal(getClientIp(headers({ 'x-forwarded-for': 'a'.repeat(500) })).length, 64);
});

test('getClientIp falls back to x-real-ip and then a placeholder', () => {
  assert.equal(getClientIp(headers({ 'x-real-ip': '9.9.9.9' })), '9.9.9.9');
  assert.equal(getClientIp(headers()), '0.0.0.0');
});

test('getCountry reads the edge headers', () => {
  assert.equal(getCountry(headers({ 'x-vercel-ip-country': 'DE' })), 'DE');
  assert.equal(getCountry(headers({ 'cf-ipcountry': 'us' })), 'US', 'normalised to uppercase');
  assert.equal(getCountry(headers()), null);
});

test('getCountry rejects the anonymity markers', () => {
  // Cloudflare reports XX for unknown and T1 for Tor; neither is a country.
  assert.equal(getCountry(headers({ 'cf-ipcountry': 'XX' })), null);
  assert.equal(getCountry(headers({ 'cf-ipcountry': 'T1' })), null);
  assert.equal(getCountry(headers({ 'cf-ipcountry': 'Eurozone' })), null);
});

test('parseUserAgent classifies device, browser and OS', () => {
  const desktop = parseUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
  );
  assert.equal(desktop.device, 'desktop');
  assert.equal(desktop.browser, 'Chrome');
  // ua-parser-js reports the family as "Mac OS"; the dashboard displays
  // whatever the parser returns, so assert the parser's own label.
  assert.equal(desktop.os, 'Mac OS');

  const mobile = parseUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  );
  assert.equal(mobile.device, 'mobile');
});

test('parseUserAgent degrades gracefully on an unknown user agent', () => {
  const result = parseUserAgent('');
  assert.equal(result.browser, 'Unknown');
  assert.equal(result.os, 'Unknown');
});

// ---------------------------------------------------------------------------
// Bot filtering
// ---------------------------------------------------------------------------

test('isLikelyBot catches the obvious crawlers', () => {
  for (const ua of [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0)',
    'facebookexternalhit/1.1',
    'curl/8.4.0',
    'python-requests/2.31.0',
    'Mozilla/5.0 HeadlessChrome/120.0.0.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36 Lighthouse',
  ]) {
    assert.ok(isLikelyBot(ua), `should be treated as a bot: ${ua}`);
  }
});

test('isLikelyBot lets real browsers through', () => {
  for (const ua of [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ]) {
    assert.ok(!isLikelyBot(ua), `should be treated as a browser: ${ua}`);
  }
});

test('isLikelyBot rejects a missing user agent', () => {
  assert.ok(isLikelyBot(''));
});

// ---------------------------------------------------------------------------
// Referrers
// ---------------------------------------------------------------------------

test('parseReferrer extracts the hostname', () => {
  assert.equal(parseReferrer('https://news.ycombinator.com/item?id=1'), 'news.ycombinator.com');
  assert.equal(parseReferrer('https://News.Example.COM/x'), 'news.example.com');
  assert.equal(parseReferrer('not a url'), null);
  assert.equal(parseReferrer(''), null);
  assert.equal(parseReferrer(null), null);
});

test('parseReferrer ignores non-web schemes', () => {
  assert.equal(parseReferrer('android-app://com.example'), null);
  assert.equal(parseReferrer('javascript:alert(1)'), null);
});

test('shouldCountReferral drops self-referrals', () => {
  const site = {
    domain: 'example.com',
    allowedDomains: ['example.com'],
    excludeSelfReferrals: true,
  };

  assert.ok(!shouldCountReferral('example.com', site));
  assert.ok(!shouldCountReferral('blog.example.com', site), 'subdomains count as self');
  assert.ok(shouldCountReferral('google.com', site));
  assert.ok(!shouldCountReferral(null, site), 'no referrer is not a referral');
});

test('shouldCountReferral keeps self-referrals when the option is off', () => {
  const site = {
    domain: 'example.com',
    allowedDomains: ['example.com'],
    excludeSelfReferrals: false,
  };
  assert.ok(shouldCountReferral('example.com', site));
});

test('shouldCountReferral falls back to the site domain with no allowlist', () => {
  const site = { domain: 'example.com', allowedDomains: [], excludeSelfReferrals: true };
  assert.ok(!shouldCountReferral('example.com', site));
  assert.ok(shouldCountReferral('other.com', site));
});

// ---------------------------------------------------------------------------
// Origin allowlist (the multi-tenant write boundary)
// ---------------------------------------------------------------------------

test('isAllowedOrigin accepts the configured domain and its subdomains', () => {
  const site = { domain: 'example.com', allowedDomains: ['example.com'] };
  assert.ok(isAllowedOrigin('example.com', site));
  assert.ok(isAllowedOrigin('www.example.com', site));
  assert.ok(isAllowedOrigin('example.com:3000', site));
});

test('isAllowedOrigin rejects unrelated hosts', () => {
  const site = { domain: 'example.com', allowedDomains: ['example.com'] };
  assert.ok(!isAllowedOrigin('evil.com', site));
  assert.ok(!isAllowedOrigin('notexample.com', site));
  assert.ok(!isAllowedOrigin('example.com.evil.com', site));
});

test('isAllowedOrigin always permits localhost for local testing', () => {
  const site = { domain: 'example.com', allowedDomains: ['example.com'] };
  assert.ok(isAllowedOrigin('localhost', site));
  assert.ok(isAllowedOrigin('localhost:3300', site));
  assert.ok(isAllowedOrigin('127.0.0.1', site));
});

test('isAllowedOrigin falls back to the site domain when no allowlist is set', () => {
  const site = { domain: 'example.com', allowedDomains: [] };
  assert.ok(isAllowedOrigin('example.com', site));
  assert.ok(!isAllowedOrigin('evil.com', site));
});

test('isAllowedOrigin refuses a missing Origin when an allowlist is configured', () => {
  // With no Origin header on a site that has an explicit allowlist there is
  // nothing to check, so refuse rather than allow.
  const withList = { domain: 'example.com', allowedDomains: ['example.com'] };
  assert.ok(!isAllowedOrigin(null, withList));

  // Without an allowlist, an absent header means a proxy stripped it; do not
  // block legitimate traffic on that.
  const withoutList = { domain: 'example.com', allowedDomains: [] };
  assert.ok(isAllowedOrigin(null, withoutList));
});
