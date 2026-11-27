'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ClaimAdminButton } from '@/components/claim-admin-button';

/**
 * Offers to make the signed-in account the platform operator.
 *
 * Renders nothing unless the server reports that no administrator exists yet,
 * so it is invisible on a deployment that is already set up. The offer itself is
 * enforced server-side, so this is purely a discoverability affordance: without
 * it the first operator would have to know to run SQL.
 */
export function ClaimAdminBanner() {
  const [state, setState] = useState<'checking' | 'available' | 'hidden'>('checking');

  useEffect(() => {
    let cancelled = false;

    fetch('/api/admin/claim')
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { needsFirstAdmin?: boolean; isAdmin?: boolean } | null) => {
        if (cancelled) return;
        // An existing admin does not need the prompt either.
        setState(body?.needsFirstAdmin && !body.isAdmin ? 'available' : 'hidden');
      })
      .catch(() => {
        if (!cancelled) setState('hidden');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state !== 'available') return null;

  return (
    <div className="rounded-xl border border-primary/30 bg-accent/40 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-accent-foreground"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-medium">This deployment has no administrator yet</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Claim it to see platform totals and manage every account. This is only offered while
              nobody holds the role.
            </p>
          </div>
        </div>
        <ClaimAdminButton />
      </div>
    </div>
  );
}
