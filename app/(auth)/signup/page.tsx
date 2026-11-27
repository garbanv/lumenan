import type { Metadata } from 'next';
import Link from 'next/link';
import { redirectIfSignedIn } from '@/lib/auth';
import { signupsOpen } from '@/lib/env';
import { SignupForm } from './signup-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Create your account',
  robots: { index: false, follow: false },
};

export default async function SignupPage() {
  await redirectIfSignedIn();

  if (!signupsOpen()) {
    return (
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Signups are closed</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This deployment is not accepting new accounts. If you already have one, sign in.
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

  return <SignupForm />;
}
