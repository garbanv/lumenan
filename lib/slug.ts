/**
 * Typed re-export of ./slug.mjs.
 *
 * The logic lives in the .mjs file so it can be unit-tested directly by
 * `node --test` with no loader. Application code keeps importing from
 * '@/lib/slug' and gets full types.
 */
export {
  slugify,
  isValidSiteId,
  normalizeDomain,
  domainHost,
  hostMatchesRule,
  isExcludedPath,
  parseDomainList,
} from './slug.mjs';
