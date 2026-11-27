import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { SiteNav } from '@/components/site-nav';
import { requireUser } from '@/lib/auth';
import { getSiteForUser, listSitesForUser } from '@/lib/sites';

export const dynamic = 'force-dynamic';

/**
 * Shared chrome for one site: the app shell, the site heading, and the section
 * tabs. Resolving the site here means every child page can rely on the site
 * existing and belonging to the signed-in user.
 */
export default async function SiteLayout(
  props: {
    children: React.ReactNode;
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;

  const {
    children
  } = props;

  const user = await requireUser(`/sites/${params.id}`);

  const [site, sites] = await Promise.all([
    getSiteForUser(params.id, user.id),
    listSitesForUser(user.id),
  ]);

  // 404 rather than 403: a site belonging to someone else should not be
  // distinguishable from one that does not exist.
  if (!site) notFound();

  return (
    <AppShell user={user} sites={sites} currentSiteId={site.id}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{site.name}</h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">{site.domain}</p>
        </div>
      </div>

      <div className="mt-6 border-b border-border">
        <SiteNav siteId={site.id} role={site.role} />
      </div>

      <div className="mt-6">{children}</div>
    </AppShell>
  );
}
