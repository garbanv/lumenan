'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function AcceptInvite({ token, signedInAs }: { token: string; signedInAs: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = (await response.json().catch(() => ({}))) as { siteId?: string; error?: string };
      if (!response.ok || !body.siteId) {
        setError(body.error ?? 'Could not accept the invitation.');
        return;
      }
      router.push(`/sites/${encodeURIComponent(body.siteId)}`);
      router.refresh();
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <p>Signed in as {signedInAs}.</p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Button type="button" onClick={accept} disabled={pending}>
        {pending ? 'Joining…' : 'Accept invitation'}
      </Button>
    </div>
  );
}
