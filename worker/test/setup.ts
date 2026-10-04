import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

// Every test file starts from the real schema: the same migration files
// `wrangler d1 migrations apply` runs against production.
await applyD1Migrations(
  (env as unknown as { DB: D1Database }).DB,
  (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
);
