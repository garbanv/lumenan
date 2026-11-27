// Grants platform-operator access to an account, by email.
//
// Run with:  npm run db:grant-admin -- you@example.com
//
// In Docker (the migrate service runs this same image, with db/ included):
//   docker compose run --rm migrate node db/grant-admin.mjs you@example.com
//
// This exists because the alternative is pasting an UPDATE out of the README,
// which is easy to mistype and gives no feedback: a typo in the email silently
// updates zero rows and looks identical to success.
//
// Plain JavaScript so it runs on any Node without a TypeScript loader.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

/** Same precedence as db/migrate.mjs; real environment variables win. */
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function main() {
  loadEnvFile();

  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npm run db:grant-admin -- you@example.com');
    console.error('');
    console.error('Lists the accounts on this deployment with:');
    console.error('  npm run db:list-admins');
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
  const emailKey = email.trim().toLowerCase();

  try {
    // Match on email_key, the same column the unique index uses, so casing and
    // surrounding whitespace do not matter.
    const { rows } = await pool.query(
      `UPDATE users
          SET is_admin = true, updated_at = now()
        WHERE email_key = $1
        RETURNING id, email, is_admin`,
      [emailKey]
    );

    if (rows.length === 0) {
      // Zero rows is the failure mode worth being loud about: without this the
      // command would look like it worked.
      console.error(`No account found with email "${emailKey}".`);
      console.error('');
      const existing = await pool.query(
        `SELECT email, is_admin FROM users ORDER BY created_at`
      );
      if (existing.rows.length === 0) {
        console.error('This deployment has no accounts yet. Sign up first, then run this again.');
      } else {
        console.error('Accounts on this deployment:');
        for (const row of existing.rows) {
          console.error(`  ${row.email}${row.is_admin ? '  (already an admin)' : ''}`);
        }
      }
      process.exitCode = 1;
      return;
    }

    const user = rows[0];
    console.log(`${user.email} is now an administrator.`);
    console.log('');
    console.log('Reload /admin — the session already carries the account, so there is');
    console.log('nothing to sign out of.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
