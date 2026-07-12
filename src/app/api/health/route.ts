import { NextResponse } from "next/server";
import { get } from "@/lib/db";

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

  const body = {
    status: db ? "ok" : "degraded",
    db: db ? "up" : "down",
    uptime: Math.round(process.uptime()),
  };
  return NextResponse.json(body, { status: db ? 200 : 503 });
}
