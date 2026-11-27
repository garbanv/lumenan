// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { goalResultsSql, validateGoalInput } from '../lib/goals.mjs';

test('event goals keep the name as typed and default the label to it', () => {
  const r = validateGoalInput({ type: 'event', value: '  signup_completed ', name: '' });
  assert.deepEqual(r, { ok: true, goal: { type: 'event', value: 'signup_completed', name: 'signup_completed' } });
});

test('page goals are normalised like tracked paths', () => {
  const ok = (/** @type {string} */ value) => {
    const r = validateGoalInput({ type: 'page', value, name: 'x' });
    assert.ok(r.ok);
    return r.ok ? r.goal.value : '';
  };
  assert.equal(ok('thank-you'), '/thank-you');
  assert.equal(ok('/thank-you?utm_source=x#top'), '/thank-you');
  assert.equal(ok('/blog/*'), '/blog/*');
  assert.equal(ok('/blog/**'), '/blog/*');
  assert.equal(ok('*'), '/*');
});

test('invalid input reports per-field errors', () => {
  const bad = validateGoalInput({ type: 'nope', value: '', name: 'n'.repeat(61) });
  assert.equal(bad.ok, false);
  assert.ok(!bad.ok && bad.fields.type && bad.fields.name);

  const empty = validateGoalInput({ type: 'event', value: '   ' });
  assert.ok(!empty.ok && empty.fields.value);

  const tooLong = validateGoalInput({ type: 'event', value: 'x'.repeat(129) });
  assert.ok(!tooLong.ok && tooLong.fields.value);

  const control = validateGoalInput({ type: 'event', value: 'a\u0000b' });
  assert.ok(!control.ok && control.fields.value);
});

test('goal SQL carries the filter fragment but never a value', () => {
  const sql = goalResultsSql(" AND e.country = $3");
  assert.ok(sql.includes('AND e.country = $3'));
  assert.ok(sql.includes('GROUP BY g.id'));
});
