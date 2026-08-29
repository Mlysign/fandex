import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { initDb, run } from "@/lib/db";
import { GET } from "./route";

// This route is a KEY-gated public endpoint with no session behind it, so its
// gate is the whole route. A regression that answers 200 to a caller without the
// secret publishes Fandex's traffic and user numbers to whoever asks.

initDb();

const KEY = "kpi-test-key-long-enough";

function req(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/telemetry/kpi", { headers });
}

beforeEach(() => {
  run("DELETE FROM page_view_daily");
  run("DELETE FROM users");
  vi.stubEnv("KPI_READ_KEY", KEY);
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/telemetry/kpi: the gate", () => {
  it("404s when KPI_READ_KEY is unset (the shipped default)", async () => {
    vi.stubEnv("KPI_READ_KEY", "");
    const res = await GET(req({ "x-bw-admin": KEY }));
    expect(res.status).toBe(404);
  });

  it("404s with no header at all", async () => {
    const res = await GET(req());
    expect(res.status).toBe(404);
  });

  it("404s on a wrong key, and on one that is merely a prefix of the real one", async () => {
    expect((await GET(req({ "x-bw-admin": "nope" }))).status).toBe(404);
    expect((await GET(req({ "x-bw-admin": KEY.slice(0, -1) }))).status).toBe(404);
    expect((await GET(req({ "x-bw-admin": `${KEY}x` }))).status).toBe(404);
  });

  it("404s rather than 401, so a wrong key and a missing route look identical", async () => {
    // A portfolio-wide convention, not a local preference: the hub reports both
    // cases the same way instead of guessing between them.
    const res = await GET(req({ "x-bw-admin": "nope" }));
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("fails closed on a key too short to be worth anything", async () => {
    // The key is the only protection on a public endpoint, so a weak one is a
    // hole rather than a preference. A truncated value must not half-work.
    vi.stubEnv("KPI_READ_KEY", "short");
    const res = await GET(req({ "x-bw-admin": "short" }));
    expect(res.status).toBe(404);
  });

  it("answers 200 with the contract shape for the right key", async () => {
    run("INSERT INTO users (id) VALUES (?)", ["kpi-user-1"]);
    const res = await GET(req({ "x-bw-admin": KEY }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.unit).toBe("pageviews");
    expect(body.usersTotal).toBe(1);
    expect(body.windowDays).toEqual({ active: 7, new: 30 });
    expect(typeof body.server).toBe("string");
  });

  it("reads the key at call time, so a rotation takes effect without a restart", async () => {
    // AGENTS.md: a safety gate read at module load is a gate nothing tests.
    vi.stubEnv("KPI_READ_KEY", "rotated-key-long-enough");
    expect((await GET(req({ "x-bw-admin": KEY }))).status).toBe(404);
    expect((await GET(req({ "x-bw-admin": "rotated-key-long-enough" }))).status).toBe(200);
  });
});

describe("GET /api/telemetry/kpi: what it must not do", () => {
  it("sends no CORS headers", async () => {
    // The hub reaches this through a server-side proxy that holds the key. CORS
    // would only invite the secret into a browser later.
    const res = await GET(req({ "x-bw-admin": KEY }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("forbids caching of a key-gated response", async () => {
    const res = await GET(req({ "x-bw-admin": KEY }));
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("sets no cookie and reads no session", async () => {
    const res = await GET(req({ "x-bw-admin": KEY }));
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("returns aggregates only, never a user id", async () => {
    run("INSERT INTO users (id) VALUES (?)", ["kpi-secret-user"]);
    const res = await GET(req({ "x-bw-admin": KEY }));
    expect(JSON.stringify(await res.json())).not.toContain("kpi-secret-user");
  });
});
