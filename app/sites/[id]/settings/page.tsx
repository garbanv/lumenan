import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/roles';
import { getSiteForUser } from '@/lib/sites';
import { listGoals, listRecentEventNames } from '@/lib/goals';
import { listMembers, listPendingInvites } from '@/lib/team';
import { SiteSettingsForm } from './site-settings-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Site settings',
  robots: { index: false, follow: false },
};

export default async function SiteSettingsPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await requireUser(`/sites/${params.id}/settings`);
  const site = await getSiteForUser(params.id, user.id);
  // Viewers have no settings; to them the page does not exist.
  if (!site || !can(site.role, 'manage')) notFound();

  const isOwner = can(site.role, 'team');
  const [goals, eventNames, members, invites] = await Promise.all([
    listGoals(site.id),
    listRecentEventNames(site.id),
    // Who has access is for the owner's eyes only.
    isOwner ? listMembers(site.id) : Promise.resolve([]),
    isOwner ? listPendingInvites(site.id) : Promise.resolve([]),
  ]);

  return (
    <SiteSettingsForm
      site={site}
      goals={goals}
      eventNames={eventNames}
      members={members}
      invites={invites}
    />
  );
}
