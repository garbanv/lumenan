/**
 * Typed re-export of ./ingest.mjs.
 *
 * The logic lives in the .mjs file so it can be unit-tested directly by
 * `node --test` with no loader. Application code keeps importing from
 * '@/lib/ingest' and gets full types.
 */
export {
  visitorDay,
  hashVisitor,
  getClientIp,
  getCountry,
  parseUserAgent,
  clientMetadata,
  isLikelyBot,
  normalizePath,
  parseReferrer,
  shouldCountReferral,
  isAllowedOrigin,
} from './ingest.mjs';

export interface ClientMetadata {
  ip: string;
  country: string | null;
  device: string;
  browser: string;
  os: string;
}

export interface ParsedUserAgent {
  device: string;
  browser: string;
  os: string;
}
