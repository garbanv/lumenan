import { getPool, transaction } from './db';

export interface PendingEvent {
  /** Internal: number of failed flush attempts. Set by the queue, not callers. */
  attempts?: number;
  siteId: string;
  visitorHash: string;
  /** UTC day the visitor hash belongs to (YYYY-MM-DD). */
  visitorDay: string;
  path: string;
  /** Domain only. The full referrer URL is deliberately never stored. */
  referrerDomain: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  country: string | null;
  device: string;
  browser: string;
  os: string;
  eventType: string;
  eventName: string | null;
}

// ---------------------------------------------------------------------------
// In-memory write batching
// ---------------------------------------------------------------------------
// Events buffer in memory and flush as one multi-row INSERT. This keeps the
// database off the hot path of every pageview, at the cost of being tied to a
// single long-lived process: on serverless platforms each invocation may get a
// fresh module instance, so a buffer can be discarded before it flushes. There,
// write directly per request instead (see README "Deployment").

const BATCH_INTERVAL_MS = 2000;
const MAX_BATCH_SIZE = 500;
const MAX_RETRY_ATTEMPTS = 3;

interface QueueState {
  buffer: PendingEvent[];
  timer: ReturnType<typeof setInterval> | null;
  /** One flush at a time; a concurrent flush would read a half-drained buffer. */
  flushing: Promise<void> | null;
}

// The state lives on globalThis rather than in module-level variables. Next.js
// bundles instrumentation.ts (which flushes on shutdown, see lib/shutdown.ts)
// separately from the route handlers (which enqueue), and with module scope each
// bundle can end up with its own, empty, buffer. In `next dev` a hot reload also
// re-evaluates this module, which would orphan buffered events and start a
// second timer.
const globalQueue = globalThis as typeof globalThis & { __analyticsQueue?: QueueState };
const state: QueueState = (globalQueue.__analyticsQueue ??= {
  buffer: [],
  timer: null,
  flushing: null,
});

export function enqueueEvent(event: PendingEvent): void {
  state.buffer.push(event);
  if (state.buffer.length >= MAX_BATCH_SIZE) {
    void flush();
  } else {
    ensureTimer();
  }
}

function ensureTimer(): void {
  if (state.timer) return;
  const timer = setInterval(() => void flush(), BATCH_INTERVAL_MS);
  // Do not hold the process open purely for this timer.
  if (typeof timer.unref === 'function') timer.unref();
  state.timer = timer;
}

/** Test/teardown hook: flush what is buffered and stop the interval. */
export async function drainQueue(): Promise<void> {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  await flush();
}

/** Visible for tests and the health endpoint. */
export function queueDepth(): number {
  return state.buffer.length;
}

export async function flush(): Promise<void> {
  if (state.flushing) return state.flushing;
  if (state.buffer.length === 0) return;

  // Take ownership of the buffer synchronously, before any await, so events
  // enqueued during the flush land in the next batch rather than being lost or
  // written twice.
  const batch = state.buffer;
  state.buffer = [];

  state.flushing = writeBatch(batch)
    .catch((err) => {
      console.error(`Failed to flush event batch (${batch.length} events):`, err);
      requeue(batch);
    })
    .finally(() => {
      state.flushing = null;
      // Anything that arrived while we were writing goes out on the next tick
      // rather than waiting for the interval.
      if (state.buffer.length > 0) ensureTimer();
    });

  return state.flushing;
}

async function writeBatch(batch: PendingEvent[]): Promise<void> {
  await transaction(async (client) => {
    // 1. Record which (site, visitor, day) triples are new. ON CONFLICT DO
    //    NOTHING returns only the rows actually inserted, and it does so
    //    atomically, so two concurrent flushes cannot both claim a visitor.
    const visitorValues: unknown[] = [];
    const visitorRows: string[] = [];
    batch.forEach((event, index) => {
      const base = index * 3;
      visitorRows.push(`($${base + 1}, $${base + 2}, $${base + 3}::date)`);
      visitorValues.push(event.siteId, event.visitorHash, event.visitorDay);
    });

    const inserted = await client.query<{ site_id: string; visitor_hash: string }>(
      `INSERT INTO visitors (site_id, visitor_hash, day)
       VALUES ${visitorRows.join(',')}
       ON CONFLICT (site_id, visitor_hash, day) DO NOTHING
       RETURNING site_id, visitor_hash`,
      visitorValues
    );

    const newVisitors = new Set(
      inserted.rows.map((row) => `${row.site_id}\u0000${row.visitor_hash}`)
    );

    // 2. Insert the events themselves, flagging first-seen visitors.
    const eventValues: unknown[] = [];
    const eventRows: string[] = [];
    batch.forEach((event, index) => {
      const base = index * 14;
      const placeholders = Array.from({ length: 14 }, (_, offset) => `$${base + offset + 1}`);
      eventRows.push(`(${placeholders.join(', ')})`);
      eventValues.push(
        event.siteId,
        event.visitorHash,
        event.path,
        event.referrerDomain,
        event.utmSource,
        event.utmMedium,
        event.utmCampaign,
        event.country,
        event.device,
        event.browser,
        event.os,
        event.eventType,
        event.eventName,
        newVisitors.has(`${event.siteId}\u0000${event.visitorHash}`)
      );
    });

    await client.query(
      `INSERT INTO events (
         site_id, visitor_hash, path, referrer_domain,
         utm_source, utm_medium, utm_campaign, country, device,
         browser, os, event_type, event_name, is_new_visitor
       ) VALUES ${eventRows.join(',')}`,
      eventValues
    );
  });
}

/**
 * Put a failed batch back at the front of the buffer, dropping events that have
 * already failed MAX_RETRY_ATTEMPTS times.
 *
 * Without the cap, a single unsatisfiable row (an unknown site_id, a constraint
 * violation) would fail the same multi-row INSERT forever, re-queueing itself
 * every flush and taking every event batched alongside it down with it.
 */
function requeue(batch: PendingEvent[]): void {
  const retryable: PendingEvent[] = [];
  for (const event of batch) {
    const attempts = (event.attempts ?? 0) + 1;
    if (attempts > MAX_RETRY_ATTEMPTS) {
      console.error(
        `Dropping event after ${MAX_RETRY_ATTEMPTS} failed attempts ` +
          `(site_id: "${event.siteId}", path: "${event.path}")`
      );
      continue;
    }
    retryable.push({ ...event, attempts });
  }
  state.buffer = retryable.concat(state.buffer);
}

/** Close the pool during graceful shutdown so in-flight writes can finish. */
export async function shutdownQueue(): Promise<void> {
  await drainQueue();
  await getPool().end();
}
