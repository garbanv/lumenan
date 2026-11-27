'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldError, FieldHint, Label } from '@/components/ui/label';

interface ApiErrorBody {
  error?: string;
  fields?: Record<string, string>;
}

/**
 * Add-site form. Creates the site and then navigates to its tracking-code page,
 * because "now paste this" is unambiguously the next thing the user needs.
 */
export function NewSiteForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const response = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, domain }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
        setFormError(body.error ?? 'Could not create the site.');
        setFieldErrors(body.fields ?? {});
        return;
      }

      const body = (await response.json()) as { site: { id: string } };
      router.push(`/sites/${encodeURIComponent(body.site.id)}/code`);
      router.refresh();
    } catch {
      setFormError('Network error. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-lg space-y-6" noValidate>
      {formError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {formError}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="name">Site name</Label>
        <Input
          id="name"
          name="name"
          required
          autoFocus
          placeholder="My Blog"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={!!fieldErrors.name}
          aria-describedby={fieldErrors.name ? 'name-error' : undefined}
        />
        {fieldErrors.name ? (
          <FieldError id="name-error">{fieldErrors.name}</FieldError>
        ) : (
          <FieldHint id="name-hint">Only shown inside this dashboard.</FieldHint>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="domain">Domain</Label>
        <Input
          id="domain"
          name="domain"
          required
          placeholder="example.com"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          aria-invalid={!!fieldErrors.domain}
          aria-describedby={fieldErrors.domain ? 'domain-error' : 'domain-hint'}
        />
        {fieldErrors.domain ? (
          <FieldError id="domain-error">{fieldErrors.domain}</FieldError>
        ) : (
          <FieldHint id="domain-hint">
            The site you want to track. Subdomains are accepted, and events from other hosts are
            rejected by default.
          </FieldHint>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? 'Creating…' : 'Create site'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          onClick={() => router.push('/sites')}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
