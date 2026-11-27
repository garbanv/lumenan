import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn, formatNumber, formatPercent } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string;
  /** Secondary line under the value, e.g. "42% of visitors". */
  detail?: string;
  /** Percentage change versus the previous period; null when not comparable. */
  change?: number | null;
  /** Whether a rise is good. Bounce rate rising is not. */
  higherIsBetter?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  detail,
  change,
  higherIsBetter = true,
  className,
}: StatCardProps) {
  const hasChange = typeof change === 'number' && Number.isFinite(change);
  // Treat sub-0.1% movement as flat: rendering "+0.0%" is noise.
  const isFlat = hasChange && Math.abs(change) < 0.1;
  const isGood = hasChange ? (change > 0) === higherIsBetter : true;

  return (
    <div className={cn('rounded-xl border border-border bg-card p-5', className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="tabular mt-2 text-2xl font-semibold tracking-tight">{value}</p>

      <div className="mt-2 flex min-h-[20px] items-center gap-2 text-xs">
        {hasChange ? (
          <>
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-medium',
                isFlat
                  ? 'text-muted-foreground'
                  : isGood
                    ? 'text-success'
                    : 'text-destructive'
              )}
            >
              {isFlat ? (
                <Minus className="h-3 w-3" aria-hidden="true" />
              ) : change > 0 ? (
                <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
              )}
              {formatPercent(Math.abs(change), 1)}
            </span>
            <span className="text-muted-foreground">vs previous period</span>
          </>
        ) : (
          <span className="text-muted-foreground">{detail ?? 'No prior data to compare'}</span>
        )}
      </div>

      {hasChange && detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

/** Compact variant for secondary metrics that do not need a trend. */
export function MiniStat({
  label,
  value,
  className,
}: {
  label: string;
  value: string | number;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-border bg-card px-4 py-3', className)}>
      <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="tabular mt-1 text-lg font-semibold">
        {typeof value === 'number' ? formatNumber(value) : value}
      </p>
    </div>
  );
}
