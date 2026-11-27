/**
 * Shared types across the server/client boundary. Kept dependency-free so both
 * a server module and a `'use client'` component can import from here without
 * pulling server-only code into the browser bundle.
 */

export type Plan = 'free' | 'pro';

/**
 * Billing state, deliberately separate from the entitlement tier in `plan`.
 *
 * Keeping them apart is what lets `canceled` mean "cancelled, but still
 * entitled until current_period_end" rather than an immediate downgrade.
 */
export type SubscriptionStatus =
  | 'none' // free account, no subscription
  | 'active' // paid and current
  | 'past_due' // payment failed; still entitled while retries run
  | 'canceled' // subscription ended; access retained until period end
  | 'paused'; // suspended by an operator

export interface User {
  id: string;
  email: string;
  name: string | null;
  plan: Plan;
  isAdmin: boolean;
  subscriptionStatus: SubscriptionStatus;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/** Platform-wide totals for the admin overview. */
export interface AdminMetrics {
  totalUsers: number;
  newUsers7d: number;
  newUsers30d: number;
  adminCount: number;
  /** Accounts grouped by entitlement tier. */
  byPlan: { plan: Plan; count: number }[];
  /** Accounts grouped by billing state. */
  byStatus: { status: SubscriptionStatus; count: number }[];
  /**
   * Monthly recurring revenue in whole currency units, derived from
   * price_per_month on accounts that are actually paying (active, or past_due
   * while retries run). Not real invoicing data — see lib/admin.ts.
   */
  mrr: number;
  payingUsers: number;
  /** Conversion rate from total accounts to paying accounts. */
  conversionRate: number;
  totalSites: number;
  sitesWithTraffic7d: number;
  events7d: number;
}

/** A row in the admin user list. */
export interface AdminUserSummary {
  id: string;
  email: string;
  name: string | null;
  plan: Plan;
  isAdmin: boolean;
  subscriptionStatus: SubscriptionStatus;
  pricePerMonth: number | null;
  currency: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  siteCount: number;
  pageviews7d: number;
  /** Events ever recorded, used to spot dormant accounts. */
  pageviewsTotal: number;
  lastEventAt: string | null;
}

/** A row in the audit trail. */
export interface AdminAuditEntry {
  id: number;
  operatorEmail: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

/** Everything the user-detail page needs. */
export interface AdminUserDetail {
  user: AdminUserSummary;
  billing: {
    subscriptionStatus: SubscriptionStatus;
    pricePerMonth: number | null;
    currency: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    internalNote: string | null;
    /** True when there is no payment provider connected to this deployment. */
    providerConnected: boolean;
  };
  planLimits: {
    sites: number;
    monthlyEvents: number;
    retentionDays: number;
  };
  usage: {
    sites: number;
    eventsLast30d: number;
  };
  /** True when the account is over the limits of its current plan. */
  overLimits: {
    sites: boolean;
    events: boolean;
  };
  sites: { id: string; name: string; domain: string; createdAt: string; pageviews: number }[];
  audit: AdminAuditEntry[];
}

export type ApiError = {
  error: string;
  /** Field-level messages, keyed by form field name. */
  fields?: Record<string, string>;
};

export interface Site {
  id: string;
  name: string;
  domain: string;
  allowedDomains: string[];
  excludedPaths: string[];
  excludeSelfReferrals: boolean;
  /** Secret for the public read-only dashboard; null when the site is not shared. */
  shareToken: string | null;
  createdAt: string;
}

export interface Goal {
  id: string;
  name: string;
  type: 'event' | 'page';
  /** event: the custom event name. page: a path, optionally ending in * for a prefix. */
  value: string;
  createdAt: string;
}

export interface GoalResult extends Goal {
  /** Times the goal happened in the window (a visitor can convert more than once). */
  conversions: number;
  /** Distinct visitors who converted. */
  visitors: number;
  /** visitors / all visitors in the same window and filters, as a percentage; null with no traffic. */
  conversionRate: number | null;
}

export interface SiteSummary extends Site {
  pageviews: number;
  visitors: number;
  /** Pageviews in the same-length window immediately before the current one. */
  previousPageviews: number;
}

export type RangeKey = '24h' | '7d' | '30d' | '90d';

export interface StatsSummary {
  pageviews: number;
  visitors: number;
  /** Distinct visitor/day pairs whose first-ever event fell inside the range. */
  newVisitors: number;
  /** Share of visitors who viewed only one page. */
  bounceRate: number;
  /** Total custom events recorded in the range. */
  events: number;
  /** Mean pageviews per visitor, rounded to 2dp. */
  pagesPerVisit: number;
}

export interface TimeseriesPoint {
  /** ISO timestamp of the bucket start. */
  bucket: string;
  pageviews: number;
  visitors: number;
}

export interface BreakdownRow {
  label: string;
  value: number;
  /** Present for rows that carry a secondary dimension (e.g. browser version). */
  meta?: string | null;
}

/**
 * The dashboard payload.
 *
 * Deliberately excludes the site record: the site is already resolved by the
 * page (or returned alongside this by the API), and duplicating it here invites
 * two sources of truth for the same name and domain.
 */
export interface StatsResponse {
  range: RangeKey;
  /** Bucket size the API chose for this range. */
  interval: 'hour' | 'day';
  summary: StatsSummary;
  /** Same metrics for the preceding window, for the delta indicators. */
  previous: Pick<StatsSummary, 'pageviews' | 'visitors'>;
  timeseries: TimeseriesPoint[];
  topPages: BreakdownRow[];
  topReferrers: BreakdownRow[];
  topCountries: BreakdownRow[];
  devices: BreakdownRow[];
  browsers: BreakdownRow[];
  operatingSystems: BreakdownRow[];
  customEvents: BreakdownRow[];
  goals: GoalResult[];
  recent: {
    path: string;
    referrer: string | null;
    country: string | null;
    device: string | null;
    browser: string | null;
    eventType: string;
    eventName: string | null;
    isNewVisitor: boolean;
    createdAt: string;
  }[];
}
