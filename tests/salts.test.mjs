// @ts-check
/**
 * Unit tests for the per-day visitor salt resolver.
 *
 * The SQL itself is checked against real PostgreSQL in db/verify-schema.mjs;
 * these tests cover the logic around it with a fake query function: caching,
 * sharing one lookup between concurrent requests, agreeing with another
 * instance that created the day's salt first, and deleting expired salts.
 *
 * Run with:  npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaltResolver, generateSalt, SALT_SQL } from '../lib/salts.mjs';

/**
 * An in-memory stand-in for the daily_salts table that honours
 * ON CONFLICT DO NOTHING, and records every statement it was given.
 */
function fakeDatabase({ failPurge = false, delayMs = 0 } = {}) {
  /** @type {Map<string, string>} */
  const table = new Map();
  /** @type {Array<{ text: string, params: unknown[] }>} */
  const calls = [];

  async function query(text, params = []) {
    calls.push({ text, params });
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (text === SALT_SQL.create) {
      const [day, salt] = /** @type {[string, string]} */ (params);
      if (!table.has(day)) table.set(day, salt); // ON CONFLICT DO NOTHING
      return { rows: [] };
    }
    if (text === SALT_SQL.read) {
      const day = /** @type {string} */ (params[0]);
      return { rows: table.has(day) ? [{ salt: table.get(day) }] : [] };
    }
    if (text === SALT_SQL.purge) {
      if (failPurge) throw new Error('purge failed');
      const cutoff = /** @type {string} */ (params[0]);
      for (const day of [...table.keys()]) if (day < cutoff) table.delete(day);
      return { rows: [] };
    }
    throw new Error(`unexpected SQL: ${text}`);
  }

  return { query, table, calls, count: (sql) => calls.filter((c) => c.text === sql).length };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('generateSalt returns 256 random bits as hex, different every time', () => {
  const a = generateSalt();
  const b = generateSalt();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test('the first request of a day creates a salt and later ones reuse it', async () => {
  const db = fakeDatabase();
  const { getDailySalt } = createSaltResolver(db.query);

  const first = await getDailySalt('2026-10-18');
  const second = await getDailySalt('2026-10-18');

  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(db.count(SALT_SQL.create), 1, 'created exactly once');
  assert.equal(db.count(SALT_SQL.read), 1, 'the cache answers every later call');
});

test('concurrent first requests share one lookup', async () => {
  const db = fakeDatabase({ delayMs: 5 });
  const { getDailySalt } = createSaltResolver(db.query);

  const salts = await Promise.all(Array.from({ length: 50 }, () => getDailySalt('2026-10-18')));

  assert.equal(new Set(salts).size, 1, 'every caller must get the same salt');
  assert.equal(db.count(SALT_SQL.create), 1, 'a burst of requests must not become a burst of inserts');
});

test('different days get different salts', async () => {
  const db = fakeDatabase();
  const { getDailySalt } = createSaltResolver(db.query);

  const monday = await getDailySalt('2026-10-18');
  const tuesday = await getDailySalt('2026-10-19');

  assert.notEqual(monday, tuesday);
});

test('adopts the salt another instance already created for the day', async () => {
  // Two instances race at the start of the day. The loser's INSERT does nothing
  // and its read returns the winner's salt, so both hash identically.
  const db = fakeDatabase();
  db.table.set('2026-10-18', 'f'.repeat(64));
  const { getDailySalt } = createSaltResolver(db.query, { generate: () => '0'.repeat(64) });

  assert.equal(await getDailySalt('2026-10-18'), 'f'.repeat(64));
});

test('two resolvers on one database agree', async () => {
  const db = fakeDatabase();
  const a = createSaltResolver(db.query);
  const b = createSaltResolver(db.query);

  const [fromA, fromB] = await Promise.all([a.getDailySalt('2026-10-18'), b.getDailySalt('2026-10-18')]);

  assert.equal(fromA, fromB);
});

test('salts of days that are over are deleted', async () => {
  const db = fakeDatabase();
  const { getDailySalt } = createSaltResolver(db.query);

  const monday = await getDailySalt('2026-10-18');
  await tick();
  assert.equal(db.table.get('2026-10-18'), monday, "today's salt exists");

  await getDailySalt('2026-10-19');
  await tick();

  assert.ok(!db.table.has('2026-10-18'), "yesterday's salt must be gone once a new day starts");
  assert.ok(db.table.has('2026-10-19'), "today's salt must remain");
  assert.deepEqual(
    db.calls.filter((c) => c.text === SALT_SQL.purge).map((c) => c.params[0]),
    ['2026-10-18', '2026-10-19'],
    'purge deletes everything before the day just resolved'
  );
});

test('the purge runs once per day, not once per event', async () => {
  const db = fakeDatabase();
  const { getDailySalt } = createSaltResolver(db.query);

  for (let i = 0; i < 100; i++) await getDailySalt('2026-10-18');
  await tick();

  assert.equal(db.count(SALT_SQL.purge), 1);
});

test('an expired salt is also dropped from memory', async () => {
  const db = fakeDatabase();
  const { getDailySalt } = createSaltResolver(db.query);

  const first = await getDailySalt('2026-10-18');
  await getDailySalt('2026-10-19');
  await tick();

  // Asking for the old day again must not resurrect the deleted salt from a cache.
  const again = await getDailySalt('2026-10-18');
  assert.notEqual(again, first, 'the deleted salt must not be recoverable from this process either');
});

test('a failing purge is reported but never fails ingest', async () => {
  const db = fakeDatabase({ failPurge: true });
  /** @type {unknown[]} */
  const errors = [];
  const { getDailySalt } = createSaltResolver(db.query, { onError: (err) => errors.push(err) });

  const salt = await getDailySalt('2026-10-18');
  await tick();

  assert.match(salt, /^[0-9a-f]{64}$/, 'the salt is still returned');
  assert.equal(errors.length, 1, 'the failure is surfaced to the caller-supplied handler');
});

test('a failed lookup rejects, and the next call tries again', async () => {
  const db = fakeDatabase();
  let fail = true;
  const flaky = async (text, params) => {
    if (fail) throw new Error('database unavailable');
    return db.query(text, params);
  };
  const { getDailySalt } = createSaltResolver(flaky);

  await assert.rejects(getDailySalt('2026-10-18'), /database unavailable/);
  fail = false;
  assert.match(await getDailySalt('2026-10-18'), /^[0-9a-f]{64}$/, 'a transient failure must not be cached');
});

test('refuses to return an empty salt', async () => {
  // If the row is missing after the insert, hashing with an empty salt would
  // silently remove the daily rotation. Fail instead.
  const broken = async () => ({ rows: [] });
  const { getDailySalt } = createSaltResolver(broken);

  await assert.rejects(getDailySalt('2026-10-18'), /No visitor salt/);
});
