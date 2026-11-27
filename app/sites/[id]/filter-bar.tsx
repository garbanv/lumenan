'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { FILTER_KEYS, FILTER_LABELS, parseFilters } from '@/lib/filters';

/**
 * Removable chips for the active dashboard filters.
 *
 * Filters live in the query string, so each chip is a plain link to the same
 * URL without that one key: no client state to keep in sync, and the browser
 * back button steps through filter changes.
 */
export function FilterBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = parseFilters(searchParams);
  const active = FILTER_KEYS.filter((key) => filters[key] !== undefined);

  if (active.length === 0) return null;

  const without = (keys: readonly string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of keys) params.delete(key);
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Active filters" role="group">
      {active.map((key) => (
        <Link
          key={key}
          href={without([key])}
          scroll={false}
          className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-3 pr-2 text-xs transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Remove filter ${FILTER_LABELS[key]}: ${filters[key]}`}
        >
          <span className="text-muted-foreground">{FILTER_LABELS[key]}</span>
          <span className="truncate font-medium">{filters[key]}</span>
          <X className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
        </Link>
      ))}
      {active.length > 1 && (
        <Link
          href={without(active)}
          scroll={false}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Clear all
        </Link>
      )}
    </div>
  );
}
