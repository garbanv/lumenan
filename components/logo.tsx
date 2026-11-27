import { cn } from '@/lib/utils';

/** The product mark: a small bar-chart glyph in the primary colour. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground',
        className
      )}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M5 19V11M12 19V5M19 19v-5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <Logo />
      <span className="text-sm font-semibold tracking-tight">Analytics</span>
    </span>
  );
}
