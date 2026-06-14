import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    // Tests that touch the DB run against a throwaway in-memory SQLite db, so
    // they never see or mutate the real data/rr.db. db.ts reads DB_PATH at import.
    env: { DB_PATH: ":memory:" },
    include: ["src/**/*.test.ts"],
    // better-sqlite3 is a native addon — never let vite try to transform it.
    server: { deps: { external: ["better-sqlite3"] } },
  },
});
