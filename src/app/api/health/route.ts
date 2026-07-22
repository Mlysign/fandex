import { NextResponse } from "next/server";
import { get } from "@/lib/db";
import {
  readCgroupMemory,
  readDbFootprint,
  readProcessRss,
} from "@/lib/containerMemory";

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
  };
  return NextResponse.json(body, { status: db ? 200 : 503 });
}
