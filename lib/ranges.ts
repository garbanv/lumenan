import type { RangeKey } from './types';

/**
 * Range definitions, shared by the server (which builds the queries) and the
 * client (which renders the picker).
 *
 * This file must stay free of server imports: importing it from a `'use client'`
 * component is how the picker knows the labels without dragging `pg` into the
 * browser bundle.
 */
export interface RangeSpec {
  key: RangeKey;
  label: string;
  /** Length of the window. */
  hours: number;
  /** Bucket size for the timeseries. */
  interval: 'hour' | 'day';
  /** Compact label for the segmented control. */
  short: string;
}

export const RANGES: Record<RangeKey, RangeSpec> = {
  '24h': { key: '24h', label: 'Last 24 hours', hours: 24, interval: 'hour', short: '24h' },
  '7d': { key: '7d', label: 'Last 7 days', hours: 24 * 7, interval: 'day', short: '7 days' },
  '30d': { key: '30d', label: 'Last 30 days', hours: 24 * 30, interval: 'day', short: '30 days' },
  '90d': { key: '90d', label: 'Last 90 days', hours: 24 * 90, interval: 'day', short: '90 days' },
};

/** Display order for the picker. */
export const RANGE_ORDER: RangeKey[] = ['24h', '7d', '30d', '90d'];

export function isRangeKey(value: string | null | undefined): value is RangeKey {
  return !!value && value in RANGES;
}

export function resolveRange(value: string | null | undefined): RangeSpec {
  return isRangeKey(value) ? RANGES[value] : RANGES['7d'];
}
