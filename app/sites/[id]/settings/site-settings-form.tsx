'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { FieldError, FieldHint, Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/utils';
import type { Site } from '@/lib/types';

interface ApiErrorBody {
  error?: string;
  fields?: Record<string, string>;
}

export function SiteSettingsForm({ site }: { site: Site }) {
  const router = useRouter();

  const [name, setName] = useState(site.name);
  const [domain, setDomain] = useState(site.domain);
  const [allowedDomains, setAllowedDomains] = useState(site.allowedDomains.join('\n'));
  const [excludedPaths, setExcludedPaths] = useState(site.excludedPaths.join('\n'));
  const [excludeSelfReferrals, setExcludeSelfReferrals] = useState(site.excludeSelfReferrals);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);
    setStatus('saving');

    try {
      const response = await fetch(`/api/sites/${encodeURIComponent(site.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          domain,
          allowedDomains,
          excludedPaths,
          excludeSelfReferrals,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
        setFormError(body.error ?? 'Could not save your changes.');
        setFieldErrors(body.fields ?? {});
        setStatus('idle');
        return;
      }

      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
      router.refresh();
    } catch {
      setFormError('Network error. Check your connection and try again.');
      setStatus('idle');
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Site details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {formError && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={!!fieldErrors.name}
            />
            {fieldErrors.name && <FieldError>{fieldErrors.name}</FieldError>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="domain">Primary domain</Label>
            <Input
              id="domain"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              aria-invalid={!!fieldErrors.domain}
              aria-describedby="domain-help"
            />
            {fieldErrors.domain ? (
              <FieldError>{fieldErrors.domain}</FieldError>
            ) : (
              <FieldHint id="domain-help">
                Used for the dashboard heading and to recognise self-referrals.
              </FieldHint>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="allowed">Accepted hosts</Label>
            <Textarea
              id="allowed"
              value={allowedDomains}
              onChange={(event) => setAllowedDomains(event.target.value)}
              placeholder={'example.com\nblog.example.com'}
              className="font-mono text-xs"
              aria-describedby="allowed-help"
            />
            <FieldHint id="allowed-help">
              One host per line. Events from any other host are ignored. Subdomains of a listed
              host are accepted automatically, and <code>localhost</code> always works so you can
              test locally.
            </FieldHint>
          </div>

          <div className="space-y-2">
            <Label htmlFor="excluded">Excluded paths</Label>
            <Textarea
              id="excluded"
              value={excludedPaths}
              onChange={(event) => setExcludedPaths(event.target.value)}
              placeholder={'/admin\n/preview'}
              className="font-mono text-xs"
              aria-describedby="excluded-help"
            />
            <FieldHint id="excluded-help">
              One path prefix per line. Matching paths are never recorded.
            </FieldHint>
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-border p-3">
            <input
              type="checkbox"
              checked={excludeSelfReferrals}
              onChange={(event) => setExcludeSelfReferrals(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
            />
            <span>
              <span className="block text-sm font-medium">Ignore self-referrals</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Keeps internal navigation out of the referrers panel. Leave this on unless you
                deliberately track several domains as one property.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={status === 'saving'}>
          {status === 'saving' ? 'Saving…' : 'Save changes'}
        </Button>
        {status === 'saved' && (
          <span role="status" className="text-sm text-success">
            Saved
          </span>
        )}
      </div>

      <DangerZone site={site} />
    </form>
  );
}

/**
 * Deletion is a two-step confirm rather than a browser `confirm()`, so the
 * consequence can be spelled out and the destructive action can be disabled
 * while it is in flight.
 */
function DangerZone({ site }: { site: Site }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = confirmation.trim() === site.name.trim();

  async function onDelete() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/sites/${encodeURIComponent(site.id)}`, {
        method: 'DELETE',
      });
      if (!response.ok && response.status !== 204) {
        const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
        setError(body.error ?? 'Could not delete the site.');
        return;
      }
      router.push('/sites');
      router.refresh();
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Delete this site</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Permanently removes the site, every event it has recorded, and its visitor counts. This
          cannot be undone.
        </p>
        <p className="text-xs text-muted-foreground">Created {formatDate(site.createdAt, 'long')}.</p>

        {error && (
          <div role="alert" className="text-sm text-destructive">
            {error}
          </div>
        )}

        {confirming ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="confirm-name">
                Type <span className="font-semibold">{site.name}</span> to confirm
              </Label>
              <Input
                id="confirm-name"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="destructive"
                onClick={onDelete}
                disabled={!canDelete || pending}
                type="button"
              >
                {pending ? 'Deleting…' : 'Delete permanently'}
              </Button>
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  setConfirming(false);
                  setConfirmation('');
                }}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" type="button" onClick={() => setConfirming(true)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete site
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
