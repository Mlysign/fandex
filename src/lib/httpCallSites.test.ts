import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// 2026-08-22. The 401/403 auth latch in http.ts only counts a call site that
// opted in with `appScopedAuth: true`, because RAWG and TMDB serve app-key and
// per-user requests from the same host and a user's dead token must never latch
// a provider for everybody.
//
// Opt-in fails SILENTLY when you miss a site, and the first pass missed the ones
// that mattered: it marked src/lib/sources/ and left the calls a cold facet page
// actually makes, in facetDetail.ts and discoverFeed.ts, unmarked. Prod took 39
// consecutive RAWG 401s with the breaker still closed. Nothing else noticed —
// tsc, lint, the suite and the build were all green, because an unmarked call
// site is just a call site.
//
// So this test is the thing that notices. An app key in the URL is proof the
// request carries no per-user credential, which is exactly the case the latch
// wants and exactly the case a human forgets.
const APP_KEY_IN_URL = /(\?|&)(api_key|apikey|key)=/;

// An app key in the URL only proves the request is app-scoped when there is no
// per-user credential riding alongside it. Two shapes carry one:
//
//   session_id=      TMDB's per-user session, a URL param next to the api_key.
//   /authentication/ TMDB's connect handshake, where a 401 means the user did
//                    not approve the request token, not that our key is dead.
//
// Anything else with a key in the query string is ours alone and must opt in.
const CARRIES_USER_CREDENTIAL = /session_id=|\/authentication\//;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) { out.push(...tsFiles(p)); continue; }
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
    if (p.endsWith(join("lib", "http.ts"))) continue; // the implementation itself
    out.push(p);
  }
  return out;
}

/** The text of each `httpFetch(...)` call, by matching parens. */
function httpFetchCalls(src: string): string[] {
  const calls: string[] = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf("httpFetch(", from);
    if (at === -1) return calls;
    let depth = 0;
    let i = at + "httpFetch".length;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")" && --depth === 0) { i++; break; }
    }
    calls.push(src.slice(at, i));
    from = i;
  }
}

describe("httpFetch call sites", () => {
  it("marks every request whose only credential is an app key in the URL", () => {
    const unmarked: string[] = [];
    for (const file of tsFiles("src")) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("httpFetch(")) continue;
      for (const call of httpFetchCalls(src)) {
        if (!APP_KEY_IN_URL.test(call)) continue;
        if (CARRIES_USER_CREDENTIAL.test(call)) continue;
        if (call.includes("appScopedAuth")) continue;
        unmarked.push(`${file}: ${call.replace(/\s+/g, " ").slice(0, 120)}`);
      }
    }
    // A failure here is not a style nit: that provider will be re-asked forever
    // once its key dies. Add `appScopedAuth: true` to the init object.
    expect(unmarked).toEqual([]);
  });

  it("finds the call sites at all, so a rename cannot make this test vacuous", () => {
    const withCalls = tsFiles("src").filter((f) => readFileSync(f, "utf8").includes("httpFetch("));
    expect(withCalls.length).toBeGreaterThan(8);

    const marked = withCalls.flatMap((f) =>
      httpFetchCalls(readFileSync(f, "utf8")).filter((c) => APP_KEY_IN_URL.test(c) && !CARRIES_USER_CREDENTIAL.test(c))
    );
    expect(marked.length).toBeGreaterThan(10);
  });
});
