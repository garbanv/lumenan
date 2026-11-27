# Deploying on Coolify: pilot checklist

For a first real deployment with one or two known users. Work top to bottom.

## 1. Create the resource

1. Coolify → **New resource** → **Docker Compose** (from your Git repository).
2. **Compose file:** `docker-compose-prod.yml`.
3. Assign your domain to the **`app`** service, port **3000**, with HTTPS on
   (`https://analytics.example.com`). Assign no domain to `db` or `migrate`.
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

1. Deploy. The `migrate` service applies the schema and exits (that is expected;
   it will show as "exited").
2. Open the site over **https** and sign up. Signing in over plain `http` fails because
   session cookies are `Secure` in production.
3. On `/sites`, click **Make me an admin** straight away: until someone does, the
   first account to ask gets it. Or, from the Coolify terminal of the `migrate`
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
