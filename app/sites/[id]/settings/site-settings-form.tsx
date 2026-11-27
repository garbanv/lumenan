'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Share2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { FieldError, FieldHint, Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import type { Goal, Site } from '@/lib/types';

interface ApiErrorBody {
  error?: string;
  fields?: Record<string, string>;
}

export function SiteSettingsForm({
  site,
  goals,
  eventNames,
}: {
  site: Site;
  goals: Goal[];
  eventNames: string[];
}) {
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

      <GoalsCard site={site} goals={goals} eventNames={eventNames} />

      <SharingCard site={site} />

      <DangerZone site={site} />
    </form>
  );
}

/**
 * Conversion goals: a custom event or a page the owner wants counted.
 *
 * This sits inside the settings <form>, so Enter in its fields is intercepted
 * (it adds the goal) rather than submitting the whole form. Goals save on their
 * own and report on existing history straight away.
 */
function GoalsCard({
  site,
  goals,
  eventNames,
}: {
  site: Site;
  goals: Goal[];
  eventNames: string[];
}) {
  const router = useRouter();
  const [type, setType] = useState<'event' | 'page'>('event');
  const [value, setValue] = useState('');
  const [name, setName] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const base = `/api/sites/${encodeURIComponent(site.id)}/goals`;

  async function add() {
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const response = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, value, name }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
        setFieldErrors(body.fields ?? {});
        if (!body.fields) setError(body.error ?? 'Could not add the goal.');
        return;
      }
      setValue('');
      setName('');
      router.refresh();
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  async function remove(goal: Goal) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`${base}/${encodeURIComponent(goal.id)}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 204) {
        const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
        setError(body.error ?? 'Could not remove the goal.');
        return;
      }
      router.refresh();
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  function onEnter(event: React.KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!pending) void add();
  }

  return (
    <Card id="goals" className="scroll-mt-6">
      <CardHeader>
        <CardTitle>Goals</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Count what matters: a custom event (<code>trackEvent(&apos;signup&apos;)</code>) or a visit
          to a page. The dashboard shows how many visitors reached each goal and the conversion
          rate. New goals report on past traffic straight away.
        </p>

        {goals.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {goals.map((goal) => (
              <li key={goal.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{goal.name}</span>
                  <span className="block truncate font-mono text-2xs text-muted-foreground">
                    {goal.type === 'event' ? 'event' : 'page'} · {goal.value}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={pending}
                  onClick={() => remove(goal)}
                  aria-label={`Remove goal ${goal.name}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <div role="alert" className="text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
          <div className="space-y-2">
            <Label htmlFor="goal-type">Type</Label>
            <Select
              id="goal-type"
              value={type}
              onChange={(event) => setType(event.target.value as 'event' | 'page')}
            >
              <option value="event">Custom event</option>
              <option value="page">Page visit</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal-value">{type === 'event' ? 'Event name' : 'Page path'}</Label>
            <Input
              id="goal-value"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={onEnter}
              placeholder={type === 'event' ? 'signup_completed' : '/thank-you or /blog/*'}
              list={type === 'event' ? 'goal-event-names' : undefined}
              className="font-mono text-xs"
              aria-invalid={!!fieldErrors.value}
              autoComplete="off"
            />
            {type === 'event' && (
              <datalist id="goal-event-names">
                {eventNames.map((eventName) => (
                  <option key={eventName} value={eventName} />
                ))}
              </datalist>
            )}
            {fieldErrors.value ? (
              <FieldError>{fieldErrors.value}</FieldError>
            ) : (
              type === 'page' && (
                <FieldHint>End with * to match everything under a path, e.g. /blog/*.</FieldHint>
              )
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="goal-name">Label (optional)</Label>
          <Input
            id="goal-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={onEnter}
            placeholder="Signed up"
            aria-invalid={!!fieldErrors.name}
            autoComplete="off"
          />
          {fieldErrors.name && <FieldError>{fieldErrors.name}</FieldError>}
        </div>

        <Button type="button" variant="outline" disabled={pending || !value.trim()} onClick={add}>
          {pending ? 'Saving…' : 'Add goal'}
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Public read-only dashboard link.
 *
 * Turning sharing on mints a secret URL; "Create new link" replaces it, which
 * is how a leaked link is revoked; "Stop sharing" removes it. Changes apply
 * immediately and independently of the settings form above.
 */
function SharingCard({ site }: { site: Site }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(site.shareToken);
  const [origin, setOrigin] = useState('');
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The public origin is only known in the browser.
  useEffect(() => setOrigin(window.location.origin), []);

  const url = token ? `${origin}/share/${token}` : '';

  async function run(action: 'enable' | 'regenerate' | 'disable') {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/sites/${encodeURIComponent(site.id)}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
        setError(body.error ?? 'Could not update sharing.');
        return;
      }
      const body = (await response.json()) as { shareToken: string | null };
      setToken(body.shareToken);
      setCopied(false);
      router.refresh();
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy. Select the link and copy it manually.');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Public dashboard</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Share a read-only view of this site&apos;s statistics with anyone who has the link, no
          account needed. Viewers see totals and breakdowns only, never individual visits, and
          cannot change anything.
        </p>

        {error && (
          <div role="alert" className="text-sm text-destructive">
            {error}
          </div>
        )}

        {token ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={url}
                aria-label="Public dashboard link"
                onFocus={(event) => event.currentTarget.select()}
                className="font-mono text-xs"
              />
              <Button type="button" variant="outline" onClick={copy} className="shrink-0">
                {copied ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden="true" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Open
              </a>
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => run('regenerate')}>
                Create new link
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => run('disable')}>
                Stop sharing
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Anyone with this link can view the dashboard. Create a new link to invalidate the old
              one, or stop sharing to turn it off.
            </p>
          </div>
        ) : (
          <Button type="button" variant="outline" disabled={pending} onClick={() => run('enable')}>
            <Share2 className="h-4 w-4" aria-hidden="true" />
            {pending ? 'Creating…' : 'Create public link'}
          </Button>
        )}
      </CardContent>
    </Card>
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
