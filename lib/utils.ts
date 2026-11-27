import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names, letting later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const full = new Intl.NumberFormat('en-US');

/**
 * Format a count for a stat card: exact when short, abbreviated when long.
 * "1,284" stays readable; "1.3M" avoids overflowing a narrow card.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) < 10_000) return full.format(value);
  return compact.format(value);
}

/** Exact formatting for tables, where alignment matters more than brevity. */
export function formatExact(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return full.format(value);
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '0%';
  return `${value.toFixed(digits)}%`;
}

/** 1284 -> "+1,284" ; -32 -> "-32" ; used next to period-over-period deltas. */
export function formatDelta(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatNumber(value)}`;
}

export function formatDate(input: string | Date, style: 'short' | 'long' = 'short'): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    month: style === 'short' ? 'short' : 'long',
    day: 'numeric',
    ...(style === 'long' ? { year: 'numeric' } : {}),
  });
}

export function formatDateTime(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "just now" / "4m ago" / "3h ago" / "Aug 12" — for the live activity feed. */
export function formatRelative(input: string | Date, now: number = Date.now()): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return '—';
  const diffSec = Math.round((now - date.getTime()) / 1000);
  if (diffSec < 45) return 'just now';
  if (diffSec < 90) return '1m ago';
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(date);
}

/** Truncate a long URL path in the middle so both ends stay recognisable. */
export function truncateMiddle(input: string, max = 60): string {
  if (input.length <= max) return input;
  const half = Math.floor((max - 1) / 2);
  return `${input.slice(0, half)}…${input.slice(-half)}`;
}

/** Percentage share of a total, guarding against divide-by-zero. */
export function share(value: number, total: number): number {
  if (total <= 0) return 0;
  return (value / total) * 100;
}
