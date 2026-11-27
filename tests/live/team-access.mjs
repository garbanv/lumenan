// @ts-check
/**
 * Live check: who can do what on a shared site.
 *
 * Runs against a RUNNING app (signups must be open) and its database. It creates
 * throwaway users (owner, manager, viewer, outsider, plus a few for invite
 * edge cases), drives the real HTTP API with their own sessions, and checks the
 * whole permission matrix. Everything it created is deleted afterwards, even if
 * a check fails.
 *
 *   BASE_URL=http://localhost:3000 DATABASE_URL=postgresql://... npm run test:live:team
 *
 * Why it exists: access control is the one place a bug silently exposes someone
 * else's data. Unit tests cover the rules; this proves every route applies them.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const baseUrl = (process.env.BASE_URL ?? '').replace(/\/$/, '');
const databaseUrl = process.env.DATABASE_URL ?? '';
if (!baseUrl || !databaseUrl) {
  console.error('Set BASE_URL (the running app) and DATABASE_URL (its database).');
  process.exit(2);
}

const run = randomBytes(4).toString('hex');
const password = `Pw-${randomBytes(12).toString('hex')}`; // test-only, never printed
const emailOf = (who) => `team-probe-${run}-${who}@example.invalid`;

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const failures = [];
let checks = 0;

function expect(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)})`}`);
}

/** One signed-in person: carries its own session cookie. */
class Person {
  constructor(who) {
    this.who = who;
    this.email = emailOf(who);
    this.cookie = '';
  }

  async call(method, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = response.headers.getSetCookie?.() ?? [];
    const session = set.find((c) => c.startsWith('sa_session='));
    if (session) this.cookie = session.split(';')[0];
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON (a page) */ }
    return { status: response.status, json, text };
  }

  signup(extra = {}) {
    return this.call('POST', '/api/auth/signup', { email: this.email, password, name: this.who, ...extra });
  }
}

const people = Object.fromEntries(
  ['owner', 'manager', 'viewer', 'outsider', 'locked', 'leaver'].map((w) => [w, new Person(w)])
);
const { owner, manager, viewer, outsider, locked, leaver } = people;

const tokenOf = (res) => res.json?.token;
const statuses = async (person, calls) =>
  Object.fromEntries(await Promise.all(Object.entries(calls).map(async ([k, f]) => [k, (await f(person)).status])));

