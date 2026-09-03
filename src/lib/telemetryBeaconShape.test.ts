import { describe, it, expect } from "vitest";
import { isSameOriginBeacon } from "./telemetry";

// 2026-09-03. Nils: "the analytics page shows crawler pageviews again. can we
// permanently filter them out?"
//
// Measured on prod the same day, over `railway ssh`:
//
//   2026-09-02   9,917 pageviews          every other day in the window: 7-56
//   that day     /person 3,575 · /tag 3,218 · /[type]/[id] 2,331 · /studio 408
//                ... against FORTY-TWO homepage views
//   blocked by the user-agent filter that day: 15
//
// 9,532 deep pages against 42 front doors is not a person, and it landed on the
// exact day the facet sweep put swept facets into the sitemap. It is not
// Googlebot: `/api/` is under the robots Disallow and Googlebot's renderer
// honours robots.txt for subresources, so it never reaches the beacon.
//
// `isSameOriginBeacon` is the second gate, and it checks a SHAPE rather than a
// name, because guessing names is what the user-agent list already does and this
// one walked past it. The precision half is what these tests are mostly for: a
// false positive here silently deletes a real visitor from the only number that
// gates the ads decision, and a deleted visitor looks exactly like a visitor who
// never came.
const HOST = "fandex.org";

const req = (over: Partial<Parameters<typeof isSameOriginBeacon>[0]> = {}) => ({
  origin: `https://${HOST}`,
  secFetchSite: "same-origin",
  host: HOST,
  ...over,
});

describe("the beacon only counts a call that looks like our own page making it", () => {
  it("accepts a modern browser, which sends both markers", () => {
    expect(isSameOriginBeacon(req())).toBe(true);
  });

  it("accepts a browser that sends Origin and no Sec-Fetch-Site", () => {
    // Safari before 16.4. Requiring both markers would have stopped counting
    // every one of those readers, which is the failure mode that matters here.
    expect(isSameOriginBeacon(req({ secFetchSite: null }))).toBe(true);
  });

  it("accepts a browser that sends Sec-Fetch-Site and no Origin", () => {
    expect(isSameOriginBeacon(req({ origin: null }))).toBe(true);
  });

  it("compares HOSTS, so a proxied scheme does not reject everyone", () => {
    // ⚠️ Railway terminates TLS in front of the container, so the request can
    // read `http:` while the browser sent an `https:` Origin. Comparing whole
    // origin strings would have rejected 100% of real prod traffic — the loudest
    // possible version of this bug, and the easiest to write.
    expect(isSameOriginBeacon(req({ origin: `https://${HOST}` }))).toBe(true);
    expect(isSameOriginBeacon(req({ origin: `http://${HOST}` }))).toBe(true);
  });

  it("keeps a port in the comparison, since localhost:3000 is a real host", () => {
    expect(isSameOriginBeacon({ origin: "http://localhost:3000", secFetchSite: "same-origin", host: "localhost:3000" })).toBe(true);
  });

  it("rejects a scripted client, which sends neither marker", () => {
    // curl, python-requests, a driver posting straight at the endpoint. No
    // user-agent string is involved in this decision at all, which is the point.
    expect(isSameOriginBeacon({ origin: null, secFetchSite: null, host: HOST })).toBe(false);
  });

  it("rejects somebody else's page posting at us", () => {
    expect(isSameOriginBeacon(req({ origin: "https://evil.example" }))).toBe(false);
    expect(isSameOriginBeacon(req({ secFetchSite: "cross-site", origin: null }))).toBe(false);
  });

  it("treats an explicit cross-site marker as decisive, even beside a good Origin", () => {
    // A forged Origin is one header; contradicting Sec-Fetch-Site is the browser
    // itself saying otherwise, and the browser is the one that cannot be lying
    // about this without already being a scripted client.
    expect(isSameOriginBeacon(req({ secFetchSite: "cross-site" }))).toBe(false);
    expect(isSameOriginBeacon(req({ secFetchSite: "same-site" }))).toBe(false);
    expect(isSameOriginBeacon(req({ secFetchSite: "none" }))).toBe(false);
  });

  it("rejects a malformed Origin rather than throwing on a request path", () => {
    expect(isSameOriginBeacon(req({ origin: "not a url", secFetchSite: null }))).toBe(false);
  });

  it("rejects when the host header is missing", () => {
    expect(isSameOriginBeacon(req({ host: null }))).toBe(false);
  });
});
