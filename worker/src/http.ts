// Request/response plumbing shared by every route: JSON responses, CORS, the
// CSRF rule for cookie sessions, body reading with a size cap, rate limiting.

import type { Env } from "./env";
import type { Session } from "./auth/session";

const JSON_TYPE = "application/json; charset=utf-8";

/** `body` may be an already-serialised JSON string (the catalog reads hand those over) or a value. */
export function json(body: string | object | null, status = 200, headers: Record<string, string> = {}): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { "Content-Type": JSON_TYPE, ...headers } });
}

export function error(status: number, code: string, message?: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: code, ...(message ? { message } : {}), ...extra }, status, { "Cache-Control": "no-store" });
}

// ── Origins ──────────────────────────────────────────────────────────────────

export function allowedOrigins(env: Env): Set<string> {
  return new Set((env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

/** The request's Origin if it is one we serve a browser client from, else null. */
export function trustedOrigin(env: Env, request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  if (allowedOrigins(env).has(origin)) return origin;
  // Same-origin: the day the Worker serves fandex.org itself, the web client's
  // origin IS the API's.
  try {
    if (new URL(request.url).origin === origin) return origin;
  } catch { /* an unparseable url is not an origin */ }
  return null;
}

export function withCors(env: Env, request: Request, response: Response): Response {
  const origin = trustedOrigin(env, request);
  if (!origin) return response;
  const res = new Response(response.body, response);
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.append("Vary", "Origin");
  return res;
}

export function preflight(env: Env, request: Request): Response {
  const origin = trustedOrigin(env, request);
  if (!origin) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, If-None-Match",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}

/**
 * The CSRF rule. A bearer token cannot be attached by another site, so a bearer
 * session needs nothing. A COOKIE is attached by the browser to any request it
 * can be tricked into making, so a state-changing request on a cookie session
 * must come from an origin we serve.
 */
export function csrfOk(env: Env, request: Request, session: Session): boolean {
  if (session.via === "bearer") return true;
  if (request.method === "GET" || request.method === "HEAD") return true;
  return trustedOrigin(env, request) !== null;
}

// ── Bodies ───────────────────────────────────────────────────────────────────

export class BodyError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "BodyError";
  }
}

/**
 * Parse a JSON body, refusing one over `maxBytes`. The cap counts BYTES and is
 * checked while the body streams in, so a chunked body with no Content-Length
 * stops at the cap instead of being read whole first. A count of characters
 * let a non-ASCII body past the cap and into a D1 bind it was too big for.
 */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > maxBytes) throw new BodyError(413, "Request body too large");
  const text = await readCapped(request, maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new BodyError(400, "Request body is not valid JSON");
  }
}

async function readCapped(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyError(413, "Request body too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(bytes);
}

// ── Edge cache ───────────────────────────────────────────────────────────────

/**
 * An edge-cache hit, as the client should get it. The edge keeps its copy for
 * days, but the stored Cache-Control would tell a browser the same, and a
 * browser holding a week-old copy is never reached by a cache version bump. So
 * a hit carries the lifetime a miss sends.
 */
export function cachedAnswer(hit: Response, cacheControl = "public, max-age=3600"): Response {
  const res = new Response(hit.body, hit);
  res.headers.set("Cache-Control", cacheControl);
  return res;
}

// ── Rate limiting ────────────────────────────────────────────────────────────

/**
 * The rate limiters' key for a caller. An IPv6 address is cut to its /64: one
 * connection is usually handed a whole /64, so keying the full address let a
 * single client rotate past every limiter for free.
 */
export function clientIp(request: Request): string {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  // An IPv4-mapped address ("::ffff:1.2.3.4") is one host, not a network.
  return ip.includes(":") && !ip.includes(".") ? ipv6Prefix64(ip) : ip;
}

export function ipv6Prefix64(ip: string): string {
  const [head, tail] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail === undefined ? [] : tail ? tail.split(":") : [];
  const fill = tail === undefined ? [] : Array(Math.max(0, 8 - left.length - right.length)).fill("0");
  const groups = [...left, ...fill, ...right];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** True when the call may proceed. A missing binding (tests, local runs) allows. */
export async function allow(limiter: RateLimit | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch {
    // The limiter being unavailable must not take the API down with it.
    return true;
  }
}
