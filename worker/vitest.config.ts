import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

const here = path.dirname(fileURLToPath(import.meta.url));

// Tests run INSIDE workerd, against a local D1 that is the same SQLite build
// production runs. That is the point: the SQL here leans on row values,
// json_each, WITHOUT ROWID and upserts, and a test against better-sqlite3 would
// prove those work somewhere else.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(here, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Test-only values. None of these is a real credential.
            JWT_SECRET: "test-secret-that-is-long-enough-to-pass",
            TMDB_API_KEY: "test-tmdb-key",
            TWITCH_CLIENT_ID: "test-twitch-id",
            TWITCH_CLIENT_SECRET: "test-twitch-secret",
            GOOGLE_CLIENT_ID: "test-google-client.apps.googleusercontent.com",
            TRAKT_CLIENT_ID: "test-trakt-client",
          },
        },
      }),
    ],
    // The shared site modules import each other as "@/lib/…".
    resolve: { alias: { "@": path.resolve(here, "../src") } },
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
    },
  };
});
