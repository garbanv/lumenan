import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Plan, SubscriptionStatus } from '@/lib/types';

const PLAN_LABELS: Record<Plan, string> = {
  free: 'Free',
  pro: 'Pro',
};

/**
 * Plan tier. `pro` gets the accent treatment so a paid account is scannable in
 * a long list.
 */
export function PlanBadge({ plan, className }: { plan: Plan; className?: string }) {
  return (
    <Badge
      variant={plan === 'pro' ? 'default' : 'outline'}
      className={cn('capitalize', className)}
    >
      {PLAN_LABELS[plan]}
    </Badge>
  );
}

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  none: 'No subscription',
  active: 'Active',
  past_due: 'Past due',
  canceled: 'Canceled',
  paused: 'Paused',
};

const STATUS_VARIANTS: Record<
  SubscriptionStatus,
  'default' | 'secondary' | 'outline' | 'success' | 'destructive'
> = {
  none: 'outline',
  active: 'success',
  past_due: 'destructive',
  canceled: 'secondary',
  paused: 'outline',
};

/**
 * Billing state. Distinct from the plan badge on purpose: an account can be
 * `pro` and `canceled` at the same time, which means "still entitled until the
 * period ends".
 */
export function StatusBadge({
  status,
  className,
}: {
  status: SubscriptionStatus;
  className?: string;
}) {
  return (
    <Badge variant={STATUS_VARIANTS[status]} className={className}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function statusLabel(status: SubscriptionStatus): string {
  return STATUS_LABELS[status];
}
