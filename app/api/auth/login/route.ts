import { isCrossOrigin, jsonError, readJson } from '@/lib/api';
import { startSession, userAgentOf } from '@/lib/auth-routes';
import { authenticate } from '@/lib/users';

export const runtime = 'nodejs';

interface LoginBody {
  email?: string;
  password?: string;
}

export async function POST(req: Request) {
  if (isCrossOrigin(req)) return jsonError('Cross-origin request rejected.', 403);

  const { data, error } = await readJson<LoginBody>(req);
  if (error) return error;

  const email = (data?.email ?? '').trim();
  const password = data?.password ?? '';

  if (!email || !password) {
    return jsonError('Enter your email and password.', 400, {
      ...(email ? {} : { email: 'Email is required.' }),
      ...(password ? {} : { password: 'Password is required.' }),
    });
  }

  try {
    const { user } = await authenticate(email, password);
    if (!user) {
      // One message for both "no such account" and "wrong password", so the
      // response cannot be used to enumerate registered addresses.
      return jsonError('Incorrect email or password.', 401);
    }
    return await startSession(user.id, userAgentOf(req));
  } catch (err) {
    console.error('Login failed:', err);
    return jsonError('Could not sign you in. Please try again.', 500);
  }
}
