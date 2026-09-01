import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { enforceRateLimit, clientIp } from "@/lib/rateLimit";
import { BadRequestError } from "@/lib/validate";
import { log, errorFields } from "@/lib/logger";
import { compressResponse } from "@/lib/compressResponse";
import type { SessionUser } from "@/types";

// Per-user cap across all authed routes (S3/P7). These routes proxy third-party
// APIs with our keys, so this blunts a single account draining TMDB/RAWG quota.
// Generous enough not to bother normal infinite-scroll/facet bursts (~5/s).
const USER_LIMIT = 300;
const USER_WINDOW_MS = 60_000;

// Uniform auth + error handling for API routes (A6). Wrap a handler so every
// route gets the same behavior in one place instead of the copy-pasted
// `try { const session = await requireSession() … } catch (Unauthorized→401/…→500)`:
//   export const POST = withUser(async (req, session) => { … });
// The handler receives the authenticated session; throwing inside it becomes a
// logged 500. Any trailing route-context args (dynamic params) pass through.
export function withUser<A extends unknown[]>(
  handler: (req: NextRequest, session: SessionUser, ...rest: A) => Promise<Response> | Response,
) {
  return async (req: NextRequest, ...rest: A): Promise<Response> => {
    let session: SessionUser;
    try {
      session = await requireSession();
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const limited = enforceRateLimit(`user:${session.userId}`, USER_LIMIT, USER_WINDOW_MS);
    if (limited) return limited;
    const path = (() => { try { return new URL(req.url).pathname; } catch { return req.url; } })();
    try {
      // gzip on the way out. Next installs the `compression` middleware but its
      // filter rejects every route handler response, so this is the only place
      // an /api/ payload gets compressed at all. → lib/compressResponse.ts
      return await compressResponse(req, await handler(req, session, ...rest));
    } catch (e) {
      // S8: schema-validation failures are the caller's fault → 400, not 500.
      if (e instanceof BadRequestError) {
        // P9: warn (not error) — client fault, but worth surfacing for abuse/bad clients.
        log.warn("api_bad_request", { method: req.method, path, userId: session.userId, error: e.message });
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      // P9: structured error log on the 500 funnel (method/path/user + error/stack).
      log.error("api_error", { method: req.method, path, userId: session.userId, ...errorFields(e) });
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
  };
}

// The same uniform error handling, for a route that serves BOTH an anonymous
// and a signed-in caller (2026-08-18). The handler gets `session` or null and is
// responsible for degrading gracefully — typically by passing the userId
// straight through to `persistDiscoverBatch`, whose anonymous branch resolves
// existing rows read-only and writes nothing (PR15's gate is enforced there, not
// here).
//
// Rate limiting keys on the user when there is one and on the client IP when
// there isn't. The anon cap is tighter than USER_LIMIT because an anonymous
// caller is un-attributable and potentially a crawler.
//
// SIZE THE OVERRIDE TO WHAT THE ROUTE ACTUALLY SPENDS, not to a feeling. The
// default suits a route that only reads local state; a route that reaches a
// provider on our keys should pass something much lower. Getting this backwards
// in the tight direction is a live bug, not a safe default: `/api/discover/facets`
// backs the nav search box, which fires TWO requests per debounced keystroke, so
// a 60/min cap 429s an ordinary person typing — while a 60/min cap on a route
// that fans out to TMDB and RAWG is exactly right.
const ANON_LIMIT = 240;
const ANON_WINDOW_MS = 60_000;

export interface OptionalUserOptions {
  /** Per-IP requests/minute for an anonymous caller. Defaults to ANON_LIMIT. */
  anonLimit?: number;
}

export function withOptionalUser<A extends unknown[]>(
  handler: (req: NextRequest, session: SessionUser | null, ...rest: A) => Promise<Response> | Response,
  { anonLimit = ANON_LIMIT }: OptionalUserOptions = {},
) {
  return async (req: NextRequest, ...rest: A): Promise<Response> => {
    let session: SessionUser | null = null;
    try {
      session = await requireSession();
    } catch {
      session = null;
    }
    const limited = session
      ? enforceRateLimit(`user:${session.userId}`, USER_LIMIT, USER_WINDOW_MS)
      : enforceRateLimit(`anon:${clientIp(req)}`, anonLimit, ANON_WINDOW_MS);
    if (limited) return limited;
    const path = (() => { try { return new URL(req.url).pathname; } catch { return req.url; } })();
    try {
      // gzip on the way out. Next installs the `compression` middleware but its
      // filter rejects every route handler response, so this is the only place
      // an /api/ payload gets compressed at all. → lib/compressResponse.ts
      return await compressResponse(req, await handler(req, session, ...rest));
    } catch (e) {
      if (e instanceof BadRequestError) {
        log.warn("api_bad_request", { method: req.method, path, userId: session?.userId ?? null, error: e.message });
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      log.error("api_error", { method: req.method, path, userId: session?.userId ?? null, ...errorFields(e) });
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
  };
}
