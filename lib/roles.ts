/** Typed re-export of ./roles.mjs (see lib/ingest.ts for why). */
export { MEMBER_ROLES, can, siteForUserSql } from './roles.mjs';
export type SiteRole = 'owner' | 'manager' | 'viewer';
export type MemberRole = 'manager' | 'viewer';
export type Capability = 'view' | 'manage' | 'team' | 'delete';
