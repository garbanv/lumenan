'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldError, FieldHint, Label } from '@/components/ui/label';
import { MIN_PASSWORD_LENGTH, validatePassword } from '@/lib/password';

interface ApiErrorBody {
  error?: string;
  fields?: Record<string, string>;
}

export function SignupForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  // Mirrors the server-side rules so the user gets feedback before submitting.
  // The server revalidates regardless; this is convenience, not enforcement.
  const passwordProblem = useMemo(
    () => (password.length > 0 ? validatePassword(password) : null),
    [password]
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
        setFormError(body.error ?? 'Could not create your account.');
        setFieldErrors(body.fields ?? {});
        return;
      }

      // The signup route sets the session cookie, so go straight to the app.
      router.push('/sites?welcome=1');
      router.refresh();
    } catch {
      setFormError('Network error. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Free for up to 3 sites. No credit card required.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        {formError && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {formError}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Optional"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
          />
          {fieldErrors.email && <FieldError id="email-error">{fieldErrors.email}</FieldError>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={!!(fieldErrors.password || passwordProblem)}
            aria-describedby="password-hint"
          />
          {fieldErrors.password ? (
            <FieldError id="password-hint">{fieldErrors.password}</FieldError>
          ) : passwordProblem ? (
            <FieldError id="password-hint">{passwordProblem.message}</FieldError>
          ) : (
            <FieldHint id="password-hint">
              At least {MIN_PASSWORD_LENGTH} characters. A passphrase beats a short complex password.
            </FieldHint>
          )}
        </div>

        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          {pending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
