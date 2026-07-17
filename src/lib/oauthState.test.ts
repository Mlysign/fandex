import { describe, it, expect } from "vitest";
import type { NextRequest, NextResponse } from "next/server";
import {
  createOAuthNonce,
  setOAuthStateCookie,
  verifyOAuthState,
  clearOAuthState,
  isSafeReturnPath,
  setOAuthReturnCookie,
  readOAuthReturn,
  clearOAuthReturn,
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

// ── H2c return-path cookie ───────────────────────────────────────────────────

// The open-redirect guard is the one security-sensitive addition; exercise every
// bypass shape we care about.
describe("isSafeReturnPath", () => {
  it("accepts a same-origin absolute path", () => {
    expect(isSafeReturnPath("/movie/uuid/slug")).toBe(true);
    expect(isSafeReturnPath("/")).toBe(true);
  });
  it("rejects protocol-relative (open redirect to another host)", () => {
    expect(isSafeReturnPath("//evil.com")).toBe(false);
  });
  it("rejects absolute URLs with a scheme", () => {
    expect(isSafeReturnPath("https://evil.com")).toBe(false);
    expect(isSafeReturnPath("javascript:alert(1)")).toBe(false);
  });
  it("rejects the backslash trick some browsers normalize toward //", () => {
    expect(isSafeReturnPath("/\\evil.com")).toBe(false);
  });
  it("rejects a relative path, empty string, and nullish", () => {
    expect(isSafeReturnPath("dashboard")).toBe(false);
    expect(isSafeReturnPath("")).toBe(false);
    expect(isSafeReturnPath(null)).toBe(false);
    expect(isSafeReturnPath(undefined)).toBe(false);
  });
});

// Return-cookie reader needs a req keyed on the return cookie name.
function fakeReturnReq(cookieValue: string | null): NextRequest {
  return {
    cookies: {
      get: (name: string) =>
        name === "rr2_oauth_return" && cookieValue !== null ? { value: cookieValue } : undefined,
    },
  } as unknown as NextRequest;
}

describe("setOAuthReturnCookie", () => {
  it("sets a short-lived httpOnly lax cookie for a safe path", () => {
    const { res, sets } = fakeRes();
    setOAuthReturnCookie(res, "/movie/uuid/slug");
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({
      name: "rr2_oauth_return",
      value: "/movie/uuid/slug",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
  });
  it("sets NOTHING for an unsafe or absent path", () => {
    for (const bad of ["//evil.com", "https://evil.com", "", null, undefined]) {
      const { res, sets } = fakeRes();
      setOAuthReturnCookie(res, bad);
      expect(sets).toHaveLength(0);
    }
  });
});

describe("readOAuthReturn", () => {
  it("returns a safe stored path", () => {
    expect(readOAuthReturn(fakeReturnReq("/show/uuid/slug"))).toBe("/show/uuid/slug");
  });
  it("returns null when absent", () => {
    expect(readOAuthReturn(fakeReturnReq(null))).toBeNull();
  });
  it("re-validates on the way out (defense in depth) and rejects an unsafe value", () => {
    expect(readOAuthReturn(fakeReturnReq("//evil.com"))).toBeNull();
  });
});

describe("clearOAuthReturn", () => {
  it("expires the cookie", () => {
    const { res, sets } = fakeRes();
    clearOAuthReturn(res);
    expect(sets[0]).toMatchObject({ name: "rr2_oauth_return", value: "", maxAge: 0, path: "/" });
  });
});
