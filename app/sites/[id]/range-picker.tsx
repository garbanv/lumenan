'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Select } from '@/components/ui/select';
import { RANGES, RANGE_ORDER, resolveRange } from '@/lib/ranges';
import { cn } from '@/lib/utils';

/**
 * Range picker that drives the URL.
 *
 * Keeping the selection in the query string means the dashboard stays
 * server-rendered, the choice survives a refresh and can be shared, and the
 * browser back button behaves as expected.
 *
 * `useTransition` keeps the current numbers on screen (dimmed) while the next
 * range loads, instead of replacing them with a skeleton.
 */
export function RangePicker({ className }: { className?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const current = resolveRange(searchParams.get('range')).key;

  function select(range: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('range', range);
    startTransition(() => {
      router.replace(`?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <>
      {/* Segmented control on wider screens, where all four options fit. */}
      <div
        role="group"
        aria-label="Date range"
        className={cn(
          'hidden items-center gap-1 rounded-lg border border-border bg-card p-0.5 sm:inline-flex',
          pending && 'opacity-60',
          className
        )}
      >
        {RANGE_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => select(key)}
            aria-pressed={current === key}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              current === key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}
          >
            {RANGES[key].short}
          </button>
        ))}
      </div>

      {/* Native select on small screens so the control never wraps. */}
      <div className="sm:hidden">
        <Select
          value={current}
          onChange={(event) => select(event.target.value)}
          aria-label="Date range"
        >
          {RANGE_ORDER.map((key) => (
            <option key={key} value={key}>
              {RANGES[key].label}
            </option>
          ))}
        </Select>
      </div>
    </>
  );
}
