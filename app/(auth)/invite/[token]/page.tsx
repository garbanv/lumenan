import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import { getInviteByToken } from '@/lib/team';
import { emailAllowed } from '@/lib/team.mjs';
import { AcceptInvite } from './accept-invite';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Invitation',
  robots: { index: false, follow: false, nocache: true },
  // The token is in the URL: keep it out of Referer headers and search engines.
  referrer: 'no-referrer',
};

const ROLE_TEXT = {
  manager: 'a manager. You can view the dashboard and change the site’s settings, goals and public link.',
  viewer: 'a viewer. You can view the dashboard.',
} as const;

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-2 space-y-4 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

const button =
  'inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium transition-colors';
const primary = `${button} bg-primary text-primary-foreground hover:bg-primary/90`;
const outline = `${button} border border-input bg-background text-foreground hover:bg-secondary`;

export default async function InvitePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const invite = await getInviteByToken(token);

  if (!invite) {
    return (
      <Shell title="Invitation not found">
        <p>This link is not valid. Check that you copied all of it, or ask for a new one.</p>
      </Shell>
    );
  }
  if (invite.status !== 'pending') {
    return (
      <Shell title={invite.status === 'accepted' ? 'Invitation already used' : 'Invitation expired'}>
        <p>
          {invite.status === 'accepted'
            ? 'This invitation has already been used. Each link works once.'
            : 'This invitation has expired. Ask the site owner for a new one.'}
        </p>
        <Link href="/login" className={primary}>
          Sign in
        </Link>
      </Shell>
    );
  }

  const user = await getCurrentUser();
  const next = `/invite/${token}`;

  return (
    <Shell title={`Join ${invite.siteName}`}>
      <p>
        You have been invited to <span className="font-medium text-foreground">{invite.siteName}</span>{' '}
        ({invite.siteDomain}) as {ROLE_TEXT[invite.role]}
      </p>

      {user ? (
        emailAllowed(invite.email, user.email) ? (
          <AcceptInvite token={token} signedInAs={user.email} />
        ) : (
          <p role="alert" className="text-destructive">
            This invitation was created for a different email address than the one you are signed in
            with ({user.email}). Sign out and use the invited address.
          </p>
        )
      ) : (
        <div className="flex flex-wrap gap-3">
          <Link href={`/signup?invite=${encodeURIComponent(token)}`} className={primary}>
            Create an account
          </Link>
          <Link href={`/login?next=${encodeURIComponent(next)}`} className={outline}>
            I already have one
          </Link>
        </div>
      )}
    </Shell>
  );
}
