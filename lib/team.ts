import { isUniqueViolation, query, transaction } from './db';
import {
  INVITE_TTL_DAYS,
  MAX_MEMBERS,
  MAX_PENDING_INVITES,
  emailAllowed,
  generateInviteToken,
  hashInviteToken,
  inviteStatus,
  isInviteToken,
} from './team.mjs';
import type { TeamInvite, TeamMember } from './types';

export { INVITE_TTL_DAYS, MAX_MEMBERS, MAX_PENDING_INVITES, validateInviteInput } from './team.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// All functions here assume the caller has already established, with
// getSiteForUser + can(role, 'team'), that the signed-in user owns the site.
// They are still scoped by site id, so an id from another site changes nothing.

export async function listMembers(siteId: string): Promise<TeamMember[]> {
  const { rows } = await query<{
    user_id: string;
    email: string;
    name: string | null;
    role: 'manager' | 'viewer';
    created_at: Date;
  }>(
    `SELECT m.user_id, u.email, u.name, m.role, m.created_at
       FROM site_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.site_id = $1
      ORDER BY m.created_at ASC`,
    [siteId]
  );
  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    joinedAt: row.created_at.toISOString(),
  }));
}

/** Invitations that can still be used. */
export async function listPendingInvites(siteId: string): Promise<TeamInvite[]> {
  const { rows } = await query<{
    id: string;
    role: 'manager' | 'viewer';
    email: string | null;
    created_at: Date;
    expires_at: Date;
  }>(
    `SELECT id, role, email, created_at, expires_at
       FROM site_invites
      WHERE site_id = $1 AND accepted_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC`,
    [siteId]
  );
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    email: row.email,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  }));
}

export type CreateInviteResult =
  | { ok: true; invite: TeamInvite; token: string }
  | { ok: false; reason: 'too_many_invites' | 'too_many_members' };

/** The raw token is returned once, here, and never stored. */
export async function createInvite(
  siteId: string,
  createdBy: string,
  input: { role: 'manager' | 'viewer'; email: string | null }
): Promise<CreateInviteResult> {
  const { rows: counts } = await query<{ members: number; invites: number }>(
    `SELECT (SELECT count(*) FROM site_members WHERE site_id = $1)::int AS members,
            (SELECT count(*) FROM site_invites
              WHERE site_id = $1 AND accepted_at IS NULL AND expires_at > now())::int AS invites`,
    [siteId]
  );
  const { members = 0, invites = 0 } = counts[0] ?? {};
  if (invites >= MAX_PENDING_INVITES) return { ok: false, reason: 'too_many_invites' };
  if (members + invites >= MAX_MEMBERS) return { ok: false, reason: 'too_many_members' };

  const token = generateInviteToken();
  const { rows } = await query<{ id: string; created_at: Date; expires_at: Date }>(
    `INSERT INTO site_invites (site_id, token_hash, role, email, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6::int))
     RETURNING id, created_at, expires_at`,
    [siteId, hashInviteToken(token), input.role, input.email, createdBy, INVITE_TTL_DAYS]
  );
  const row = rows[0];
  if (!row) throw new Error('INSERT ... RETURNING produced no row');

  return {
    ok: true,
    token,
    invite: {
      id: row.id,
      role: input.role,
      email: input.email,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    },
  };
}

export async function revokeInvite(siteId: string, inviteId: string): Promise<boolean> {
  if (!UUID.test(inviteId)) return false;
  const { rowCount } = await query(
    'DELETE FROM site_invites WHERE id = $1 AND site_id = $2 AND accepted_at IS NULL',
    [inviteId, siteId]
  );
  return (rowCount ?? 0) > 0;
}

export async function setMemberRole(
  siteId: string,
  userId: string,
  role: 'manager' | 'viewer'
): Promise<boolean> {
  if (!UUID.test(userId)) return false;
  const { rowCount } = await query(
    'UPDATE site_members SET role = $3 WHERE site_id = $1 AND user_id = $2',
    [siteId, userId, role]
  );
  return (rowCount ?? 0) > 0;
}

