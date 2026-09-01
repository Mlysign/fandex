// gzip for /api/ responses, because Next does not do it and its own config
// says it does.
//
// ── The bug, measured rather than assumed (2026-09-01) ──────────────────────
// `next.config.ts` leaves `compress` at its default `true`, and
// `next/dist/server/lib/router-server.js` really does install the `compression`
// middleware on EVERY request. Pages come back gzipped. Route handlers do not:
//
//   GET /discover              -> Content-Encoding: gzip
//   GET /api/discover/facets   -> no encoding header at all
//
// Reproduced against a local `next start` with no proxy in the way, so this is
// Next and not Railway's edge. Running that server under `DEBUG=compression`
// prints the reason in one line:
//
//   compression [ 'application/json' ] not compressible
//   compression no compression: filtered
//
// Note the ARRAY. `compression`'s filter is
// `compressible(res.getHeader("Content-Type"))`, and `compressible` takes a
// STRING. The array comes from Next itself: `server/send-response.js` copies a
// route handler's Web `Headers` onto the Node response with
// `res.appendHeader(name, value)`, and `NodeNextResponse.appendHeader`
// (`server/base-http/node.js`) is unconditionally
// `setHeader(name, [...currentValues, value])`. So every header a route handler
// sets lands as a single-element array, `compressible([...])` is false, and the
// middleware filters out every JSON response in the app before it ever looks at
// the size or the client's Accept-Encoding.
//
// Pages never go through `sendResponse`, which is the whole reason they are the
// half that works. Nothing about this is specific to our routes, and nothing in
// our config can reach it: `compression()` is constructed inside Next with no
// options, so its filter is not ours to replace.
//
// ── Why it is worth doing at all ───────────────────────────────────────────
// `/api/library` is 8.63 MB of JSON on the real account. gzip measures ~3.5x on
// this project's actual payloads (the same figure `facetCacheStore.ts` sizes its
// row ceiling with), so this is roughly 6 MB off a single request, which is more
// than every field-trimming idea in TASKS.md combined.
//
// ── The rules this has to keep ─────────────────────────────────────────────
// - `Vary: Accept-Encoding` is not optional. Without it any shared cache can
//   hand a gzipped body to a client that did not ask for one.
// - Compress off the BYTE length, never `String.length`. UTF-16 units are not
//   UTF-8 bytes, and this repo has already lost a cache to that distinction.
// - Never touch a response that already carries a `Content-Encoding`.
// - Never touch a `Set-Cookie` response. Copying a `Headers` that holds several
//   of them risks collapsing them into one comma-joined value, and every
//   cookie-setting route here answers well under the threshold anyway, so the
//   safe branch costs nothing.
// - gzip ASYNCHRONOUSLY. `zlib.gzipSync` on 8 MB blocks the event loop for
//   ~150 ms, and this is one always-on process serving everybody. The callback
//   form runs on libuv's threadpool instead.
import zlib from "zlib";
import { promisify } from "util";

const gzip = promisify(zlib.gzip);

/**
 * Don't bother below this. Under roughly one MTU there is nothing to win, gzip
 * can make a short body LARGER, and every 401/400/500 this app returns is a
 * few dozen bytes. Measured in UTF-8 bytes, not characters.
 */
export const COMPRESS_MIN_BYTES = 1400;

/**
 * zlib's own default. Level 1 was measured 20% faster on an 8 MB payload for a
 * ~3% worse ratio, which is the wrong trade when the whole point is the bytes
 * on the wire and the work happens off the main thread.
 */
const GZIP_LEVEL = 6;

/** Content types worth compressing. Everything this app's API returns is JSON. */
function isCompressibleType(contentType: string | null): boolean {
  if (!contentType) return false;
  const type = contentType.split(";")[0].trim().toLowerCase();
  return (
    type === "application/json" ||
    type === "application/ld+json" ||
    type === "application/xml" ||
    type === "image/svg+xml" ||
    type.startsWith("text/")
  );
}

/** Does the caller actually accept gzip? A crawler or curl may not. */
export function acceptsGzip(req: Request): boolean {
  const header = req.headers.get("accept-encoding");
  if (!header) return false;
  // `gzip;q=0` is a client explicitly refusing it, which is rare but legal.
  return header
    .toLowerCase()
    .split(",")
    .map((part) => part.trim())
    .some((part) => {
      const [coding, ...params] = part.split(";").map((s) => s.trim());
      if (coding !== "gzip" && coding !== "*") return false;
      const q = params.find((p) => p.startsWith("q="));
      return q ? Number(q.slice(2)) > 0 : true;
    });
}

/**
 * Return `res`, gzipped, when that is both safe and worth it. Otherwise return
 * `res` untouched.
 *
 * Best-effort by design: a compression failure must never turn a good response
 * into an error, so anything unexpected falls back to the original.
 */
export async function compressResponse(req: Request, res: Response): Promise<Response> {
  if (req.method === "HEAD") return res;
  if (!res.body) return res;                                  // 204/304 and friends
  if (res.headers.has("content-encoding")) return res;        // already encoded
  if (res.headers.has("set-cookie")) return res;              // see the header note above
  if (!isCompressibleType(res.headers.get("content-type"))) return res;
  if (!acceptsGzip(req)) return res;

  // Reading the body DISTURBS it, so `res` stops being a valid thing to return
  // the moment this succeeds. Everything after this point falls back to a
  // response rebuilt from `raw`, never to `res`.
  // Held as an ArrayBuffer rather than a Buffer because that is what `Response`
  // accepts as a body without a cast; `new Uint8Array(raw)` below is a view over
  // the same memory, not a copy.
  let raw: ArrayBuffer;
  try {
    raw = await res.arrayBuffer();
  } catch {
    return res;
  }

  const passthrough = () =>
    new Response(raw, { status: res.status, statusText: res.statusText, headers: res.headers });

  if (raw.byteLength < COMPRESS_MIN_BYTES) return passthrough();

  try {
    const gzipped = await gzip(new Uint8Array(raw), { level: GZIP_LEVEL });
    const packed = new Uint8Array(gzipped.buffer, gzipped.byteOffset, gzipped.byteLength);
    const headers = new Headers(res.headers);
    headers.set("content-encoding", "gzip");
    headers.set("content-length", String(packed.byteLength));
    // Append rather than set, so a route that already varies on something keeps
    // it. Guard the duplicate: Next adds its own `vary` at the Node layer after
    // this runs, but a route is free to have set one here too.
    const vary = headers.get("vary") ?? "";
    if (!/(^|,)\s*accept-encoding\s*(,|$)/i.test(vary)) headers.append("vary", "Accept-Encoding");
    return new Response(packed, { status: res.status, statusText: res.statusText, headers });
  } catch {
    return passthrough();
  }
}
