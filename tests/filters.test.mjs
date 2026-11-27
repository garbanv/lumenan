// @ts-check
/**
 * Dashboard filters come straight from the URL, so the parsing and the SQL
 * fragment builder are a trust boundary: values must only ever reach the
 * database as bound parameters.
 *
 * Run with:  npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFilterClause, filtersKey, hasFilters, parseFilters } from '../lib/filters.mjs';

const params = (/** @type {Record<string, string>} */ init) => new URLSearchParams(init);

test('parseFilters keeps only known keys and trims values', () => {
  const filters = parseFilters(
    params({ page: ' /pricing ', device: 'mobile', range: '7d', evil: 'x', browser: '   ' })
  );
  assert.deepEqual(filters, { page: '/pricing', device: 'mobile' });
});

test('parseFilters normalises and validates countries', () => {
  assert.deepEqual(parseFilters(params({ country: 'de' })), { country: 'DE' });
  assert.deepEqual(parseFilters(params({ country: 'DEU' })), {});
  assert.deepEqual(parseFilters(params({ country: "D'" })), {});
});

test('parseFilters caps value length', () => {
  const filters = parseFilters(params({ page: '/' + 'a'.repeat(5000) }));
  assert.equal(filters.page?.length, 512);
});

test('hasFilters and filtersKey', () => {
  assert.equal(hasFilters({}), false);
  assert.equal(hasFilters({ os: 'Mac OS' }), true);
  assert.equal(filtersKey({ page: '/a', os: 'x' }), filtersKey({ os: 'x', page: '/a' }));
  assert.notEqual(filtersKey({ page: '/a' }), filtersKey({ page: '/b' }));
  assert.notEqual(filtersKey({ page: 'x' }), filtersKey({ browser: 'x' }));
});

test('buildFilterClause numbers placeholders from the given offset', () => {
  const { sql, params: bound } = buildFilterClause({ page: '/a', device: 'mobile' }, 3);
  assert.equal(sql, " AND path = $3 AND coalesce(device, 'Unknown') = $4");
  assert.deepEqual(bound, ['/a', 'mobile']);
});

test('buildFilterClause applies a table alias', () => {
  const { sql } = buildFilterClause({ referrer: 'news.ycombinator.com' }, 4, 'e.');
  assert.equal(sql, " AND coalesce(e.referrer_domain, 'Direct') = $4");
});

test('buildFilterClause never puts a value into the SQL text', () => {
  const hostile = "'; DROP TABLE events; --";
  const { sql, params: bound } = buildFilterClause(
    { page: hostile, referrer: hostile, browser: hostile, os: hostile, device: hostile },
    3
  );
  assert.ok(!sql.includes('DROP'));
  assert.ok(!sql.includes("'; "));
  assert.equal(bound.length, 5);
  assert.ok(bound.every((value) => value === hostile));
});

test('no filters yields an empty clause', () => {
  assert.deepEqual(buildFilterClause({}, 3), { sql: '', params: [] });
});
