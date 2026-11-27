/**
 * Typed re-export of ./filters.mjs (same pattern as lib/ingest.ts): the logic
 * stays in a plain .mjs file so `node --test` can load it without a loader.
 */
export {
  FILTER_KEYS,
  FILTER_LABELS,
  parseFilters,
  hasFilters,
  filtersKey,
  buildFilterClause,
} from './filters.mjs';
export type FilterKey = 'page' | 'referrer' | 'country' | 'device' | 'browser' | 'os';
export type Filters = Partial<Record<FilterKey, string>>;
