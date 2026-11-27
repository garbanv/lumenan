import { isUniqueViolation, query } from './db';
import { MAX_GOALS_PER_SITE } from './goals.mjs';
import type { Goal } from './types';

export { MAX_GOALS_PER_SITE, validateGoalInput, goalResultsSql } from './goals.mjs';

interface GoalRow {
  id: string;
  name: string;
  type: 'event' | 'page';
  value: string;
  created_at: Date;
}

export function toGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    value: row.value,
    createdAt: row.created_at.toISOString(),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Callers must already have established that the site belongs to the user. */
export async function listGoals(siteId: string): Promise<Goal[]> {
  const { rows } = await query<GoalRow>(
    `SELECT id, name, type, value, created_at FROM goals
      WHERE site_id = $1 ORDER BY created_at ASC`,
    [siteId]
  );
  return rows.map(toGoal);
}

export type CreateGoalResult =
  | { ok: true; goal: Goal }
  | { ok: false; reason: 'limit' | 'duplicate' };

export async function createGoal(
  siteId: string,
  input: { type: 'event' | 'page'; value: string; name: string }
): Promise<CreateGoalResult> {
  const { rows: counted } = await query<{ n: number }>(
    'SELECT count(*)::int AS n FROM goals WHERE site_id = $1',
    [siteId]
  );
  if ((counted[0]?.n ?? 0) >= MAX_GOALS_PER_SITE) return { ok: false, reason: 'limit' };

  try {
    const { rows } = await query<GoalRow>(
      `INSERT INTO goals (site_id, name, type, value) VALUES ($1, $2, $3, $4)
       RETURNING id, name, type, value, created_at`,
      [siteId, input.name, input.type, input.value]
    );
    const row = rows[0];
    if (!row) throw new Error('INSERT ... RETURNING produced no row');
    return { ok: true, goal: toGoal(row) };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: 'duplicate' };
    throw err;
  }
}

/** Scoped by site, so a goal id from another site deletes nothing. */
export async function deleteGoal(siteId: string, goalId: string): Promise<boolean> {
  if (!UUID.test(goalId)) return false;
  const { rowCount } = await query('DELETE FROM goals WHERE id = $1 AND site_id = $2', [
    goalId,
    siteId,
  ]);
  return (rowCount ?? 0) > 0;
}

/** Custom event names seen recently, to suggest when creating an event goal. */
export async function listRecentEventNames(siteId: string): Promise<string[]> {
  const { rows } = await query<{ name: string }>(
    `SELECT event_name AS name FROM events
      WHERE site_id = $1 AND event_type = 'custom' AND event_name IS NOT NULL
        AND created_at > now() - interval '90 days'
      GROUP BY event_name ORDER BY count(*) DESC LIMIT 50`,
    [siteId]
  );
  return rows.map((row) => row.name);
}
