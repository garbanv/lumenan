'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

const SORTS = [
  { value: 'created', label: 'Newest first' },
  { value: 'pageviews', label: 'Most pageviews' },
  { value: 'sites', label: 'Most sites' },
  { value: 'email', label: 'Email A–Z' },
];

const PLANS = [
  { value: 'all', label: 'All plans' },
  { value: 'free', label: 'Free' },
  { value: 'pro', label: 'Pro' },
];

const STATUSES = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'past_due', label: 'Past due' },
  { value: 'canceled', label: 'Canceled' },
  { value: 'paused', label: 'Paused' },
  { value: 'none', label: 'No subscription' },
];

/**
 * Filters drive the URL rather than local state.
 *
 * That keeps the page server-rendered, makes a filtered view shareable and
 * bookmarkable, and means the browser back button walks backwards through
 * filter changes — all of which matter when an operator is working through a
 * list of accounts.
 */
export function UserFilters({ total }: { total: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [search, setSearch] = useState(searchParams.get('q') ?? '');

  // Keep the input in sync when navigation changes the query (e.g. back button).
  useEffect(() => {
    setSearch(searchParams.get('q') ?? '');
  }, [searchParams]);

  function apply(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value || value === 'all') params.delete(key);
      else params.set(key, value);
    }
    // Any filter change invalidates the current page number.
    params.delete('page');
    startTransition(() => {
      router.replace(`/admin/users?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <form
      className="flex flex-wrap items-center gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        apply({ q: search });
      }}
      role="search"
    >
      <div className="relative min-w-[220px] flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search email, name or site id"
          aria-label="Search users"
          className="pl-9"
        />
      </div>

      <div className="w-[150px]">
        <Select
          value={searchParams.get('plan') ?? 'all'}
          onChange={(event) => apply({ plan: event.target.value })}
          aria-label="Filter by plan"
        >
          {PLANS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="w-[170px]">
        <Select
          value={searchParams.get('status') ?? 'all'}
          onChange={(event) => apply({ status: event.target.value })}
          aria-label="Filter by billing status"
        >
          {STATUSES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="w-[170px]">
        <Select
          value={searchParams.get('sort') ?? 'created'}
          onChange={(event) => apply({ sort: event.target.value })}
          aria-label="Sort by"
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? 'Searching…' : 'Search'}
      </Button>

      {pending && <span className="text-xs text-muted-foreground">Updating…</span>}

      <span className="ml-auto text-xs text-muted-foreground" role="status">
        {total === 1 ? '1 user' : `${total.toLocaleString()} users`}
      </span>
    </form>
  );
}

/** Pagination that preserves the active filters. */
export function UserPagination({
  page,
  totalPages,
}: {
  page: number;
  totalPages: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  if (totalPages <= 1) return null;

  function go(next: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (next <= 1) params.delete('page');
    else params.set('page', String(next));
    startTransition(() => {
      router.replace(`/admin/users?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-xs text-muted-foreground">
        Page {page} of {totalPages}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => go(page - 1)}
          disabled={page <= 1 || pending}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => go(page + 1)}
          disabled={page >= totalPages || pending}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
