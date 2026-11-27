'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Claims the first-operator role.
 *
 * Safe to render unconditionally: the server only honours the request while no
 * administrator exists at all (see claimFirstAdmin, which checks that condition
 * in the same statement as the update). A losing race or an already-claimed
 * deployment comes back as 409 and is reported plainly.
 */
export function ClaimAdminButton({ label = 'Make me an admin' }: { label?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/claim', { method: 'POST' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Could not claim administrator access.');
        // Re-render so the page switches from "claimable" to "ask an admin".
        router.refresh();
        return;
      }
      router.push('/admin');
      router.refresh();
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={claim} disabled={pending}>
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        {pending ? 'Claiming…' : label}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
