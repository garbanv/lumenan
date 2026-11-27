/**
 * Typed re-export of ./rate-limit.mjs.
 *
 * The logic lives in the .mjs file so it can be unit-tested directly by
 * `node --test` with no loader. Application code keeps importing from
 * '@/lib/rate-limit' and gets full types.
 */
export {
  rateLimit,
  resetRateLimits,
  INGEST_LIMIT_PER_MINUTE,
  LOGIN_LIMIT_PER_15_MIN,
  SHARE_LIMIT_PER_MINUTE,
} from './rate-limit.mjs';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets; suitable for a Retry-After header. */
  retryAfter: number;
}
