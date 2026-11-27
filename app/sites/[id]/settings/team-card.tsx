'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Check, Copy, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FieldError, FieldHint, Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatDate } from '@/lib/utils';
import type { Site, TeamInvite, TeamMember } from '@/lib/types';

interface ApiErrorBody {
  error?: string;
  fields?: Record<string, string>;
}

type Role = 'manager' | 'viewer';

const ROLE_LABEL: Record<Role, string> = { manager: 'Manager', viewer: 'Viewer' };

/**
 * Who has access to this site (owner only).
 *
 * There is no email service, so inviting means creating a link and sending it
 * yourself. The link works once, expires after 7 days, and is shown only at the
 * moment it is created (the server keeps just a hash). This card sits inside the
 * settings <form>, so Enter in its fields adds an invitation rather than
 * submitting the whole form.
 */
export function TeamCard({
  site,
  members,
  invites,
}: {
  site: Site;
  members: TeamMember[];
  invites: TeamInvite[];
}) {
  const router = useRouter();
  const [role, setRole] = useState<Role>('viewer');
  const [email, setEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<{ url: string; role: Role; email: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');

  // The public origin is only known in the browser.
  useEffect(() => setOrigin(window.location.origin), []);

  const base = `/api/sites/${encodeURIComponent(site.id)}`;

  async function call(path: string, init: RequestInit): Promise<Response | null> {
    setPending(true);
    setError(null);
    try {
      return await fetch(`${base}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      setError('Network error. Check your connection and try again.');
      return null;
    } finally {
      setPending(false);
    }
  }

  async function failure(response: Response, fallback: string) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    setFieldErrors(body.fields ?? {});
    if (!body.fields) setError(body.error ?? fallback);
  }

  async function invite() {
    setFieldErrors({});
    setCreated(null);
    const response = await call('/invites', {
      method: 'POST',
      body: JSON.stringify({ role, email }),
    });
    if (!response) return;
    if (!response.ok) return failure(response, 'Could not create the invitation.');

    const body = (await response.json()) as { token: string; invite: TeamInvite };
    setCreated({
      url: `${origin}/invite/${body.token}`,
      role: body.invite.role,
      email: body.invite.email,
    });
    setCopied(false);
    setEmail('');
    router.refresh();
  }

  async function revoke(item: TeamInvite) {
    const response = await call(`/invites/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    if (!response) return;
    if (!response.ok && response.status !== 204) return failure(response, 'Could not revoke it.');
    router.refresh();
  }

  async function changeRole(member: TeamMember, next: Role) {
    const response = await call(`/members/${encodeURIComponent(member.userId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: next }),
    });
    if (!response) return;
    if (!response.ok) await failure(response, 'Could not change the role.');
    router.refresh();
  }

  async function remove(member: TeamMember) {
    const response = await call(`/members/${encodeURIComponent(member.userId)}`, { method: 'DELETE' });
    if (!response) return;
    if (!response.ok && response.status !== 204) return failure(response, 'Could not remove them.');
    router.refresh();
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy. Select the link and copy it manually.');
    }
  }

  function onEnter(event: React.KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!pending) void invite();
  }

  return (
    <Card id="team" className="scroll-mt-6">
      <CardHeader>
        <CardTitle>Team</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Invite people to this site. <strong className="font-medium text-foreground">Managers</strong>{' '}
          can view the dashboard and change settings, goals and the public link.{' '}
          <strong className="font-medium text-foreground">Viewers</strong> can only view the
          dashboard. Neither can delete the site or manage who has access.
        </p>

        {error && (
          <div role="alert" className="text-sm text-destructive">
            {error}
          </div>
        )}

        {members.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {members.map((member) => (
              <li key={member.userId} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{member.name || member.email}</span>
                  {member.name && (
                    <span className="block truncate text-2xs text-muted-foreground">{member.email}</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Select
                    value={member.role}
                    disabled={pending}
                    onChange={(event) => changeRole(member, event.target.value as Role)}
                    aria-label={`Role for ${member.email}`}
                    className="h-8 text-xs"
                  >
                    <option value="manager">Manager</option>
                    <option value="viewer">Viewer</option>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={pending}
                    onClick={() => remove(member)}
                    aria-label={`Remove ${member.email}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {invites.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Open invitations</p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {invites.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{ROLE_LABEL[item.role]}</span>
                    <span className="block truncate text-2xs text-muted-foreground">
                      {item.email ? `Only for ${item.email} · ` : 'Anyone with the link · '}
                      expires {formatDate(item.expiresAt, 'long')}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => revoke(item)}
                    aria-label={`Revoke the ${ROLE_LABEL[item.role]} invitation`}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {created && (
          <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="text-sm font-medium">
              Invitation for a {ROLE_LABEL[created.role].toLowerCase()}
              {created.email ? ` (${created.email})` : ''} created
            </p>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={created.url}
                aria-label="Invitation link"
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
            <p className="text-xs text-muted-foreground">
              Send this link to them yourself. It works once, expires in 7 days, and is shown only
              now. If you lose it, revoke the invitation and create another.
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as Role)}>
              <option value="viewer">Viewer</option>
              <option value="manager">Manager</option>
            </Select>
            {fieldErrors.role && <FieldError>{fieldErrors.role}</FieldError>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email (optional)</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={onEnter}
              placeholder="colleague@example.com"
              aria-invalid={!!fieldErrors.email}
              autoComplete="off"
            />
            {fieldErrors.email ? (
              <FieldError>{fieldErrors.email}</FieldError>
            ) : (
              <FieldHint>If set, only this address can use the link. Nothing is emailed.</FieldHint>
            )}
          </div>
        </div>

        <Button type="button" variant="outline" disabled={pending} onClick={invite}>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          {pending ? 'Working…' : 'Create invitation link'}
        </Button>
      </CardContent>
    </Card>
  );
}
