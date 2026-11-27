// @ts-check
/**
 * Conversion goals: validation of what the owner types, and the one SQL query
 * that turns goals plus events into conversion numbers.
 *
 * Kept as plain .mjs so `node --test` and db/verify-schema.mjs can use it
 * without a loader; lib/goals.ts adds the types and the database access.
 */
import { normalizePath } from './ingest.mjs';

/** @typedef {'event' | 'page'} GoalType */

export const GOAL_TYPES = /** @type {const} */ (['event', 'page']);
export const MAX_GOALS_PER_SITE = 20;

const MAX_NAME = 60;
const MAX_EVENT_NAME = 128;
const MAX_PAGE = 512;

/**
 * @param {{ type?: unknown, value?: unknown, name?: unknown }} input
 * @returns {{ ok: true, goal: { type: GoalType, value: string, name: string } }
 *   | { ok: false, fields: Record<string, string> }}
 */
export function validateGoalInput(input) {
  /** @type {Record<string, string>} */
  const fields = {};

  const type = GOAL_TYPES.find((t) => t === input.type);
  if (!type) fields.type = 'Choose a custom event or a page.';

  const rawValue = typeof input.value === 'string' ? input.value.trim() : '';
  let value = '';

  if (type === 'event') {
    if (!rawValue) fields.value = 'Enter the event name, for example signup_completed.';
    else if (rawValue.length > MAX_EVENT_NAME) fields.value = `Keep it under ${MAX_EVENT_NAME} characters.`;
    else if (/[\u0000-\u001f]/.test(rawValue)) fields.value = 'Remove control characters.';
    else value = rawValue;
  } else if (type === 'page') {
    if (!rawValue) {
      fields.value = 'Enter a path, for example /thank-you or /blog/*.';
    } else {
      // Same normalisation the tracker's paths get: no query string or hash.
      // A trailing * (prefix match) must survive it.
      const prefix = rawValue.split(/[?#]/, 1)[0]?.trim().endsWith('*') ?? false;
      const path = normalizePath(rawValue.replace(/\*+$/, ''));
      value = prefix ? `${path === '/' ? '/' : path}*` : path;
      if (value.length > MAX_PAGE) {
        fields.value = `Keep it under ${MAX_PAGE} characters.`;
        value = '';
      }
    }
  }

  const rawName = typeof input.name === 'string' ? input.name.trim() : '';
  if (rawName.length > MAX_NAME) fields.name = `Keep it under ${MAX_NAME} characters.`;

  if (Object.keys(fields).length > 0 || !type) return { ok: false, fields };
  return { ok: true, goal: { type, value, name: rawName || value } };
}

/**
 * Conversions per goal for one site and window. $1 = site id, $2 = window
 * interval; dashboard filters, when present, are appended as bound parameters
 * from $3 by the caller (aliased `e.`), so a goal can be read for "visitors
 * from Germany" the same way every other number on the page can.
 *
 * A page goal ending in * matches by prefix, compared with left()/length() so
 * that no LIKE wildcard in a user-supplied path can change its meaning.
 *
 * @param {string} filterSql the " AND ..." fragment from lib/filters.mjs
 */
export function goalResultsSql(filterSql) {
  return `SELECT g.id, g.name, g.type, g.value, g.created_at,
       count(e.id)::int                      AS conversions,
       count(DISTINCT e.visitor_hash)::int   AS visitors
  FROM goals g
  LEFT JOIN events e
    ON e.site_id = g.site_id
   AND e.created_at > now() - $2::interval
   AND (
        (g.type = 'event' AND e.event_type = 'custom' AND e.event_name = g.value)
     OR (g.type = 'page'  AND e.event_type = 'pageview' AND (
            e.path = g.value
         OR (right(g.value, 1) = '*'
             AND left(e.path, length(g.value) - 1) = left(g.value, length(g.value) - 1))
        ))
   )${filterSql}
 WHERE g.site_id = $1
 GROUP BY g.id
 ORDER BY conversions DESC, g.created_at ASC`;
}
