'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Code2, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SiteNavProps {
  siteId: string;
  /** Viewers only get the dashboard. */
  role: 'owner' | 'manager' | 'viewer';
}

/**
 * Per-site navigation. The active tab is derived from the pathname rather than
 * passed in, so a deep link still highlights correctly on a server-rendered
 * first paint.
 */
export function SiteNav({ siteId, role }: SiteNavProps) {
  const pathname = usePathname();
  const base = `/sites/${encodeURIComponent(siteId)}`;

  const items = [
    { href: base, label: 'Dashboard', icon: BarChart3, exact: true },
    { href: `${base}/code`, label: 'Tracking code', icon: Code2, exact: false },
    { href: `${base}/settings`, label: 'Settings', icon: Settings, exact: false },
  ].filter((item) => role !== 'viewer' || item.exact);

  return (
    <nav aria-label="Site sections" className="-mb-px flex gap-1 overflow-x-auto">
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
