# Analytics

Privacy-first website analytics. One small script, one dashboard, no cookies and
no personal data. Next.js (App Router) + PostgreSQL, no ORM, no chart library.

This started as a self-hosted clone of the Simple Analytics idea. It is now a
multi-tenant application: accounts, sessions, per-user site isolation, plan
limits, and a redesigned dashboard.

---

## What is here

| Piece | Path |
| --- | --- |
| Tracker (runs on your site) | `public/track.js` |
| Ingestion endpoint | `app/api/collect/route.ts` |
| Read API | `app/api/stats/route.ts` |
| Auth endpoints | `app/api/auth/*` |
| Account endpoints | `app/api/account/route.ts` |
| Admin API | `app/api/admin/*` |
| Admin queries | `lib/admin.ts` |
| Schema | `db/schema.sql` |
| Migration / seed | `db/migrate.mjs` |
| Write batching | `lib/queue.ts` |
| Dashboard queries | `lib/stats.ts` |
| Dashboard filters | `lib/filters.mjs`, `app/sites/[id]/filter-bar.tsx` |
| Goals | `lib/goals.mjs`, `lib/goals.ts`, `app/api/sites/[id]/goals/*` |
| Current visitors | `lib/realtime.ts`, `app/api/stats/realtime/route.ts` |
| Public share links | `lib/share.mjs`, `app/share/[token]/page.tsx`, `app/api/sites/[id]/share/route.ts` |
| Stats cache | `lib/ttl-cache.mjs` |
| Design system | `app/globals.css`, `components/ui/*` |

---

## Admin: platform-wide visibility and plan management

Sign in and open **`/admin`**. Every admin page carries a red `Admin` badge in
the header, so it is never ambiguous which mode you are in.

| Screen | What it answers |
| --- | --- |
| `/admin` | How many users, how many pay, MRR, conversion rate, signups, plan and billing-status distributions |
| `/admin/users` | The full account list, searchable and filterable by plan and billing status |
| `/admin/users/[id]` | One account: usage, billing, plan controls, its sites, and its audit trail |

### Getting the first administrator

A fresh deployment has no operator, so it offers the role to the first signed-in
account: a banner on `/sites` reads "This deployment has no administrator yet"
with a **Make me an admin** button.

This is safe to expose because the database enforces the condition rather than
the application checking first:

```sql
UPDATE users SET is_admin = true
 WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin)
```

Two people clicking at once cannot both win, and once an operator exists the
endpoint returns `409` permanently. It cannot be used to escalate afterwards.

To promote someone without the UI — the reliable path on a deployment that
already has accounts but no operator:

```bash
# Docker
docker compose run --rm migrate node db/grant-admin.mjs you@example.com

# Local Postgres
npm run db:grant-admin -- you@example.com
```

It reports the accounts on the deployment when the email does not match, rather
than silently updating no rows.

### If /admin sends you to an access page

`/admin` is gated on the `is_admin` column. A signed-in account without the role
is redirected to `/admin/no-access`, which states the situation and prints the
exact command to fix it, including your email address. This is deliberately not a
self-service button: once an operator exists, letting any signed-in account
promote itself would make the role meaningless.

If you expected `/admin` to work and got that page, run the command above.

The API routes (`/api/admin/*`) answer `404` for a non-admin rather than
redirecting, since a redirect is meaningless to `fetch()` and a 404 avoids
confirming which admin endpoints exist.

### Changing a plan

The user detail page offers direct actions — **Upgrade to Pro**, **Downgrade to
Free**, **Cancel subscription**, **Pause account**, **Reactivate** — plus a full
form for price, period end, cancellation and an internal note. Every change is
written to `admin_audit_log` in the same transaction as the update, so a change
cannot be applied without being recorded. The log renders a before/after diff
per changed field.

### Plan versus billing status

These are separate columns on purpose, because collapsing them forces a bad
choice about what "cancel" means:

