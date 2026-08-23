import { beforeEach } from "vitest";
import { __clearSharedCaches } from "@/lib/boundedCache";

// ── Shared caches are process-wide, so tests must start from empty ──────────
//
// 2026-08-23: ~20 module-level BoundedCaches moved behind `sharedCache()`, which
// pins them to globalThis so Next cannot duplicate them per route bundle. That
// is the point of the change, and it has one consequence here — a cache is no
// longer thrown away between test files, so one test's cached provider response
// silently answers the next test's request.
//
// It surfaced immediately: omdb's "a bad key still fails closed on a non-ok
// response" started failing with "expected fetch to be called 1 times, got 0",
// because an earlier test in the same file had already cached that lookup. The
// test was right and the isolation was gone.
//
// Clearing here rather than in each file, because the failure mode is silent in
// the other direction too: a test that PASSES off a stale cache entry proves
// nothing, and there is no reason every future test author should have to know
// which of the twenty caches their code path touches.
beforeEach(() => {
  __clearSharedCaches();
});
