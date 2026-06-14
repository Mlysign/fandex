import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { find, FindRequest } from "@/lib/discovery";

// Taste Match — rank the whole local catalog by the user's preference profile
// (refined with seeds + like/dislike pills), with filters + sort. POST body is a
// FindRequest; see src/lib/discovery.ts.
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = (await req.json().catch(() => ({}))) as FindRequest;
    return NextResponse.json(find(session.userId, body));
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
