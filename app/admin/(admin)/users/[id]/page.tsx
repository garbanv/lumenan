import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ExternalLink } from 'lucide-react';
import { AdminShell } from '@/components/admin-shell';
import { PlanBadge, StatusBadge } from '@/components/plan-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireAdminPage } from '@/lib/admin-auth';
import { getUserDetail } from '@/lib/admin';
import { formatDateTime, formatExact, formatRelative } from '@/lib/utils';
import { AdminUserForm, UsageSummary } from './admin-user-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'User detail',
  robots: { index: false, follow: false },
};

export default async function AdminUserDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const admin = await requireAdminPage();
  const detail = await getUserDetail(params.id);
  if (!detail) notFound();

  const { user, billing, sites, audit } = detail;

  return (
    <AdminShell user={admin}>
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        All users
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{user.email}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {user.name ? `${user.name} · ` : ''}
            Joined {formatDateTime(user.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {user.isAdmin && <span className="rounded bg-destructive/10 px-2 py-0.5 text-2xs font-medium text-destructive">admin</span>}
          <PlanBadge plan={user.plan} />
          <StatusBadge status={user.subscriptionStatus} />
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <AdminUserForm detail={detail} operatorId={admin.id} />

          {/* ---------------- sites ---------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Sites</CardTitle>
              <span className="text-xs text-muted-foreground">
                {sites.length === 1 ? '1 site' : `${sites.length} sites`}
              </span>
            </CardHeader>
            <CardContent>
              {sites.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  This account has not added a site yet.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {sites.map((site) => (
                    <li key={site.id} className="flex items-center justify-between gap-4 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{site.name}</span>
                        <span className="block truncate text-2xs text-muted-foreground">
                          {site.domain} · <code className="font-mono">{site.id}</code>
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="tabular block text-sm">
                          {formatExact(site.pageviews)}
                        </span>
                        <span className="block text-2xs text-muted-foreground">pageviews</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ---------------- audit log ---------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Audit log</CardTitle>
              <span className="text-xs text-muted-foreground">
                {audit.length === 0 ? 'No changes recorded' : `Last ${audit.length}`}
              </span>
            </CardHeader>
            <CardContent>
              {audit.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nothing has been changed on this account by an administrator.
                </p>
              ) : (
                <ol className="space-y-3">
                  {audit.map((entry) => (
                    <li key={entry.id} className="border-l-2 border-border pl-3">
                      <p className="text-sm">
                        <span className="font-medium">{describeAction(entry.action)}</span>
                        <span className="text-muted-foreground"> by {entry.operatorEmail}</span>
                      </p>
                      <p className="mt-0.5 text-2xs text-muted-foreground">
                        {formatDateTime(entry.createdAt)} · {formatRelative(entry.createdAt)}
                      </p>
                      <AuditDiff details={entry.details} />
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ---------------- sidebar ---------------- */}
        <div className="min-w-0 space-y-6">
          <UsageSummary detail={detail} />

          <Card>
            <CardHeader>
              <CardTitle>Billing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Status" value={<StatusBadge status={billing.subscriptionStatus} />} />
              <Row
                label="Price"
                value={
                  billing.pricePerMonth === null || billing.pricePerMonth === 0
                    ? 'Free'
                    : `$${formatExact(billing.pricePerMonth)}/mo ${billing.currency.toUpperCase()}`
                }
              />
              <Row
                label="Period ends"
                value={
                  billing.currentPeriodEnd ? formatDateTime(billing.currentPeriodEnd) : '—'
                }
              />
              <Row
                label="Cancels at end"
                value={billing.cancelAtPeriodEnd ? 'Yes' : 'No'}
              />
              <Row
                label="Customer id"
                value={
                  billing.stripeCustomerId ? (
                    <code className="font-mono text-xs">{billing.stripeCustomerId}</code>
                  ) : (
                    <span className="text-muted-foreground">not set</span>
                  )
                }
              />
              <Row
                label="Subscription id"
                value={
                  billing.stripeSubscriptionId ? (
                    <code className="font-mono text-xs">{billing.stripeSubscriptionId}</code>
                  ) : (
                    <span className="text-muted-foreground">not set</span>
                  )
                }
              />

              {billing.internalNote && (
                <div className="border-t border-border pt-3">
                  <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                    Internal note
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-xs">{billing.internalNote}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Totals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Sites" value={formatExact(user.siteCount)} />
              <Row label="Pageviews · 7d" value={formatExact(user.pageviews7d)} />
              <Row label="Pageviews · all time" value={formatExact(user.pageviewsTotal)} />
              <Row
                label="Last activity"
                value={user.lastEventAt ? formatRelative(user.lastEventAt) : 'never'}
              />
              <Row
                label="Account id"
                value={<code className="font-mono text-2xs">{user.id}</code>}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>View as the user</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Direct links into the customer dashboard. Admin pages are
                  server-rendered from the operator's own session, so these open
                  an ordinary session and will 404 unless the operator owns the
                  site — they are here to inspect a site id, not to impersonate. */}
              <p className="text-xs text-muted-foreground">
                These open the normal dashboard. They only render if your own account owns the
                site.
              </p>
              {sites.slice(0, 3).map((site) => (
                <a
                  key={site.id}
                  href={`/sites/${encodeURIComponent(site.id)}`}
                  className="flex items-center gap-2 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  {site.name}
                </a>
              ))}
              {sites.length === 0 && (
                <p className="text-xs text-muted-foreground">No sites to open.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminShell>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right">{value}</span>
    </div>
  );
}

function describeAction(action: string): string {
  switch (action) {
    case 'plan.updated':
      return 'Plan changed';
    case 'admin.granted':
      return 'Admin access granted';
    case 'admin.revoked':
      return 'Admin access revoked';
    default:
      return action;
  }
}

/**
 * Renders the before/after payload recorded on a plan change.
 *
 * Only the keys that actually differ are shown, so the log reads as a diff
 * rather than a wall of unchanged fields.
 */
function AuditDiff({ details }: { details: Record<string, unknown> }) {
  const before = (details.before ?? {}) as Record<string, unknown>;
  const after = (details.after ?? {}) as Record<string, unknown>;

  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const changed = keys.filter((key) => String(before[key]) !== String(after[key]));
  if (changed.length === 0) return null;

  return (
    <ul className="mt-1 space-y-0.5">
      {changed.map((key) => (
        <li key={key} className="text-2xs text-muted-foreground">
          <span className="font-medium text-foreground/80">{humanize(key)}</span>:{' '}
          <span className="line-through">{format(before[key])}</span>
          {' → '}
          <span className="text-foreground">{format(after[key])}</span>
        </li>
      ))}
    </ul>
  );
}

function humanize(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}

function format(value: unknown): string {
  if (value === null || value === undefined) return 'none';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (value === '') return 'none';
  return String(value);
}