| | Meaning |
| --- | --- |
| `plan` | Entitlement: what the account is allowed to do. |
| `subscription_status` | Billing state: `none`, `active`, `past_due`, `canceled`, `paused`. |

So **cancelling sets `canceled` while keeping `plan = 'pro'`**: the customer
keeps what they paid for until `current_period_end`, then drops to Free. MRR
counts only `active` and `past_due` (retries still running) and excludes
`canceled`, which is why MRR and the plan breakdown can legitimately disagree.

### Safety rules

- **A non-admin is redirected to `/admin/no-access`,** which explains the
  situation and prints the command to fix it. The API routes still answer `404`,
  so a `fetch()` cannot enumerate which admin endpoints exist. (This used to be
  a bare 404 everywhere; that was a dead end for the operator who had just
  deployed the instance and could not tell a missing route from a missing role.)
- **You cannot remove your own admin access** — that would lock you out
  mid-session.
- **The last administrator cannot be demoted**, so a deployment cannot become
  unmanageable.
- **Downgrading below current usage is allowed and deletes nothing.** The
  account keeps its sites and simply cannot add more; the detail page shows an
  over-limit warning.
- **The audit log outlives the accounts it refers to.** `operator_id` and
  `target_user_id` are `ON DELETE SET NULL` and the emails are denormalised, so
  history stays readable after those accounts are deleted.

### Billing is not connected

There is no payment provider in this build. `stripe_customer_id`,
`stripe_subscription_id`, `current_period_end`, `price_per_month` and `currency`
exist so that adding Stripe or Paddle is a webhook route plus an upsert, not a
schema migration. `price_per_month` holds whole currency units for display
rather than a real invoice record, and the UI says so on the page instead of
implying otherwise.

---

## Setup

### Option A — Docker Compose (recommended)

Needs only Docker. Starts Postgres, applies the schema, then starts the app.

```bash
docker compose up
```

Then open <http://localhost:3000> and create an account at `/signup`.

To re-apply the schema after editing it:

```bash
docker compose run --rm migrate
```

To create a demo account (`demo@example.com` / `demo-password`):

```bash
docker compose run --rm -e SEED=1 migrate
```

> The seed flag is an environment variable rather than `--seed` on purpose.
> `docker compose run migrate --seed` in Docker appends the flag to the image's
> `CMD`, so `node` receives it as a module path and exits with
> `Cannot find module '--seed'`. Both spellings work locally via
> `npm run db:seed`.

To wipe everything including the database volume:

```bash
docker compose down -v
```

The compose file uses hardcoded development credentials and a placeholder
`VISITOR_SALT`. **Change both before exposing this anywhere reachable.**

> **Production compose (`docker-compose-prod.yml`, used by Coolify)** has no
> separate `migrate` service. The `app` container applies the schema each time it
> starts, then serves. Where the commands in this README say
> `docker compose run --rm migrate <command>`, run `<command>` in the `app`
> container's terminal instead, for example `node db/grant-admin.mjs you@example.com`.

### Upgrading a database created before multi-tenancy

`db/schema.sql` is written to migrate the old single-tenant schema in place: it
adds `sites.user_id`, adds the newer `events` columns, adds the admin and billing
columns to `users`, creates `admin_audit_log`, and drops the unused
`stats_hourly` table. The upgrade block runs before any index that references a
new column, so re-running it is safe.

One caveat worth knowing if you maintain this schema: it uses
`CREATE TABLE IF NOT EXISTS`, so re-applying it will **not** repair constraints
that were dropped from a table which still exists. `DROP TABLE users CASCADE`,
for example, silently strips `admin_audit_log` foreign keys while leaving that
table in place, and a re-run will not put them back. The verification suite keeps
its legacy-upgrade checks on a separate database instance for exactly this
reason.

Pre-existing sites have no owner and are added as `user_id IS NULL`. They are
invisible to every query, because tenant scoping filters on `user_id`, so they
are inert rather than exposed. The migration reports them; to claim them, create
an account and run:

