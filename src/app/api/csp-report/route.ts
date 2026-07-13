import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, clientIp } from "@/lib/rateLimit";
import { parseCspReport } from "@/lib/cspReport";
import { log } from "@/lib/logger";

// S6 — CSP violation sink. The Report-Only policy (next.config.ts) points its
// `report-uri` here so would-be violations surface in the Railway logs (via the
// P9 structured logger) instead of only the browser console. Public + unauthed
// (browsers post reports without credentials), so cap per IP to prevent flooding.
export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(`csp-report:${clientIp(req)}`, 60, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  log.warn("csp_violation", { ...parseCspReport(body) });
  // Reports don't need a response body.
  return new NextResponse(null, { status: 204 });
}
