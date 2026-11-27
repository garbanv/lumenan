// @ts-check
/**
 * URL, domain and path helpers.
 *
 * Pure and isomorphic: no server imports anywhere in this file, so client forms
 * and API routes validate identically. Plain JavaScript with JSDoc types so the
 * tests run under `node --test` with no TypeScript loader.
 */

/**
 * "My Blog!" -> "my-blog"
 * @param {string} input
 * @returns {string}
 */
export function slugify(input) {
  return input
    .toLowerCase()
    .trim()
    .normalize('NFKD')
    // Strip accents so "Café" becomes "cafe" rather than "caf".
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Site ids are the public tracking key, so keep the alphabet URL-safe.
 * @param {string} id
 * @returns {boolean}
 */
export function isValidSiteId(id) {
  return /^[a-z0-9][a-z0-9-]{1,47}$/.test(id);
}

/**
 * Accepts "https://www.Example.com/path?x=1" and returns "www.example.com".
 * Returns null if the result does not look like a valid hostname.
 * "localhost" (optionally with a port) is allowed for local testing.
 *
 * @param {string} input
 * @returns {string | null}
 */
export function normalizeDomain(input) {
  // Host is everything before the first path/query/fragment separator.
  const segment = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split(/[/?#]/)[0];
  if (!segment) return null;

  // Strip any credentials ("user:pass@host") and the trailing dot of an FQDN.
  const host = segment.replace(/^[^@]*@/, '').replace(/\.$/, '');
  if (!host) return null;

  const valid = /^(localhost|([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(:\d{1,5})?$/.test(host);
  return valid ? host : null;
}

/**
 * Strip the port so "example.com:3000" and "example.com" share a rule set.
 * @param {string} domain
 * @returns {string}
 */
export function domainHost(domain) {
  return domain.split(':')[0] ?? domain;
}

/**
 * Does `hostname` fall under `rule`? Matches the domain itself and any
 * subdomain, which is what people expect when they enter "example.com" and then
 * track "blog.example.com".
 *
 * Ports are stripped from both sides, so an Origin of "example.com:3000"
 * matches a rule of "example.com".
 *
 * @param {string} hostname
 * @param {string} rule
 * @returns {boolean}
 */
export function hostMatchesRule(hostname, rule) {
  const host = domainHost(hostname.trim().toLowerCase()).replace(/\.$/, '');
  const base = domainHost(rule.trim().toLowerCase()).replace(/\.$/, '');
  if (!host || !base) return false;
  return host === base || host.endsWith(`.${base}`);
}

/**
 * True when `path` starts with any excluded prefix (case-insensitive).
 * @param {string} path
 * @param {readonly string[]} excludedPrefixes
 * @returns {boolean}
 */
export function isExcludedPath(path, excludedPrefixes) {
  if (excludedPrefixes.length === 0) return false;
  const target = path.toLowerCase();
  return excludedPrefixes.some((raw) => {
    const prefix = raw.trim().toLowerCase();
    return prefix.length > 0 && target.startsWith(prefix);
  });
}

/**
 * Parse a user-entered list of domains (comma, space or newline separated) into
 * normalised hostnames, discarding anything that is not a valid host.
 *
 * @param {string} input
 * @returns {string[]}
 */
export function parseDomainList(input) {
  return input
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => normalizeDomain(part) ?? part.toLowerCase())
    .filter((part, index, all) => all.indexOf(part) === index);
}
