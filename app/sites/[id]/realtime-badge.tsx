'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const POLL_MS = 15_000;

/**
 * "N current visitors", refreshed every 15 seconds while the tab is visible.
 *
 * Polling pauses in a background tab and catches up the moment the tab is shown
 * again, so an abandoned dashboard costs the server nothing. A failed request
 * keeps the last known number rather than flashing an error: this is a
 * secondary indicator, not something worth interrupting the page for.
 */
export function RealtimeBadge({ endpoint: url }: { endpoint: string }) {
  const [state, setState] = useState<{ visitors: number; windowMinutes: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { visitors: number; windowMinutes: number };
          setState({ visitors: data.visitors, windowMinutes: data.windowMinutes });
        }
      } catch {
        /* keep the last value */
      }
      schedule();
    }

    function schedule() {
      if (cancelled) return;
      timer = setTimeout(() => {
        if (document.visibilityState === 'visible') void load();
        else schedule();
      }, POLL_MS);
    }

    function onVisible() {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer);
        void load();
      }
    }

    void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [url]);

  // Reserve the space before the first answer so the header does not jump.
  if (!state) return <span className="inline-block h-5 w-36" aria-hidden="true" />;

  const active = state.visitors > 0;
  return (
    <span
      className="inline-flex items-center gap-2 text-sm"
      title={`Visitors with activity in the last ${state.windowMinutes} minutes`}
      role="status"
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-2 w-2 rounded-full',
          active ? 'animate-pulse bg-success' : 'bg-muted-foreground/40'
        )}
      />
      <span className="tabular font-medium">{state.visitors}</span>
      <span className="text-muted-foreground">
        current {state.visitors === 1 ? 'visitor' : 'visitors'}
      </span>
    </span>
  );
}
