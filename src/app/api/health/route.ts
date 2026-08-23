import { NextResponse } from "next/server";
import { get } from "@/lib/db";
import {
  readCgroupMemory,
  readDbFootprint,
  readProcessRss,
} from "@/lib/containerMemory";
import { providerBreakerSnapshot, providerCallSnapshot, hostGateSnapshot } from "@/lib/http";
import { cacheSnapshot } from "@/lib/boundedCache";

// Reads live process/cgroup state — must never be prerendered at build time.
export const dynamic = "force-dynamic";

// Liveness + readiness probe (P9). Unauthenticated on purpose so Railway's
// healthcheck (and any uptime monitor) can hit it. Deliberately leaks nothing
// sensitive — just whether the process is up and the DB is reachable.
//
// - 200 { status: "ok" }        → process up AND DB query succeeds (ready)
// - 503 { status: "degraded" }  → process up but the DB probe failed (not ready)
export async function GET() {
  let db = false;
  try {
    // Cheapest possible probe: opens/uses the SQLite connection and confirms it
    // answers. Also implicitly verifies the volume-mounted DB file is readable.
    const row = get<{ ok: number }>("SELECT 1 AS ok");
    db = row?.ok === 1;
  } catch {
    db = false;
  }

  // Memory breakdown (2026-07-21). Railway's dashboard only graphs total RSS,
  // which cost two incidents' worth of guessing about WHERE the memory was.
  // heap* is what --max-old-space-size bounds; external/arrayBuffers is Buffer
  // territory; rss minus all of those is native (sharp, SQLite, allocator
  // fragmentation). If rss ramps while heapUsed stays flat, it is not a JS leak.
  const m = process.memoryUsage();
  const mb = (n: number) => Math.round(n / 1048576);

  // ...and the level ABOVE the process (2026-07-22). Railway graphs the whole
  // container: two processes (litestream + node) plus kernel page cache. When
  // the dashboard ramps to 2GB while `memoryMb.rss` sits flat at ~350MB, the
  // answer is in here — cgroup.anonMb is real process memory, cgroup.fileMb is
  // reclaimable page cache from SQLite I/O, and `processes` splits node from
  // Litestream. See src/lib/containerMemory.ts.
  const body = {
    status: db ? "ok" : "degraded",
    db: db ? "up" : "down",
    uptime: Math.round(process.uptime()),
    memoryMb: {
      rss: mb(m.rss),
      heapTotal: mb(m.heapTotal),
      heapUsed: mb(m.heapUsed),
      external: mb(m.external),
      arrayBuffers: mb(m.arrayBuffers),
    },
    cgroupMb: readCgroupMemory(),
    processes: readProcessRss(),
    dbFilesMb: readDbFootprint(),
    // Third-party hosts whose circuit breaker is currently OPEN (2026-08-02).
    // `{}` = every provider looks healthy. This exists because diagnosing the
    // RAWG outage that motivated the breaker took a manual curl against each
    // provider in turn — the answer belongs in the probe we already have.
    // Host names only, never a key or a URL with one in it.
    openProviderCircuits: providerBreakerSnapshot(),
    // Per-host provider call volume SINCE BOOT (2026-08-20). Added after RAWG's
    // monthly quota ran out at pre-launch traffic and nothing in the app could
    // say which surface spent it — `openProviderCircuits` answers "is it up",
    // never "how much are we asking of it". Read `projectedPerMonth` against
    // `uptime` above and distrust it under an hour; a deploy resets these.
    // Host names and counts only, never a key or a URL carrying one.
    providerCalls: providerCallSnapshot(),
    // Per-host concurrency gates (2026-08-23). IGDB publishes a 4 req/s limit
    // and we were exceeding it — 64 network errors in 175 requests, and 190 of
    // 232 in an earlier reading — which matters more than latency because with
    // RAWG's quota exhausted IGDB is the ONLY games source left.
    //
    // `queuedTotal: 0` means the gate never bound and the concurrency was not
    // the problem. A rising `maxQueued` means it is doing real work. This is
    // here because the fix shipped on a documented rate limit plus a visible
    // fan-out rather than on a fresh measurement (the browse page cache landed
    // the same day and cut IGDB volume), so the next reading is what settles it.
    hostGates: hostGateSnapshot(),
    // Live entry count per SHARED cache (2026-08-23). These were bare
    // module-scope caches, which Next duplicates per route bundle — so the
    // budgeted figure was never the retained figure, and nothing could see the
    // difference from inside one bundle. Now that they are process-wide, THIS
    // is the true number: read it against the `max` each cache was sized to.
    caches: cacheSnapshot(),
  };
  return NextResponse.json(body, { status: db ? 200 : 503 });
}
