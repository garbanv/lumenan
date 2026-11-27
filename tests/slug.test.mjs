// @ts-check
/**
 * Unit tests for the domain / path / id helpers.
 *
 * These are the validation rules that guard site creation and event ingestion,
 * so an over-permissive hostname check would let anyone write events into a
 * site they do not own.
 *
 * Run with:  npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify,
  isValidSiteId,
  normalizeDomain,
  domainHost,
  hostMatchesRule,
  isExcludedPath,
  parseDomainList,
} from '../lib/slug.mjs';

test('slugify produces a URL-safe id', () => {
  assert.equal(slugify('My Blog!'), 'my-blog');
  assert.equal(slugify('  Spaced   Out  '), 'spaced-out');
  assert.equal(slugify('Café'), 'cafe');
  assert.equal(slugify('---leading and trailing---'), 'leading-and-trailing');
  assert.equal(slugify(''), '');
});

test('slugify keeps non-ASCII input usable rather than emptying it', () => {
  // NFKD decomposition plus a combining-mark strip turns "Ünïcödé" into ASCII.
  assert.equal(slugify('Ünïcödé'), 'unicode');
});

test('slugify caps length at 48 characters', () => {
  assert.equal(slugify('a'.repeat(120)).length, 48);
});

test('isValidSiteId accepts lowercase ids and rejects the rest', () => {
  assert.ok(isValidSiteId('blog'));
  assert.ok(isValidSiteId('my-blog-3f9a1c7e'));
  assert.ok(isValidSiteId('a1'));

  assert.ok(!isValidSiteId('A'), 'too short');
  assert.ok(!isValidSiteId('Blog'), 'uppercase is rejected');
  assert.ok(!isValidSiteId('-leading'), 'must start alphanumeric');
  assert.ok(!isValidSiteId('has space'));
  assert.ok(!isValidSiteId('a'.repeat(49)), 'too long');
});

test('isValidSiteId rejects path traversal and SQL-ish input', () => {
  for (const input of ['../etc/passwd', "'; DROP TABLE sites;--", 'a/b']) {
    assert.ok(!isValidSiteId(input), `${input} must be rejected`);
  }
});

test('normalizeDomain handles the shapes a user actually pastes', () => {
  assert.equal(normalizeDomain('example.com'), 'example.com');
  assert.equal(normalizeDomain('Example.COM'), 'example.com');
  assert.equal(normalizeDomain('https://example.com/path?x=1'), 'example.com');
  assert.equal(normalizeDomain('http://www.example.com'), 'www.example.com');
  assert.equal(normalizeDomain('  example.com  '), 'example.com');
  assert.equal(normalizeDomain('example.com:3000'), 'example.com:3000');
  assert.equal(normalizeDomain('example.com.'), 'example.com', 'trailing FQDN dot');
  assert.equal(normalizeDomain('user:pass@example.com'), 'example.com', 'credentials');
});

test('normalizeDomain allows localhost for local testing', () => {
  assert.equal(normalizeDomain('localhost'), 'localhost');
  assert.equal(normalizeDomain('localhost:3000'), 'localhost:3000');
});

test('normalizeDomain rejects things that are not hostnames', () => {
  for (const input of ['', '   ', 'not a domain', 'http://', 'example', '.com', 'a..b.com']) {
    assert.equal(normalizeDomain(input), null, `${JSON.stringify(input)} should be rejected`);
  }
});

test('domainHost strips the port', () => {
  assert.equal(domainHost('example.com:3000'), 'example.com');
  assert.equal(domainHost('example.com'), 'example.com');
});

test('hostMatchesRule matches the domain and its subdomains only', () => {
  assert.ok(hostMatchesRule('example.com', 'example.com'));
  assert.ok(hostMatchesRule('blog.example.com', 'example.com'));
  assert.ok(hostMatchesRule('a.b.example.com', 'example.com'));
  assert.ok(hostMatchesRule('example.com:3000', 'example.com'));

  // The important negative cases: a suffix that merely looks similar.
  assert.ok(!hostMatchesRule('notexample.com', 'example.com'));
  assert.ok(!hostMatchesRule('example.com.evil.com', 'example.com'));
  assert.ok(!hostMatchesRule('example.org', 'example.com'));
});

test('isExcludedPath matches case-insensitive prefixes', () => {
  assert.ok(isExcludedPath('/admin', ['/admin']));
  assert.ok(isExcludedPath('/ADMIN/users', ['/admin']));
  assert.ok(isExcludedPath('/admin/settings', ['/admin']));
  assert.ok(!isExcludedPath('/public', ['/admin']));
  assert.ok(!isExcludedPath('/anything', []), 'an empty list excludes nothing');
  assert.ok(!isExcludedPath('/x', ['   ']), 'blank entries are ignored');
});

test('parseDomainList normalises and de-duplicates', () => {
  const parsed = parseDomainList('example.com\nhttps://blog.example.com, EXAMPLE.com');
  assert.deepEqual(parsed, ['example.com', 'blog.example.com']);
});

test('parseDomainList handles newlines, commas and spaces', () => {
  assert.deepEqual(parseDomainList('a.com b.com\nc.com,d.com'), [
    'a.com',
    'b.com',
    'c.com',
    'd.com',
  ]);
  assert.deepEqual(parseDomainList(''), []);
});
