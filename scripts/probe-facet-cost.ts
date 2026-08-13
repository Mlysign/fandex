// Read-only probe: WHERE does a cold public-facet render actually spend its time?
//
// Written for the 2026-08-13 plan (T1). This repo has twice paid for optimising
// before measuring — perf §A was mis-sized by 100×, and the 58 s Discover load
// was blamed on the pool cache for days when it was a dead provider. So the
// persisted-cache work is gated on this probe showing that PROVIDER FAN-OUT,
// not local scoring/sort, dominates. If it doesn't, the fix is wrong.
//
// Counts and times outbound HTTP by wrapping globalThis.fetch, so it measures
// the real fan-out rather than trusting the call sites.
//
//   npx tsx --env-file=.env scripts/probe-facet-cost.ts
//
// Read-only w.r.t. the DB: every build runs with persist:false, which after
// SM38 (2026-08-12) still resolves uuids but writes nothing.
import { initDb } from "@/lib/db";
import { buildPublicFacetDetail } from "@/lib/detail/publicFacetDetail";
import type { PublicFacetRef } from "@/lib/detail/publicFacetDetail";

interface FetchStat {
  calls: number;
  /** Summed per-call durations. EXCEEDS wall clock when calls run concurrently
   *  (they do — `fetchPages` fires 5 pages under one Promise.all), so this is a
   *  measure of provider WORK, never of elapsed time. Dividing it by the total
   *  is meaningless and produced a "362%" reading on the first run. */
  ms: number;
  /** Wall-clock span actually spent inside fetch: last-end minus first-start.
   *  THIS is what to compare against the total — concurrency-correct. */
  spanMs: number;
  byHost: Record<string, { n: number; ms: number }>;
}

function instrumentFetch(): { stat: FetchStat; restore: () => void } {
  const stat: FetchStat = { calls: 0, ms: 0, spanMs: 0, byHost: {} };
  let firstStart = Infinity;
  let lastEnd = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    let host = "unknown";
    try { host = new URL(url).host; } catch { /* keep "unknown" */ }
    const t0 = performance.now();
    if (t0 < firstStart) firstStart = t0;
    try {
      return await orig(input, init);
    } finally {
      const t1 = performance.now();
      if (t1 > lastEnd) lastEnd = t1;
      const dt = t1 - t0;
      stat.calls++;
      stat.ms += dt;
      stat.spanMs = lastEnd - firstStart;
      const b = stat.byHost[host] ?? { n: 0, ms: 0 };
      b.n++; b.ms += dt;
      stat.byHost[host] = b;
    }
  }) as typeof fetch;
  return { stat, restore: () => { globalThis.fetch = orig; } };
}

async function measure(label: string, ref: PublicFacetRef) {
  const { stat, restore } = instrumentFetch();
  const t0 = performance.now();
  let items = 0;
  let failed = false;
  try {
    const payload = await buildPublicFacetDetail(ref, { persist: false });
    items = payload?.items.length ?? 0;
    if (!payload) failed = true;
  } catch (e) {
    failed = true;
    console.log(`  ${label}: THREW ${(e as Error).message}`);
  } finally {
    restore();
  }
  const total = performance.now() - t0;
  // Compare the WALL-CLOCK fetch span, not summed durations — the calls are
  // concurrent. Everything outside that span is local work: pool assembly,
  // scoring, sort, projection.
  const local = Math.max(0, total - stat.spanMs);
  const pct = total > 0 ? Math.round((stat.spanMs / total) * 100) : 0;
  console.log(
    `  ${label.padEnd(26)} total=${total.toFixed(0)}ms  fanoutSpan=${stat.spanMs.toFixed(0)}ms (${pct}%)  ` +
    `local=${local.toFixed(0)}ms  calls=${stat.calls}  work=${stat.ms.toFixed(0)}ms  items=${items}${failed ? "  [BUILD FAILED]" : ""}`
  );
  for (const [host, b] of Object.entries(stat.byHost).sort((a, z) => z[1].ms - a[1].ms)) {
    console.log(`      ${host.padEnd(24)} ${b.n} call(s)  ${b.ms.toFixed(0)}ms`);
  }
  return { total, fanout: stat.ms, local, calls: stat.calls, pct };
}

async function main() {
  initDb();
  console.log("=== cold public-facet render cost (persist:false, read-only) ===");
  console.log("Each key is used ONCE so every build is a genuine cache miss.\n");

  const results: Record<string, Awaited<ReturnType<typeof measure>>> = {};
  // Deliberately obscure keys: a popular one may already sit in a warm cache in
  // a long-lived process, and the long tail is what a crawl sweep actually hits.
  results.tag = await measure("tag/telepathy", { kind: "tag", key: "telepathy" });
  results.person = await measure("person/christopher nolan", { kind: "person", key: "christopher nolan" });
  results.company = await measure("company/a24", { kind: "company", key: "a24" });

  const avgPct = Math.round(
    Object.values(results).reduce((s, r) => s + r.pct, 0) / Object.values(results).length
  );
  console.log(`\n=== verdict ===`);
  console.log(`provider fan-out is ${avgPct}% of cold render time on average`);
  console.log(
    avgPct >= 60
      ? "→ fan-out DOMINATES: a persisted cache is the right fix (T2/T3 proceed)."
      : "→ fan-out does NOT dominate: STOP. The premise of T2/T3 is wrong; log a blocker."
  );
}

main();
