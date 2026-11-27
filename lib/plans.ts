/**
 * Plan limits, in one place so the API, the UI copy and the landing page
 * pricing table cannot drift apart.
 *
 * Nothing here is enforced by a payment provider yet — `users.plan` is set
 * manually or by a future webhook. Keeping the shape in place means adding
 * billing is a change to this file plus a webhook route, not a schema change.
 */
export interface PlanLimits {
  name: string;
  sites: number;
  /** Events retained; older rows are removable by the retention job. */
  retentionDays: number;
  monthlyEvents: number;
  price: number;
}

export const PLAN_LIMITS = {
  free: {
    name: 'Free',
    sites: 3,
    retentionDays: 90,
    monthlyEvents: 100_000,
    price: 0,
  },
  pro: {
    name: 'Pro',
    sites: 25,
    retentionDays: 730,
    monthlyEvents: 2_000_000,
    price: 9,
  },
} as const satisfies Record<'free' | 'pro', PlanLimits>;