```sql
UPDATE sites SET user_id = '<your-user-uuid>' WHERE user_id IS NULL;
```

### Option B — Local Node + Postgres

Requires Node 20.9 or newer (Next.js 16) and a reachable PostgreSQL 14+.

```bash
npm install
cp .env.example .env      # then edit DATABASE_URL and VISITOR_SALT
npm run db:migrate
npm run dev
```

`db/migrate.mjs` reads `.env` (and `.env.local`) itself, because it runs outside
Next.js. Real environment variables always take precedence over the file.

Open <http://localhost:3000> and sign up. To create a demo account instead:

```bash
npm run db:seed
# demo@example.com / demo-password
```

### Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string. |
| `VISITOR_SALT` | yes | Long-lived secret mixed into the visitor hash alongside the random per-day salt (it acts as a pepper, so a copy of the database alone cannot be used to test IP addresses). Keep it long, random and secret. Changing it only makes the current day's visitors look new once; it does not affect history. `openssl rand -hex 32` |
| `GEOIP_DB_PATH` | no | Location of the DB-IP country file. Default `data/geoip/dbip-country-lite.csv.gz`. |
| `GEOIP_AUTO_UPDATE` | no | `false` stops the app downloading a newer monthly GeoIP file on its own. Default: enabled. |
| `TRUSTED_PROXY_HOPS` | no | Number of reverse proxies in front of the app that append to `X-Forwarded-For`. Default `1` (one Traefik/nginx/Vercel). Use `2` for Cloudflare plus a proxy. The client IP is taken that many entries from the right, because anything further left is client-supplied. `0` ignores forwarding headers entirely (all visitors collapse into one). Too high lets visitors spoof their IP and dodge the rate limit; too low attributes traffic to your own proxy. |
| `ALLOW_SIGNUP` | no | Default `true`. Set `false` to stop new accounts being created (`/signup` shows "Signups are closed" and `POST /api/auth/signup` returns 403); existing accounts and sign-in are unaffected. Create the accounts you need first, then close signups on any deployment reachable from the internet. Needs a restart, not a rebuild. |
| `NEXT_PUBLIC_APP_ORIGIN` | no | Public origin, used for absolute URLs. Falls back to `localhost:3000`, or `VERCEL_URL` when deployed there. |

---

## Commands

```bash
npm run dev         # development server
npm run build       # production build
npm start           # start the production build
npm run typecheck   # tsc --noEmit
npm test            # unit tests (no database needed)
npm run test:db     # schema + SQL checks against real PostgreSQL (via PGlite)
npm run db:migrate  # apply db/schema.sql
npm run db:scrub    # report query strings / full referrers stored by older versions (add -- --apply to clean)
```

`npm test` runs on plain Node with no TypeScript loader, which is why the pure
logic lives in `.mjs` files that the `.ts` modules re-export with types.

---

## Installing the tracker

Add one line to any site:

```html
<script async defer data-site-id="YOUR_SITE_ID" src="https://your-analytics-host/track.js"></script>
```

In a Next.js App Router project, put it in the root layout so every route is
covered:

```tsx
import Script from 'next/script';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script src="https://your-analytics-host/track.js" data-site-id="YOUR_SITE_ID" />
      </body>
    </html>
  );
}
```

The dashboard's **Tracking code** tab generates both snippets with your real site
id filled in.

Custom events, from anywhere after the script loads:

```js
window.trackEvent('signup_completed');
```

The tracker handles client-side navigation automatically (`pushState`,
`replaceState` and `popstate`), and de-duplicates navigations to the same URL so
a single page load is never counted twice.

---

## Using the dashboard

- **Click to filter.** Click any row in Top pages, Referrers, Devices, Countries,
  Browsers or Operating systems and every number on the page narrows to it. Filters
  stack, show as removable chips, and live in the URL (`?page=/pricing&device=mobile`),
  so a filtered view can be bookmarked or shared. Under a page filter, "bounce rate"
  means visitors who viewed that page once, not visitors who left after one page
  overall. Filter values are always sent to PostgreSQL as bound parameters.
