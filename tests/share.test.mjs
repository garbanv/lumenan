// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateShareToken, isShareToken } from '../lib/share.mjs';

test('generated tokens are 43 url-safe characters and unique', () => {
  const tokens = new Set(Array.from({ length: 200 }, () => generateShareToken()));
  assert.equal(tokens.size, 200);
  for (const token of tokens) {
    assert.equal(token.length, 43);
    assert.ok(isShareToken(token));
  }
});

test('isShareToken rejects anything that is not exactly a token', () => {
  assert.equal(isShareToken(''), false);
  assert.equal(isShareToken('short'), false);
  assert.equal(isShareToken(undefined), false);
  assert.equal(isShareToken('a'.repeat(44)), false);
  assert.equal(isShareToken('a'.repeat(42) + '/'), false);
  assert.equal(isShareToken("a".repeat(41) + "'; "), false);
  assert.equal(isShareToken('a'.repeat(43)), true);
});
