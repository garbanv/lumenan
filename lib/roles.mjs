// @ts-check
/**
 * Who may do what on a site.
 *
 * owner   created the site (sites.user_id); can do everything.
 * manager invited; can read everything and change the site's configuration
 *         (settings, goals, public link, tracking code), but cannot delete the
 *         site or manage who has access.
 * viewer  invited; can read the dashboard and nothing else.
 *
 * Routes check a capability, never a role name, so the rules live here only.
 */

/** @typedef {'owner' | 'manager' | 'viewer'} SiteRole */
/** @typedef {'view' | 'manage' | 'team' | 'delete'} Capability */

/** Roles an owner can hand out. */
export const MEMBER_ROLES = /** @type {const} */ (['manager', 'viewer']);

/** @type {Record<Capability, readonly SiteRole[]>} */
const CAPABILITIES = {
  view: ['owner', 'manager', 'viewer'],
  manage: ['owner', 'manager'],
  team: ['owner'],
  delete: ['owner'],
};

/**
 * @param {SiteRole | null | undefined} role
 * @param {Capability} capability
 */
export function can(role, capability) {
  return !!role && CAPABILITIES[capability].includes(role);
}

/**
 * The one query that decides whether a user may see a site, and as what.
 * $1 = site id, $2 = user id. No row means no access (the caller answers 404,
 * so a site's existence is not revealed to people who cannot see it).
 *
 * `columns` are table-qualified (`s.id, s.name, ...`) and come from code, never
 * from a request.
 *
 * @param {string} columns
 */
export function siteForUserSql(columns) {
  return `SELECT ${columns},
       CASE WHEN s.user_id = $2 THEN 'owner' ELSE m.role END AS role
  FROM sites s
  LEFT JOIN site_members m ON m.site_id = s.id AND m.user_id = $2
 WHERE s.id = $1
   AND (s.user_id = $2 OR m.user_id IS NOT NULL)`;
}
