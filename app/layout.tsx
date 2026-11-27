import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { themeInitScript } from '@/components/theme-toggle';
import { publicOrigin } from '@/lib/env';
import './globals.css';

// Self-hosted by next/font, so there is no layout shift and no third-party
// request. `display: swap` keeps first paint immediate.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(publicOrigin()),
  title: {
    default: 'Analytics — privacy-first website analytics',
    template: '%s · Analytics',
  },
  description:
    'Simple, cookie-free website analytics. No consent banner required, no personal data stored, and a dashboard that loads in milliseconds.',
  openGraph: {
    type: 'website',
    title: 'Analytics — privacy-first website analytics',
    description:
      'Simple, cookie-free website analytics. No consent banner required, no personal data stored.',
    siteName: 'Analytics',
  },
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1117' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
