import { describe, it, expect } from "vitest";
import type { NextRequest, NextResponse } from "next/server";
import {
  createOAuthNonce,
  setOAuthStateCookie,
  verifyOAuthState,
  clearOAuthState,
} from "./oauthState";

// Minimal fakes: the module only touches req.cookies.get and res.cookies.set.
function fakeReq(cookieValue: string | null): NextRequest {
  return {
    cookies: {
      get: (name: string) =>
        name === "rr2_oauth_state" && cookieValue !== null ? { value: cookieValue } : undefined,
    },
  } as unknown as NextRequest;
}

function fakeRes() {
  const sets: any[] = [];
  const res = { cookies: { set: (opts: any) => sets.push(opts) } } as unknown as NextResponse;
  return { res, sets };
}

describe("createOAuthNonce", () => {
  it("returns a URL-safe, high-entropy, unique value each call", () => {
    const a = createOAuthNonce();
    const b = createOAuthNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding/reserved chars
    expect(a.length).toBeGreaterThanOrEqual(40); // 32 random bytes → 43 chars
  });
});

describe("setOAuthStateCookie", () => {
  it("sets a short-lived httpOnly lax cookie carrying the nonce", () => {
    const { res, sets } = fakeRes();
    setOAuthStateCookie(res, "the-nonce");
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({
      name: "rr2_oauth_state",
      value: "the-nonce",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
  });
});

describe("verifyOAuthState", () => {
  it("accepts an exact match", () => {
    expect(verifyOAuthState(fakeReq("abc123"), "abc123")).toBe(true);
  });
  it("rejects a mismatch", () => {
    expect(verifyOAuthState(fakeReq("abc123"), "xyz789")).toBe(false);
  });
  it("rejects when the cookie is missing", () => {
    expect(verifyOAuthState(fakeReq(null), "abc123")).toBe(false);
  });
  it("rejects when the received value is missing", () => {
    expect(verifyOAuthState(fakeReq("abc123"), null)).toBe(false);
  });
  it("rejects a value that is a prefix of the cookie (length guard)", () => {
    expect(verifyOAuthState(fakeReq("abc123"), "abc")).toBe(false);
  });
});

describe("clearOAuthState", () => {
  it("expires the cookie", () => {
    const { res, sets } = fakeRes();
    clearOAuthState(res);
    expect(sets[0]).toMatchObject({ name: "rr2_oauth_state", value: "", maxAge: 0, path: "/" });
  });
});