- **Current visitors.** The count next to the date range is the number of distinct
  visitors with an event in the last 5 minutes. It ignores the date range and
  filters, refreshes every 15 seconds while the tab is visible, and is cached for
  5 seconds on the server (`GET /api/stats/realtime`).
- **Goals.** Settings → Goals counts a custom event (`trackEvent('signup')`) or a page
  visit (`/thank-you`, or `/blog/*` for everything under `/blog/`). The Goals table
  shows visitors, total conversions and conversion rate (visitors who reached the
  goal ÷ all visitors in the same range and filters). Matching happens when the page
  is read, so a new goal reports on past traffic at once and deleting one removes no
  events. Up to 20 goals per site.
- **Public dashboard link.** Settings → Public dashboard creates a secret URL,
  `/share/<token>`, that shows a read-only dashboard to anyone who has it, no account
  needed. It carries totals and breakdowns only: no activity feed or individual
  visits (they are removed on the server, not just hidden), no settings, no other
  sites. "Create new link" replaces the token and so revokes the old URL; "Stop
  sharing" removes it. The token is stored as plain text (you can view the link
  again), it is a bearer credential like any unlisted link, and it appears in your
  server's access logs. The page sends `noindex` and `no-referrer`. Requests to
  shared pages are limited to 120 per minute per client IP.

---

## Team access

A site's owner can invite people from **Settings → Team**.

| | Owner | Manager | Viewer |
| --- | --- | --- | --- |
| View the dashboard | ✓ | ✓ | ✓ |
| Change settings, goals, the public link; see the tracking code | ✓ | ✓ | |
| Invite people, change roles, remove people | ✓ | | |
| Delete the site | ✓ | | |

- **Invitations are links, not emails.** The app has no mail service. Creating an
  invitation shows a link (`/invite/<token>`) once; send it yourself. A link works
  once, expires after 7 days, and can optionally be locked to one email address.
  Only a hash of the token is stored, so a database leak yields no usable links.
  Lost a link? Revoke the invitation and create another.
- **Invitees can join a closed deployment.** With `ALLOW_SIGNUP=false`, a valid
  invitation still lets its holder create an account (only for the address it is
  locked to, if any); nobody else can. Existing users sign in and accept.
- **Access is checked on every request.** `getSiteForUser` returns the caller's
  role or nothing; a site you cannot access looks exactly like a missing one (404).
  Removing someone, or demoting them, takes effect on their next request. A member
  can leave a site themselves. Viewers never receive the public-link secret.
- Shared sites appear in the invitee's site list with a role badge. They do not count
  against the invitee's own site limit. Limits: 25 people and 20 open invitations
  per site.
- **Not built:** transferring ownership, email notifications, per-person audit logs.

---

## Multi-tenancy and access control

This is the part that matters most if you are running this for other people.

- **The tracking key is not the tenant key.** `data-site-id` is embedded in the
  page source of every tracked site, so it is public by definition. It grants
  the ability to *write* events for that site and nothing else. Reading a
  dashboard requires a session.
- **Every read is scoped by `user_id`.** `getSiteForUser(siteId, userId)` is the
  only way a route resolves a site, and the layout, API routes and stats queries
  all go through it. A site belonging to another account returns 404, not 403,
  so the response cannot be used to test whether an id exists.
- **Sessions are opaque and server-side.** The cookie holds a 256-bit random
  token; the database stores only its SHA-256. Logout deletes the row, so
  revocation is real. Cookies are `httpOnly`, `SameSite=Lax`, and `Secure` in
  production.
- **Passwords** are bcrypt (cost 11). Signup and login compare against a dummy
  hash when no user matches, so response timing does not reveal whether an email
  is registered, and both paths return the same error message.
