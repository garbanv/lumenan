// Applies db/schema.sql, then optionally seeds a demo account.
//
// Run with:  npm run db:migrate          apply the schema only
//            npm run db:seed             apply the schema and seed a demo account
//
// The seed flag is also read from the SEED environment variable, because
// argument passing through Docker is unreliable: `docker compose run migrate
// --seed` appends the flag to CMD, so `node` tries to load "--seed" as a module
// and exits with "Cannot find module '--seed'". Use:
//
//   docker compose run --rm -e SEED=1 migrate
//
// Plain JavaScript so it runs on any Node version without a TypeScript loader.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

/**
 * Loads the first .env file that exists, into process.env, without adding a
 * dotenv dependency.
 *
 * Next.js loads .env automatically, but this script runs outside Next, so
 * `npm run db:migrate` would otherwise fail with "DATABASE_URL is not set"
 * immediately after the user has just created a .env file. Checked in the same
 * precedence order Next uses.
 *
 * Real environment variables always win over file values, which is what
 * containers rely on: docker-compose sets DATABASE_URL in the environment and
 * no .env file is present in the image anyway.
 */
const ENV_FILES = ['.env.local', '.env'];

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
    // Strip one layer of matching quotes, as dotenv does.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/**
 * Both spellings are accepted so no caller has to know which one works in its
 * environment.
 */
function shouldSeed() {
  return process.argv.includes('--seed') || process.env.SEED === '1';
}

async function main() {
  loadEnvFile();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      'DATABASE_URL is not set.\n' +
        'Copy .env.example to .env and fill it in, or pass DATABASE_URL in the environment.'
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const sql = readFileSync(join(process.cwd(), 'db', 'schema.sql'), 'utf-8');

  console.log('Applying db/schema.sql ...');
  await pool.query(sql);
  console.log('Schema is up to date.');

  const { rows } = await pool.query(
    `SELECT (SELECT count(*)::int FROM users) AS users,
            (SELECT count(*)::int FROM sites) AS sites`
  );
  const counts = rows[0] ?? { users: 0, sites: 0 };
  console.log(`Accounts: ${counts.users}, sites: ${counts.sites}.`);

  if (shouldSeed()) {
    await seed(pool);
  } else if (counts.users === 0) {
    console.log('');
    console.log('No accounts exist yet. Create one at /signup, or run:');
    console.log('  npm run db:seed');
    console.log('to create a demo account (demo@example.com / demo-password).');
    console.log('In Docker:  docker compose run --rm -e SEED=1 migrate');
  }

  await pool.end();
}

/**
 * Demo data for local development. Deliberately opt-in: a migration that
 * silently creates a known-password account is a footgun on a public host.
 */
async function seed(pool) {
  const bcrypt = (await import('bcryptjs')).default;

  const email = 'demo@example.com';
  const password = 'demo-password';
  const hash = await bcrypt.hash(password, 11);

  const { rows } = await pool.query(
    `INSERT INTO users (email, email_key, password_hash, name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email_key) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [email, email, hash, 'Demo user']
  );

  const userId = rows[0]?.id;
  if (!userId) throw new Error('Could not create the demo user.');

  await pool.query(
    `INSERT INTO sites (id, user_id, name, domain, allowed_domains)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    ['demo', userId, 'Demo site', 'example.com', ['example.com', 'localhost']]
  );

  console.log('');
  console.log('Seeded a demo account:');
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log('  site id:  demo');
  console.log('Change these before deploying anywhere reachable.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
