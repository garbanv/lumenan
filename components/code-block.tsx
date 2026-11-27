'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SnippetProps {
  label: string;
  description?: string;
  code: string;
}

/**
 * A labelled code block with a copy button, a language hint, and a fallback for
 * the clipboard API being unavailable (which happens on non-HTTPS origins).
 */
export function CodeBlock({ label, description, code }: SnippetProps) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setFailed(false);
    } catch {
      // Older browsers and insecure origins. The text is selectable, so point
      // the user at it rather than failing silently.
      setFailed(true);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{label}</p>
          {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
        </div>
        <Button variant="ghost" size="sm" onClick={copy} className="shrink-0">
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Copy
            </>
          )}
        </Button>
      </div>

      <pre
        className={cn(
          'overflow-x-auto px-4 py-4 font-mono text-xs leading-relaxed',
          'bg-background/50'
        )}
      >
        <code>{code}</code>
      </pre>

      {failed && (
        <p role="status" className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Copying is unavailable here. Select the code above and copy it manually.
        </p>
      )}
    </div>
  );
}
