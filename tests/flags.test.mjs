// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBooleanFlag } from '../lib/flags.mjs';

test('unset or empty uses the fallback', () => {
  assert.equal(parseBooleanFlag(undefined, true), true);
  assert.equal(parseBooleanFlag('', true), true);
  assert.equal(parseBooleanFlag('  ', false), false);
});

test('off spellings turn it off, in any case', () => {
  for (const raw of ['false', 'False', 'FALSE', '0', 'no', 'off', ' false ']) {
    assert.equal(parseBooleanFlag(raw, true), false, raw);
  }
});

test('anything else that is set turns it on', () => {
  for (const raw of ['true', '1', 'yes', 'on', 'whatever']) {
    assert.equal(parseBooleanFlag(raw, false), true, raw);
  }
});
