import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { requireUser } from '@/lib/auth';
import { listSitesForUser, countSitesForUser } from '@/lib/sites';
import { PLAN_LIMITS } from '@/lib/plans';
import { NewSiteForm } from './new-site-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Add a site',
  robots: { index: false, follow: false },
};

export default async function NewSitePage() {
  const user = await requireUser('/sites/new');
  const [sites, siteCount] = await Promise.all([
    listSitesForUser(user.id),
    countSitesForUser(user.id),
  ]);

  const limit = PLAN_LIMITS[user.plan].sites;
  const atLimit = siteCount >= limit;

  return (
    <AppShell user={user} sites={sites}>
      <Link
        href="/sites"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        All sites
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Add a site</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        You will get a tracking snippet as soon as the site is created.
      </p>

      <div className="mt-8">
        {atLimit ? (
          <div className="max-w-lg rounded-xl border border-border bg-card p-6">
            <h2 className="text-sm font-semibold">Site limit reached</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The {user.plan} plan includes {limit} sites, and you are using all of them. Remove a
              site or move to a larger plan to continue.
            </p>
            <Link
              href="/settings"
              className="mt-4 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Compare plans
            </Link>
          </div>
        ) : (
          <NewSiteForm />
        )}
      </div>
    </AppShell>
  );
}
