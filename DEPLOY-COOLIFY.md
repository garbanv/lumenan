# Deploying on Coolify: pilot checklist

For a first real deployment with one or two known users. Work top to bottom.

## 1. Create the resource

1. Coolify → **New resource** → **Docker Compose** (from your Git repository).
2. **Compose file:** `docker-compose-prod.yml`.
3. The compose file declares the domain for **`app`** on port 3000 itself
   (`SERVICE_FQDN_APP_3000`), so Coolify offers a domain field on `app`. Replace the
   generated `sslip.io` address with your own: `https://analytics.example.com:3000`
   (the `:3000` is the port the app listens on). `db` takes no domain.
4. Do **not** add port mappings for any service. The compose file deliberately
   has none: the database must not be reachable from the internet, and the app
   must only be reachable through the proxy.

## 2. Environment variables

Coolify generates the `SERVICE_*` values for you. Set these yourself:

| Variable | Value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_ORIGIN` | `https://analytics.example.com` | Mark it **build variable** too; Next.js inlines it at build time. No trailing slash. |
| `TRUSTED_PROXY_HOPS` | `1` | `1` = Coolify's Traefik only. `2` = Cloudflare proxy (orange cloud) in front of Traefik. A wrong value gives wrong visitor counts, silently. See step 5. |
| `ALLOW_SIGNUP` | `true` for now | Turn it off in step 4. |

`VISITOR_SALT` comes from `SERVICE_PASSWORD_64_VISITORSALT`. Keep it stable: changing it
makes that day's visitors look new once.

## 3. First deploy and first account

1. Deploy. There are two services, `db` and `app`. `app` applies the database schema
   every time it starts (the migration is idempotent), then serves the site.
2. Open the site over **https** and sign up. Signing in over plain `http` fails because
   session cookies are `Secure` in production.
3. On `/sites`, click **Make me an admin** straight away: until someone does, the
   first account to ask gets it. Or, from the Coolify terminal of the `app`
   service: `node db/grant-admin.mjs you@example.com`.
4. Create your client's account the same way (or have them sign up now), before step 4.

## 4. Close signups

Set `ALLOW_SIGNUP=false` in Coolify and **restart** `app` (no rebuild needed).
`/signup` then says "Signups are closed" and the API returns 403. Sign-in is
unaffected. Turn it back on briefly whenever you need to add someone.

## 5. Verify it works end to end

- [ ] Add a site in the dashboard, install the snippet on a page you control, visit
      it. The page appears within a few seconds and **Current visitors** shows 1.
- [ ] **Countries** shows your real country. If it is empty or shows a data-centre
      country, `TRUSTED_PROXY_HOPS` is wrong (try `2` if Cloudflare is in front).
- [ ] Visit from a second device or network: it counts as a second visitor.
- [ ] Settings → Public dashboard → create a link, open it in a private window:
      numbers show, no activity feed. Run the automated check, then stop sharing
      if you do not want the link live:
      `BASE_URL=https://analytics.example.com DATABASE_URL=... npm run test:live`
      (see README → Testing for the in-Docker form).
- [ ] From outside your network, confirm the database is not reachable:
      `nc -zv your-server-ip 5432` should fail or time out.

## 6. Set up the client's site

- Settings → **Accepted hosts**: add the client's domain. Events from other
  hosts are dropped silently.
- If the client's site sends a Content-Security-Policy, it must allow your analytics
  domain in `script-src` (for `/track.js`) and `connect-src` (for `/api/collect`).
- Tell them: ad blockers will block the script, so numbers will be lower than
  reality; "visitors" means unique visitors **per day**, not people; visits where
  the script did not load are not counted.

## 7. Before you rely on it

- **Backups.** The database lives in this compose project's `db_data` volume, so
  Coolify's managed-database backups do not cover it. Schedule a dump, for example
  a Coolify scheduled task on the `db` service:
  `pg_dump -U $POSTGRES_USER analytics | gzip > /backups/analytics-$(date +%F).sql.gz`
  and copy it off the server. Test a restore once.
- **Run exactly one replica of `app`.** The write queue and rate limits are in
  memory; two instances would split them.
- **Retention.** Nothing is deleted automatically. See README → Scaling notes
  for the cleanup queries to schedule.
- **Updates.** Redeploying restarts the app; buffered events (up to 2 seconds) are
  flushed on shutdown. The schema migration runs on every deploy and is idempotent.

## Troubleshooting: 404 after a successful deploy

A 404 written as plain text (`404 page not found`) comes from Traefik and means it has
no running container registered for that hostname.

- **Check which container owns the hostname** (run on the server):

  ```bash
  docker ps -a --format '{{.Names}}' | grep -E 'app-|db-' | while read c; do
    echo "== $c"; docker inspect --format '{{json .Config.Labels}}' "$c" | tr ',' '\n' | grep -i rule
  done
  ```

  The `Host(...)` rule must be on `app-…`. If it is on anything else, or missing,
  open Configuration → Services → `app`, set the domain with `:3000`, and redeploy.
  Labels are only written at deploy time.
- **An older version of this compose file had a separate `migrate` service.** Coolify
  once attached the domain to it (it exits after running, so the site 404'd). If you
  are upgrading from that version, delete the leftover `SERVICE_URL_MIGRATE` and
  `SERVICE_FQDN_MIGRATE` variables and confirm the domain is on `app`.
- **`app` is not healthy or keeps restarting.** Read its logs. It prints
  "Schema is up to date." and then "Ready" when it starts; a database error or a
  missing `SERVICE_PASSWORD_64_VISITORSALT` shows up before that.
