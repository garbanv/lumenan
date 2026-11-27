'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogOut } from 'lucide-react';

/**
 * Sign-out control. Posts to the API and then refreshes, so the server
 * components re-render without a session rather than showing a stale shell.
 */
export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className={className}
      aria-label="Sign out"
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">{pending ? 'Signing out…' : 'Sign out'}</span>
    </button>
  );
}
