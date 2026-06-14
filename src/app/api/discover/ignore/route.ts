import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { ignoreItem, unignoreItem } from "@/lib/matcher";

// T10 "For You" feed: mark an item ignored (swipe left) or undo it. The feed
// (find with excludeIgnored) then never surfaces it again.
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const { mediaItemId } = await req.json();
    if (!mediaItemId) return NextResponse.json({ error: "mediaItemId required" }, { status: 400 });
    ignoreItem(session.userId, mediaItemId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    const { mediaItemId } = await req.json();
    if (!mediaItemId) return NextResponse.json({ error: "mediaItemId required" }, { status: 400 });
    unignoreItem(session.userId, mediaItemId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
