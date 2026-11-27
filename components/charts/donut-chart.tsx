'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { cn, formatExact, formatPercent, share } from '@/lib/utils';
import type { BreakdownRow } from '@/lib/types';

interface DonutChartProps {
  data: BreakdownRow[];
  /** When provided, each legend row links here (the folded "Other" row never does). */
  hrefFor?: (row: BreakdownRow) => string;
  /** Rows beyond this are folded into "Other" so the ring stays readable. */
  maxSegments?: number;
  className?: string;
}

/** Series colours, in a fixed order so the same category keeps its colour. */
const SERIES = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--muted-foreground))',
];

/**
 * Donut + legend for a categorical breakdown (devices, browsers).
 *
 * The legend carries the numbers, so the ring is decorative and marked
 * `aria-hidden`; a screen reader gets the list, which is the useful part.
 */
export function DonutChart({ data, hrefFor, maxSegments = 5, className }: DonutChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  const segments = useMemo(() => {
    const sorted = [...data].sort((a, b) => b.value - a.value);
    if (sorted.length <= maxSegments) return sorted;

    const head = sorted.slice(0, maxSegments);
    const tail = sorted.slice(maxSegments);
    const otherValue = tail.reduce((sum, row) => sum + row.value, 0);
    // Label it with the real count so the total still reconciles.
    return [...head, { label: `Other (${tail.length})`, value: otherValue, meta: null }];
  }, [data, maxSegments]);

  const total = segments.reduce((sum, row) => sum + row.value, 0);

  if (total === 0) {
    return <p className={cn('py-8 text-center text-sm text-muted-foreground', className)}>No data</p>;
  }

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  // Small gap between arcs reads as separation without needing a stroke.
  const gap = segments.length > 1 ? 1.5 : 0;

  let offset = 0;

  return (
    <div className={cn('flex flex-col items-center gap-5 sm:flex-row sm:items-center', className)}>
      <div className="relative shrink-0">
        <svg viewBox="0 0 140 140" className="h-36 w-36 -rotate-90" aria-hidden="true">
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth="14"
          />
          {segments.map((segment, index) => {
            const fraction = segment.value / total;
            const length = Math.max(0, fraction * circumference - gap);
            const dash = `${length} ${circumference - length}`;
            const rotation = offset;
            offset += fraction * circumference;

            return (
              <circle
                key={segment.label}
                cx="70"
                cy="70"
                r={radius}
                fill="none"
                stroke={SERIES[index % SERIES.length]}
                strokeWidth={hovered === index ? 17 : 14}
                strokeDasharray={dash}
                strokeDashoffset={-rotation}
                className="transition-[stroke-width] duration-150"
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-xl font-semibold">
            {hovered !== null && segments[hovered]
              ? formatPercent(share(segments[hovered].value, total), 0)
              : formatExact(total)}
          </span>
          <span className="text-2xs text-muted-foreground">
            {hovered !== null && segments[hovered] ? segments[hovered].label : 'total'}
          </span>
        </div>
      </div>

      <ul className="w-full min-w-0 space-y-2">
        {segments.map((segment, index) => {
          const isOther = !data.some((row) => row.label === segment.label);
          const href = hrefFor && !isOther ? hrefFor(segment) : null;
          const row = (
            <>
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: SERIES[index % SERIES.length] }}
                />
                <span className="truncate capitalize">{segment.label}</span>
              </span>
              <span className="tabular shrink-0 text-muted-foreground">
                {formatExact(segment.value)}
                <span className="ml-2 text-xs">{formatPercent(share(segment.value, total), 0)}</span>
              </span>
            </>
          );
          return (
            <li
              key={segment.label}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
            >
              {href ? (
                <Link
                  href={href}
                  scroll={false}
                  className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-1 text-sm transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {row}
                </Link>
              ) : (
                <div className="flex items-center justify-between gap-3 text-sm">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
