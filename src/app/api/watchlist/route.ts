import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { get } from "@/lib/db";
import { upsertMediaItem, upsertWatchlistEntry } from "@/lib/matcher";
import { persistItemFromIds } from "@/lib/persistItem";
import { resolveMediaItemFromIds } from "@/lib/userState";
import { removeFromWishlist } from "@/lib/wishlistRemove";
import { sanitizePosterUrl } from "@/lib/posterUrl";
import { parseJsonBody } from "@/lib/validate";
import { WatchlistPostSchema, WatchlistDeleteSchema } from "@/lib/schemas";
import { log, errorFields } from "@/lib/logger";
import { sourcesForType } from "@/lib/sources/registry";

export const POST = withUser(async (req: NextRequest, session) => {
    const { type, title, releaseDate, posterUrl, ids, targetProvider } =
      await parseJsonBody(req, WatchlistPostSchema);

    // S12: only persist/reflect a poster URL from a trusted media-CDN host.
    const safePosterUrl = sanitizePosterUrl(posterUrl);

    // Fetch + store the canonical media_item from the provided source ids.
    const mediaItemId = await persistItemFromIds({ type, title, releaseDate, posterUrl: safePosterUrl, ids });
    if (!mediaItemId) return NextResponse.json({ error: "Could not resolve item" }, { status: 400 });

    // Mark all found sources in watchlist
    const sources = Object.keys(ids).filter((k) => ids[k]);
    for (const source of sources) {
      upsertWatchlistEntry(session.userId, mediaItemId, source as any);
    }

    // ── Platform write-backs via the MediaSource registry ───────────
    // For each writable provider that handles this type, resolve the provider's
    // own id (natively or by cross-referencing TMDB), persist the resolved link
    // so status/remove can find it, then push to the platform. `targetProvider`
    // (if set) narrows the write-back to a single provider.
    const shouldWriteTo = (p: string) => !targetProvider || targetProvider === p;
    const year = releaseDate ? parseInt(String(releaseDate).slice(0, 4)) : undefined;
    // PL2 (2026-08-23): collected and RETURNED, the way /api/library has always
    // done it. This loop used to catch, log and answer `{ ok: true }` regardless,
    // so a provider refusing the write was invisible to the person who asked for
    // it. Trakt makes that concrete: it caps a free account's watchlist and
    // answers 420, so past the cap the item silently stopped reaching Trakt while
    // Fandex kept saying it had been added. The log line was the only evidence,
    // and the user is the one person who cannot read it.
    const platformErrors: string[] = [];

    for (const src of sourcesForType(type)) {
      if (!src.capabilities.wishlist.write || !shouldWriteTo(src.id)) continue;
      try {
        const ctx = await src.context(session.userId);
        if (!ctx?.token) continue;
        let sourceId = src.resolveSourceId
          ? await src.resolveSourceId(ctx, type, ids, { title, year })
          : (ids[src.id] != null ? String(ids[src.id]) : null);
        // The client payload often lacks a provider's own id — e.g. adding a
        // Trakt title sends only its trakt id, so TMDB's resolveSourceId (which
        // reads ids.tmdb) returns null and the write-back was silently skipped.
        // We captured cross-source ids at merge time (extractCrossIds →
        // media_external_ids), so resolve the provider's id from there.
        if (!sourceId) {
          const ext = get<{ external_id: string }>(
            "SELECT external_id FROM media_external_ids WHERE media_item_id = ? AND source = ? LIMIT 1",
            [mediaItemId, src.id]
          );
          if (ext?.external_id) sourceId = ext.external_id;
        }
        if (!sourceId) continue;
        // Persist the resolved link (esp. when resolved via TMDB) so the item's
        // status and later removal can find this provider.
        if (ids[src.id] == null) {
          upsertMediaItem({
            source: src.id, sourceId, type,
            title: title ?? "", releaseDate: releaseDate ?? null,
            rawData: { title, ids: { ...ids, [src.id]: sourceId } },
          });
        }
        await src.pushWishlist!(ctx, sourceId, type, true);
        upsertWatchlistEntry(session.userId, mediaItemId, src.id);
        log.info("watchlist_writeback", { op: "add", source: src.id, sourceId, mediaItemId });
      } catch (e) {
        log.error("watchlist_writeback_failed", { op: "add", source: src.id, mediaItemId, ...errorFields(e) });
        platformErrors.push(`${src.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // `ok` stays true: the item IS on the Fandex watchlist, which is the local
    // truth and the thing the caller asked for. The warning says which provider
    // did not take it, so the UI can say so without pretending the whole action
    // failed. Same contract as /api/library's `warnings`.
    return NextResponse.json({
      ok: true,
      mediaItemId,
      ...(platformErrors.length > 0 && { warnings: platformErrors }),
    });
});

export const DELETE = withUser(async (req: NextRequest, session) => {
    const body = await parseJsonBody(req, WatchlistDeleteSchema, { allowEmpty: true });
    // Prefer the explicit UUID; fall back to resolving it from source ids (a card
    // that never carried the local UUID). Nothing resolvable → nothing to remove.
    const mediaItemId: string | null = body.mediaItemId ?? resolveMediaItemFromIds(body.ids);
    if (!mediaItemId) return NextResponse.json({ ok: true });

    // The whole removal (S7 ownership gate, provider write-back, truth-table
    // clear) lives in lib/wishlistRemove.ts since 2026-07-30 — /api/library's
    // POST needs the same behaviour when a rating lands, and a second copy of a
    // provider write-back loop is exactly how the two would drift.
    await removeFromWishlist(session.userId, mediaItemId, { source: body.source });

    return NextResponse.json({ ok: true });
});
