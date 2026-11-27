import { NextResponse } from 'next/server';

/**
 * Small helpers shared by the route handlers so error shapes stay consistent:
 * every failure is `{ error: string, fields?: Record<string, string> }`.
 */

export function jsonError(
  message: string,
  status: number,
  fields?: Record<string, string>
): NextResponse {
  return NextResponse.json({ error: message, ...(fields ? { fields } : {}) }, { status });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export interface ParsedBody<T> {
  data?: T;
  error?: NextResponse;
}

/** Read a JSON body, returning a 400 response instead of throwing on garbage. */
export async function readJson<T>(req: Request): Promise<ParsedBody<T>> {
  try {
    const data = (await req.json()) as T;
    if (typeof data !== 'object' || data === null) {
      return { error: jsonError('Expected a JSON object.', 400) };
    }
    return { data };
  } catch {
    return { error: jsonError('Invalid JSON body.', 400) };
  }
}

/**
 * Browser-only fetch guard for state-changing requests.
 *
 * SameSite=Lax on the session cookie already blocks cross-site POSTs in
 * current browsers, so this is defence in depth. A missing Origin (curl, a
 * server-to-server call, some privacy tooling) is allowed through rather than
 * rejected, because Origin is not guaranteed on same-origin GETs and blocking
 * on its absence breaks legitimate clients. Such clients cannot carry the
 * session cookie cross-site anyway.
 */
export function isCrossOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const host = req.headers.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}
