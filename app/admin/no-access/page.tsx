import { ShieldAlert, ShieldCheck, Terminal } from 'lucide-react';
import Link from 'next/link';
import { Wordmark } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { ClaimAdminButton } from '@/components/claim-admin-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { adminCount } from '@/lib/admin';
import { requireUserForAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin access',
  robots: { index: false, follow: false },
};

/**
 * Shown to a signed-in account that lacks the operator role.
 *
 * This page exists because a bare 404 was genuinely unhelpful: the most likely
 * person to open /admin without the role is the one who just deployed the
 * instance, and a 404 gives them no way to tell a missing route from a stale
 * build from a missing permission. It states the actual situation and the exact
 * command to resolve it.
 *
 * It sits OUTSIDE the gated route group, so it cannot redirect to itself.
 */
export default async function AdminNoAccessPage() {
  // Redirects to login when there is no session; that is the correct response.
  const user = await requireUserForAdmin();

  // If nobody holds the role, the offer to claim it is genuinely open. If
  // someone does, this account needs that person to promote it.
  const operators = await adminCount();
  const claimable = operators === 0;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <div className="container flex h-14 items-center justify-between">
          <Link href="/sites" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:block">{user.email}</span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container flex flex-1 items-start justify-center py-12">
        <div className="w-full max-w-xl space-y-6">
          <div className="text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <ShieldAlert className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">
              You do not have admin access
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              You are signed in as <span className="font-medium text-foreground">{user.email}</span>
              , which is not an administrator on this deployment.
            </p>
          </div>

          {claimable ? (
            <Card>
              <CardHeader>
                <CardTitle>This deployment has no administrator yet</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Nobody holds the role, so it is available to claim. The offer is enforced by the
                  database and disappears as soon as someone takes it.
                </p>
                <ClaimAdminButton />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>How to get access</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <p className="text-muted-foreground">
                  {operators === 1
                    ? 'One account already holds the role.'
                    : `${operators} accounts already hold the role.`}{' '}
                  It cannot be claimed a second time — an existing administrator has to grant it from{' '}
                  <span className="font-medium text-foreground">Admin → Users → your account</span>.
                </p>

                <div className="rounded-lg border border-border bg-secondary/40 p-4">
                  <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
                    If you run this deployment
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Promote your own account with the bundled script. This works against the Docker
                    stack and a local database alike:
                  </p>
                  <pre className="mt-2 overflow-x-auto rounded-md bg-background p-3 font-mono text-xs">
{`# Docker
docker compose run --rm migrate \\
  node db/grant-admin.mjs ${user.email.toLowerCase()}

# Local Postgres
npm run db:grant-admin -- ${user.email.toLowerCase()}`}
                  </pre>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Then reload this page. Your session already carries the account, so there is
                    nothing to sign out of.
                  </p>
                </div>

                <p className="text-xs text-muted-foreground">
                  This is deliberately not a self-service button: once an operator exists, letting
                  any signed-in account promote itself would make the role meaningless.
                </p>
              </CardContent>
            </Card>
          )}

          <div className="flex items-center justify-center gap-3">
            <Link
              href="/sites"
              className="inline-flex h-9 items-center rounded-lg border border-input px-4 text-sm font-medium transition-colors hover:bg-secondary"
            >
              Back to your sites
            </Link>
            {user.isAdmin && (
              <Link
                href="/admin"
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Open admin
              </Link>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
