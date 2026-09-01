import { describe, it, expect } from "vitest";
import zlib from "zlib";
import { compressResponse, acceptsGzip, COMPRESS_MIN_BYTES } from "./compressResponse";

// 2026-09-01 — Next installs the `compression` middleware on every request and
// then filters out every route handler response, because `send-response.js`
// copies a handler's headers with `appendHeader`, which stores even a single
// value as an ARRAY, and `compressible([...])` is false. Pages compress; /api/
// does not. `/api/library` was 8.63 MB uncompressed on the real account.
//
// The failure mode this file guards is the quiet one. A missing
// `Content-Encoding` costs bytes and nothing else, so nobody notices; a WRONG
// one (a gzipped body served to a client that did not ask, a stale
// `Content-Length`, a lost `Vary`) breaks the response outright for somebody
// and still looks fine from here. So the assertions are about the header
// contract, not about the ratio.

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });

/** A payload comfortably over the threshold. */
const big = () => ({ items: Array.from({ length: 400 }, (_, i) => ({ id: i, title: `Item number ${i}` })) });

const get = (accept: string | null = "gzip, deflate, br") =>
  new Request("https://fandex.org/api/library", {
    method: "GET",
    headers: accept === null ? {} : { "accept-encoding": accept },
  });

describe("acceptsGzip", () => {
  it("reads a plain gzip offer", () => {
    expect(acceptsGzip(get("gzip"))).toBe(true);
    expect(acceptsGzip(get("gzip, deflate, br"))).toBe(true);
    expect(acceptsGzip(get("*"))).toBe(true);
  });

  it("is false when the header is absent or offers something else", () => {
    expect(acceptsGzip(get(null))).toBe(false);
    expect(acceptsGzip(get("br"))).toBe(false);
    expect(acceptsGzip(get("identity"))).toBe(false);
  });

  it("treats q=0 as the refusal it is", () => {
    expect(acceptsGzip(get("gzip;q=0"))).toBe(false);
    expect(acceptsGzip(get("gzip;q=0.5"))).toBe(true);
  });
});

describe("compressResponse", () => {
  it("gzips a large JSON body and the body still round-trips", async () => {
    const payload = big();
    const res = await compressResponse(get(), json(payload));

    expect(res.headers.get("content-encoding")).toBe("gzip");
    const packed = Buffer.from(await res.arrayBuffer());
    const unpacked = JSON.parse(zlib.gunzipSync(packed).toString("utf8"));
    expect(unpacked).toEqual(payload);
  });

  it("actually makes it smaller", async () => {
    const raw = Buffer.byteLength(JSON.stringify(big()));
    const res = await compressResponse(get(), json(big()));
    expect((await res.arrayBuffer()).byteLength).toBeLessThan(raw);
  });

  it("declares Vary: Accept-Encoding, so no shared cache can serve it to a client that cannot read it", async () => {
    const res = await compressResponse(get(), json(big()));
    expect(res.headers.get("vary")?.toLowerCase()).toContain("accept-encoding");
  });

  it("does not add a second Accept-Encoding when the route already varies on it", async () => {
    const res = await compressResponse(get(), json(big(), { vary: "Accept-Encoding" }));
    expect(res.headers.get("vary")?.toLowerCase().match(/accept-encoding/g)).toHaveLength(1);
  });

  it("sets Content-Length to the COMPRESSED length", async () => {
    const res = await compressResponse(get(), json(big()));
    const bytes = (await res.arrayBuffer()).byteLength;
    expect(res.headers.get("content-length")).toBe(String(bytes));
  });

  it("preserves status and the route's own headers", async () => {
    const source = new Response(JSON.stringify(big()), {
      status: 207,
      statusText: "Multi-Status",
      headers: { "content-type": "application/json", "x-fandex-test": "kept" },
    });
    const res = await compressResponse(get(), source);
    expect(res.status).toBe(207);
    expect(res.headers.get("x-fandex-test")).toBe("kept");
  });

  it("leaves a body under the threshold alone, and it still reads", async () => {
    const res = await compressResponse(get(), json({ error: "Unauthorized" }));
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("measures the threshold in UTF-8 BYTES, not UTF-16 units", async () => {
    // 500 astral characters: `.length` is 1,000 (under the threshold), the
    // UTF-8 byte length is ~2,000 (over it). This repo has already lost a cache
    // to exactly this distinction, so it is pinned rather than assumed.
    const body = JSON.stringify({ s: "\u{1F600}".repeat(500) });
    expect(body.length).toBeLessThan(COMPRESS_MIN_BYTES);
    expect(Buffer.byteLength(body)).toBeGreaterThan(COMPRESS_MIN_BYTES);
    const res = await compressResponse(get(), new Response(body, { headers: { "content-type": "application/json" } }));
    expect(res.headers.get("content-encoding")).toBe("gzip");
  });

  it("leaves it alone when the client did not ask for gzip", async () => {
    const res = await compressResponse(get(null), json(big()));
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.json()).toEqual(big());
  });

  it("never double-encodes", async () => {
    const already = new Response(zlib.gzipSync(Buffer.from(JSON.stringify(big()))), {
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
    });
    const res = await compressResponse(get(), already);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    const unpacked = JSON.parse(zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"));
    expect(unpacked).toEqual(big());
  });

  it("leaves a Set-Cookie response alone, so no header can be collapsed on the way through", async () => {
    const res = await compressResponse(get(), json(big(), { "set-cookie": "rr_session=abc; Path=/; HttpOnly" }));
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("set-cookie")).toContain("rr_session=abc");
  });

  it("leaves a non-compressible content type alone", async () => {
    const res = await compressResponse(
      get(),
      new Response(Buffer.alloc(20_000), { headers: { "content-type": "image/png" } }),
    );
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  it("skips a HEAD request", async () => {
    const head = new Request("https://fandex.org/api/library", {
      method: "HEAD",
      headers: { "accept-encoding": "gzip" },
    });
    const res = await compressResponse(head, json(big()));
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  it("passes a bodyless response straight through", async () => {
    const res = await compressResponse(get(), new Response(null, { status: 204 }));
    expect(res.status).toBe(204);
    expect(res.headers.get("content-encoding")).toBeNull();
  });
});
