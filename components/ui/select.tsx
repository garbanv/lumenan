import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/**
 * A styled native <select>. Native beats a custom listbox here: it is
 * keyboard-accessible and mobile-friendly for free, which is what a range
 * picker needs.
 */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          'h-9 w-full cursor-pointer appearance-none rounded-lg border border-input bg-background ' +
            'py-1 pl-3 pr-9 text-sm shadow-sm transition-colors ' +
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
            'focus-visible:ring-offset-1 focus-visible:ring-offset-background ' +
            'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
);
Select.displayName = 'Select';

export { Select };