try {
  // ----- setup ---------------------------------------------------------------
  console.log('Setup');
  const s = await owner.signup();
  expect('owner can sign up (signups must be open for this check)', s.status, 200);
  if (s.status !== 200) throw new Error('Cannot continue: set ALLOW_SIGNUP=true while running this check.');

  const created = await owner.call('POST', '/api/sites', { name: 'Team probe', domain: `probe-${run}.example` });
  expect('owner creates a site', created.status, 201);
  const siteId = created.json.site.id;
  const site = `/api/sites/${siteId}`;

  expect('outsider signs up', (await outsider.signup()).status, 200);
  const other = await outsider.call('POST', '/api/sites', { name: 'Outsider site', domain: `other-${run}.example` });
  expect("outsider creates their own site", other.status, 201);
  const otherSite = `/api/sites/${other.json.site.id}`;

  // Make the public link exist so we can check who can see its secret.
  expect('owner turns on the public link', (await owner.call('POST', `${site}/share`, { action: 'enable' })).status, 200);

  // ----- invitations ---------------------------------------------------------
  console.log('Invitations');
  const mInvite = await owner.call('POST', `${site}/invites`, { role: 'manager' });
  const vInvite = await owner.call('POST', `${site}/invites`, { role: 'viewer' });
  expect('owner creates a manager invitation', mInvite.status, 201);
  expect('the token is returned once, with 43 characters', tokenOf(mInvite)?.length, 43);
  expect('owner creates a viewer invitation', vInvite.status, 201);

  expect('a bad role is rejected', (await owner.call('POST', `${site}/invites`, { role: 'owner' })).status, 400);
  expect('a bad email is rejected', (await owner.call('POST', `${site}/invites`, { role: 'viewer', email: 'nope' })).status, 400);

  expect('manager joins by signing up with the link', (await manager.signup({ inviteToken: tokenOf(mInvite) })).json?.siteId, siteId);
  expect('viewer signs up normally first', (await viewer.signup()).status, 200);
  expect('viewer then accepts the link while signed in', (await viewer.call('POST', '/api/invites/accept', { token: tokenOf(vInvite) })).json?.siteId, siteId);

  expect('a used link cannot be used again', (await outsider.call('POST', '/api/invites/accept', { token: tokenOf(vInvite) })).status, 409);
  expect('a made-up link is not found', (await outsider.call('POST', '/api/invites/accept', { token: 'A'.repeat(43) })).status, 404);
  expect('accepting needs a session', (await new Person('anon').call('POST', '/api/invites/accept', { token: tokenOf(mInvite) })).status, 401);

  const expiring = await owner.call('POST', `${site}/invites`, { role: 'viewer' });
  await pool.query(`UPDATE site_invites SET expires_at = now() - interval '1 minute' WHERE id = $1`, [expiring.json.invite.id]);
  expect('an expired link is refused', (await outsider.call('POST', '/api/invites/accept', { token: tokenOf(expiring) })).status, 409);

  const revoked = await owner.call('POST', `${site}/invites`, { role: 'viewer' });
  expect('owner revokes an invitation', (await owner.call('DELETE', `${site}/invites/${revoked.json.invite.id}`)).status, 204);
  expect('a revoked link no longer works', (await outsider.call('POST', '/api/invites/accept', { token: tokenOf(revoked) })).status, 404);

  const lockedInvite = await owner.call('POST', `${site}/invites`, { role: 'viewer', email: locked.email });
  expect('an invitation can be locked to an address', lockedInvite.status, 201);
  expect('someone else cannot use a locked link (signed in)', (await outsider.call('POST', '/api/invites/accept', { token: tokenOf(lockedInvite) })).status, 409);
  const wrongSignup = await new Person('wrong').signup({ inviteToken: tokenOf(lockedInvite) });
  expect('nor can someone else sign up with it', wrongSignup.status, 400);
  expect('the intended address can', (await locked.signup({ inviteToken: tokenOf(lockedInvite) })).json?.siteId, siteId);

  // ----- permission matrix ---------------------------------------------------
  console.log('Permissions');
  const matrix = {
    'read site': (p) => p.call('GET', site),
    'read stats': (p) => p.call('GET', `/api/stats?siteId=${siteId}`),
    'read realtime': (p) => p.call('GET', `/api/stats/realtime?siteId=${siteId}`),
    'edit settings': (p) => p.call('PATCH', site, { name: 'Team probe' }),
    'add goal': (p) => p.call('POST', `${site}/goals`, { type: 'event', value: `probe-${p.who}` }),
    'change public link': (p) => p.call('POST', `${site}/share`, { action: 'enable' }),
    'invite': (p) => p.call('POST', `${site}/invites`, { role: 'viewer' }),
    'change a role': (p) => p.call('PATCH', `${site}/members/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}`, { role: 'viewer' }),
    'delete site': (p) => p.call('DELETE', site),
    'settings page': (p) => p.call('GET', `/sites/${siteId}/settings`),
    'tracking code page': (p) => p.call('GET', `/sites/${siteId}/code`),
    'dashboard page': (p) => p.call('GET', `/sites/${siteId}`),
  };

  expect('owner', await statuses(owner, { ...matrix, 'delete site': async () => ({ status: -1 }) }), {
    'read site': 200, 'read stats': 200, 'read realtime': 200, 'edit settings': 200, 'add goal': 201,
    'change public link': 200, invite: 201, 'change a role': 404, 'delete site': -1,
    'settings page': 200, 'tracking code page': 200, 'dashboard page': 200,
  });
  expect('manager', await statuses(manager, matrix), {
    'read site': 200, 'read stats': 200, 'read realtime': 200, 'edit settings': 200, 'add goal': 201,
    'change public link': 200, invite: 403, 'change a role': 403, 'delete site': 403,
    'settings page': 200, 'tracking code page': 200, 'dashboard page': 200,
  });
  expect('viewer', await statuses(viewer, matrix), {
    'read site': 200, 'read stats': 200, 'read realtime': 200, 'edit settings': 403, 'add goal': 403,
    'change public link': 403, invite: 403, 'change a role': 403, 'delete site': 403,
    'settings page': 404, 'tracking code page': 404, 'dashboard page': 200,
  });
  expect('outsider (no access at all: everything looks like a missing site)', await statuses(outsider, matrix), {
    'read site': 404, 'read stats': 404, 'read realtime': 404, 'edit settings': 404, 'add goal': 404,
    'change public link': 404, invite: 404, 'change a role': 404, 'delete site': 404,
    'settings page': 404, 'tracking code page': 404, 'dashboard page': 404,
  });

  console.log('Secrets and isolation');
  const asViewer = await viewer.call('GET', site);
  expect("a viewer never receives the public link's secret", asViewer.json?.site?.shareToken, null);
  expect('a viewer sees their role', asViewer.json?.site?.role, 'viewer');
  expect('a manager sees their role', (await manager.call('GET', site)).json?.site?.role, 'manager');
  expect('a manager does receive the public link', typeof (await manager.call('GET', site)).json?.site?.shareToken, 'string');
  expect("the site list shows shared sites with the right role", (await manager.call('GET', '/api/sites')).json?.sites?.find((x) => x.id === siteId)?.role, 'manager');
  expect("the outsider's list does not include this site", (await outsider.call('GET', '/api/sites')).json?.sites?.some((x) => x.id === siteId), false);
  expect("membership of one site grants nothing on another", (await manager.call('GET', otherSite)).status, 404);
  expect("…including writing to it", (await manager.call('POST', `${otherSite}/goals`, { type: 'event', value: 'x' })).status, 404);

  // ----- managing members ----------------------------------------------------
  console.log('Managing members');
  const ownerView = await owner.call('GET', site);
  const viewerId = (await pool.query('SELECT id FROM users WHERE email = $1', [viewer.email])).rows[0].id;
  const managerId = (await pool.query('SELECT id FROM users WHERE email = $1', [manager.email])).rows[0].id;
  const leaverInvite = await owner.call('POST', `${site}/invites`, { role: 'manager' });
  await leaver.signup({ inviteToken: tokenOf(leaverInvite) });
  const leaverId = (await pool.query('SELECT id FROM users WHERE email = $1', [leaver.email])).rows[0].id;
  expect('the owner can see the site normally', ownerView.status, 200);

  expect('a manager cannot remove another member', (await manager.call('DELETE', `${site}/members/${viewerId}`)).status, 403);
  expect('a viewer cannot remove another member', (await viewer.call('DELETE', `${site}/members/${managerId}`)).status, 403);
  expect('owner promotes the viewer to manager', (await owner.call('PATCH', `${site}/members/${viewerId}`, { role: 'manager' })).status, 200);
  expect('the promoted member can now edit settings', (await viewer.call('PATCH', site, { name: 'Team probe' })).status, 200);
  expect('owner demotes them again', (await owner.call('PATCH', `${site}/members/${viewerId}`, { role: 'viewer' })).status, 200);
  expect('…and they are read-only again', (await viewer.call('PATCH', site, { name: 'Team probe' })).status, 403);
  expect('a role must be valid', (await owner.call('PATCH', `${site}/members/${viewerId}`, { role: 'owner' })).status, 400);

  expect('a member can leave a site themselves', (await leaver.call('DELETE', `${site}/members/${leaverId}`)).status, 204);
  expect('after leaving they have no access', (await leaver.call('GET', site)).status, 404);
  expect('owner removes a member', (await owner.call('DELETE', `${site}/members/${managerId}`)).status, 204);
  expect('a removed member loses access at once', (await manager.call('GET', site)).status, 404);
  expect('…and cannot write either', (await manager.call('PATCH', site, { name: 'x' })).status, 404);

  // ----- owner-only deletion -------------------------------------------------
  console.log('Deletion');
  expect('the owner can delete their site', (await owner.call('DELETE', site)).status, 204);
  expect('its members lose access with it', (await viewer.call('GET', site)).status, 404);
} catch (err) {
  failures.push(`script error: ${err instanceof Error ? err.message : String(err)}`);
  console.log(`  FAIL  script error: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  // Users cascade to their sites, memberships and invitations.
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`team-probe-${run}-%`]).catch(() => {});
  await pool.end();
}

console.log('');
if (failures.length > 0) {
  console.log(`${failures.length} of ${checks} checks failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`All ${checks} access checks passed.`);
