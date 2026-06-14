import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { searchFacets, searchTitles } from "@/lib/discovery";

// Autocomplete for Taste Match: facet pills (kind=tag|person|company) and
// example-title seeds (kind=title), searched against the local catalog vocab.
export async function GET(req: NextRequest) {
  try {
    await requireSession();
    const { searchParams } = req.nextUrl;
    const q = searchParams.get("q") ?? "";
    const kind = searchParams.get("kind");
    if (kind === "title") return NextResponse.json({ matches: searchTitles(q) });
    return NextResponse.json({ matches: searchFacets(q, kind) });
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
