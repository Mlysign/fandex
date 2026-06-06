import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { initDb } from "@/lib/db";
import { syncTrakt, syncSteam, syncRawg } from "@/lib/sync";

export async function POST(req: NextRequest) {
  try {
    initDb();
    const session = await requireSession();
    const body = await req.json().catch(() => ({ provider: "all" }));
    const { provider } = body;

    console.log(`[sync] Starting sync for user ${session.userId}, provider: ${provider}`);

    const results: Record<string, any> = {};

    if (provider === "all" || provider === "trakt") {
      console.log("[sync] Running Trakt sync...");
      results.trakt = await syncTrakt(session.userId);
      console.log("[sync] Trakt result:", JSON.stringify(results.trakt));
    }
    if (provider === "all" || provider === "steam") {
      console.log("[sync] Running Steam sync...");
      results.steam = await syncSteam(session.userId);
      console.log("[sync] Steam result:", JSON.stringify(results.steam));
    }
    if (provider === "all" || provider === "rawg") {
      console.log("[sync] Running RAWG sync...");
      results.rawg = await syncRawg(session.userId);
      console.log("[sync] RAWG result:", JSON.stringify(results.rawg));
    }

    console.log("[sync] All done:", JSON.stringify(results));
    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    console.error("[sync] Error:", e);
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
