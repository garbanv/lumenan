-- ============================================================================
-- Analytics schema
-- ============================================================================
-- Multi-tenant: every site belongs to exactly one user, and every dashboard
-- query is scoped by user_id. The tracking key is NOT the tenant key, so
-- leaking a data-site-id never grants access to a dashboard.
--
-- Apply with:  npm run db:migrate
-- Idempotent:  safe to run repeatedly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL,
  -- Case-insensitive uniqueness without citext: all writes lowercase first.
  email_key      TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  name           TEXT,
  -- The entitlement tier: what the account is allowed to do. Deliberately not
  -- the same thing as billing state — see subscription_status below.
  plan           TEXT NOT NULL DEFAULT 'free',
  -- Platform operator. Grants access to /admin, which can read every account
  -- and change any plan. Deliberately a column on users rather than a separate
  -- roles table: there is exactly one role, and a join would buy nothing.
  is_admin       BOOLEAN NOT NULL DEFAULT false,

  -- ---------------------------------------------------------------------
  -- Billing
  -- ---------------------------------------------------------------------
  -- Billing state, kept separate from `plan` so that cancelling can mean
  -- "cancelled, but still entitled until the period ends" rather than an
  -- immediate downgrade. Values:
  --   none      free account, no subscription
  --   active    paid and current
  --   past_due  payment failed; still entitled while retries run
  --   canceled  subscription ended, access retained until current_period_end
  --   paused    temporarily suspended by an operator
  subscription_status   TEXT NOT NULL DEFAULT 'none',
  -- Identifiers and timestamps a payment provider owns. Present so wiring up
  -- Stripe or Paddle later is a webhook route rather than a schema migration.
  stripe_customer_id    TEXT,
  stripe_subscription_id TEXT,
  current_period_end    TIMESTAMPTZ,
  cancel_at_period_end  BOOLEAN NOT NULL DEFAULT false,
  -- Whole currency units (e.g. 9 for $9/month), matching the displayed price.
  -- Storing cents would be more correct for real invoicing; this column is
  -- display-only until a provider is connected.
  price_per_month       INTEGER,
  currency              TEXT NOT NULL DEFAULT 'usd',
  -- Free-text operator note, e.g. "comped for the launch".
  internal_note         TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_key ON users (email_key);
