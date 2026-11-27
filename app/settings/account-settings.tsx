'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldError, FieldHint, Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MIN_PASSWORD_LENGTH } from '@/lib/password';
import { PLAN_LIMITS } from '@/lib/plans';
import type { User } from '@/lib/types';

interface ApiErrorBody {
  error?: string;
  fields?: Record<string, string>;
}

export function AccountSettings({
  user,
  siteCount,
}: {
  user: User;
  siteCount: number;
}) {
  return (
    <div className="max-w-2xl space-y-6">
      <ProfileCard user={user} />
      <PasswordCard />
      <PlanCard user={user} siteCount={siteCount} />
    </div>
  );
}

function ProfileCard({ user }: { user: User }) {
  const router = useRouter();
  const [name, setName] = useState(user.name ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus('saving');
    setError(null);

    try {
      const response = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
        setError(body.error ?? 'Could not save your profile.');
        setStatus('idle');
        return;
      }

      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
      router.refresh();
    } catch {
      setError('Network error. Check your connection and try again.');
      setStatus('idle');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-5">
          {error && (
            <div role="alert" className="text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            {/* Changing the sign-in address would need a verification flow, so
                it is shown read-only rather than offered and then rejected. */}
            <Input id="email" value={user.email} readOnly disabled />
            <FieldHint>Contact support to change the email on your account.</FieldHint>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Display name</Label>
            <Input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={status === 'saving'}>
              {status === 'saving' ? 'Saving…' : 'Save'}
            </Button>
            {status === 'saved' && (
              <span role="status" className="text-sm text-success">
                Saved
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus('saving');
    setError(null);
    setFieldErrors({});

    try {
      const response = await fetch('/api/account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
        setError(body.error ?? 'Could not change your password.');
        setFieldErrors(body.fields ?? {});
        setStatus('idle');
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setStatus('saved');
      setNotice('Password updated. All other devices have been signed out.');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setError('Network error. Check your connection and try again.');
      setStatus('idle');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-5">
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          {notice && (
            <div role="status" className="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
              {notice}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="current">Current password</Label>
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              aria-invalid={!!fieldErrors.currentPassword}
            />
            {fieldErrors.currentPassword && (
              <FieldError>{fieldErrors.currentPassword}</FieldError>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="new">New password</Label>
            <Input
              id="new"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              aria-invalid={!!fieldErrors.newPassword}
              aria-describedby="new-password-hint"
            />
            {fieldErrors.newPassword ? (
              <FieldError id="new-password-hint">{fieldErrors.newPassword}</FieldError>
            ) : (
              <FieldHint id="new-password-hint">
                At least {MIN_PASSWORD_LENGTH} characters.
              </FieldHint>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={status === 'saving'}>
              {status === 'saving' ? 'Updating…' : 'Update password'}
            </Button>
            {status === 'saved' && (
              <span role="status" className="text-sm text-success">
                Updated
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PlanCard({ user, siteCount }: { user: User; siteCount: number }) {
  const plan = PLAN_LIMITS[user.plan];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan</CardTitle>
        <Badge variant={user.plan === 'pro' ? 'default' : 'outline'}>{plan.name}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Sites</dt>
            <dd className="tabular mt-0.5 text-sm font-medium">
              {siteCount} / {plan.sites}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Events / month</dt>
            <dd className="tabular mt-0.5 text-sm font-medium">
              {plan.monthlyEvents.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">History</dt>
            <dd className="tabular mt-0.5 text-sm font-medium">{plan.retentionDays} days</dd>
          </div>
        </dl>

        {user.plan === 'free' ? (
          <div className="rounded-lg border border-border bg-secondary/40 p-4">
            <p className="text-sm font-medium">Upgrade to Pro</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {PLAN_LIMITS.pro.sites} sites, {PLAN_LIMITS.pro.monthlyEvents.toLocaleString()}{' '}
              events per month, and two years of history for ${PLAN_LIMITS.pro.price}/month.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Billing is not connected yet — this build is self-hosted, so raise the limit in{' '}
              <code className="rounded bg-background px-1 py-0.5">lib/plans.ts</code> or set your
              account to <code className="rounded bg-background px-1 py-0.5">pro</code> directly.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            You are on Pro. Thanks for supporting the project.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
