import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { initDb, run } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/session";
import { GET } from "./route";

// The dev login shortcut is a deliberate authentication bypass, so its GATES are
// the whole point of the route — each one is pinned here. A regression that
// makes any of these return a session instead of a 404 is a total auth hole.

initDb();

const USER = "dev-user-1";

function req(host = "localhost:3000") {
  return new NextRequest("http://localhost:3000/api/dev/login", { headers: { host } });
}

beforeEach(() => {
  run("DELETE FROM user_identities");
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
  run(
    `INSERT INTO user_identities (id, user_id, provider, provider_user_id, display_name)
     VALUES (?, ?, ?, ?, ?)`,
    ["ident-1", USER, "trakt", "nils", "Nils"]
  );
  vi.stubEnv("DEV_LOGIN_USER_ID", USER);
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/dev/login — gates", () => {
  it("404s in production even when everything else is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("404s when DEV_LOGIN_USER_ID is unset (the shipped default)", async () => {
    vi.stubEnv("DEV_LOGIN_USER_ID", "");
    const res = await GET(req());
    expect(res.status).toBe(404);
  });

  it("404s for a non-loopback host", async () => {
    const res = await GET(req("192.168.1.50:3000"));
    expect(res.status).toBe(404);
  });

  it("404s when the configured user has no identity row", async () => {
    run("DELETE FROM user_identities");
    const res = await GET(req());
    expect(res.status).toBe(404);
  });

  it("404s when the configured user id does not exist at all", async () => {
    vi.stubEnv("DEV_LOGIN_USER_ID", "nobody");
    const res = await GET(req());
    expect(res.status).toBe(404);
  });
});

describe("GET /api/dev/login — success path", () => {
  it("sets a session cookie and redirects home", async () => {
    const res = await GET(req());
    expect(res.status).toBe(307);
    const cookie = res.cookies.get(SESSION_COOKIE);
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
  });

  it("mints a session carrying the real identity, not a synthesized one", async () => {
    const res = await GET(req());
    const token = res.cookies.get(SESSION_COOKIE)!.value;
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    expect(claims.userId).toBe(USER);
    expect(claims.identityId).toBe("ident-1");
    expect(claims.provider).toBe("trakt");
  });
});
