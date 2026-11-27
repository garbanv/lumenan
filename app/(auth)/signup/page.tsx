import type { Metadata } from 'next';
import { redirectIfSignedIn } from '@/lib/auth';
import { SignupForm } from './signup-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Create your account',
  robots: { index: false, follow: false },
};

export default async function SignupPage() {
  await redirectIfSignedIn();
  return <SignupForm />;
}
