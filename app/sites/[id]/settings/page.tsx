import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { getSiteForUser } from '@/lib/sites';
import { listGoals, listRecentEventNames } from '@/lib/goals';
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
  if (!site) notFound();

  const [goals, eventNames] = await Promise.all([
    listGoals(site.id),
    listRecentEventNames(site.id),
  ]);

  return <SiteSettingsForm site={site} goals={goals} eventNames={eventNames} />;
}
