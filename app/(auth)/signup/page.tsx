import type { Metadata } from 'next';
import Link from 'next/link';
import { redirectIfSignedIn } from '@/lib/auth';
import { signupsOpen } from '@/lib/env';
import { getInviteByToken } from '@/lib/team';
import { SignupForm } from './signup-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Create your account',
  robots: { index: false, follow: false },
  // An invitation token may be in the URL; do not pass it on in Referer headers.
  referrer: 'no-referrer',
};

export default async function SignupPage(props: {
  searchParams: Promise<{ invite?: string | string[] }>;
}) {
  const searchParams = await props.searchParams;
  const token = typeof searchParams.invite === 'string' ? searchParams.invite : '';

  const invite = token ? await getInviteByToken(token) : null;
  const usable = invite && invite.status === 'pending' ? invite : null;

  // Someone already signed in joins through the invitation page instead.
  await redirectIfSignedIn(usable ? `/invite/${token}` : '/sites');

  if (!signupsOpen() && !usable) {
    return (
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Signups are closed</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {invite
            ? 'This invitation can no longer be used. Ask the site owner for a new one.'
            : 'This deployment is not accepting new accounts. If you already have one, sign in.'}
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <SignupForm
      invite={
        usable
          ? { token, siteName: usable.siteName, role: usable.role, email: usable.email }
          : undefined
      }
    />
  );
}
