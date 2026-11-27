// @ts-check
/**
 * Unit tests for the fixed-window rate limiter.
 *
 * The limiter is the only thing standing between a public ingest endpoint and
 * an unbounded write load, so its window arithmetic needs to be right.
 *
 * Run with:  npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rateLimit,
  resetRateLimits,
  INGEST_LIMIT_PER_MINUTE,
} from '../lib/rate-limit.mjs';

test('allows requests up to the limit, then refuses', () => {
  resetRateLimits();

  for (let i = 0; i < 5; i++) {
    const result = rateLimit('key-a', 5, 60_000);
    assert.equal(result.allowed, true, `request ${i + 1} should be allowed`);
  }

  const blocked = rateLimit('key-a', 5, 60_000);
  assert.equal(blocked.allowed, false, 'the sixth request exceeds a limit of five');
  assert.equal(blocked.remaining, 0);
});

test('counts keys independently', () => {
  resetRateLimits();

  for (let i = 0; i < 3; i++) rateLimit('key-a', 3, 60_000);

  // key-a is exhausted; key-b must be unaffected.
  assert.equal(rateLimit('key-a', 3, 60_000).allowed, false);
  assert.equal(rateLimit('key-b', 3, 60_000).allowed, true);
});

test('reports the seconds until the window resets', () => {
  resetRateLimits();

  rateLimit('key-b', 1, 30_000);
  const blocked = rateLimit('key-b', 1, 30_000);

  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfter > 0, 'expected a positive Retry-After');
  assert.ok(blocked.retryAfter <= 30, 'should not exceed the window length');
});

test('remaining counts down as the window fills', () => {
  resetRateLimits();

  assert.equal(rateLimit('key-c', 3, 60_000).remaining, 2);
  assert.equal(rateLimit('key-c', 3, 60_000).remaining, 1);
  assert.equal(rateLimit('key-c', 3, 60_000).remaining, 0);
});

test('the window resets after it expires', async () => {
  resetRateLimits();

  // A 40ms window keeps the test fast while still exercising the reset path.
  assert.equal(rateLimit('key-d', 1, 40).allowed, true);
  assert.equal(rateLimit('key-d', 1, 40).allowed, false, 'the second request is blocked');

  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(rateLimit('key-d', 1, 40).allowed, true, 'a new window allows the request again');
});

test('resetRateLimits clears every counter', () => {
  resetRateLimits();
  rateLimit('key-e', 1, 60_000);
  assert.equal(rateLimit('key-e', 1, 60_000).allowed, false);

  resetRateLimits();
  assert.equal(rateLimit('key-e', 1, 60_000).allowed, true);
});

test('the ingest limit is a sane ceiling', () => {
  // Four requests per second sustained: comfortably above an SPA firing a
  // route-change event per navigation, far below anything that could flood
  // the events table.
  assert.ok(INGEST_LIMIT_PER_MINUTE >= 60, 'too low for a normal browsing session');
  assert.ok(INGEST_LIMIT_PER_MINUTE <= 1000, 'too high to protect the database');
});
