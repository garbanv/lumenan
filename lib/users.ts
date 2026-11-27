import { isUniqueViolation, query } from './db';
import { burnPasswordTime, hashPassword, verifyPassword } from './password';
import type { SubscriptionStatus, User } from './types';

/** Valid billing states; the database column is free-form text. */
export const SUBSCRIPTION_STATUSES = [
  'none',
  'active',
  'past_due',
  'canceled',
  'paused',
] as const;

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  is_admin: boolean;
  subscription_status: string;
  created_at: Date;
}

/** Narrow a free-form column to the union the UI switches on. */
export function normalizeStatus(value: string): SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
    ? (value as SubscriptionStatus)
    : 'none';
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    plan: row.plan === 'pro' ? 'pro' : 'free',
    isAdmin: row.is_admin,
    subscriptionStatus: normalizeStatus(row.subscription_status),
    createdAt: row.created_at.toISOString(),
  };
}

/** Emails are case-insensitive for lookup but stored with original casing. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Deliberately permissive. The only authoritative test of an address is sending
// mail to it; over-strict regexes reject valid addresses and help nobody.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

export type CreateUserResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'email_taken' };

export async function createUser(
  email: string,
  password: string,
  name: string | null
): Promise<CreateUserResult> {
  const normalized = normalizeEmail(email);
  const passwordHash = await hashPassword(password);

  try {
    const { rows } = await query<UserRow>(
      `INSERT INTO users (email, email_key, password_hash, name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, plan, is_admin, subscription_status, created_at`,
      [email.trim(), normalized, passwordHash, name?.trim() || null]
    );
    const row = rows[0];
    if (!row) throw new Error('INSERT ... RETURNING produced no row');
    return { ok: true, user: toUser(row) };
  } catch (err) {
    // The unique index on email_key is the source of truth for uniqueness, so
    // two simultaneous signups cannot both win.
    if (isUniqueViolation(err)) return { ok: false, reason: 'email_taken' };
    throw err;
  }
}

export interface AuthenticateResult {
  user: User | null;
  reason?: 'no_user' | 'bad_password';
}

export async function authenticate(
  email: string,
  password: string
): Promise<AuthenticateResult> {
  const { rows } = await query<UserRow & { password_hash: string }>(
    `SELECT id, email, name, plan, is_admin, subscription_status, created_at, password_hash
       FROM users
      WHERE email_key = $1`,
    [normalizeEmail(email)]
  );

  const row = rows[0];
  if (!row) {
    // Spend comparable time so response latency does not reveal whether the
    // address is registered.
    await burnPasswordTime(password);
    return { user: null, reason: 'no_user' };
  }

  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) return { user: null, reason: 'bad_password' };

  return { user: toUser(row) };
}

export async function findUserById(id: string): Promise<User | null> {
  const { rows } = await query<UserRow>(
    'SELECT id, email, name, plan, is_admin, subscription_status, created_at FROM users WHERE id = $1',
    [id]
  );
  const row = rows[0];
  return row ? toUser(row) : null;
}

export async function updateUserProfile(
  userId: string,
  fields: { name?: string | null }
): Promise<User | null> {
  const { rows } = await query<UserRow>(
    `UPDATE users
        SET name = COALESCE($2, name),
            updated_at = now()
      WHERE id = $1
      RETURNING id, email, name, plan, is_admin, subscription_status, created_at`,
    [userId, fields.name ?? null]
  );
  const row = rows[0];
  return row ? toUser(row) : null;
}

/** Returns null when the current password is wrong, so callers can 400. */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<boolean> {
  const { rows } = await query<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE id = $1',
    [userId]
  );
  const row = rows[0];
  if (!row) return false;
  if (!(await verifyPassword(currentPassword, row.password_hash))) return false;

  const hash = await hashPassword(newPassword);
  await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
    userId,
    hash,
  ]);
  return true;
}
