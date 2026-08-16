import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { get, query } from "@/lib/db";
import { parseJsonBody } from "@/lib/validate";
import { EpisodesPostSchema } from "@/lib/schemas";
import { sourcesForType } from "@/lib/sources/registry";
import { upsertMediaItem } from "@/lib/matcher";
import { log, errorFields } from "@/lib/logger";
import type { MediaType } from "@/types";
import type { EpisodeRef } from "@/lib/episodes";
import {
  ensureShowSeasons, ensureSeasonEpisodes, loadEpisodes,
  loadWatched, watchedCounts, markEpisodes, unmarkEpisodes,
} from "@/lib/episodes";

// MB14 — per-episode tracking for shows.
//
// GET  ?mediaItemId=…            → the season list with an n/total progress count
//      &season=n                 → additionally that season's episode list
// POST { mediaItemId, watched, season? | episodes? }
//
// The catalog half is filled LAZILY here (P18's precedent): the season list on
// the first view of a show, one season's episodes the first time it's expanded.
// Never a full-catalog op.

export const dynamic = "force-dynamic";

function showRow(mediaItemId: string) {
  return get<{ id: string; type: string; title: string; release_date: string | null }>(
    "SELECT id, type, title, release_date FROM media_items WHERE id = ?",
    [mediaItemId],
  );
}

export const GET = withUser(async (req: NextRequest, session) => {
  const { searchParams } = req.nextUrl;
  const mediaItemId = searchParams.get("mediaItemId");
  if (!mediaItemId) return NextResponse.json({ error: "mediaItemId required" }, { status: 400 });

  const item = showRow(mediaItemId);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (item.type !== "show") return NextResponse.json({ seasons: [], watched: [], supported: false });

  const seasons = await ensureShowSeasons(mediaItemId);
  const counts = watchedCounts(session.userId, mediaItemId);

  const seasonParam = searchParams.get("season");
  const seasonNumber = seasonParam == null ? null : Number(seasonParam);
  const wantsSeason = seasonNumber != null && Number.isInteger(seasonNumber);

  const episodes = wantsSeason ? await ensureSeasonEpisodes(mediaItemId, seasonNumber) : [];

  return NextResponse.json({
    supported: true,
    seasons: seasons.map((s) => ({ ...s, watchedCount: counts[s.seasonNumber] ?? 0 })),
    // Only the requested season's watched set — the whole show's would grow
    // without bound on a long-running series and the collapsed view needs
    // nothing beyond the counts above.
    watched: wantsSeason ? loadWatched(session.userId, mediaItemId, seasonNumber) : [],
    episodes,
  });
});

export const POST = withUser(async (req: NextRequest, session) => {
  const body = await parseJsonBody(req, EpisodesPostSchema);
  const item = showRow(body.mediaItemId);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (item.type !== "show") {
    return NextResponse.json({ error: "Episodes apply to shows only" }, { status: 400 });
  }

  // Resolve the target list. A bare `season` means the whole season, which needs
  // the catalog — so fill it first rather than silently marking nothing.
  let targets: EpisodeRef[];
  if (body.episodes?.length) {
    targets = body.episodes;
  } else if (body.season != null) {
    await ensureSeasonEpisodes(body.mediaItemId, body.season);
    targets = loadEpisodes(body.mediaItemId, body.season).map((e) => ({
      season: e.seasonNumber,
      episode: e.episodeNumber,
    }));
    if (!targets.length) {
      return NextResponse.json({ error: "No episodes known for that season" }, { status: 409 });
    }
  } else {
    return NextResponse.json({ error: "season or episodes required" }, { status: 400 });
  }

  // ── Push first, write second ────────────────────────────────────────────────
  // The order is the whole contract. Writing locally and pushing afterwards
  // would leave a tick that Trakt never accepted looking permanent until the
  // next sync silently pruned it (episodes.ts's reconcile treats "absent from a
  // complete pull" as removed upstream). Pushing first means a failure surfaces
  // as a 502 the client rolls its optimistic state back on, and nothing local is
  // ever attributed to a provider that didn't take it.
  const { pushedTo, errors } = await pushToProviders(
    session.userId,
    body.mediaItemId,
    item.type as MediaType,
    item.title,
    item.release_date,
    targets,
    body.watched,
  );

  // Every writable provider the user has connected refused → don't write.
  if (errors.length && !pushedTo.length) {
    return NextResponse.json(
      { error: `Could not reach ${errors.join(", ")}`, pushErrors: errors },
      { status: 502 },
    );
  }

  const changed = body.watched
    ? markEpisodes(session.userId, body.mediaItemId, targets, { sources: pushedTo })
    : unmarkEpisodes(session.userId, body.mediaItemId, targets);

  return NextResponse.json({
    ok: true,
    changed,
    pushedTo,
    watchedCount: watchedCounts(session.userId, body.mediaItemId),
  });
});

/**
 * Push the episode change to every connected provider that can write episodes,
 * mirroring /api/library's id-resolution (media_links cross-ids, then the
 * media_external_ids fallback for a cross-referenced item).
 *
 * Returns the providers that actually took the write — that list becomes the
 * row's `sources`, so a provider that errored is never recorded as holding
 * state it doesn't have.
 */
async function pushToProviders(
  userId: string,
  mediaItemId: string,
  type: MediaType,
  title: string,
  releaseDate: string | null,
  episodes: EpisodeRef[],
  watched: boolean,
): Promise<{ pushedTo: string[]; errors: string[] }> {
  const links = query<{ source: string; source_id: string }>(
    "SELECT source, source_id FROM media_links WHERE media_item_id = ?",
    [mediaItemId],
  );
  const crossIds: Record<string, string> = {};
  for (const l of links) crossIds[l.source] = l.source_id;
  const year = releaseDate ? parseInt(String(releaseDate).slice(0, 4)) : undefined;

  const pushedTo: string[] = [];
  const errors: string[] = [];

  for (const src of sourcesForType(type)) {
    if (!src.capabilities.episodes?.write || !src.pushEpisodes) continue;
    try {
      const ctx = await src.context(userId);
      if (!ctx?.token) continue;
      let sourceId = src.resolveSourceId
        ? await src.resolveSourceId(ctx, type, crossIds, { title, year })
        : (crossIds[src.id] != null ? String(crossIds[src.id]) : null);
      if (!sourceId) {
        const ext = get<{ external_id: string }>(
          "SELECT external_id FROM media_external_ids WHERE media_item_id = ? AND source = ? LIMIT 1",
          [mediaItemId, src.id],
        );
        if (ext?.external_id) sourceId = ext.external_id;
      }
      if (!sourceId) continue;
      // Persist a newly-resolved cross-ref so later reads/writes find it directly.
      if (crossIds[src.id] == null) {
        upsertMediaItem({
          source: src.id, sourceId, type, title, releaseDate,
          rawData: { title, ids: { ...crossIds, [src.id]: sourceId } },
        });
      }
      await src.pushEpisodes(ctx, sourceId, episodes, watched);
      pushedTo.push(src.id);
    } catch (e) {
      errors.push(src.id);
      log.warn("episode_push_failed", {
        source: src.id, mediaItemId, count: episodes.length, watched, ...errorFields(e),
      });
    }
  }

  return { pushedTo, errors };
}
