'use client';

import { useEffect, useState } from 'react';
import { CodeBlock } from '@/components/code-block';

/**
 * Tracking snippets for one site.
 *
 * The script URL is derived from the address the dashboard is being viewed on,
 * so this must run on the client — the server has no reliable way to know the
 * public origin of the deployment.
 */
export function EmbedCode({ siteId }: { siteId: string }) {
  // Set after mount so server-rendered and client-rendered markup match.
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Show a placeholder origin until mounted rather than an empty string, so the
  // snippet is never briefly wrong in a way the user might copy.
  const base = origin || 'https://your-analytics-host';

  const htmlSnippet = `<script async defer data-site-id="${siteId}" src="${base}/track.js"></script>`;

  const reactSnippet = `import Script from 'next/script';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src="${base}/track.js"
          data-site-id="${siteId}"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}`;

  const eventSnippet = `// Anywhere on your site, after the script has loaded:
window.trackEvent('signup_completed');
window.trackEvent('upgrade_clicked');

// In a React component:
<button onClick={() => window.trackEvent('cta_clicked')}>
  Get started
</button>`;

  return (
    <div className="space-y-4">
      <CodeBlock
        label="HTML — paste before the closing </body> tag"
        description="Works with any framework, CMS or plain HTML."
        code={htmlSnippet}
      />

      <CodeBlock
        label="Next.js App Router — add to app/layout.tsx"
        description="Covers every route, including client-side navigation."
        code={reactSnippet}
      />

      <CodeBlock
        label="Custom events"
        description="Optional. Records a named event alongside pageviews."
        code={eventSnippet}
      />

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Verify the install</h2>
        <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li className="flex gap-3">
            <span className="font-mono text-xs text-foreground">1.</span>
            Deploy the snippet, then open your site in a new tab.
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-xs text-foreground">2.</span>
            Reload the dashboard — the first pageview appears within a few seconds.
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-xs text-foreground">3.</span>
            Visits from your own IP still count. To exclude them, add the path or use a separate
            browser profile.
          </li>
        </ol>
        <p className="mt-4 text-xs text-muted-foreground">
          Only hosts listed under Settings are accepted. Requests from anywhere else are recorded
          nowhere and return no error.
        </p>
      </div>
    </div>
  );
}
