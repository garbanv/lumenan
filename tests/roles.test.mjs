// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { can, siteForUserSql } from '../lib/roles.mjs';

test('the permission matrix', () => {
  const matrix = {
    owner: { view: true, manage: true, team: true, delete: true },
    manager: { view: true, manage: true, team: false, delete: false },
    viewer: { view: true, manage: false, team: false, delete: false },
  };
  for (const [role, caps] of Object.entries(matrix)) {
    for (const [cap, expected] of Object.entries(caps)) {
      assert.equal(can(/** @type {any} */ (role), /** @type {any} */ (cap)), expected, `${role} ${cap}`);
    }
  }
});

test('no role means no capability, whatever is asked', () => {
  for (const cap of ['view', 'manage', 'team', 'delete']) {
    assert.equal(can(null, /** @type {any} */ (cap)), false);
    assert.equal(can(undefined, /** @type {any} */ (cap)), false);
    assert.equal(can(/** @type {any} */ ('admin'), /** @type {any} */ (cap)), false);
  }
});

test('the access query is scoped by both site and user', () => {
  const sql = siteForUserSql('s.id');
  assert.ok(sql.includes('s.id = $1') || sql.includes('s.id = $1\n'));
  assert.ok(sql.includes('$2'));
  assert.ok(/user_id = \$2 OR m\.user_id IS NOT NULL/.test(sql));
});
