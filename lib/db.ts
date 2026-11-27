import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { databaseUrl } from './env';

// Reuse the pool across hot reloads in development, where modules are
// re-evaluated on every edit and would otherwise leak a pool per reload.
declare global {
  // eslint-disable-next-line no-vars
  var _analyticsPool: Pool | undefined;
}

function createPool(): Pool {
  return new Pool({
    connectionString: databaseUrl(),
    // Modest per-process ceiling. The stats endpoint runs several queries
    // concurrently per request, so this is sized to keep a handful of
    // simultaneous dashboards comfortable without exhausting Postgres'
    // default 100 connection slots. Raise it only alongside PgBouncer.
    max: 10,
    idleTimeoutMillis: 30_000,
    // Fail fast instead of hanging a request for a minute when the database
    // is unreachable, so the UI can show a real error.
    connectionTimeoutMillis: 10_000,
  });
}

export function getPool(): Pool {
  // Guard against Next.js instantiating this module once per route in dev.
  global._analyticsPool ??= createPool();
  return global._analyticsPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params as never[]);
}

/**
 * Run several statements in a single transaction, rolling back on any error.
 * Used by the ingest flush, where the event insert and the visitor upsert must
 * agree or neither should land.
 */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // A failed rollback almost always means the connection died; the pool
      // will discard it. Nothing useful to do beyond not masking the original
      // error, which is what we rethrow below.
    }
    throw err;
  } finally {
    client.release();
  }
}

/** True for Postgres' unique_violation, the one error worth branching on. */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === '23505'
  );
}
