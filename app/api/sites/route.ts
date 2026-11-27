import { NextResponse } from 'next/server';
import { isCrossOrigin, jsonError, readJson } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import {
  countSitesForUser,
  createSite,
  invalidateSiteCache,
  listSitesForUser,
} from '@/lib/sites';
import { normalizeDomain, parseDomainList } from '@/lib/slug';
import { PLAN_LIMITS } from '@/lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError('Not signed in.', 401);

  try {
    const sites = await listSitesForUser(user.id);
    return NextResponse.json({ sites });
  } catch (err) {
    console.error('Failed to list sites:', err);
    return jsonError('Could not load your sites.', 500);
  }
}

interface CreateSiteBody {
  name?: string;
  domain?: string;
  allowedDomains?: string | string[];
  excludedPaths?: string | string[];
}

export async function POST(req: Request) {
  if (isCrossOrigin(req)) return jsonError('Cross-origin request rejected.', 403);

  const user = await getCurrentUser();
  if (!user) return jsonError('Not signed in.', 401);

  const { data, error } = await readJson<CreateSiteBody>(req);
  if (error) return error;

  const name = (data?.name ?? '').trim();
  const domain = normalizeDomain(data?.domain ?? '');

  const fields: Record<string, string> = {};
  if (!name) fields.name = 'Give this site a name.';
  if (!data?.domain?.trim()) fields.domain = 'Domain is required.';
  else if (!domain) fields.domain = 'Enter a valid domain, for example example.com.';

  if (Object.keys(fields).length > 0) {
    return jsonError('Please fix the highlighted fields.', 400, fields);
  }

  try {
    const limit = PLAN_LIMITS[user.plan].sites;
    const existing = await countSitesForUser(user.id);
    if (existing >= limit) {
      return jsonError(
        `Your ${user.plan} plan includes ${limit} sites. Remove one or upgrade to add more.`,
        402
      );
    }

    const allowedDomains = toList(data?.allowedDomains);
    const excludedPaths = toList(data?.excludedPaths);

    const result = await createSite(user.id, {
      name,
      domain: domain as string,
      // Default the allowlist to the domain being added, so a new site works
      // immediately without the user having to configure anything.
      allowedDomains: allowedDomains.length > 0 ? allowedDomains : [domain as string],
      excludedPaths,
      excludeSelfReferrals: true,
    });

    if (!result.ok) {
      return jsonError('Could not generate a unique site ID. Please try again.', 500);
    }

    invalidateSiteCache();
    return NextResponse.json({ site: result.site }, { status: 201 });
  } catch (err) {
    console.error('Failed to create site:', err);
    return jsonError('Could not create the site.', 500);
  }
}

/**
 * Accepts either an array (JSON API) or a comma/newline separated string (form
 * submission), so the same route serves both callers.
 */
function toList(input: string | string[] | undefined): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .map((value) => normalizeDomain(value) ?? value.trim().toLowerCase())
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index);
  }
  return parseDomainList(input);
}
