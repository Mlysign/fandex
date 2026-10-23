import { afterEach, describe, expect, it, vi } from "vitest";

// A Twitch app token IGDB refuses must not keep being served. Twitch can
// revoke one long before its 60 days (a rotated secret, the per-client cap),
// and the in-memory cache and the Worker's shared copy both still read it as
// unexpired. A 401 drops it, mints a new one, overwrites the shared copy and
// asks again once.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadIgdb() {
  vi.stubEnv("TWITCH_CLIENT_ID", "client");
  vi.stubEnv("TWITCH_CLIENT_SECRET", "secret");
  vi.stubEnv("IGDB_ENABLED", "1");
  vi.resetModules(); // the credentials are read at module load
  const http = await import("@/lib/http");
  http.__resetBreakers();
  http.__resetHostGates();
  return import("./igdb");
}

describe("an IGDB 401 clears the Twitch token", () => {
  it("drops the refused token, mints a new one, stores it and retries once", async () => {
    const igdb = await loadIgdb();
    const stored: { token: string; expiresAt: number }[] = [];
    let shared = { token: "revoked", expiresAt: Date.now() + 30 * 86_400_000 };
    igdb.setIgdbTokenStore({
      get: async () => shared,
      set: async (t) => { stored.push(t); shared = t; },
    });

    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith("https://id.twitch.tv/")) {
        return new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600 }), { status: 200 });
      }
      const auth = new Headers(init?.headers).get("Authorization") ?? "";
      seen.push(auth);
      return auth === "Bearer fresh"
        ? new Response("[]", { status: 200 })
        : new Response("unauthorized", { status: 401 });
    }));

    await expect(igdb.getIgdbCollections([1])).resolves.toEqual([]);
    expect(seen).toEqual(["Bearer revoked", "Bearer fresh"]);
    expect(stored.map((t) => t.token)).toEqual(["fresh"]);

    // The next call uses the new token straight away.
    await igdb.getIgdbCollections([2]);
    expect(seen.at(-1)).toBe("Bearer fresh");
    expect(seen).toHaveLength(3);
  });

  it("does not pick the refused token back up from a store that still holds it", async () => {
    const igdb = await loadIgdb();
    // A store whose write failed keeps answering the dead token.
    igdb.setIgdbTokenStore({
      get: async () => ({ token: "revoked", expiresAt: Date.now() + 30 * 86_400_000 }),
      set: async () => { throw new Error("D1 down"); },
    });
    let mints = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith("https://id.twitch.tv/")) {
        mints++;
        return new Response(JSON.stringify({ access_token: `fresh${mints}`, expires_in: 3600 }), { status: 200 });
      }
      const auth = new Headers(init?.headers).get("Authorization") ?? "";
      return new Response(auth.startsWith("Bearer fresh") ? "[]" : "no", { status: auth.startsWith("Bearer fresh") ? 200 : 401 });
    }));

    await igdb.getIgdbCollections([1]);
    await igdb.getIgdbCollections([2]);
    expect(mints).toBe(1);
  });
});
