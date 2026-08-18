import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { SessionUser } from "@/types";

// `withOptionalUser` (2026-08-18) is the wrapper that made the release calendar
// and the nav-search vocab public. What matters about it is NOT that it lets an
// anonymous caller through — that's the easy half — but that it hands the
// handler a NULL session so the PR15 write gate downstream still fires, and that
// it doesn't cap an anonymous caller at a limit meant for a provider-spending
// route. Both regress silently.

// A plain module stub driven by one mutable variable, deliberately NOT a
// `vi.fn()`. A spy records every call's result, and for a call that rejects it
// keeps a reference to that rejected promise which nothing ever catches — so
// vitest reports an unhandled rejection and fails every anonymous test here
// while the wrapper is behaving perfectly. Nothing in these tests needs call
// counts, so the spy buys nothing and costs that.
let currentSession: SessionUser | null = null;
vi.mock("@/lib/session", () => ({
  // Async and throwing, exactly like the real requireSession (session.ts:114).
  requireSession: async () => {
    if (!currentSession) throw new Error("Unauthorized");
    return currentSession;
  },
}));

const { withOptionalUser } = await import("./withUser");

// The rate-limit bucket store is module-level and shared across tests, so each
// test that doesn't care about limits needs its own IP.
let ipCounter = 0;
function req(ip?: string): NextRequest {
  const addr = ip ?? `10.0.0.${++ipCounter}`;
  return {
    url: "http://localhost/api/test",
    method: "GET",
    headers: new Headers({ "x-forwarded-for": addr }),
  } as unknown as NextRequest;
}

beforeEach(() => { currentSession = null; });

describe("withOptionalUser", () => {
  it("passes a null session through instead of 401ing, so the handler can degrade", async () => {
    let seen: unknown = "unset";
    const handler = withOptionalUser(async (_r, session) => {
      seen = session;
      return new Response("ok");
    });
    const res = await handler(req());
    expect(res.status).toBe(200);
    // NULL, not a placeholder id. persistDiscoverBatch branches on exactly this
    // to decide whether it may WRITE media_items rows — a non-null stand-in here
    // would silently re-open the crawler write path PR15 closed.
    expect(seen).toBeNull();
  });

  it("passes the real session through when there is one", async () => {
    currentSession = { userId: "u1" } as SessionUser;
    // A holder object, not a bare `let`: assigned only inside the callback, tsc
    // narrows a `let` to its initializer and then rejects the property read.
    const seen: { value: SessionUser | null } = { value: null };
    const handler = withOptionalUser(async (_r, session) => { seen.value = session; return new Response("ok"); });
    await handler(req());
    expect(seen.value?.userId).toBe("u1");
  });

  it("applies the per-route anon cap, not one shared number", async () => {
    const handler = withOptionalUser(async () => new Response("ok"), { anonLimit: 2 });
    expect((await handler(req("10.9.9.1"))).status).toBe(200);
    expect((await handler(req("10.9.9.1"))).status).toBe(200);
    expect((await handler(req("10.9.9.1"))).status).toBe(429);
  });

  it("does not charge an anonymous cap to a signed-in caller", async () => {
    currentSession = { userId: "u2" } as SessionUser;
    const handler = withOptionalUser(async () => new Response("ok"), { anonLimit: 1 });
    // A cap of 1 would block the second call if the IP bucket were used. The
    // signed-in path must key on the user and take the much larger USER_LIMIT.
    expect((await handler(req("10.9.9.2"))).status).toBe(200);
    expect((await handler(req("10.9.9.2"))).status).toBe(200);
  });

  it("turns a handler throw into a 500 rather than an unhandled rejection", async () => {
    const handler = withOptionalUser(async () => { throw new Error("boom"); });
    expect((await handler(req())).status).toBe(500);
  });
});
