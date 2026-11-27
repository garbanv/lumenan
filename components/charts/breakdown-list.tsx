import { cn, formatExact, share } from '@/lib/utils';
import type { BreakdownRow } from '@/lib/types';

interface BreakdownListProps {
  data: BreakdownRow[];
  /** Renders a progress bar behind each row proportional to its share. */
  showBar?: boolean;
  /** Optional link builder; the row label becomes a link when provided. */
  hrefFor?: (row: BreakdownRow) => string;
  /** Custom renderer for the label, e.g. a monospace path or a flag. */
  renderLabel?: (label: string, row: BreakdownRow) => React.ReactNode;
  emptyMessage?: string;
  className?: string;
}

/**
 * Ranked list used for top pages, referrers, countries and event names.
 *
 * The bar is drawn from the top row's value rather than the sum, so the leading
 * entry always fills the track and differences between the rest stay visible.
 */
export function BreakdownList({
  data,
  showBar = true,
  hrefFor,
  renderLabel,
  emptyMessage = 'No data in this range',
  className,
}: BreakdownListProps) {
  if (data.length === 0) {
    return <p className={cn('py-8 text-center text-sm text-muted-foreground', className)}>{emptyMessage}</p>;
  }

  const max = Math.max(...data.map((row) => row.value));
  const total = data.reduce((sum, row) => sum + row.value, 0);

  return (
    <ul className={cn('space-y-1', className)}>
      {data.map((row) => {
        const width = max > 0 ? (row.value / max) * 100 : 0;
        const content = (
          <>
            {showBar && (
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 rounded-md bg-primary/[0.07] transition-[width] duration-300"
                style={{ width: `${width}%` }}
              />
            )}
            <span className="relative min-w-0 truncate">
              {renderLabel ? renderLabel(row.label, row) : row.label}
            </span>
            <span className="relative shrink-0 tabular text-muted-foreground">
              {formatExact(row.value)}
              <span className="ml-2 hidden text-xs text-muted-foreground/70 sm:inline">
                {Math.round(share(row.value, total))}%
              </span>
            </span>
          </>
        );

        return (
          <li key={`${row.label}-${row.value}`}>
            {hrefFor ? (
              <a
                href={hrefFor(row)}
                className="relative flex items-center justify-between gap-4 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {content}
              </a>
            ) : (
              <div className="relative flex items-center justify-between gap-4 rounded-md px-2 py-1.5 text-sm">
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
