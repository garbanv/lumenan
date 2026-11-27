import { NextResponse } from 'next/server';
import { isCrossOrigin, jsonError, readJson } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import { changePassword, updateUserProfile } from '@/lib/users';
import { validatePassword } from '@/lib/password';
import {
  SESSION_COOKIE_NAME,
  createSession,
  destroyAllSessionsForUser,
  sessionCookieOptions,
} from '@/lib/session';

export const runtime = 'nodejs';

interface ProfileBody {
  name?: string;
}

export async function PATCH(req: Request) {
  if (isCrossOrigin(req)) return jsonError('Cross-origin request rejected.', 403);

  const user = await getCurrentUser();
  if (!user) return jsonError('Not signed in.', 401);

  const { data, error } = await readJson<ProfileBody>(req);
  if (error) return error;

  try {
    const updated = await updateUserProfile(user.id, {
      name: (data?.name ?? '').trim().slice(0, 120) || null,
    });
    if (!updated) return jsonError('Account not found.', 404);
    return NextResponse.json({ user: updated });
  } catch (err) {
    console.error('Failed to update profile:', err);
    return jsonError('Could not save your profile.', 500);
  }
}

interface PasswordBody {
  currentPassword?: string;
  newPassword?: string;
}

/**
 * Password change lives on the same route because both operations share the
 * "am I really this user" check.
 */
export async function PUT(req: Request) {
  if (isCrossOrigin(req)) return jsonError('Cross-origin request rejected.', 403);

  const user = await getCurrentUser();
  if (!user) return jsonError('Not signed in.', 401);

  const { data, error } = await readJson<PasswordBody>(req);
  if (error) return error;

  const currentPassword = data?.currentPassword ?? '';
  const newPassword = data?.newPassword ?? '';

  const fields: Record<string, string> = {};
  if (!currentPassword) fields.currentPassword = 'Enter your current password.';

  const problem = validatePassword(newPassword);
  if (!newPassword) fields.newPassword = 'Enter a new password.';
  else if (problem) fields.newPassword = problem.message;
  else if (newPassword === currentPassword) {
    fields.newPassword = 'Choose a password different from your current one.';
  }

  if (Object.keys(fields).length > 0) {
    return jsonError('Please fix the highlighted fields.', 400, fields);
  }

  try {
    const ok = await changePassword(user.id, currentPassword, newPassword);
    if (!ok) {
      return jsonError('Your current password is incorrect.', 400, {
        currentPassword: 'Incorrect password.',
      });
    }

    // Revoke every session — if the password was changed because it leaked, an
    // attacker's existing sessions must stop working — then issue a fresh one
    // for this device so the user is not signed out of the tab they are using.
    await destroyAllSessionsForUser(user.id);
    const { token, expiresAt } = await createSession(user.id, req.headers.get('user-agent'));

    const response = NextResponse.json({ ok: true, otherSessionsRevoked: true });
    response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(expiresAt));
    return response;
  } catch (err) {
    console.error('Failed to change password:', err);
    return jsonError('Could not change your password.', 500);
  }
}
