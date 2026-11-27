import type { Metadata } from 'next';
import { AppShell } from '@/components/app-shell';
import { requireUser } from '@/lib/auth';
import { countSitesForUser, listSitesForUser } from '@/lib/sites';
import { AccountSettings } from './account-settings';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Account settings',
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  const user = await requireUser('/settings');
  const [sites, siteCount] = await Promise.all([
    listSitesForUser(user.id),
    countSitesForUser(user.id),
  ]);

  return (
    <AppShell user={user} sites={sites}>
      <h1 className="text-2xl font-semibold tracking-tight">Account settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your profile, password and plan.
      </p>

      <div className="mt-8">
        <AccountSettings user={user} siteCount={siteCount} />
      </div>
    </AppShell>
  );
}