- **State-changing requests** reject cross-origin `Origin` headers as defence in
  depth behind `SameSite=Lax`.
- **Ingest is restricted per site.** `allowed_domains` is an allowlist checked
  against the request origin; `excluded_paths` drops matching paths;
  self-referrals are filtered out. Localhost is always accepted so you can test.

`proxy.ts` (called `middleware.ts` before Next.js 16) only checks that a session
cookie is *present*; it does not query the database, so a lookup does not sit in
front of every navigation. That is a redirect optimisation, not the security
boundary. The authoritative check is `requireUser()`, called by every protected
page and API route.

### Multi-tenancy verification

```bash
npm run test:db
```

This runs `db/schema.sql` and the dashboard queries against real PostgreSQL via
PGlite: the pre-multi-tenancy upgrade path, cascade behaviour, the unique email
index, the visitor upsert, the partial custom-event index, and tenant scoping.
No database server required.

---

## Privacy design

- **No cookies, no localStorage.** Nothing is stored in the visitor's browser.
- **The visitor identifier cannot be linked across days, even by the operator.**
  It is an HMAC of `IP | User-Agent | siteId`, truncated to 32 hex characters,
  keyed by `VISITOR_SALT` plus a **random salt generated for each UTC day**
  (`daily_salts`, `lib/salts.mjs`). The salt of a day that is over is deleted, so
  nothing remains that could recompute that day's identifiers from an IP address,
  not even for someone holding the database and `VISITOR_SALT`. The salt lives
  in the database, not in memory, so every instance agrees on it and a restart
  mid-day does not make returning visitors look new.
- **Raw IP addresses are never stored.** The IP is hash input and is discarded.
- **Pathname only.** The tracker never sends the query string, and the server
  strips everything after `?` or `#` even from cached copies of an older tracker.
  Only `utm_source`, `utm_medium` and `utm_campaign` are read from it, into their
  own fields. Query strings routinely carry emails, tokens and search terms.
  Path *segments* can still contain identifiers (`/users/jane`); use the site's
  `excluded_paths` for routes like that.
- **Referrer domain only.** The tracker sends just the referrer's origin and the
  server stores only the host. The full referrer URL is never kept.
