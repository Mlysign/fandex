import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { buildInsights } from "@/lib/insights";

// Library analytics — aggregates the user's rated library into rating
// distribution, tag/people/company stats, and the extra (you-vs-crowd / by-era)
// breakdowns. All computed on the fly over user_library (cached per library
// signature in libraryAnalysis).
export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json(buildInsights(session.userId));
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
