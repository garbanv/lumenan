import { NextResponse } from 'next/server';
import { isCrossOrigin, jsonError, readJson } from '@/lib/api';
import { startSession, userAgentOf } from '@/lib/auth-routes';
import { createUser, isValidEmail } from '@/lib/users';
import { validatePassword } from '@/lib/password';
import { query } from '@/lib/db';
import { signupsOpen } from '@/lib/env';
import { ACCEPT_MESSAGES, acceptInvite, getInviteByToken } from '@/lib/team';
import { emailAllowed } from '@/lib/team.mjs';

export const runtime = 'nodejs';

interface SignupBody {
  email?: string;
  password?: string;
  name?: string;
  /** From an invitation link: lets this person join even when signups are closed. */
  inviteToken?: string;
}

export async function POST(req: Request) {
  if (isCrossOrigin(req)) return jsonError('Cross-origin request rejected.', 403);

  const { data, error } = await readJson<SignupBody>(req);
  if (error) return error;

  // A usable invitation is the one thing that opens a closed deployment, and
  // only for the person it is meant for. With signups open, an unusable token
  // is simply ignored and this is an ordinary signup.
  const invite =
    typeof data?.inviteToken === 'string' ? await getInviteByToken(data.inviteToken) : null;
  const usableInvite = invite && invite.status === 'pending' ? invite : null;

  // Checked before any account is touched.
  if (!signupsOpen() && !usableInvite) {
    return jsonError('Signups are closed on this deployment.', 403);
  }

  const email = (data?.email ?? '').trim();
  const password = data?.password ?? '';
  const name = (data?.name ?? '').trim() || null;

  // Collect every problem at once so the form can show them together rather
  // than making the user fix one field, resubmit, and discover the next.
  const fields: Record<string, string> = {};
  if (!email) fields.email = 'Email is required.';
  else if (!isValidEmail(email)) fields.email = 'Enter a valid email address.';

  const passwordProblem = validatePassword(password);
  if (!password) fields.password = 'Password is required.';
  else if (passwordProblem) fields.password = passwordProblem.message;

  if (usableInvite && !fields.email && !emailAllowed(usableInvite.email, email)) {
    fields.email = ACCEPT_MESSAGES.email_mismatch;
  }

  if (Object.keys(fields).length > 0) {
    return jsonError('Please fix the highlighted fields.', 400, fields);
  }

  try {
    const result = await createUser(email, password, name);
    if (!result.ok) {
      return jsonError('An account with that email already exists.', 409, {
        email: 'This email is already registered.',
      });
    }

    // Join the site before the first page load, so they land on it.
    let siteId: string | undefined;
    if (usableInvite && typeof data?.inviteToken === 'string') {
      const accepted = await acceptInvite(data.inviteToken, result.user);
      if (accepted.ok) {
        siteId = accepted.siteId;
      } else if (!signupsOpen()) {
        // The invitation was used by someone else in the moment between the
        // check above and now. On a closed deployment this account exists only
        // because of that invitation, so it must not outlive it.
        await query('DELETE FROM users WHERE id = $1', [result.user.id]);
        return jsonError(ACCEPT_MESSAGES[accepted.reason], 409);
      }
    }

    return await startSession(result.user.id, userAgentOf(req), siteId ? { siteId } : {});
  } catch (err) {
    console.error('Signup failed:', err);
    return jsonError('Could not create your account. Please try again.', 500);
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
