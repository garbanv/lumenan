import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { getSiteForUser } from '@/lib/sites';
import { EmbedCode } from '@/components/embed-code';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Tracking code',
  robots: { index: false, follow: false },
};

export default async function SiteCodePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await requireUser(`/sites/${params.id}/code`);
  const site = await getSiteForUser(params.id, user.id);
  if (!site) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-5 py-4">
        <span className="text-sm font-medium">{site.domain}</span>
        <span className="text-muted-foreground" aria-hidden="true">
          ·
        </span>
        <span className="text-sm text-muted-foreground">Site ID</span>
        <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs">{site.id}</code>
      </div>

      <EmbedCode siteId={site.id} />
    </div>
  );
}
