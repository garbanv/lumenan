import Link from 'next/link';
import { Wordmark } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <div className="container flex h-14 items-center justify-between">
          <Link
            href="/"
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Wordmark />
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-12">{children}</main>

      <footer className="container py-6 text-center text-xs text-muted-foreground">
        <Link href="/" className="transition-colors hover:text-foreground">
          ← Back to home
        </Link>
      </footer>
    </div>
  );
}
