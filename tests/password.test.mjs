// @ts-check
/**
 * Unit tests for password hashing and the shared password rules.
 *
 * Run with:  npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  burnPasswordTime,
  validatePassword,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
} from '../lib/password.mjs';

test('a hashed password verifies against itself', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.ok(hash.startsWith('$2'), 'expected a bcrypt hash');
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
});

test('a wrong password does not verify', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('correct horse battery stapl', hash), false);
  assert.equal(await verifyPassword('', hash), false);
  assert.equal(await verifyPassword('CORRECT HORSE BATTERY STAPLE', hash), false);
});

test('the same password hashes differently every time', async () => {
  // A per-hash salt is what stops a rainbow table from working across accounts.
  const first = await hashPassword('same-password');
  const second = await hashPassword('same-password');
  assert.notEqual(first, second, 'hashes must not be deterministic');
  assert.equal(await verifyPassword('same-password', first), true);
  assert.equal(await verifyPassword('same-password', second), true);
});

test('a malformed hash reads as a wrong password, not an exception', async () => {
  // A legacy or corrupted row must not produce a 500 that leaks account state.
  for (const bad of ['', 'not-a-hash', '$2a$11$truncated']) {
    assert.equal(await verifyPassword('anything', bad), false);
  }
});

test('burnPasswordTime resolves without throwing', async () => {
  // Used on the no-such-user login path to equalise response timing.
  await assert.doesNotReject(() => burnPasswordTime('anything'));
});

test('validatePassword enforces the minimum length', () => {
  assert.ok(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH - 1)), 'one under the minimum');
  assert.equal(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH)), null);
});

test('validatePassword rejects a password over the bcrypt byte limit', () => {
  // bcrypt silently truncates past 72 bytes, which would make two different
  // long passwords interchangeable.
  const tooLong = 'a'.repeat(MAX_PASSWORD_BYTES + 1);
  const problem = validatePassword(tooLong);
  assert.ok(problem, 'expected a problem for an over-long password');
  assert.match(problem.message, /72/);

  assert.equal(validatePassword('a'.repeat(MAX_PASSWORD_BYTES)), null, 'exactly at the limit');
});

test('validatePassword measures bytes, not characters', () => {
  // Multi-byte characters hit the limit sooner than their length suggests.
  const multibyte = 'é'.repeat(40); // 80 bytes in UTF-8
  assert.ok(validatePassword(multibyte), 'expected the byte length to be enforced');
});
