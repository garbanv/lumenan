import { NextResponse } from 'next/server';
import { isCrossOrigin, jsonError, readJson } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import {
  deleteSiteForUser,
  getSiteForUser,
  invalidateSiteCache,
  updateSiteForUser,
} from '@/lib/sites';
import { normalizeDomain, parseDomainList } from '@/lib/slug';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, props: RouteContext) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return jsonError('Not signed in.', 401);

  try {
    const site = await getSiteForUser(params.id, user.id);
    // A site owned by someone else is reported as missing, not forbidden: a 403
    // would confirm that this id exists.
    if (!site) return jsonError('Site not found.', 404);
    return NextResponse.json({ site });
  } catch (err) {
    console.error('Failed to load site:', err);
    return jsonError('Could not load the site.', 500);
  }
}

interface UpdateSiteBody {
  name?: string;
  domain?: string;
  allowedDomains?: string | string[];
  excludedPaths?: string | string[];
  excludeSelfReferrals?: boolean;
}

export async function PATCH(req: Request, props: RouteContext) {
  const params = await props.params;
  if (isCrossOrigin(req)) return jsonError('Cross-origin request rejected.', 403);

  const user = await getCurrentUser();
  if (!user) return jsonError('Not signed in.', 401);

  const { data, error } = await readJson<UpdateSiteBody>(req);
  if (error) return error;

  const fields: Record<string, string> = {};

  const name = data?.name?.trim();
  if (name !== undefined && !name) fields.name = 'Name cannot be empty.';

  let domain: string | undefined;
  if (data?.domain !== undefined) {
    const normalized = normalizeDomain(data.domain);
    if (!normalized) fields.domain = 'Enter a valid domain, for example example.com.';
    else domain = normalized;
  }

  if (Object.keys(fields).length > 0) {
    return jsonError('Please fix the highlighted fields.', 400, fields);
  }

  try {
    const site = await updateSiteForUser(params.id, user.id, {
      ...(name !== undefined ? { name: name.slice(0, 120) } : {}),
      ...(domain !== undefined ? { domain } : {}),
      ...(data?.allowedDomains !== undefined
        ? { allowedDomains: toList(data.allowedDomains) }
        : {}),
      ...(data?.excludedPaths !== undefined ? { excludedPaths: toList(data.excludedPaths) } : {}),
      ...(data?.excludeSelfReferrals !== undefined
        ? { excludeSelfReferrals: data.excludeSelfReferrals }
        : {}),
    });

    if (!site) return jsonError('Site not found.', 404);

    invalidateSiteCache();
    return NextResponse.json({ site });
  } catch (err) {
    console.error('Failed to update site:', err);
    return jsonError('Could not update the site.', 500);
  }
}

export async function DELETE(req: Request, props: RouteContext) {
  const params = await props.params;
  if (isCrossOrigin(req)) return jsonError('Cross-origin request rejected.', 403);

  const user = await getCurrentUser();
  if (!user) return jsonError('Not signed in.', 401);

  try {
    const deleted = await deleteSiteForUser(params.id, user.id);
    if (!deleted) return jsonError('Site not found.', 404);
    // Events and visitors cascade with the site row.
    invalidateSiteCache();
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('Failed to delete site:', err);
    return jsonError('Could not delete the site.', 500);
  }
}

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
