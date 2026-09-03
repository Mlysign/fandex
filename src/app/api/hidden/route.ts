import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { get } from "@/lib/db";
import { hideItem, unhideItem, hiddenCount } from "@/lib/hiddenItems";
import { resolveMediaItemFromIds } from "@/lib/userState";
import { parseJsonBody } from "@/lib/validate";
import { HiddenPostSchema } from "@/lib/schemas";

// POST   /api/hidden — "stop showing me this"
// DELETE /api/hidden — unhide
//
// Body: { mediaItemId } or the usual { ids } identity, same tolerance the
// library and watchlist DELETEs have, so a card that never carried the local
// uuid can still act.
//
// ⚠️ Signed-in only, and it writes NOTHING to the catalog. Hiding is a per-user
// display preference: it does not touch media_items, media_links, user_item_state
// or any provider. That is what makes it safe to call from a browse surface.
export const dynamic = "force-dynamic";

/** The row must exist before we can key a preference to it. */
function resolve(body: { mediaItemId?: string; ids?: Record<string, string | number | null> }): string | null {
  const id = body.mediaItemId ?? resolveMediaItemFromIds(body.ids);
  if (!id) return null;
  return get<{ id: string }>("SELECT id FROM media_items WHERE id = ?", [id])?.id ?? null;
}

export const POST = withUser(async (req: NextRequest, session) => {
  const body = await parseJsonBody(req, HiddenPostSchema, { allowEmpty: true });
  const mediaItemId = resolve(body);
  if (!mediaItemId) return NextResponse.json({ error: "Could not resolve item" }, { status: 400 });

  hideItem(session.userId, mediaItemId);
  return NextResponse.json({ ok: true, mediaItemId, hidden: true, total: hiddenCount(session.userId) });
});

export const DELETE = withUser(async (req: NextRequest, session) => {
  const body = await parseJsonBody(req, HiddenPostSchema, { allowEmpty: true });
  const mediaItemId = resolve(body);
  // Idempotent: nothing resolvable means nothing to unhide, same shape as the
  // watchlist and library DELETEs.
  if (!mediaItemId) return NextResponse.json({ ok: true });

  unhideItem(session.userId, mediaItemId);
  return NextResponse.json({ ok: true, mediaItemId, hidden: false, total: hiddenCount(session.userId) });
});
