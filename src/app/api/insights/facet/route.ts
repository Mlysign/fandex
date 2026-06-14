import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { buildFacetDetail } from "@/lib/facetDetail";
import { FacetRole } from "@/lib/facets";

// Detail for one facet (tag/person/company): catalog items carrying it (+ your
// library state), your average vs the crowd, and a TMDB bio/age for people.
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const { searchParams } = req.nextUrl;
    const kind = searchParams.get("kind");
    const key = searchParams.get("key");
    const label = searchParams.get("label") ?? key ?? "";
    const role = searchParams.get("role") || undefined;
    if (!kind || !key) return NextResponse.json({ error: "kind and key are required" }, { status: 400 });

    const payload = await buildFacetDetail(session.userId, { kind, role: role as FacetRole | undefined, key, label });
    return NextResponse.json(payload);
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
