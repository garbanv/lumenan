// @ts-check
/**
 * Live check: a public share link must never carry individual visits.
 *
 * This runs against a RUNNING app and its database, unlike `npm test`. It
 * creates its own throwaway user and site (with unmistakable probe values),
 * requests the public page with no cookies, inspects everything the server
 * sent, and deletes what it created, even when an assertion fails.
 *
 *   BASE_URL=http://localhost:3000 DATABASE_URL=postgresql://... npm run test:live
 *
 * Why it exists: the dashboard is a client component, so every field of the
 * stats object is serialised into the page, rendered or not. A previous version
 * hid the activity feed on screen while still shipping it in the page data.
 * Looking at the rendered text cannot catch that; reading the raw response can.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { generateShareToken } from '../../lib/share.mjs';

const baseUrl = (process.env.BASE_URL ?? '').replace(/\/$/, '');
const databaseUrl = process.env.DATABASE_URL ?? '';
if (!baseUrl || !databaseUrl) {
  console.error('Set BASE_URL (the running app) and DATABASE_URL (its database).');
  process.exit(2);
}

const run = randomBytes(4).toString('hex');
const siteId = `leak-probe-${run}`;
const token = generateShareToken();
const email = `leak-probe-${run}@example.invalid`;

// Values that can only come from an individual visit's row in the feed.
const PROBE_REFERRER = `probe-${run}.example`;
const PROBE_TIME = new Date(Date.now() - 90_000); // 90 seconds ago, to the millisecond
PROBE_TIME.setMilliseconds(417);
const PROBE_ISO = PROBE_TIME.toISOString();

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const failures = [];
const check = (ok, message) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!ok) failures.push(message);
};

try {
  const user = await pool.query(
    `INSERT INTO users (email, email_key, password_hash, name)
     VALUES ($1, $1, 'x', 'Leak probe') RETURNING id`,
    [email]
  );
  const userId = user.rows[0].id;
  await pool.query(
    `INSERT INTO sites (id, user_id, name, domain, share_token)
     VALUES ($1, $2, 'Leak probe', 'leak-probe.example', $3)`,
    [siteId, userId, token]
  );
  await pool.query(
    `INSERT INTO events (site_id, visitor_hash, path, referrer_domain, device, browser,
                         event_type, is_new_visitor, created_at)
     VALUES ($1, 'probe-visitor', '/probe-page', $2, 'desktop', 'Chrome', 'pageview', true, $3)`,
    [siteId, PROBE_REFERRER, PROBE_ISO]
  );

  const response = await fetch(`${baseUrl}/share/${token}`, { credentials: 'omit', redirect: 'manual' });
  const body = await response.text();

  check(response.status === 200, 'the public page loads without a session');
  check(body.includes('Leak probe'), 'it is the probe site (the page really rendered)');

  // The probe visit does legitimately count in aggregates (path and referrer
  // appear in the top lists), so test for what only the feed carries.
  check(!body.includes(PROBE_ISO), "no individual visit's exact timestamp is in the page");
  check(!/isNewVisitor/.test(body), 'no per-visit fields (isNewVisitor) are in the page');
  check(!/eventType/.test(body), 'no per-visit fields (eventType) are in the page');
  check(!/recent\\?":\[\{/.test(body), 'the activity feed is empty in the page data');
  check(!body.includes(siteId), "the site's internal tracking id is not in the page");

  check(
    !/Remove filter|Sign out|\/settings|Tracking code/.test(body),
    'no owner controls (settings, sign-out, tracking code) are in the page'
  );

  const realtime = await fetch(`${baseUrl}/api/share/${token}/realtime`, { credentials: 'omit' });
  check(realtime.status === 200, 'the public realtime endpoint works with the token');
  const missing = await fetch(`${baseUrl}/share/${generateShareToken()}`, { credentials: 'omit' });
  check(missing.status === 404, 'an unknown token is a 404');
} finally {
  // Cascades to the site, its events and goals.
  await pool.query('DELETE FROM users WHERE email = $1', [email]).catch(() => {});
  await pool.end();
}

console.log('');
if (failures.length > 0) {
  console.log(`${failures.length} check(s) failed: the public share page is exposing data.`);
  process.exit(1);
}
console.log('Public share page exposes aggregates only.');
