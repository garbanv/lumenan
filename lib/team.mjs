// @ts-check
/**
 * Team invitations: tokens, validation and status. Database access is in
 * lib/team.ts; everything here is pure so it can be unit-tested.
 *
 * An invitation is a bearer link, `/invite/<token>`. Only a SHA-256 of the token
 * is stored, so a database leak does not yield usable links; the owner sees the
 * link once, when it is created. A token is 256 random bits, so it cannot be
 * guessed.
 */
import { createHash, randomBytes } from 'node:crypto';
import { MEMBER_ROLES } from './roles.mjs';

export const INVITE_TTL_DAYS = 7;
export const MAX_PENDING_INVITES = 20;
export const MAX_MEMBERS = 25;

export function generateInviteToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isInviteToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** @param {string} token */
export function hashInviteToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/** @param {string} email */
export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * @param {{ role?: unknown, email?: unknown }} input
 * @returns {{ ok: true, role: 'manager' | 'viewer', email: string | null }
 *   | { ok: false, fields: Record<string, string> }}
 */
export function validateInviteInput(input) {
  /** @type {Record<string, string>} */
  const fields = {};

  const role = MEMBER_ROLES.find((r) => r === input.role);
  if (!role) fields.role = 'Choose Manager or Viewer.';

  let email = null;
  if (typeof input.email === 'string' && input.email.trim() !== '') {
    const normalized = normalizeEmail(input.email);
    if (normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
      fields.email = 'Enter a valid email address, or leave it empty.';
    } else {
      email = normalized;
    }
  }

  if (Object.keys(fields).length > 0 || !role) return { ok: false, fields };
  return { ok: true, role, email };
}

/**
 * @param {{ expiresAt: Date | string, acceptedAt: Date | string | null }} invite
 * @param {Date} [now]
 * @returns {'pending' | 'expired' | 'accepted'}
 */
export function inviteStatus(invite, now = new Date()) {
  if (invite.acceptedAt) return 'accepted';
  return new Date(invite.expiresAt).getTime() <= now.getTime() ? 'expired' : 'pending';
}

/**
 * An invitation locked to an address can only be used by that address.
 *
 * @param {string | null | undefined} inviteEmail
 * @param {string} userEmail
 */
export function emailAllowed(inviteEmail, userEmail) {
  return !inviteEmail || normalizeEmail(inviteEmail) === normalizeEmail(userEmail);
}
