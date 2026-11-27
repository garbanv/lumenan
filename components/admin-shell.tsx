import Link from 'next/link';
import { Wordmark } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { SignOutButton } from '@/components/sign-out-button';
import { AdminNav } from '@/components/admin-nav';
import { Badge } from '@/components/ui/badge';
import type { User } from '@/lib/types';

/**
 * Chrome for the admin surface.
 *
 * Deliberately separate from AppShell: the operator's job is different from a
 * customer's, and a distinct header with an explicit "Admin" badge makes it hard
 * to forget which mode you are in — which matters, because actions here affect
 * other people's accounts.
 */
export function AdminShell({
  user,
  children,
}: {
  user: User;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="container flex h-14 items-center gap-4">
          <Link
            href="/admin"
            className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Wordmark />
            <Badge variant="destructive">Admin</Badge>
          </Link>

          <div className="ml-auto flex items-center gap-1">
            <Link
              href="/sites"
              className="hidden rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:block"
            >
              Exit admin
            </Link>
            <span className="hidden px-2 text-sm text-muted-foreground md:block">
              {user.email}
            </span>
            <ThemeToggle />
            <SignOutButton className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" />
          </div>
        </div>

        <div className="container">
          <AdminNav />
        </div>
      </header>

      <main className="container py-8">{children}</main>
    </div>
  );
}
