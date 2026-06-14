import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { syncProviders } from "@/lib/sync";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = await req.json().catch(() => ({ provider: "all" }));
    const { provider } = body;

    console.log(`[sync] Starting sync for user ${session.userId}, provider: ${provider ?? "all"}`);

    // One generic pass over the registered providers — each pulls its wishlist +
    // library through its adapter. Provider may be "all" or a specific source id.
    const results = await syncProviders(session.userId, provider);

    console.log("[sync] Done:", JSON.stringify(results));
    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    console.error("[sync] Error:", e);
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
