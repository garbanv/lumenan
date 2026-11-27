import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirectIfSignedIn } from '@/lib/auth';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  // Someone already signed in has no reason to see this page.
  await redirectIfSignedIn();

  return (
    <Suspense fallback={<div className="h-64 w-full max-w-sm" aria-hidden="true" />}>
      <LoginForm />
    </Suspense>
  );
}
