import Link from 'next/link';
import { Wordmark } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { SignOutButton } from '@/components/sign-out-button';
import { SiteSwitcher, type SiteOption } from '@/components/site-switcher';
import type { User } from '@/lib/types';

interface AppShellProps {
  user: User;
  sites: SiteOption[];
  /** Omitted on pages that are not inside a single site's context. */
  currentSiteId?: string;
  children: React.ReactNode;
}

/**
 * Chrome for every signed-in page: one sticky bar with the brand, the site
 * switcher, and account controls. A single bar rather than a sidebar because
 * the navigation is only two levels deep — a sidebar would spend 240px of width
 * to hold six links.
 */
export function AppShell({ user, sites, currentSiteId, children }: AppShellProps) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="container flex h-14 items-center gap-4">
          <Link
            href="/sites"
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Wordmark />
            <span className="sr-only">All sites</span>
          </Link>

          {currentSiteId && sites.length > 0 && (
            <div className="w-full max-w-[240px]">
              <SiteSwitcher sites={sites} currentSiteId={currentSiteId} />
            </div>
          )}

          <div className="ml-auto flex items-center gap-1">
            {user.isAdmin && (
              <Link
                href="/admin"
                className="hidden rounded-lg px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 sm:block"
              >
                Admin
              </Link>
            )}
            <Link
              href="/settings"
              className="hidden rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:block"
            >
              {user.name ?? user.email}
            </Link>
            <ThemeToggle />
            <SignOutButton className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" />
          </div>
        </div>
      </header>

      <main className="container py-8">{children}</main>
    </div>
  );
}
