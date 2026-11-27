import Link from "next/link"
import {
  ArrowRight,
  BarChart3,
  Cookie,
  Gauge,
  Globe2,
  ServerCog,
  ShieldCheck,
  Zap,
} from "lucide-react"
import { Wordmark } from "@/components/logo"
import { ThemeToggle } from "@/components/theme-toggle"
import { Badge } from "@/components/ui/badge"
import { PLAN_LIMITS, type PlanLimits } from "@/lib/plans"
import { getCurrentUser } from "@/lib/session"

// Reads the session cookie, so it cannot be statically prerendered.
export const dynamic = "force-dynamic"

export default async function LandingPage() {
  const user = await getCurrentUser()

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="container flex h-14 items-center justify-between">
          <Wordmark />
          <nav className="flex items-center gap-1" aria-label="Main">
            <a
              href="#pricing"
              className="hidden rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:block"
            >
              Pricing
            </a>
            <a
              href="#privacy"
              className="hidden rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:block"
            >
              Privacy
            </a>
            <ThemeToggle />
            {user ? (
              <Link
                href="/sites"
                className="ml-2 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Open dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className="ml-1 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Start free
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* ---------------- hero ---------------- */}
        <section className="relative overflow-hidden">
          <div
            className="bg-grid pointer-events-none absolute inset-0"
            aria-hidden="true"
          />
          <div className="container relative py-20 text-center sm:py-28">
            <Badge variant="outline" className="mb-6">
              <Cookie className="mr-1.5 h-3 w-3" aria-hidden="true" />
              No cookies. No consent banner.
            </Badge>

            <h1 className="mx-auto max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
              Website analytics you can actually{" "}
              <span className="bg-gradient-to-r from-primary to-chart-2 bg-clip-text text-transparent">
                read in seconds
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-pretty text-lg text-muted-foreground">
              One lightweight script, one clear dashboard. No visitor tracking,
              no personal data, and nothing to configure before your first
              pageview lands.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href={user ? "/sites" : "/signup"}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {user ? "Open dashboard" : "Start for free"}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <a
                href="#how"
                className="inline-flex h-11 items-center rounded-lg border border-input px-6 text-sm font-medium transition-colors hover:bg-secondary"
              >
                See how it works
              </a>
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              Free forever for up to {PLAN_LIMITS.free.sites} sites. No credit
              card.
            </p>
          </div>
        </section>

        {/* ---------------- feature grid ---------------- */}
        <section id="how" className="container scroll-mt-20 pb-20">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Feature
              icon={<Zap className="h-4 w-4" />}
              title="Install in one line"
              body="A single script tag, or one import in your Next.js root layout. No SDK, no build step, no vendor lock-in."
            />
            <Feature
              icon={<Gauge className="h-4 w-4" />}
              title="Loads in milliseconds"
              body="The tracker is 3.8&nbsp;KB raw, ~1.3&nbsp;KB compressed, loads async, and never blocks rendering. Dashboard queries run against indexed time windows."
            />
            <Feature
              icon={<ShieldCheck className="h-4 w-4" />}
              title="No personal data, ever"
              body="Visitor identifiers are salted hashes that rotate every day. Raw IP addresses are never written to disk."
            />
            <Feature
              icon={<Globe2 className="h-4 w-4" />}
              title="Countries without GeoIP"
              body="Reads the country header your CDN already sends, so there is no database to download or keep up to date."
            />
            <Feature
              icon={<BarChart3 className="h-4 w-4" />}
              title="The numbers that matter"
              body="Pageviews, visitors, bounce rate, top pages and referrers, devices and countries — and a live event feed."
            />
            <Feature
              icon={<ServerCog className="h-4 w-4" />}
              title="Yours to self-host"
              body="One Postgres database and one Node process. Run it on a VPS, or bring your own managed Postgres."
            />
          </div>
        </section>

        {/* ---------------- privacy ---------------- */}
        <section
          id="privacy"
          className="scroll-mt-20 border-y border-border bg-card/40 py-20"
        >
          <div className="container grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">
                Built so you never need a consent banner
              </h2>
              <p className="mt-4 text-muted-foreground">
                Most analytics tools identify people, then ask permission
                afterwards. This one never identifies anyone, which removes the
                question entirely.
              </p>
              <ul className="mt-6 space-y-3 text-sm">
                {[
                  "No cookies and no localStorage — nothing is stored in the browser.",
                  "The visitor hash rotates at UTC midnight, so nobody can be followed across days.",
                  "Raw IP addresses are used as hash input and immediately discarded.",
                  "Do Not Track is respected, and obvious bots are filtered before they are counted.",
                ].map((item) => (
                  <li key={item} className="flex gap-3">
                    <ShieldCheck
                      className="mt-0.5 h-4 w-4 shrink-0 text-success"
                      aria-hidden="true"
                    />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-xs text-muted-foreground">
                This describes how the software works, not legal advice for your
                jurisdiction.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                What one pageview records
              </p>
              <dl className="mt-4 divide-y divide-border text-sm">
                {[
                  ["Page path", "/pricing?ref=hn"],
                  ["Referrer domain", "news.ycombinator.com"],
                  ["Country", "DE"],
                  ["Device, browser, OS", "desktop · Firefox · macOS"],
                  ["Visitor", "a94f…c21e (rotates daily)"],
                ].map(([term, value]) => (
                  <div
                    key={term}
                    className="flex items-center justify-between gap-4 py-2.5"
                  >
                    <dt className="text-muted-foreground">{term}</dt>
                    <dd className="font-mono text-xs">{value}</dd>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-muted-foreground">IP address</dt>
                  <dd className="text-xs font-medium text-destructive">
                    never stored
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        {/* ---------------- pricing ---------------- */}
        <section id="pricing" className="container scroll-mt-20 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight">
              Straightforward pricing
            </h2>
            <p className="mt-3 text-muted-foreground">
              Start free. Upgrade when you outgrow it — the limits are enforced
              in the app, not by a sales call.
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-3xl gap-6 sm:grid-cols-2">
            <PlanCard
              plan={PLAN_LIMITS.free}
              planKey="free"
              signedIn={!!user}
            />
            <PlanCard
              plan={PLAN_LIMITS.pro}
              planKey="pro"
              signedIn={!!user}
              highlighted
            />
          </div>
        </section>

        {/* ---------------- closing cta ---------------- */}
        <section className="container pb-24">
          <div className="rounded-2xl border border-border bg-gradient-to-b from-accent/50 to-transparent px-8 py-14 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">
              Add your first site in a minute
            </h2>
            <p className="mx-auto mt-3 max-w-md text-muted-foreground">
              Create an account, paste one script tag, and watch the first
              events arrive.
            </p>
            <Link
              href={user ? "/sites" : "/signup"}
              className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {user ? "Open dashboard" : "Create your account"}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8">
        <div className="container flex flex-col items-center justify-between gap-3 text-xs text-muted-foreground sm:flex-row">
          <Wordmark />
          <p>Privacy-first analytics. Built with Next.js and PostgreSQL.</p>
        </div>
      </footer>
    </div>
  )
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        {icon}
      </div>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
    </div>
  )
}

function PlanCard({
  plan,
  planKey,
  highlighted,
  signedIn,
}: {
  plan: PlanLimits
  planKey: "free" | "pro"
  highlighted?: boolean
  signedIn: boolean
}) {
  return (
    <div
      className={
        highlighted
          ? "relative rounded-xl border-2 border-primary bg-card p-8"
          : "relative rounded-xl border border-border bg-card p-8"
      }
    >
      {highlighted && (
        <Badge className="absolute top-1.5 left-6">Most popular</Badge>
      )}
      <h3 className="text-sm font-semibold">{plan.name}</h3>
      <p className="mt-3">
        <span className="text-3xl font-semibold tracking-tight">
          ${plan.price}
        </span>
        <span className="text-sm text-muted-foreground"> / month</span>
      </p>
      <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
        <li>{plan.sites} websites</li>
        <li>{plan.monthlyEvents.toLocaleString()} events / month</li>
        <li>{plan.retentionDays} days of history</li>
        <li>Unlimited team members</li>
      </ul>
      <Link
        href={
          signedIn
            ? "/settings"
            : planKey === "free"
              ? "/signup"
              : "/signup?plan=pro"
        }
        className={
          highlighted
            ? "mt-6 inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            : "mt-6 inline-flex h-10 w-full items-center justify-center rounded-lg border border-input text-sm font-medium transition-colors hover:bg-secondary"
        }
      >
        {planKey === "free" ? "Start for free" : "Upgrade to Pro"}
      </Link>
    </div>
  )
}
