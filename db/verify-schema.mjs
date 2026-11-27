/**
 * Verifies db/schema.sql and the dashboard SQL against real PostgreSQL.
 *
 * Uses PGlite (Postgres compiled to WebAssembly) so the checks run in-process
 * with no server to install and no shared memory to allocate. It is the same
 * Postgres parser and planner, so a syntax error, a type mismatch or a broken
 * index definition fails here exactly as it would against a real server.
 *
 * Plain JavaScript on purpose: this must run on any Node without a TypeScript
 * loader, including the Node 20 that ships on many servers.
 *
 * Run with:  node db/verify-schema.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { SALT_SQL } from '../lib/salts.mjs';

// These mirror the queries in lib/stats.ts. They are duplicated rather than
// imported because lib/stats.ts pulls in the pg pool, which PGlite cannot stand
// in for without a module shim. If one drifts, the numbers will disagree, so
// the two are reviewed together.
const SUMMARY_SQL = `
WITH bounds AS (
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
      AND e.event_type = 'custom')                                    AS events`;

const TIMESERIES_SQL = `
WITH b AS (
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
 ORDER BY bk.bucket ASC`;

const TOP_PAGES_SQL = `
SELECT path AS label, count(*)::int AS value
  FROM events
 WHERE site_id = $1
   AND created_at > now() - $2::interval
   AND event_type = 'pageview'
 GROUP BY path
 ORDER BY value DESC, label ASC
 LIMIT 10`;

const PREVIOUS_SQL = `
SELECT
  count(*) FILTER (WHERE event_type = 'pageview')::int AS pageviews,
  count(*) FILTER (WHERE is_new_visitor)::int          AS visitors,
  0::int                                               AS events
  FROM events
 WHERE site_id = $1
   AND created_at > now() - $2::interval
   AND created_at <= now() - $3::interval`;

const failures = [];
const checks = [];

function check(name, run) {
  checks.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${String(expected)}, got ${String(actual)})`);
  }
}

let db = new PGlite();
// Separate instance for the legacy-upgrade checks; see the reset check below.
const legacyDb = new PGlite();
const schema = readFileSync(join(process.cwd(), 'db', 'schema.sql'), 'utf-8');

let userId = '';

// ---------------------------------------------------------------------------
// Upgrading a pre-multi-tenancy database
// ---------------------------------------------------------------------------
// This runs first, on an empty database, because it needs to create the OLD
// schema before the new one is applied. It is a regression test for a real
// failure: the schema used to create `CREATE INDEX sites (user_id, ...)` before
// the DO block that adds `user_id`, so migrating a legacy database aborted with
// 'column "user_id" does not exist'. CREATE TABLE IF NOT EXISTS is a no-op for
// an existing table, so new columns must be added by explicit ALTERs that run
// before anything references them.

check('migrates a legacy single-tenant database in place', async () => {
  // The legacy checks run on their own instance so that no table is ever
  // dropped from the database the rest of the suite uses: dropping users with
  // CASCADE would strip admin_audit_log's foreign keys without restoring them.
  db = legacyDb;
  // The schema exactly as it shipped before multi-tenancy.
  await db.exec(`
    CREATE TABLE sites (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      domain      TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE events (
      id              BIGSERIAL PRIMARY KEY,
      site_id         TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      visitor_hash    TEXT NOT NULL,
      path            TEXT NOT NULL,
      referrer        TEXT,
      utm_source      TEXT,
      utm_medium      TEXT,
      utm_campaign    TEXT,
      country         CHAR(2),
      device          TEXT,
      browser         TEXT,
      os              TEXT,
      event_type      TEXT NOT NULL DEFAULT 'pageview',
      event_name      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE stats_hourly (
      site_id   TEXT NOT NULL,
      bucket    TIMESTAMPTZ NOT NULL,
      path      TEXT NOT NULL,
      pageviews INT NOT NULL DEFAULT 0,
      visitors  INT NOT NULL DEFAULT 0,
      PRIMARY KEY (site_id, bucket, path)
    );

    INSERT INTO sites (id, name, domain) VALUES ('legacy', 'Legacy site', 'legacy.com');
    INSERT INTO events (site_id, visitor_hash, path) VALUES ('legacy', 'v1', '/old');
  `);

  // The upgrade. This is the statement that used to fail.
  await db.exec(schema);
});

check('the legacy upgrade is itself idempotent', async () => {
  await db.exec(schema);
  await db.exec(schema);
});

check('legacy sites gained a nullable user_id', async () => {
  const { rows } = await db.query(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'sites' AND column_name = 'user_id'`
  );
  assertEqual(rows.length, 1, 'sites.user_id exists');
  assertEqual(rows[0].is_nullable, 'YES', 'pre-existing rows have no owner to assign');
});

check('legacy events gained is_new_visitor', async () => {
  const { rows } = await db.query(
    `SELECT column_default, is_nullable FROM information_schema.columns
      WHERE table_name = 'events' AND column_name = 'is_new_visitor'`
  );
  assertEqual(rows.length, 1, 'events.is_new_visitor exists');
  assertEqual(rows[0].is_nullable, 'NO', 'it is NOT NULL with a default');
});

check('the superseded stats_hourly table was dropped', async () => {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_name = 'stats_hourly' AND table_schema = current_schema()`
  );
  assertEqual(rows.length, 0, 'stats_hourly should be gone');
});

check('legacy rows survived the upgrade', async () => {
  const sites = await db.query(`SELECT count(*)::int AS n FROM sites WHERE id = 'legacy'`);
  assertEqual(sites.rows[0].n, 1, 'the legacy site is still present');
  const events = await db.query(`SELECT count(*)::int AS n FROM events WHERE path = '/old'`);
  assertEqual(events.rows[0].n, 1, 'the legacy event is still present');
  // Unowned rows are inert: every application query filters on user_id, so a
  // NULL owner means invisible rather than exposed.
  const owned = await db.query(`SELECT count(*)::int AS n FROM sites WHERE user_id IS NULL`);
  assertEqual(owned.rows[0].n, 1, 'the legacy site is unowned and therefore invisible');
});

check('reset for the fresh-schema checks', async () => {
  // Discard the legacy database entirely and start clean. Dropping tables in
  // place would be wrong: `DROP TABLE users CASCADE` also removes the foreign
  // keys admin_audit_log holds to users, while admin_audit_log itself survives
  // — and because the schema uses CREATE TABLE IF NOT EXISTS, re-applying it
  // skips that table and the cascaded constraints are never restored. The rest
  // of the suite would then be testing a mutilated schema.
  await legacyDb.close();
  db = new PGlite();
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

check('schema applies cleanly', async () => {
  await db.exec(schema);
});

check('schema is idempotent (safe to re-run)', async () => {
  await db.exec(schema);
  await db.exec(schema);
});

check('gen_random_uuid() is available', async () => {
  const { rows } = await db.query('SELECT gen_random_uuid() AS id');
  assert(/^[0-9a-f-]{36}$/.test(rows[0].id), 'expected a UUID');
});

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

check('seed: create an account and a site', async () => {
  const { rows } = await db.query(
    `INSERT INTO users (email, email_key, password_hash, name)
     VALUES ('owner@example.com', 'owner@example.com', 'x', 'Owner')
     RETURNING id`
  );
  userId = rows[0].id;

  await db.query(
    `INSERT INTO sites (id, user_id, name, domain, allowed_domains)
     VALUES ('testsite', $1, 'Test site', 'example.com', ARRAY['example.com'])`,
    [userId]
  );
});

check('unique email is enforced by the database', async () => {
  let rejected = false;
  try {
    await db.query(
      `INSERT INTO users (email, email_key, password_hash)
       VALUES ('owner@example.com', 'owner@example.com', 'y')`
    );
  } catch {
    rejected = true;
  }
  assert(rejected, 'a duplicate email_key should violate the unique index');
});

check('an event requires an existing site', async () => {
  let rejected = false;
  try {
    await db.query(`INSERT INTO events (site_id, visitor_hash, path) VALUES ('nope', 'h', '/')`);
  } catch {
    rejected = true;
  }
  assert(rejected, 'the foreign key should reject an unknown site_id');
});

check('seed: population', async () => {
  // Three visitors, four pageviews, two custom events. visitor-a returns to a
  // second page; visitor-b and visitor-c view exactly one page each.
  await db.exec(`
    INSERT INTO visitors (site_id, visitor_hash, day) VALUES
      ('testsite', 'visitor-a', current_date),
      ('testsite', 'visitor-b', current_date),
      ('testsite', 'visitor-c', current_date - 1);

    INSERT INTO events
      (site_id, visitor_hash, path, referrer_domain, country, device, browser, os,
       event_type, event_name, is_new_visitor, created_at)
    VALUES
      ('testsite','visitor-a','/','Direct','DE','desktop','Chrome','macOS','pageview',NULL,true,  now() - interval '2 hours'),
      ('testsite','visitor-a','/pricing','google.com','DE','desktop','Chrome','macOS','pageview',NULL,true, now() - interval '1 hour'),
      ('testsite','visitor-b','/',NULL,'US','mobile','Safari','iOS','pageview',NULL,true, now() - interval '3 hours'),
      ('testsite','visitor-c','/blog','news.ycombinator.com','FR','desktop','Firefox','Linux','pageview',NULL,true, now() - interval '1 day'),
      ('testsite','visitor-b','/',NULL,NULL,'mobile','Safari','iOS','custom','signup',false, now() - interval '2 hours'),
      ('testsite','visitor-a','/',NULL,NULL,'desktop','Chrome','macOS','custom','cta_click',false, now() - interval '30 minutes');
  `);
});

// ---------------------------------------------------------------------------
// The dashboard queries
// ---------------------------------------------------------------------------

check('summary counts pageviews and visitors separately', async () => {
  const { rows } = await db.query(SUMMARY_SQL, ['testsite', '168 hours']);
  const row = rows[0];
  assertEqual(row.pageviews, 4, 'pageviews over 7d');
  // The bug this replaced aliased sum(views) AS visitors, which reported 4.
  assertEqual(row.visitors, 3, 'unique visitors over 7d');
  assertEqual(row.events, 2, 'custom events over 7d');
  assertEqual(row.single_page_visitors, 2, 'visitors who viewed one page');
});

check('summary handles a site with no events', async () => {
  await db.query(
    `INSERT INTO sites (id, user_id, name, domain) VALUES ('empty', $1, 'Empty', 'empty.com')`,
    [userId]
  );
  const { rows } = await db.query(SUMMARY_SQL, ['empty', '168 hours']);
  assertEqual(rows[0].pageviews, 0, 'pageviews');
  assertEqual(rows[0].visitors, 0, 'visitors');
  assertEqual(rows[0].single_page_visitors, 0, 'bounce numerator');
});

check('previous-window query runs with its three parameters', async () => {
  const { rows } = await db.query(PREVIOUS_SQL, ['testsite', '336 hours', '168 hours']);
  assertEqual(rows[0].pageviews, 0, 'no events in the preceding window');
});

check('timeseries buckets by hour for the 24h range', async () => {
  const { rows } = await db.query(TIMESERIES_SQL, ['testsite', '24 hours', 'hour']);
  // One bucket per hour, so the chart sums to the same total as the summary.
  assertEqual(rows.length, 24, 'one hourly bucket per hour of the window');
  const total = rows.reduce((sum, row) => sum + row.pageviews, 0);
  assertEqual(total, 3, 'pageviews inside the 24h window');
});

check('timeseries buckets by day for the 7d range', async () => {
  const { rows } = await db.query(TIMESERIES_SQL, ['testsite', '168 hours', 'day']);
  assertEqual(rows.length, 7, 'one daily bucket per day of the window');
  const total = rows.reduce((sum, row) => sum + row.pageviews, 0);
  assertEqual(total, 4, 'pageviews inside the 7d window');
});

check('timeseries keeps empty buckets instead of dropping them', async () => {
  const { rows } = await db.query(TIMESERIES_SQL, ['testsite', '30 days', 'day']);
  assertEqual(rows.length, 30, 'one daily bucket per day of a 30-day range');
  assert(
    rows.some((row) => row.pageviews === 0),
    'expected an empty bucket, which only happens if the LEFT JOIN is correct'
  );
});

check('top pages aggregates and orders by pageviews', async () => {
  const { rows } = await db.query(TOP_PAGES_SQL, ['testsite', '168 hours']);
  assertEqual(rows[0].label, '/', 'most-viewed path');
  assertEqual(rows[0].value, 2, 'pageviews for /');
  assertEqual(rows.length, 3, 'distinct paths');
});

check('top pages excludes custom events', async () => {
  const { rows } = await db.query(TOP_PAGES_SQL, ['testsite', '168 hours']);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  assertEqual(total, 4, 'total pageviews across top pages');
});

check('the custom-event index is partial', async () => {
  const { rows } = await db.query(
    `SELECT indexdef FROM pg_indexes
      WHERE tablename = 'events' AND indexname = 'idx_events_custom_name'`
  );
  assertEqual(rows.length, 1, 'idx_events_custom_name exists');
  assert(rows[0].indexdef.includes('WHERE'), 'expected a partial index');
});

check('visitors allows one row per site/visitor/day', async () => {
  let rejected = false;
  try {
    await db.query(
      `INSERT INTO visitors (site_id, visitor_hash, day) VALUES ('testsite', 'visitor-a', current_date)`
    );
  } catch {
    rejected = true;
  }
  assert(rejected, 'the composite primary key should reject a duplicate');
});

check('the visitor upsert returns only genuinely new visitors', async () => {
  const { rows } = await db.query(
    `INSERT INTO visitors (site_id, visitor_hash, day)
     VALUES ('testsite', 'visitor-a', current_date), ('testsite', 'visitor-new', current_date)
     ON CONFLICT (site_id, visitor_hash, day) DO NOTHING
     RETURNING visitor_hash`
  );
  // This is what the ingest queue uses to decide is_new_visitor.
  assertEqual(rows.length, 1, 'rows returned by the upsert');
  assertEqual(rows[0].visitor_hash, 'visitor-new', 'the newly inserted visitor');
});

check('deleting a site cascades to events and visitors', async () => {
  await db.query(
    `INSERT INTO sites (id, user_id, name, domain) VALUES ('doomed', $1, 'Doomed', 'doomed.com')`,
    [userId]
  );
  await db.query(`INSERT INTO events (site_id, visitor_hash, path) VALUES ('doomed', 'v', '/')`);
  await db.query(
    `INSERT INTO visitors (site_id, visitor_hash, day) VALUES ('doomed', 'v', current_date)`
  );

  await db.query(`DELETE FROM sites WHERE id = 'doomed'`);

  const events = await db.query(`SELECT count(*)::int AS n FROM events WHERE site_id = 'doomed'`);
  const visitors = await db.query(
    `SELECT count(*)::int AS n FROM visitors WHERE site_id = 'doomed'`
  );
  assertEqual(events.rows[0].n, 0, 'events removed by cascade');
  assertEqual(visitors.rows[0].n, 0, 'visitors removed by cascade');
});

// ---------------------------------------------------------------------------
// Admin and billing
// ---------------------------------------------------------------------------
// These exercise the SQL the admin surface depends on, in particular the two
// invariants that would be expensive to get wrong: only one account can claim
// the first-admin role, and the audit log survives deletion of the accounts it
// refers to.

let operatorId = '';
let targetId = '';

check('admin: users gained the role and billing columns', async () => {
  const { rows } = await db.query(
    `SELECT column_name, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_name = 'users'
        AND column_name IN ('is_admin','subscription_status','price_per_month','current_period_end')
      ORDER BY column_name`
  );
  assertEqual(rows.length, 4, 'all four columns exist');
  const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
  assertEqual(byName.is_admin.is_nullable, 'NO', 'is_admin is NOT NULL');
  assertEqual(byName.subscription_status.is_nullable, 'NO', 'subscription_status is NOT NULL');
  assertEqual(
    byName.price_per_month.is_nullable,
    'YES',
    'price_per_month is nullable so later backfills do not require a default'
  );
});

check('admin: seed two more accounts', async () => {
  const op = await db.query(
    `INSERT INTO users (email, email_key, password_hash, name)
     VALUES ('operator@example.com', 'operator@example.com', 'x', 'Operator')
     RETURNING id`
  );
  operatorId = op.rows[0].id;

  const target = await db.query(
    `INSERT INTO users (email, email_key, password_hash, name)
     VALUES ('customer@example.com', 'customer@example.com', 'x', 'Customer')
     RETURNING id`
  );
  targetId = target.rows[0].id;
});

check('admin: the first-admin claim succeeds exactly once', async () => {
  // Mirrors claimFirstAdmin: the "no admin exists" condition is evaluated inside
  // the same statement as the update, so two concurrent claims cannot both win.
  const first = await db.query(
    `UPDATE users SET is_admin = true
      WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin)`,
    [operatorId]
  );
  assertEqual(first.affectedRows, 1, 'the first claim applies');

  const second = await db.query(
    `UPDATE users SET is_admin = true
      WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin)`,
    [targetId]
  );
  assertEqual(second.affectedRows, 0, 'the second claim is refused');

  const admins = await db.query(`SELECT count(*)::int AS n FROM users WHERE is_admin`);
  assertEqual(admins.rows[0].n, 1, 'exactly one administrator exists');
});

check('admin: needsFirstAdmin flips once someone holds the role', async () => {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM users WHERE is_admin`);
  assertEqual((rows[0].n === 0), false, 'the deployment is no longer unclaimed');
});

check('admin: audit entries record a before/after snapshot', async () => {
  await db.query(
    `UPDATE users
        SET plan = 'pro', subscription_status = 'active', price_per_month = 9
      WHERE id = $1`,
    [targetId]
  );

  await db.query(
    `INSERT INTO admin_audit_log
       (operator_id, operator_email, target_user_id, target_email, action, details)
     VALUES ($1, 'operator@example.com', $2, 'customer@example.com', 'plan.updated', $3::jsonb)`,
    [
      operatorId,
      targetId,
      JSON.stringify({
        before: { plan: 'free', subscriptionStatus: 'none', pricePerMonth: null },
        after: { plan: 'pro', subscriptionStatus: 'active', pricePerMonth: 9 },
      }),
    ]
  );

  const { rows } = await db.query(
    `SELECT action, details, operator_email FROM admin_audit_log WHERE target_user_id = $1`,
    [targetId]
  );
  assertEqual(rows.length, 1, 'one entry recorded');
  assertEqual(rows[0].action, 'plan.updated', 'action recorded');
  // The route reads details.before / details.after to render the diff, so the
  // JSONB round trip has to preserve both halves.
  assertEqual(rows[0].details.before.plan, 'free', 'before snapshot stored');
  assertEqual(rows[0].details.after.plan, 'pro', 'after snapshot stored');
  assertEqual(rows[0].details.after.pricePerMonth, 9, 'numeric survives the JSONB round trip');
});

check('admin: MRR counts only accounts that are actually paying', async () => {
  // A canceled subscription must drop out of MRR even though the account keeps
  // its Pro entitlement until the period ends.
  await db.query(
    `INSERT INTO users (email, email_key, password_hash, plan, subscription_status, price_per_month)
     VALUES ('churned@example.com', 'churned@example.com', 'x', 'pro', 'canceled', 9),
            ('retrying@example.com', 'retrying@example.com', 'x', 'pro', 'past_due', 9)`,
    []
  );

  const { rows } = await db.query(
    `SELECT coalesce(sum(price_per_month), 0)::int AS mrr,
            count(*)::int AS paying
       FROM users
      WHERE subscription_status IN ('active', 'past_due')`
  );
  // customer@example.com (active, 9) + retrying (past_due, 9) = 18.
  assertEqual(rows[0].mrr, 18, 'MRR includes active and past_due only');
  assertEqual(rows[0].paying, 2, 'paying account count');
});

check('admin: the audit log survives deletion of its operator', async () => {
  // operator_id is ON DELETE SET NULL specifically so that losing an account
  // does not erase the history of what that account did.
  await db.query(`DELETE FROM users WHERE id = $1`, [operatorId]);

  const { rows } = await db.query(
    `SELECT operator_id, operator_email FROM admin_audit_log WHERE target_user_id = $1`,
    [targetId]
  );
  assertEqual(rows.length, 1, 'the entry is still there');
  assertEqual(rows[0].operator_id, null, 'the dangling operator reference was nulled');
  assertEqual(
    rows[0].operator_email,
    'operator@example.com',
    'the denormalised email keeps the entry readable'
  );
});

check('admin: role and plan indexes exist', async () => {
  const { rows } = await db.query(
    `SELECT indexname FROM pg_indexes
      WHERE tablename = 'users' AND indexname IN ('idx_users_plan','idx_users_created')
      ORDER BY indexname`
  );
  assertEqual(rows.length, 2, 'expected both admin list indexes');
});

check('admin: the audit log survives deletion of its target', async () => {
  // Filter on the operator email, which is denormalised, rather than on
  // target_user_id — the point of this check is that the id has been nulled.
  await db.query(`DELETE FROM users WHERE id = $1`, [targetId]);

  const { rows } = await db.query(
    `SELECT target_user_id, target_email FROM admin_audit_log WHERE operator_email = 'operator@example.com'`
  );
  assertEqual(rows.length, 1, 'the entry remains after the target is deleted');
  assertEqual(rows[0].target_user_id, null, 'the dangling target reference was nulled');
  assertEqual(
    rows[0].target_email,
    'customer@example.com',
    'the denormalised email still identifies who it was about'
  );
});

check('sessions cascade with the user', async () => {
  await db.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, 'hash-1', now() + interval '1 day')`,
    [userId]
  );
  const before = await db.query(`SELECT count(*)::int AS n FROM sessions WHERE user_id = $1`, [
    userId,
  ]);
  assertEqual(before.rows[0].n, 1, 'session inserted');

  await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
  const after = await db.query(`SELECT count(*)::int AS n FROM sessions WHERE user_id = $1`, [
    userId,
  ]);
  assertEqual(after.rows[0].n, 0, 'sessions removed by cascade');
});

check('the tenant scoping index on sites exists', async () => {
  const { rows } = await db.query(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'sites' AND indexname = 'idx_sites_user'`
  );
  assertEqual(rows.length, 1, 'expected idx_sites_user');
});

check('a site cannot reference a non-existent owner', async () => {
  let rejected = false;
  try {
    await db.query(
      `INSERT INTO sites (id, user_id, name, domain)
       VALUES ('orphan', gen_random_uuid(), 'Orphan', 'orphan.com')`
    );
  } catch {
    rejected = true;
  }
  assert(rejected, 'the user_id foreign key should reject an unknown account');
});

// ---------------------------------------------------------------------------
// Daily visitor salts. These run the exact statements lib/salts.mjs sends.
// ---------------------------------------------------------------------------

check('daily_salts is keyed by day', async () => {
  const { rows } = await db.query(
    `SELECT a.attname
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'daily_salts'::regclass AND i.indisprimary`
  );
  assertEqual(rows.length, 1, 'one primary key column');
  assertEqual(rows[0].attname, 'day', 'the primary key is the day');
});

check('the first salt created for a day wins', async () => {
  // Two instances race at the start of the day. The loser's INSERT must do
  // nothing, so that both read back the same salt.
  await db.query(SALT_SQL.create, ['2026-10-18', 'first-instance-salt']);
  await db.query(SALT_SQL.create, ['2026-10-18', 'second-instance-salt']);

  const { rows } = await db.query(SALT_SQL.read, ['2026-10-18']);
  assertEqual(rows.length, 1, 'exactly one row for the day');
  assertEqual(rows[0].salt, 'first-instance-salt', 'the first writer wins');
});

check('reading a day with no salt returns nothing', async () => {
  const { rows } = await db.query(SALT_SQL.read, ['2026-10-17']);
  assertEqual(rows.length, 0, 'no row, so the caller must create one');
});

check('purging removes only the days before the one given', async () => {
  await db.query(SALT_SQL.create, ['2026-10-16', 'old-salt-1']);
  await db.query(SALT_SQL.create, ['2026-10-17', 'old-salt-2']);
  await db.query(SALT_SQL.create, ['2026-10-19', 'future-salt']);

  await db.query(SALT_SQL.purge, ['2026-10-18']);

  const { rows } = await db.query(`SELECT day::text AS day FROM daily_salts ORDER BY day`);
  assertEqual(
    rows.map((r) => r.day).join(','),
    '2026-10-18,2026-10-19',
    "yesterday's and earlier salts are gone; today's and later remain"
  );
});

check('daily_salts is idempotent to re-apply and survives a schema re-run', async () => {
  await db.exec(schema);
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM daily_salts`);
  assertEqual(rows[0].n, 2, 'existing salts are untouched by re-applying the schema');
});

// ---------------------------------------------------------------------------

async function main() {
  let passed = 0;

  for (const { name, run } of checks) {
    try {
      await run();
      console.log(`  ok    ${name}`);
      passed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  FAIL  ${name}`);
      console.log(`        ${message}`);
      failures.push(`${name}: ${message}`);
    }
  }

  console.log('');
  console.log(`${passed}/${checks.length} checks passed`);

  await db.close();

  if (failures.length > 0) {
    console.log('');
    console.log('Failures:');
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
