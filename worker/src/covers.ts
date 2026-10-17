// Book covers copied from Hardcover and served from Fandex (2026-10-17).
//
//   GET /v1/cover/hardcover/{folder}/{id}/{file}.jpg
//
// Hardcover's rules forbid hot-linking its images: "download those images and
// host them on your own". So a cover is fetched from assets.hardcover.app ONCE,
// put in R2 (`fandex-covers`, bound as COVERS) under its own path, and served
// from there for good, with the edge cache in front. The path carries a
// content hash, so a copy never goes stale and the answer can be immutable.
//
// What it costs, priced before building (docs/worker.md):
//   • a cover never seen: one request to Hardcover's CDN, one R2 write (Class
//     A, 1 million a month free), one D1 row write for the day's count;
//   • a cover R2 holds: one R2 read (Class B, 10 million a month free) per
//     edge location per year;
//   • a cover the edge holds: nothing.
//   A cover is 50 to 150 KB; R2's free 10 GB is roughly 100,000 of them.
//
// Who may ask: anybody, which is why the path is checked against the one shape
// Hardcover uses, the fetch is rate-limited per IP and capped per day, and
// anything that is not an image is refused. A stranger can make the Worker
// copy a Hardcover cover nobody asked for, and nothing worse.

import { BROWSE_BUDGET_MS, httpFetch } from "@/lib/http";
import { HARDCOVER_ASSETS, HARDCOVER_COVER_PATH, hardcoverConfigured } from "@/lib/sources/hardcover";
import { capFrom, spend } from "./budget";
import type { Env } from "./env";
import { useHardcover } from "./hardcover";
import { allow, clientIp, error } from "./http";

interface CoverCtx {
  env: Env;
  request: Request;
  defer: (p: Promise<unknown>) => void;
}

/** Copies allowed per UTC day. A copy happens once per cover, ever; a normal day is a few dozen. */
const DEFAULT_DAILY_COVER_CAP = 3000;
const MAX_BYTES = 3 * 1024 * 1024;
const YEAR = 31_536_000;
const USER_AGENT = "Fandex/1.0 (https://fandex.org; hello@fandex.org)";

const headers = (contentType: string, length: number): Record<string, string> => ({
  "Content-Type": contentType,
  "Content-Length": String(length),
  "Cache-Control": `public, max-age=${YEAR}, immutable`,
  "X-Content-Type-Options": "nosniff",
});

/** `parts` is the path split: ["v1", "cover", "hardcover", ...path]. Null for any other address. */
export async function coverRoute(c: CoverCtx, method: string, parts: string[]): Promise<Response | null> {
  if (parts[1] !== "cover" || parts[2] !== "hardcover") return null;
  if (method !== "GET" && method !== "HEAD") return null;
  const path = parts.slice(3).join("/");
  if (!HARDCOVER_COVER_PATH.test(path)) return error(400, "bad-request", "Not a cover address.");

  const cacheKey = new Request(`https://cache.fandex.internal/cover/hardcover/${path}`);
  const hit = await caches.default.match(cacheKey);
  if (hit) return method === "HEAD" ? new Response(null, { status: hit.status, headers: hit.headers }) : new Response(hit.body, hit);

  const key = `hardcover/${path}`;
  let bytes: ArrayBuffer;
  let contentType: string;
  const held = await c.env.COVERS.get(key);
  if (held) {
    bytes = await held.arrayBuffer();
    contentType = held.httpMetadata?.contentType ?? "image/jpeg";
  } else {
    useHardcover(c.env);
    // Off means off: no new copies are made, though the ones held keep serving.
    if (!hardcoverConfigured()) return error(404, "not-found");
    if (!(await allow(c.env.RL_RESOLVE, `cover:${clientIp(c.request)}`))) return error(429, "rate-limited");
    if (!(await spend(c.env.DB, "cover", capFrom(c.env.DAILY_COVER_CAP, DEFAULT_DAILY_COVER_CAP)))) {
      return error(503, "budget-exhausted", "No more covers can be copied today.");
    }
    let res: Awaited<ReturnType<typeof httpFetch>>;
    try {
      res = await httpFetch(`${HARDCOVER_ASSETS}${path}`, { headers: { Accept: "image/*", "User-Agent": USER_AGENT }, budgetMs: BROWSE_BUDGET_MS });
    } catch (e) {
      console.warn("cover_fetch_failed", { path, error: e instanceof Error ? e.message : String(e) });
      return error(502, "provider-unavailable");
    }
    if (res.status === 404) return error(404, "not-found");
    if (!res.ok) return error(502, "provider-unavailable");
    contentType = (res.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) return error(502, "provider-unavailable", "Not an image.");
    bytes = await res.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) return error(502, "provider-unavailable", "Not a cover.");
    await c.env.COVERS.put(key, bytes, { httpMetadata: { contentType } });
  }

  const response = new Response(bytes, { status: 200, headers: headers(contentType, bytes.byteLength) });
  c.defer(caches.default.put(cacheKey, response.clone()));
  return method === "HEAD" ? new Response(null, { status: 200, headers: response.headers }) : response;
}
