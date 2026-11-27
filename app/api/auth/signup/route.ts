import { NextResponse } from 'next/server';
import { isCrossOrigin, jsonError, readJson } from '@/lib/api';
import { startSession, userAgentOf } from '@/lib/auth-routes';
import { createUser, isValidEmail } from '@/lib/users';
import { validatePassword } from '@/lib/password';

export const runtime = 'nodejs';

interface SignupBody {
  email?: string;
  password?: string;
  name?: string;
}

export async function POST(req: Request) {
  if (isCrossOrigin(req)) return jsonError('Cross-origin request rejected.', 403);

  const { data, error } = await readJson<SignupBody>(req);
  if (error) return error;

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
    return await startSession(result.user.id, userAgentOf(req));
  } catch (err) {
    console.error('Signup failed:', err);
    return jsonError('Could not create your account. Please try again.', 500);
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
