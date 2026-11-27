import { cn } from '@/lib/utils';

/**
 * Truncated single-line URL path, with the leading segment emphasised.
 *
 * Long paths are the norm in an analytics table, so this keeps the start (which
 * identifies the section) and elides the rest rather than clipping the end.
 */
export function PathLabel({ path, className }: { path: string; className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-baseline gap-1 font-mono text-xs', className)} title={path}>
      <span className="truncate">{path}</span>
    </span>
  );
}

/** Country code with its flag emoji, avoiding a lookup table or image sprite. */
export function CountryLabel({ code }: { code: string }) {
  const flag = countryFlag(code);
  return (
    <span className="flex items-center gap-2">
      {flag && (
        <span aria-hidden="true" className="text-base leading-none">
          {flag}
        </span>
      )}
      <span>{code}</span>
    </span>
  );
}

/**
 * Regional indicator symbols: 'US' -> 🇺🇸. The flag renders as two letters on
 * platforms without emoji flags (notably Windows), which is why the country
 * code is always shown alongside it.
 */
function countryFlag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '';
  const base = 0x1f1e6;
  const points = [...code].map((char) => base + (char.charCodeAt(0) - 65));
  return String.fromCodePoint(...points);
}
