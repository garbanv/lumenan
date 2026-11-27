// @ts-check
/**
 * Live check: with signups CLOSED (ALLOW_SIGNUP=false), a valid invitation is
 * the only way to create an account, and only for the person it is meant for.
 *
 * Run against an app started with ALLOW_SIGNUP=false:
 *
 *   BASE_URL=http://localhost:3000 DATABASE_URL=postgresql://... npm run test:live:closed
 *
 * It writes its own owner, site and invitations straight to the database, calls
 * the real signup endpoint, and deletes everything afterwards.
 */
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

const baseUrl = (process.env.BASE_URL ?? '').replace(/\/$/, '');
const databaseUrl = process.env.DATABASE_URL ?? '';
if (!baseUrl || !databaseUrl) {
  console.error('Set BASE_URL (an app running with ALLOW_SIGNUP=false) and DATABASE_URL.');
  process.exit(2);
}

const run = randomBytes(4).toString('hex');
const prefix = `closed-probe-${run}`;
const password = `Pw-${randomBytes(12).toString('hex')}`; // test-only, never printed
const token = () => randomBytes(32).toString('base64url');
const hash = (t) => createHash('sha256').update(t).digest('hex');

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const failures = [];
let checks = 0;
const expect = (name, actual, expected) => {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)})`}`);
};

const signup = async (who, extra = {}) => {
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${prefix}-${who}@example.invalid`, password, name: who, ...extra }),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
};
const accountExists = async (who) =>
  (await pool.query('SELECT 1 FROM users WHERE email = $1', [`${prefix}-${who}@example.invalid`])).rowCount === 1;

try {
  const owner = await pool.query(
    `INSERT INTO users (email, email_key, password_hash, name) VALUES ($1, $1, 'x', 'owner') RETURNING id`,
    [`${prefix}-owner@example.invalid`]
  );
  const ownerId = owner.rows[0].id;
  const siteId = `${prefix}-site`;
  await pool.query(`INSERT INTO sites (id, user_id, name, domain) VALUES ($1, $2, 'Closed probe', 'closed.example')`, [siteId, ownerId]);

  const invite = async (extra = {}) => {
    const t = token();
    await pool.query(
      `INSERT INTO site_invites (site_id, token_hash, role, email, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [siteId, hash(t), extra.role ?? 'viewer', extra.email ?? null, ownerId, extra.expires ?? new Date(Date.now() + 86_400_000)]
    );
    return t;
  };

  const probe = await signup('plain');
  expect('the deployment really is closed (an ordinary signup is refused)', probe.status, 403);
  expect('…and no account was created', await accountExists('plain'), false);

  expect('a made-up invitation does not open it', (await signup('fake', { inviteToken: 'A'.repeat(43) })).status, 403);
  expect('…no account', await accountExists('fake'), false);

  const good = await invite();
  const joined = await signup('invited', { inviteToken: good });
  expect('a valid invitation lets its holder create an account', joined.status, 200);
  expect('…which lands on the invited site', joined.json?.siteId, siteId);
  expect('…as a member', (await pool.query(
    `SELECT role FROM site_members m JOIN users u ON u.id = m.user_id WHERE u.email = $1 AND m.site_id = $2`,
    [`${prefix}-invited@example.invalid`, siteId])).rows[0]?.role, 'viewer');

  expect('the same link cannot create a second account', (await signup('second', { inviteToken: good })).status, 403);
  expect('…no account', await accountExists('second'), false);

  const expired = await invite({ expires: new Date(Date.now() - 60_000) });
  expect('an expired invitation does not open it', (await signup('late', { inviteToken: expired })).status, 403);

  const locked = await invite({ email: `${prefix}-right@example.invalid`, role: 'manager' });
  const wrong = await signup('wrong', { inviteToken: locked });
  expect('an invitation locked to an address refuses another one', wrong.status, 400);
  expect('…no account', await accountExists('wrong'), false);
  expect('…and the link is still usable by the right address', (await signup('right', { inviteToken: locked })).json?.siteId, siteId);
} catch (err) {
  failures.push(`script error: ${err instanceof Error ? err.message : String(err)}`);
  console.log(`  FAIL  script error: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${prefix}-%`]).catch(() => {});
  await pool.end();
}

console.log('');
if (failures.length > 0) {
  console.log(`${failures.length} of ${checks} checks failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`All ${checks} closed-signup checks passed.`);
