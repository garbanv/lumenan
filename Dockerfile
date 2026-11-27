# ---- deps ----
# Installs dependencies in isolation so this layer is cached across code changes.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* .npmrc* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# ---- builder ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js inlines NEXT_PUBLIC_* variables at build time, so the public origin
# has to be available here, not only at runtime.
ARG NEXT_PUBLIC_APP_ORIGIN
ENV NEXT_PUBLIC_APP_ORIGIN=$NEXT_PUBLIC_APP_ORIGIN

# DATABASE_URL is not needed to build: every route that touches the database is
# dynamic, and lib/env.ts reads configuration lazily rather than at import time.
RUN npm run build

# Country lookup data (DB-IP Lite, CC BY 4.0). Optional: if the download fails
# the build continues, and the app fetches the file itself on first start.
# Docker caches this layer, so to pick up a new monthly release at build time
# pass a different value, e.g. --build-arg GEOIP_MONTH=2026-11.
ARG GEOIP_MONTH=unset
RUN node scripts/download-geoip.mjs --soft

# ---- runner ----
# Uses Next's "standalone" output (see next.config.mjs) to ship only what is
# needed at runtime rather than the whole node_modules tree.
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Migration script + schema, so `npm run db:migrate` can run inside this same
# image against a database anywhere (compose service, or a managed Postgres).
COPY --from=builder /app/db ./db
# GeoIP database. data/ is owned by the app user because the app replaces the
# file itself when a newer monthly release is published (see lib/geoip.ts).
COPY --from=builder --chown=nextjs:nodejs /app/data ./data
COPY --from=builder /app/package.json ./package.json
# bcryptjs is required at runtime by `db/migrate.mjs` when seeding, and is not
# traced into the standalone bundle because db/migrate.mjs runs outside Next's
# module graph. Without this, `docker compose run -e SEED=1 migrate` fails with
# ERR_MODULE_NOT_FOUND.
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Next.js otherwise installs its own SIGTERM handler that exits the process
# straight after closing the HTTP server. lib/shutdown.ts needs to flush the
# in-memory event queue first, so it takes over signal handling.
ENV NEXT_MANUAL_SIG_HANDLE=true

# Basic container healthcheck: the landing page renders without a database, so
# a successful response means the Node process is accepting connections.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]