export async function removeMember(siteId: string, userId: string): Promise<boolean> {
  if (!UUID.test(userId)) return false;
  const { rowCount } = await query('DELETE FROM site_members WHERE site_id = $1 AND user_id = $2', [
    siteId,
    userId,
  ]);
  return (rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Using an invitation
// ---------------------------------------------------------------------------

export interface InviteDetails {
  id: string;
  siteId: string;
  siteName: string;
  siteDomain: string;
  role: 'manager' | 'viewer';
  /** Set when the link only works for one address. */
  email: string | null;
  status: 'pending' | 'expired' | 'accepted';
}

/** Look an invitation up by the token in its link; malformed tokens never reach the database. */
export async function getInviteByToken(token: string): Promise<InviteDetails | null> {
  if (!isInviteToken(token)) return null;
  const { rows } = await query<{
    id: string;
    site_id: string;
    name: string;
    domain: string;
    role: 'manager' | 'viewer';
    email: string | null;
    expires_at: Date;
    accepted_at: Date | null;
  }>(
    `SELECT i.id, i.site_id, s.name, s.domain, i.role, i.email, i.expires_at, i.accepted_at
       FROM site_invites i
       JOIN sites s ON s.id = i.site_id
      WHERE i.token_hash = $1`,
    [hashInviteToken(token)]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    siteId: row.site_id,
    siteName: row.name,
    siteDomain: row.domain,
    role: row.role,
    email: row.email,
    status: inviteStatus({ expiresAt: row.expires_at, acceptedAt: row.accepted_at }),
  };
}

export type AcceptResult =
  | { ok: true; siteId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'used' | 'email_mismatch' | 'owner' };

/**
 * Turn an invitation into membership for `user`. One transaction, with the
 * invitation row locked, so two people opening the same link at the same moment
 * cannot both use it.
 */
export async function acceptInvite(
  token: string,
  user: { id: string; email: string }
): Promise<AcceptResult> {
  if (!isInviteToken(token)) return { ok: false, reason: 'invalid' };

  try {
    return await transaction<AcceptResult>(async (client) => {
      const { rows } = await client.query<{
        id: string;
        site_id: string;
        owner_id: string;
        role: 'manager' | 'viewer';
        email: string | null;
        expires_at: Date;
        accepted_at: Date | null;
      }>(
        `SELECT i.id, i.site_id, s.user_id AS owner_id, i.role, i.email, i.expires_at, i.accepted_at
           FROM site_invites i
           JOIN sites s ON s.id = i.site_id
          WHERE i.token_hash = $1
            FOR UPDATE OF i`,
        [hashInviteToken(token)]
      );
      const invite = rows[0];
      if (!invite) return { ok: false, reason: 'invalid' };

      const status = inviteStatus({ expiresAt: invite.expires_at, acceptedAt: invite.accepted_at });
      if (status === 'accepted') return { ok: false, reason: 'used' };
      if (status === 'expired') return { ok: false, reason: 'expired' };
      if (!emailAllowed(invite.email, user.email)) return { ok: false, reason: 'email_mismatch' };
      // Owning a site already grants everything an invitation could.
      if (invite.owner_id === user.id) return { ok: false, reason: 'owner' };

      // Someone who is already a member keeps the higher of the two roles
      // rather than being demoted by a second, lesser invitation.
      await client.query(
        `INSERT INTO site_members (site_id, user_id, role, invited_by)
         SELECT $1, $2, $3, created_by FROM site_invites WHERE id = $4
         ON CONFLICT (site_id, user_id) DO UPDATE
           SET role = CASE WHEN site_members.role = 'manager' OR EXCLUDED.role = 'manager'
                           THEN 'manager' ELSE 'viewer' END`,
        [invite.site_id, user.id, invite.role, invite.id]
      );
      await client.query(
        'UPDATE site_invites SET accepted_at = now(), accepted_by = $2 WHERE id = $1',
        [invite.id, user.id]
      );
      return { ok: true, siteId: invite.site_id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: 'used' };
    throw err;
  }
}

export const ACCEPT_MESSAGES: Record<Exclude<AcceptResult, { ok: true }>['reason'], string> = {
  invalid: 'This invitation link is not valid.',
  expired: 'This invitation has expired. Ask the site owner for a new one.',
  used: 'This invitation has already been used.',
  email_mismatch: 'This invitation was created for a different email address.',
  owner: 'You already own this site.',
};
