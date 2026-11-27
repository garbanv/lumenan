// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emailAllowed,
  generateInviteToken,
  hashInviteToken,
  inviteStatus,
  isInviteToken,
  validateInviteInput,
} from '../lib/team.mjs';

test('tokens are 43 url-safe characters, unique, and hashed to 64 hex', () => {
  const tokens = new Set(Array.from({ length: 100 }, () => generateInviteToken()));
  assert.equal(tokens.size, 100);
  for (const t of tokens) {
    assert.ok(isInviteToken(t));
    assert.match(hashInviteToken(t), /^[0-9a-f]{64}$/);
  }
  assert.notEqual(hashInviteToken('a'.repeat(43)), hashInviteToken('b'.repeat(43)));
  assert.equal(isInviteToken('short'), false);
  assert.equal(isInviteToken("a".repeat(42) + "'"), false);
});

test('invite input: role is required and limited to member roles', () => {
  assert.deepEqual(validateInviteInput({ role: 'viewer' }), { ok: true, role: 'viewer', email: null });
  assert.deepEqual(validateInviteInput({ role: 'manager', email: '  Ann@Example.COM ' }), {
    ok: true, role: 'manager', email: 'ann@example.com',
  });
  for (const role of ['owner', 'admin', '', undefined, 1]) {
    const r = validateInviteInput({ role });
    assert.ok(!r.ok && r.fields.role, String(role));
  }
});

test('invite input: a given email must look like one; empty means unrestricted', () => {
  const bad = validateInviteInput({ role: 'viewer', email: 'not-an-email' });
  assert.ok(!bad.ok && bad.fields.email);
  const blank = validateInviteInput({ role: 'viewer', email: '   ' });
  assert.deepEqual(blank, { ok: true, role: 'viewer', email: null });
});

test('status: pending, expired and accepted', () => {
  const now = new Date('2026-11-27T12:00:00Z');
  const future = '2026-11-28T12:00:00Z';
  assert.equal(inviteStatus({ expiresAt: future, acceptedAt: null }, now), 'pending');
  assert.equal(inviteStatus({ expiresAt: '2026-11-27T12:00:00Z', acceptedAt: null }, now), 'expired');
  assert.equal(inviteStatus({ expiresAt: '2026-11-01T00:00:00Z', acceptedAt: null }, now), 'expired');
  assert.equal(inviteStatus({ expiresAt: future, acceptedAt: '2026-11-27T11:00:00Z' }, now), 'accepted');
});

test('an invite locked to an address only admits that address, case-insensitively', () => {
  assert.equal(emailAllowed(null, 'anyone@example.com'), true);
  assert.equal(emailAllowed('ann@example.com', 'ANN@example.com'), true);
  assert.equal(emailAllowed('ann@example.com', 'bob@example.com'), false);
});
