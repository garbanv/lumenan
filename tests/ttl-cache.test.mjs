// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { TtlCache } from '../lib/ttl-cache.mjs';

test('serves cached values until the TTL expires', async () => {
  let t = 0;
  const cache = new TtlCache({ ttlMs: 100, now: () => t });
  let loads = 0;
  const load = async () => ++loads;
  assert.equal(await cache.get('k', load), 1);
  t = 99;
  assert.equal(await cache.get('k', load), 1);
  t = 100;
  assert.equal(await cache.get('k', load), 2);
});

test('concurrent callers share one in-flight load', async () => {
  const cache = new TtlCache({ ttlMs: 1000 });
  let loads = 0;
  const load = async () => {
    loads++;
    await new Promise((r) => setTimeout(r, 10));
    return 'v';
  };
  const results = await Promise.all([cache.get('k', load), cache.get('k', load), cache.get('k', load)]);
  assert.deepEqual(results, ['v', 'v', 'v']);
  assert.equal(loads, 1);
});

test('failures are not cached', async () => {
  const cache = new TtlCache({ ttlMs: 1000 });
  await assert.rejects(cache.get('k', async () => { throw new Error('db down'); }));
  assert.equal(await cache.get('k', async () => 'ok'), 'ok');
});

test('keys are independent and size is bounded', async () => {
  const cache = new TtlCache({ ttlMs: 1000, maxEntries: 2 });
  await cache.get('a', async () => 1);
  await cache.get('b', async () => 2);
  await cache.get('c', async () => 3);
  assert.equal(cache.entries.size, 2);
  assert.equal(cache.entries.has('a'), false);
});
