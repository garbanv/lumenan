// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { toPublicStats } from '../lib/public-stats.mjs';

const sample = () => ({
  summary: { pageviews: 3 },
  topPages: [{ label: '/', value: 3 }],
  recent: [
    { path: '/secret-visit-path', referrer: 'leaky.example', device: 'desktop', createdAt: '2026-11-27T17:59:04.812Z' },
  ],
});

test('removes every individual visit from the data, not just from the display', () => {
  const json = JSON.stringify(toPublicStats(sample()));
  assert.ok(!json.includes('secret-visit-path'));
  assert.ok(!json.includes('leaky.example'));
  assert.ok(!json.includes('2026-11-27T17:59:04.812Z'));
  assert.deepEqual(toPublicStats(sample()).recent, []);
});

test('keeps the aggregates and does not modify the original', () => {
  const original = sample();
  const result = toPublicStats(original);
  assert.deepEqual(result.summary, original.summary);
  assert.deepEqual(result.topPages, original.topPages);
  assert.equal(original.recent.length, 1, 'the cached object the owner sees is untouched');
});
