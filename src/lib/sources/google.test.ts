import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getGoogleAuthUrl, googleConfigured, googleRedirectUri } from "./google";

// Google sign-in is identity-only: it mints a session and holds no library.
// These cover the parts that fail SILENTLY — a gate read at the wrong time, a
// redirect_uri that drifts from the one registered in the Google console, and
// the scope decision, which is a privacy commitment rather than a detail.

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("googleConfigured", () => {
  // The point of this test is the TIMING, not the boolean. AGENTS.md: a safety
  // gate read at module LOAD is a gate nothing tests, because setting the env
  // var in a test does nothing after the module has been imported. Three
  // shipped that way in one session and all three had a test asserting the
  // default while believing it asserted the behaviour. These assignments happen
  // long after the import above, so a passing test proves the read is lazy.
  it("is false with neither half set", () => {
    expect(googleConfigured()).toBe(false);
  });

  it("is false with only the id", () => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "abc.apps.googleusercontent.com";
    expect(googleConfigured()).toBe(false);
  });

  it("is false with only the secret", () => {
    process.env.GOOGLE_CLIENT_SECRET = "s3cret";
    expect(googleConfigured()).toBe(false);
  });

  it("is true with both", () => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "abc.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "s3cret";
    expect(googleConfigured()).toBe(true);
  });

  it("treats an empty string as unset, not as configured", () => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "";
    process.env.GOOGLE_CLIENT_SECRET = "";
    expect(googleConfigured()).toBe(false);
  });
});

describe("googleRedirectUri", () => {
  // Google matches this EXACTLY against the Authorized redirect URI registered
  // in the console. A trailing-slash or path change here is a login outage, and
  // it is derived rather than configured precisely so there is no second value
  // to drift.
  it("is the callback path on the given origin", () => {
    expect(googleRedirectUri("https://fandex.org")).toBe("https://fandex.org/api/auth/google/callback");
  });

  it("does not double the slash when the base carries a trailing one", () => {
    expect(googleRedirectUri("https://fandex.org/")).toBe("https://fandex.org/api/auth/google/callback");
  });

  it("works for the dev origin", () => {
    expect(googleRedirectUri("http://localhost:3000")).toBe("http://localhost:3000/api/auth/google/callback");
  });
});

describe("getGoogleAuthUrl", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "abc.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "s3cret";
  });

  const params = (base = "https://fandex.org") =>
    new URL(getGoogleAuthUrl("nonce-123", base)).searchParams;

  it("points at Google's consent endpoint", () => {
    expect(getGoogleAuthUrl("n", "https://fandex.org")).toMatch(
      /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/
    );
  });

  it("round-trips the CSRF nonce as `state`", () => {
    expect(params().get("state")).toBe("nonce-123");
  });

  it("carries the derived redirect_uri", () => {
    expect(params().get("redirect_uri")).toBe("https://fandex.org/api/auth/google/callback");
  });

  // The privacy commitment, pinned. Requesting `email` would mean holding a new
  // category of personal data: a privacy-policy line, a GDPR erasure question,
  // and a hand-written block in /api/account/export, whose column lists are
  // explicit. Nothing in the app reads an address, and `sub` is the identity.
  it("requests openid and profile, and NOT email", () => {
    const scope = params().get("scope") ?? "";
    expect(scope.split(" ").sort()).toEqual(["openid", "profile"]);
    expect(scope).not.toContain("email");
  });

  // access_type=online is what makes Google withhold a refresh token. We never
  // call a Google API after login, so a long-lived credential at rest would be
  // a liability buying nothing.
  it("asks for online access, so no refresh token is issued", () => {
    expect(params().get("access_type")).toBe("online");
  });

  it("shows the account chooser rather than reusing whichever account is active", () => {
    expect(params().get("prompt")).toBe("select_account");
  });

  it("is an authorization-code flow", () => {
    expect(params().get("response_type")).toBe("code");
  });

  // Same lazy-read point as googleConfigured: a module-level const captured at
  // import time would still hold the value from a previous test's env.
  it("reads the client id at call time", () => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "changed.apps.googleusercontent.com";
    expect(params().get("client_id")).toBe("changed.apps.googleusercontent.com");
  });
});
