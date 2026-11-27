import { cn } from '@/lib/utils';

/**
 * Loading placeholder. `aria-hidden` plus a live region elsewhere in the page is
 * preferable to announcing each block, so these stay out of the accessibility
 * tree and the container announces "Loading" once.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('skeleton h-4 w-full', className)} {...props} />;
}

/** A full stat card placeholder, matching the real card's dimensions. */
export function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-7 w-24" />
      <Skeleton className="mt-3 h-3 w-16" />
    </div>
  );
}

export function PanelSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center justify-between gap-4">
          <Skeleton className="h-4" style={{ width: `${55 - index * 4}%` }} />
          <Skeleton className="h-4 w-10" />
        </div>
      ))}
    </div>
  );
}
