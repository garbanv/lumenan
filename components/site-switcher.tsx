'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChevronsUpDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface SiteOption {
  id: string;
  name: string;
  domain: string;
}

interface SiteSwitcherProps {
  sites: SiteOption[];
  currentSiteId: string;
}

/**
 * Dropdown for moving between sites without returning to the list.
 *
 * Rendered from server-fetched props so it is present on first paint, and the
 * popover is a native <details>-free custom menu with Escape handling.
 */
export function SiteSwitcher({ sites, currentSiteId }: SiteSwitcherProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const current = sites.find((site) => site.id === currentSiteId);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-border',
          'bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-secondary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        )}
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{current?.name ?? currentSiteId}</span>
          {current && (
            <span className="block truncate text-2xs text-muted-foreground">{current.domain}</span>
          )}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>

      {open && (
        <>
          {/* Click-away layer. Rendered behind the menu so any outside click closes it. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="listbox"
            aria-label="Switch site"
            className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
            }}
          >
            {sites.map((site) => (
              <button
                key={site.id}
                type="button"
                role="option"
                aria-selected={site.id === currentSiteId}
                onClick={() => {
                  setOpen(false);
                  router.push(`/sites/${encodeURIComponent(site.id)}`);
                }}
                className={cn(
                  'flex w-full flex-col rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  site.id === currentSiteId ? 'bg-accent text-accent-foreground' : 'hover:bg-secondary'
                )}
              >
                <span className="truncate font-medium">{site.name}</span>
                <span className="truncate text-2xs text-muted-foreground">{site.domain}</span>
              </button>
            ))}

            <Link
              href="/sites/new"
              onClick={() => setOpen(false)}
              className="mt-1 flex items-center gap-2 rounded-md border-t border-border px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add a site
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
