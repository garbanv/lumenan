// One-off cleanup of personal data stored by versions that predate the
// "pathname only, referrer domain only" change.
//
// Before that change the tracker sent the full query string and the server kept
// the complete referrer URL. Both can contain personal data (emails, tokens,
// order ids, search terms), and rows written back then are still in `events`.
// New events no longer contain any of it; this script removes what is left.
//
// It does two things:
//   1. Cuts everything from the first "?" or "#" out of events.path.
//   2. Drops the events.referrer column (the dashboard only ever used
//      referrer_domain, which is kept).
//
// DRY RUN BY DEFAULT: it only reports what it would change. Pass --apply to
// change data.
//
//   npm run db:scrub                   # report only
//   npm run db:scrub -- --apply        # clean the data
//   npm run db:scrub -- --apply --vacuum
//
// In Docker (the migrate service runs this same image, with db/ included):
//   docker compose run --rm migrate node db/scrub-legacy.mjs
//   docker compose run --rm migrate node db/scrub-legacy.mjs --apply
//
// Safe to re-run: a second run finds nothing to do.
//
// Plain JavaScript so it runs on any Node without a TypeScript loader.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

/** Same precedence as db/migrate.mjs; real environment variables win. */
const ENV_FILES = ['.env.local', '.env'];

/** Rows rewritten per statement, so no single statement holds locks for long. */
const BATCH_SIZE = 5000;

function loadEnvFile() {
  const path = ENV_FILES.map((name) => join(process.cwd(), name)).find((candidate) =>
    existsSync(candidate)
  );
  if (!path) return;

  for (const rawLine of readFileSync(path, 'utf-8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (!key || key in process.env) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const fmt = (n) => Number(n).toLocaleString('en-US');

async function main() {
  loadEnvFile();

  const args = new Set(process.argv.slice(2));
  const known = new Set(['--apply', '--vacuum']);
  const unknown = [...args].filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    console.error(`Unknown option: ${unknown.join(', ')}`);
    console.error('Usage: node db/scrub-legacy.mjs [--apply] [--vacuum]');
    process.exit(1);
  }
  const apply = args.has('--apply');
  const vacuum = args.has('--vacuum');
  if (vacuum && !apply) {
    console.error('--vacuum only makes sense together with --apply.');
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      'DATABASE_URL is not set.\n' +
        'Copy .env.example to .env and fill it in, or pass DATABASE_URL in the environment.'
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString });

  try {
    const hasEvents = await pool.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'events'`
    );
    if (hasEvents.rowCount === 0) {
      console.error('There is no events table. Run the migration first: npm run db:migrate');
      process.exitCode = 1;
      return;
    }

    const hasReferrer =
      (
        await pool.query(
          `SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'events' AND column_name = 'referrer'`
        )
      ).rowCount > 0;

    const total = (await pool.query('SELECT count(*)::bigint AS n FROM events')).rows[0].n;
    const dirtyPaths = (
      await pool.query(`SELECT count(*)::bigint AS n FROM events WHERE path ~ '[?#]'`)
    ).rows[0].n;
    const storedReferrers = hasReferrer
      ? (
          await pool.query(
            `SELECT count(*)::bigint AS n FROM events WHERE referrer IS NOT NULL`
          )
        ).rows[0].n
      : 0;

    console.log(`events rows:                              ${fmt(total)}`);
    console.log(`paths containing a query string or "#":   ${fmt(dirtyPaths)}`);
    console.log(
      hasReferrer
        ? `rows with a stored full referrer URL:         ${fmt(storedReferrers)}  (column still exists)`
        : `events.referrer column:                       already gone`
    );
    console.log('');

    if (Number(dirtyPaths) === 0 && !hasReferrer) {
      console.log('Nothing to clean up.');
      return;
    }

    if (!apply) {
      console.log('Dry run: nothing was changed.');
      console.log('Re-run with --apply to strip the query strings and drop the referrer column.');
      return;
    }

    // 1. Paths. Batched, and each batch is its own statement, so a large table
    //    never holds a long lock and an interruption loses at most one batch.
    //    Updated rows no longer match, so the loop always terminates.
    let cleaned = 0;
    for (;;) {
      const result = await pool.query(
        `UPDATE events e
            SET path = CASE
                         WHEN s.p = '' THEN '/'
                         WHEN left(s.p, 1) = '/' THEN s.p
                         ELSE '/' || s.p
                       END
           FROM (
             SELECT id, split_part(split_part(path, '?', 1), '#', 1) AS p
               FROM events
              WHERE path ~ '[?#]'
              LIMIT $1
           ) s
          WHERE e.id = s.id`,
        [BATCH_SIZE]
      );
      if (result.rowCount === 0) break;
      cleaned += result.rowCount;
      process.stdout.write(`\rpaths cleaned: ${fmt(cleaned)}`);
    }
    if (cleaned > 0) process.stdout.write('\n');

    // 2. The full-referrer column.
    if (hasReferrer) {
      await pool.query('ALTER TABLE events DROP COLUMN referrer');
      console.log('dropped events.referrer');
    }

    const remaining = (
      await pool.query(`SELECT count(*)::bigint AS n FROM events WHERE path ~ '[?#]'`)
    ).rows[0].n;
    console.log('');
    console.log(`Done. Paths still containing "?" or "#": ${fmt(remaining)}`);

    if (vacuum) {
      console.log('');
      console.log('Running VACUUM FULL events (takes an exclusive lock) ...');
      await pool.query('VACUUM FULL events');
      console.log('Done.');
    } else {
      console.log('');
      console.log('The old values are no longer readable through the application, but');
      console.log('PostgreSQL keeps the previous row versions on disk until the table is');
      console.log('rewritten. To remove them physically, run when traffic is low:');
      console.log('  VACUUM FULL events;');
      console.log('(or re-run this script with --apply --vacuum). It takes an exclusive');
      console.log('lock on events and needs free disk space about the size of the table.');
    }

    console.log('');
    console.log('Database backups and replicas taken before this run still contain the');
    console.log('old values; they age out with your backup retention.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
