import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

// Every test file starts from the real schema: the same migration files
// `wrangler d1 migrations apply` runs against production.
await applyD1Migrations(
  (env as unknown as { DB: D1Database }).DB,
  (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
);

// A budget a test exhausted stays exhausted in the isolate for the UTC day
// (src/budget.ts), and every test file shares one isolate's modules.
import { beforeEach } from "vitest";
import { forgetExhausted } from "../src/budget";
beforeEach(() => forgetExhausted());
