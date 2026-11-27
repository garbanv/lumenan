'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Ban, RotateCcw, ShieldCheck, ShieldOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { FieldError, FieldHint, Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PlanBadge } from '@/components/plan-badge';
import { PLAN_LIMITS } from '@/lib/plans';
import { formatExact, formatPercent } from '@/lib/utils';
import type { AdminUserDetail, Plan, SubscriptionStatus } from '@/lib/types';

interface AdminUserFormProps {
  detail: AdminUserDetail;
  /** The signed-in operator's id, so self-demotion can be disabled up front. */
  operatorId: string;
}

interface ApiErrorBody {
  error?: string;
  fields?: Record<string, string>;
}

const PLAN_PRICES: Record<Plan, number> = { free: 0, pro: PLAN_LIMITS.pro.price };

export function AdminUserForm({ detail, operatorId }: AdminUserFormProps) {
  const router = useRouter();
  const { user, billing, planLimits, usage, overLimits } = detail;

  const [plan, setPlan] = useState<Plan>(user.plan);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>(
    user.subscriptionStatus
  );
  const [pricePerMonth, setPricePerMonth] = useState<string>(
    user.pricePerMonth === null ? '' : String(user.pricePerMonth)
  );
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(user.cancelAtPeriodEnd);
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState(
    user.currentPeriodEnd ? user.currentPeriodEnd.slice(0, 10) : ''
  );
  const [internalNote, setInternalNote] = useState(billing.internalNote ?? '');

  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /**
   * One request path for every action, because they all end up as a PATCH.
   * Presets below just prefill the payload, so a "Cancel subscription" click and
   * a hand-edited form submit go through identical validation server-side.
   */
  async function send(payload: Record<string, unknown>, label: string) {
    setPending(label);
    setError(null);
    setStatus(null);
    setFieldErrors({});

    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
        setError(body.error ?? 'Could not apply that change.');
        setFieldErrors(body.fields ?? {});
        return;
      }

      setStatus(label);
      router.refresh();
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setPending(null);
    }
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsedPrice = pricePerMonth.trim() === '' ? null : Number.parseInt(pricePerMonth, 10);
    if (parsedPrice !== null && (!Number.isInteger(parsedPrice) || parsedPrice < 0)) {
      setFieldErrors({ pricePerMonth: 'Enter a whole number of currency units, or leave it blank.' });
      return;
    }

    send(
      {
        plan,
        subscriptionStatus,
        pricePerMonth: parsedPrice,
        cancelAtPeriodEnd,
        currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd).toISOString() : null,
        internalNote: internalNote.trim() === '' ? null : internalNote,
      },
      'Changes saved'
    );
  }

  const busy = pending !== null;
  const planChanged = plan !== user.plan;

  return (
    <div className="space-y-6">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      {status && (
        <div
          role="status"
          className="rounded-lg border border-success/30 bg-success/5 px-4 py-3 text-sm text-success"
        >
          {status}
        </div>
      )}

      {/* ---------------- limits warning ---------------- */}
      {(overLimits.sites || overLimits.events) && (
        <div className="flex gap-3 rounded-lg border border-chart-4/40 bg-chart-4/5 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-chart-4" aria-hidden="true" />
          <div>
            <p className="font-medium">This account exceeds its current plan limits</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {overLimits.sites && (
                <li>
                  {usage.sites} sites, but the {user.plan} plan allows {planLimits.sites}. Existing
                  sites keep working; they just cannot add more.
                </li>
              )}
              {overLimits.events && (
                <li>
                  {formatExact(usage.eventsLast30d)} events in 30 days, above the{' '}
                  {formatExact(planLimits.monthlyEvents)} included.
                </li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* ---------------- quick actions ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Plan</CardTitle>
          <span className="flex items-center gap-2">
            <PlanBadge plan={user.plan} />
            {planChanged && (
              <Badge variant="outline">
                pending: {plan === 'pro' ? 'Pro' : 'Free'}
              </Badge>
            )}
          </span>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Direct actions apply immediately and are recorded in the audit log below.
          </p>

          <div className="flex flex-wrap gap-2">
            {user.plan !== 'pro' && (
              <Button
                onClick={() =>
                  send(
                    { plan: 'pro', subscriptionStatus: 'active', pricePerMonth: PLAN_PRICES.pro },
                    'Upgraded to Pro'
                  )
                }
                disabled={busy}
              >
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                {pending === 'Upgraded to Pro' ? 'Upgrading…' : 'Upgrade to Pro'}
              </Button>
            )}

            {user.plan === 'pro' && (
              <Button
                variant="outline"
                onClick={() =>
                  send(
                    { plan: 'free', subscriptionStatus: 'none', pricePerMonth: 0, cancelAtPeriodEnd: false },
                    'Downgraded to Free'
                  )
                }
                disabled={busy}
              >
                <ArrowDownRight className="h-4 w-4" aria-hidden="true" />
                {pending === 'Downgraded to Free' ? 'Downgrading…' : 'Downgrade to Free'}
              </Button>
            )}

            {/* Cancel and pause keep the entitlement, which is the whole point
                of separating plan from subscription status. */}
            <Button
              variant="outline"
              onClick={() =>
                send(
                  {
                    subscriptionStatus: 'canceled',
                    cancelAtPeriodEnd: true,
                    // Default to the end of the current period so access runs out
                    // naturally rather than being cut off mid-cycle.
                    currentPeriodEnd:
                      user.currentPeriodEnd ??
                      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                  },
                  'Subscription canceled'
                )
              }
              disabled={busy || user.subscriptionStatus === 'canceled'}
            >
              <Ban className="h-4 w-4" aria-hidden="true" />
              {pending === 'Subscription canceled' ? 'Canceling…' : 'Cancel subscription'}
            </Button>

            <Button
              variant="outline"
              onClick={() =>
                send({ subscriptionStatus: 'paused' }, 'Account paused')
              }
              disabled={busy || user.subscriptionStatus === 'paused'}
            >
              {pending === 'Account paused' ? 'Pausing…' : 'Pause account'}
            </Button>

            <Button
              variant="outline"
              onClick={() =>
                send({ subscriptionStatus: 'active' }, 'Subscription reactivated')
              }
              disabled={busy || user.subscriptionStatus === 'active'}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {pending === 'Subscription reactivated' ? 'Reactivating…' : 'Reactivate'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---------------- full form ---------------- */}
      <form onSubmit={onSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Billing details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {!billing.providerConnected && (
              <p className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                No payment provider is connected to this deployment. These fields are recorded and
                displayed, but nothing is charged and no invoices are generated.
              </p>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="plan">Plan tier</Label>
                <Select
                  id="plan"
                  value={plan}
                  onChange={(event) => {
                    const next = event.target.value as Plan;
                    setPlan(next);
                    // Keep the price coherent with the tier unless the operator
                    // has deliberately set something custom.
                    if (pricePerMonth === '' || Number(pricePerMonth) === PLAN_PRICES[user.plan]) {
                      setPricePerMonth(String(PLAN_PRICES[next]));
                    }
                  }}
                >
                  <option value="free">Free</option>
                  <option value="pro">Pro</option>
                </Select>
                <FieldHint>
                  Free: {PLAN_LIMITS.free.sites} sites, {PLAN_LIMITS.free.retentionDays} days of
                  history. Pro: {PLAN_LIMITS.pro.sites} sites, {PLAN_LIMITS.pro.retentionDays} days.
                </FieldHint>
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Billing status</Label>
                <Select
                  id="status"
                  value={subscriptionStatus}
                  onChange={(event) => setSubscriptionStatus(event.target.value as SubscriptionStatus)}
                >
                  <option value="none">No subscription</option>
                  <option value="active">Active</option>
                  <option value="past_due">Past due</option>
                  <option value="canceled">Canceled (access until period end)</option>
                  <option value="paused">Paused</option>
                </Select>
                <FieldHint>
                  Status is billing state; the plan above is what the account is entitled to.
                </FieldHint>
              </div>

              <div className="space-y-2">
                <Label htmlFor="price">Price per month</Label>
                <Input
                  id="price"
                  inputMode="numeric"
                  value={pricePerMonth}
                  onChange={(event) => setPricePerMonth(event.target.value)}
                  placeholder="0"
                  aria-invalid={!!fieldErrors.pricePerMonth}
                />
                {fieldErrors.pricePerMonth ? (
                  <FieldError>{fieldErrors.pricePerMonth}</FieldError>
                ) : (
                  <FieldHint>Whole currency units. Blank means unpriced.</FieldHint>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="periodEnd">Current period ends</Label>
                <Input
                  id="periodEnd"
                  type="date"
                  value={currentPeriodEnd}
                  onChange={(event) => setCurrentPeriodEnd(event.target.value)}
                />
                <FieldHint>When a canceled subscription actually loses access.</FieldHint>
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-lg border border-border p-3">
              <input
                type="checkbox"
                checked={cancelAtPeriodEnd}
                onChange={(event) => setCancelAtPeriodEnd(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
              />
              <span>
                <span className="block text-sm font-medium">Cancel at period end</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  The account stays on its current plan until the date above, then drops to Free.
                </span>
              </span>
            </label>

            <div className="space-y-2">
              <Label htmlFor="note">Internal note</Label>
              <Textarea
                id="note"
                value={internalNote}
                onChange={(event) => setInternalNote(event.target.value)}
                placeholder="Comped for the launch, mentioned in a support thread…"
              />
              <FieldHint>Only visible to administrators.</FieldHint>
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy}>
                {pending === 'Changes saved' ? 'Saving…' : 'Save changes'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setPlan(user.plan);
                  setSubscriptionStatus(user.subscriptionStatus);
                  setPricePerMonth(user.pricePerMonth === null ? '' : String(user.pricePerMonth));
                  setCancelAtPeriodEnd(user.cancelAtPeriodEnd);
                  setCurrentPeriodEnd(
                    user.currentPeriodEnd ? user.currentPeriodEnd.slice(0, 10) : ''
                  );
                  setInternalNote(billing.internalNote ?? '');
                  setError(null);
                  setStatus(null);
                }}
              >
                Reset form
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* ---------------- access ---------------- */}
      <Card className={user.isAdmin ? 'border-destructive/30' : undefined}>
        <CardHeader>
          <CardTitle>Administrator access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Administrators can see and change every account on this deployment.
          </p>

          {user.id === operatorId ? (
            <p className="text-sm text-muted-foreground">
              This is your own account, so admin access cannot be changed here.
            </p>
          ) : user.isAdmin ? (
            <Button
              variant="outline"
              onClick={() => send({ isAdmin: false }, 'Admin access revoked')}
              disabled={busy}
            >
              <ShieldOff className="h-4 w-4" aria-hidden="true" />
              {pending === 'Admin access revoked' ? 'Revoking…' : 'Revoke admin access'}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => send({ isAdmin: true }, 'Admin access granted')}
              disabled={busy}
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              {pending === 'Admin access granted' ? 'Granting…' : 'Grant admin access'}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Usage panel, kept separate so the form stays focused on mutations. */
export function UsageSummary({ detail }: { detail: AdminUserDetail }) {
  const { usage, planLimits, user } = detail;

  const siteShare = planLimits.sites > 0 ? (usage.sites / planLimits.sites) * 100 : 0;
  const eventShare =
    planLimits.monthlyEvents > 0 ? (usage.eventsLast30d / planLimits.monthlyEvents) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage</CardTitle>
        <Badge variant="outline">{user.plan} limits</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <Meter
          label="Sites"
          value={usage.sites}
          limit={planLimits.sites}
          share={siteShare}
        />
        <Meter
          label="Events · 30d"
          value={usage.eventsLast30d}
          limit={planLimits.monthlyEvents}
          share={eventShare}
        />
        <p className="text-xs text-muted-foreground">
          History retained for {planLimits.retentionDays} days on this plan.
        </p>
      </CardContent>
    </Card>
  );
}

function Meter({
  label,
  value,
  limit,
  share,
}: {
  label: string;
  value: number;
  limit: number;
  share: number;
}) {
  const over = value > limit;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular">
          <span className={over ? 'font-medium text-destructive' : 'font-medium'}>
            {formatExact(value)}
          </span>
          <span className="text-muted-foreground"> / {formatExact(limit)}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={
            over ? 'h-full rounded-full bg-destructive' : 'h-full rounded-full bg-primary'
          }
          style={{ width: `${Math.min(100, Math.max(1, share))}%` }}
        />
      </div>
      <p className="mt-1 text-2xs text-muted-foreground">{formatPercent(share, 0)} of the limit</p>
    </div>
  );
}