- **Country only.** If a CDN in front of the app sends `x-vercel-ip-country` or
  `cf-ipcountry`, that is used. Otherwise the country is looked up on the server
  in a local copy of the free [DB-IP Lite](https://db-ip.com/db/download/ip-to-country-lite)
  country database (`lib/geoip.mjs`). The lookup is a binary search in memory:
  the IP is not sent anywhere, logged or stored, and only the two-letter country
  is kept. See [Country data](#country-data).
- **Bot filtering** by User-Agent pattern, plus `Do Not Track` support in the
  tracker.

### Country data

Behind a plain reverse proxy (Traefik on Coolify, nginx) nothing adds a country
header, so the country panel would stay empty. The app therefore resolves the
country itself from the DB-IP Lite "IP to Country" database: country level only,
no city, region or coordinates.

- **It is downloaded for you.** The Docker build fetches it (`scripts/download-geoip.mjs`,
  no account or key needed), and the running app fetches a newer file by itself
  when the one it has is older than about 40 days (DB-IP publishes monthly). To
  fetch it by hand: `npm run geoip:update`. If the download fails the build and
  the app carry on, and country is simply empty until the file is there.
- **Where it lives:** `data/geoip/dbip-country-lite.csv.gz`, or `GEOIP_DB_PATH`.
  It is git-ignored. Loading it takes about two seconds at start-up and uses a
  few MB of memory.
- **A CDN header wins** when one is present, so putting Cloudflare in front later
  needs no change.
- **Licence:** DB-IP Lite is CC BY 4.0, which requires crediting DB-IP. The
  dashboard's Countries card shows "IP Geolocation by DB-IP"; keep it.
- **Accuracy:** IP geolocation is approximate. Treat country figures as
  indicative, especially for mobile networks, VPNs and corporate proxies.

The only outbound request is the file download from `download.db-ip.com`; nothing
about your visitors is sent with it. Set `GEOIP_AUTO_UPDATE=false` to stop the app
making that request itself and update the file on your own schedule instead.

### What "unique visitors" actually means

Because the identifier is different every day, a "unique visitor" is a **unique
visitor-day**. Someone who visits on three days counts three times in a 7-day
window. This is the honest trade for not tracking people. The dashboard counts
distinct visitor hashes in the `events` table for the selected window and reports
the result as "unique visitor-days" so the number is not misread. The `visitors`
table, keyed by `(site_id, visitor_hash, day)`, is only used when an event is
written, to decide whether the visitor has been seen yet today.

### Upgrading from a version that stored query strings

Rows written by earlier versions can still contain query strings and full
referrer URLs. New events do not, but the old rows stay until you clean them:

```bash
# Docker: report first, then clean
docker compose run --rm migrate node db/scrub-legacy.mjs
docker compose run --rm migrate node db/scrub-legacy.mjs --apply

# Local
npm run db:scrub
npm run db:scrub -- --apply
```

It is a dry run unless you pass `--apply`. It strips everything after `?`/`#`
from `events.path` and drops `events.referrer`. PostgreSQL keeps the previous
row versions on disk until the table is rewritten, so run `VACUUM FULL events;`
afterwards (or add `--vacuum`) to remove them physically; that takes an exclusive
lock. Backups taken earlier still contain the old values until they age out.

Visitor hashes written before random daily salts were introduced were derived
from `VISITOR_SALT` and the date, so anyone who has both the database and that
value could still recompute them. To make them permanently irreversible, set
`VISITOR_SALT` to a new random value once after deploying, and discard the old
one. The only effect is that visitors seen earlier on the day you do it are
counted once more.

This is a description of how the software works, not legal advice for your
jurisdiction.

---

## How the write path works

`lib/queue.ts` buffers events in memory and flushes them as one multi-row
`INSERT` every 2 seconds (or at 500 events). Each flush runs in a transaction:

1. `INSERT INTO visitors ... ON CONFLICT DO NOTHING RETURNING` — the rows that
   come back are exactly the visitors seen for the first time today, which is
   what sets `is_new_visitor`. Doing it in one statement makes it correct under
   concurrent flushes, which a read-then-write would not be.
2. `INSERT INTO events ...` with that flag applied.

Failed batches are retried up to 3 times, then dropped with a log line. Without
that cap a single unsatisfiable row would fail the same multi-row insert forever
and take every event batched alongside it down with it.

**Shutdown.** On `SIGTERM`/`SIGINT`, `lib/shutdown.ts` (registered from
`instrumentation.ts`) flushes the buffer before the process exits, so a redeploy
no longer drops the last couple of seconds of events. This requires
`NEXT_MANUAL_SIG_HANDLE=true`: without it Next.js installs its own handler, which
exits within milliseconds and discards the buffer. The Dockerfile sets it. If you
run `next start` yourself, set it too; the server logs a warning at startup when
it is missing in production. The queue state lives on `globalThis` so that the
shutdown hook and the route handlers share one buffer.

> **This assumes a single long-running Node process** (`next start` on a VPS or
> container). On serverless platforms each invocation may get a fresh module
> instance, so a buffer can be discarded before it flushes. There, write directly
> per request in `app/api/collect/route.ts` instead — fine at low to moderate
> volume — or push events to a queue and flush from a worker.

---

## Scaling notes

- **The read path scans `events` directly.** Every aggregate is an index scan
  limited to one tenant and one time window, which is comfortable into the
  millions of rows per site. Beyond that, add a rollup table populated on a
  schedule and have `lib/stats.ts` read from it — that function is the single
  seam where the swap happens.
- **The connection pool is 10 per process** (`lib/db.ts`). A dashboard load runs
  eleven queries concurrently, so this is sized for a handful of simultaneous
  dashboards. Raise it alongside PgBouncer, not on its own.
- **Timeseries buckets are anchored to the window, not the calendar**, so the
  chart totals always match the summary card. Bucket size follows the range:
  hourly for 24h, daily beyond that.
- **Rate limiting** (`lib/rate-limit.ts`) is in-memory and therefore
  per-process: N instances allow N times the configured rate. Move it to a
  shared store if you scale horizontally.
- **Retention.** Nothing is deleted automatically. Keep the database bounded
  with a scheduled job:

  ```sql
  DELETE FROM events   WHERE created_at < now() - INTERVAL '90 days';
  DELETE FROM visitors WHERE day         < current_date - 90;
  DELETE FROM sessions WHERE expires_at  < now() - INTERVAL '7 days';
  ```

  Pruning events removes that history from the dashboard, unique counts
  included, because visitors are counted from `events`. Rows in `visitors` older
  than today are never read again, so they can be pruned freely. `daily_salts`
  prunes itself.

---

## Plans

Limits live in `lib/plans.ts` and are enforced in the API (site creation returns
`402` at the limit). `users.plan` is set manually today; there is no billing
integration. The column and the limit shape exist so that adding a payment
provider is a webhook route plus a change to that file, not a schema migration.

| | Free | Pro |
| --- | --- | --- |
| Sites | 3 | 25 |
| Events / month | 100,000 | 2,000,000 |
| History | 90 days | 730 days |
| Price | $0 | $9 |

---

## Testing

```bash
npm test        # 107 unit tests: tracker, hashing, salts, GeoIP, validation, rate limiting
npm run test:db # 43 checks against real PostgreSQL (PGlite)
npm run typecheck
```

The tracker tests run `public/track.js` inside a fake browser. They exist because
the tracker is the one component that executes on someone else's site, where a
failure is completely silent — the original implementation read
`document.currentScript`, which is `null` whenever the tag is injected
dynamically, so the documented `next/script` install recorded nothing at all.
That case is now covered by a regression test.

---

### Live checks (need a running app)

`npm run test:live:team` drives the real HTTP API as an owner, manager, viewer and
outsider (plus invitation edge cases) and checks the whole permission matrix: 50
checks. `npm run test:live:closed` checks that, with signups closed, only a valid
invitation can create an account (run it against an app started with
`ALLOW_SIGNUP=false`). Both create throwaway users and delete them afterwards. The
Docker form is the same as below with `tests/live/team-access.mjs` or
`tests/live/team-closed-signup.mjs`.

### Live check for the public share link

`npm test` and `npm run test:db` need no running app. One check does, because it
inspects the page the server actually sends:

```bash
BASE_URL=http://localhost:3000 DATABASE_URL=postgresql://... npm run test:live
```

It creates a throwaway user and site, requests `/share/<token>` with no cookies,
fails if any individual visit (timestamp, per-visit fields, the activity feed) or
the internal site id is in the response, and deletes what it created. Run it after
changing anything on the share page or in `lib/stats.ts`. Inside Docker, from the
project directory:

```bash
docker compose run --rm --no-deps -v "$PWD/tests:/app/tests:ro" -v "$PWD/lib:/app/lib:ro" \
  -e BASE_URL=http://app:3000 migrate node tests/live/share-leak.mjs
```

## Deploying

Any host that runs a long-lived Node process works: Docker on a VPS, Railway,
Render, Fly.io. The included `Dockerfile` and `docker-compose.yml` work as-is for
a VPS deploy — change the credentials, set `VISITOR_SALT`, and point a reverse
proxy (Caddy, nginx) at port 3000 for TLS.

Run migrations from CI against your managed database:

```bash
DATABASE_URL=... npm run db:migrate
```

On Vercel, remove the batching in `lib/queue.ts` and insert directly per request
(see "How the write path works"), and move the rate limiter to a shared store.
