// Next.js calls register() once when a server instance boots, before it serves
// any request — the right place to validate configuration (P10). Guarded to the
// Node runtime (config.ts reads process.env, irrelevant on the edge runtime) and
// dynamically imported so it's never pulled into an edge bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("./lib/config");
    validateEnv();

    // Boot-time prune of the browsed-discover tail (2026-08-03), default ON —
    // set PRUNE_ON_BOOT=0 to disable. NOT awaited: bootPrune() defers its own
    // (synchronous, better-sqlite3) DB work past this tick, so register()
    // still returns immediately and a prune failure can never crash boot.
    const { bootPrune } = await import("./lib/dbPrune");
    const { log, errorFields } = await import("./lib/logger");
    void bootPrune().catch((e) => log.error("boot_prune_uncaught", errorFields(e)));
  }
}