-- The plan/created_at indexes on users, and the admin_audit_log table, are
-- declared further down — after the upgrade block that adds is_admin and
-- subscription_status to a pre-existing users table. Indexing a column before
-- it is guaranteed to exist would break the migration.

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------
-- The cookie carries a random secret; the database stores only its SHA-256,
-- so a database leak does not hand over usable login tokens.
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Sites
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sites (
  id          TEXT PRIMARY KEY,     -- public tracking key, e.g. "my-blog-3f9a1c7e"
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  domain      TEXT NOT NULL,
  -- Restrict ingestion to this hostname plus its subdomains. Empty = accept
  -- any origin, which is convenient but lets anyone inflate these numbers.
  allowed_domains TEXT[] NOT NULL DEFAULT '{}',
  -- Paths never recorded (e.g. /admin, /preview). Case-insensitive prefix
  -- match, evaluated in lib/ingest.ts.
  excluded_paths  TEXT[] NOT NULL DEFAULT '{}',
  -- Drop events whose Referer is the tracked domain itself, so internal
  -- navigation does not appear as a referral source.
  exclude_self_referrals BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Upgrading a pre-multi-tenancy database
-- ---------------------------------------------------------------------------
-- This must run BEFORE any index or constraint references a column that only
-- exists in the new schema. In particular `idx_sites_user` below references
-- sites.user_id, which a legacy `sites` table does not have: CREATE TABLE IF
-- NOT EXISTS is a no-op when the table is already there, so the column has to
-- be added here or index creation fails with "column user_id does not exist".
--
-- On a fresh database every statement here is a no-op.
DO $$
BEGIN
  -- Admin and billing columns added to users after the first release.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'users' AND table_schema = current_schema()
  ) THEN
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'none';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS price_per_month INTEGER;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'usd';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS internal_note TEXT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'sites' AND table_schema = current_schema()
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'sites' AND column_name = 'user_id' AND table_schema = current_schema()
  ) THEN
    -- Nullable on purpose: existing rows have no owner to be assigned to, and
    -- guessing one would be worse than leaving them visibly unowned. The
    -- migration script reports them and lib/sites.ts scopes every query by
    -- user_id, so an unowned site is inert rather than exposed.
    ALTER TABLE sites ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;
  END IF;

  -- Columns added to events after the first release. Same reasoning: the
  -- CREATE above is skipped for an existing table, so each new column needs an
  -- explicit, idempotent ALTER.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'events' AND table_schema = current_schema()
  ) THEN
    ALTER TABLE events ADD COLUMN IF NOT EXISTS is_new_visitor BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS referrer_domain TEXT;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS utm_source TEXT;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS utm_medium TEXT;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
  END IF;

  -- Superseded table from the single-tenant version: unused there (the read path
  -- queried raw events) and it lacks user scoping, so drop it rather than leave
  -- a trap for future queries.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'stats_hourly' AND table_schema = current_schema()
  ) THEN
    DROP TABLE stats_hourly;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_sites_user ON sites (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Admin composite indexes
-- ---------------------------------------------------------------------------
-- Declared here rather than beside the users CREATE above, because they
-- reference columns that the upgrade block adds to a pre-existing table.

CREATE INDEX IF NOT EXISTS idx_users_plan ON users (plan, subscription_status);
CREATE INDEX IF NOT EXISTS idx_users_created ON users (created_at DESC);

-- ---------------------------------------------------------------------------
-- Admin audit log
-- ---------------------------------------------------------------------------
-- Every privileged mutation is recorded here before it is applied. Without this,
-- "who downgraded this customer, and when" is unanswerable — and plan changes
-- are exactly the kind of thing a customer will dispute.
--
-- operator_email is denormalised on purpose: the log must stay readable even if
-- the operator's account is later deleted, which a foreign key would prevent.
-- Both foreign keys are ON DELETE SET NULL for the same reason: losing an
-- account must not erase the history of what was done to it.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  operator_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  operator_email  TEXT NOT NULL,
  target_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  target_email    TEXT NOT NULL,
  action          TEXT NOT NULL,
  -- Free-form before/after payload so one table covers every action type.
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_target
  ON admin_audit_log (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created
  ON admin_audit_log (created_at DESC);

-- ---------------------------------------------------------------------------
-- Daily salts
-- ---------------------------------------------------------------------------
-- One random salt per UTC day, mixed into the visitor hash. The application
-- deletes the rows for days that are over (lib/salts.mjs), so once a day has
-- ended nothing remains that could recompute that day's visitor hashes from an
-- IP address, even for whoever holds this database and VISITOR_SALT.
CREATE TABLE IF NOT EXISTS daily_salts (
  day        DATE PRIMARY KEY,
  salt       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Visitors: one row per (site, visitor, UTC day)
-- ---------------------------------------------------------------------------
-- The visitor identifier rotates at UTC midnight, so "unique visitors" over a
-- range is the row count here rather than count(DISTINCT visitor_hash) over
-- the event log. Keeping them separate lets the events table stay a pure
-- append-only fact table that is cheap to prune.
CREATE TABLE IF NOT EXISTS visitors (
  site_id      TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  visitor_hash TEXT NOT NULL,
  day          DATE NOT NULL,
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, visitor_hash, day)
);

CREATE INDEX IF NOT EXISTS idx_visitors_site_day ON visitors (site_id, day DESC);

-- ---------------------------------------------------------------------------
-- Events: raw, append-only fact table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id              BIGSERIAL PRIMARY KEY,
  site_id         TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  visitor_hash    TEXT NOT NULL,        -- rotates daily; no PII stored
  path            TEXT NOT NULL,         -- pathname only; never a query string
  -- Domain only. The full referrer URL is deliberately not stored: it can carry
  -- a query string with personal data. (Databases created before this change
  -- may still have a `referrer` column; db/scrub-legacy.mjs removes it.)
  referrer_domain TEXT,
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  country         CHAR(2),              -- ISO-3166-1 alpha-2, null if unknown
  device          TEXT,                 -- desktop | mobile | tablet
  browser         TEXT,
  os              TEXT,
  event_type      TEXT NOT NULL DEFAULT 'pageview',  -- pageview | custom
  event_name      TEXT,                 -- set when event_type = 'custom'
  is_new_visitor  BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_site_time   ON events (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_site_path   ON events (site_id, event_type, path);
CREATE INDEX IF NOT EXISTS idx_events_visitor     ON events (site_id, visitor_hash, created_at);
-- Partial index: custom events are a small minority of rows, so this stays
-- tiny while making the "custom events" breakdown an index-only lookup.
CREATE INDEX IF NOT EXISTS idx_events_custom_name ON events (site_id, event_name)
  WHERE event_type = 'custom';

-- ============================================================================
-- Retention
-- ============================================================================
-- Nothing is deleted automatically. To keep the database bounded, run this on
-- a schedule (pg_cron, or a platform cron hitting an admin endpoint):
--
--   DELETE FROM events   WHERE created_at < now() - INTERVAL '90 days';
--   DELETE FROM sessions WHERE expires_at  < now() - INTERVAL '7 days';
--
-- Deleting events does not affect the visitors table, so historical unique
-- counts survive pruning.
