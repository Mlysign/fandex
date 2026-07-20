import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { buildFacetDetail } from "@/lib/facetDetail";
import { FacetKind, FacetRole, extractFacets } from "@/lib/facets";
import { buildProfile, computeFandexScore, itemsWithFacet, getTagVocab, getCompanyVocab } from "@/lib/discovery";
import { loadLinks } from "@/lib/detail/enrich";
import { mergeLinks } from "@/lib/merge";
import { get } from "@/lib/db";
import { getScoringConfig } from "@/lib/scoringConfig";
import { MediaType } from "@/types";

// P17 — the PERSONAL overlay for a public facet page. The page itself is public
// and provider-sourced (publicFacetDetail.ts, no user data); this authed endpoint
// supplies ONLY the logged-in viewer's half: their you-vs-crowd stats and, per
// media id, their rating/library state. The client island fetches it and paints
// those onto the public items it already rendered (matched by media uuid).
//
// It reuses the existing authed builder and simply DROPS its item list + crowd
// fields, so there is one source of truth for "your average vs the crowd".
export const GET = withUser(async (req: NextRequest, session) => {
  const { searchParams } = req.nextUrl;
  const kind = searchParams.get("kind");
  const key = searchParams.get("key");
  if (!kind || !key) return NextResponse.json({ error: "kind and key are required" }, { status: 400 });

  // Q25: recover the real display label from the catalog vocab, same as the
  // public page does — `key` is companyKey()/tagKey()'s LOSSY normalized form
  // ("focus" for "Focus Entertainment"), and buildFacetDetail's company branch
  // searches TMDB with whatever label it's given, so passing the bare key back
  // as the label risked matching the wrong company here too.
  const label = (kind === "tag" ? getTagVocab() : kind === "company" ? getCompanyVocab() : [])
    .find((v) => v.key === key)?.label ?? key;

  // No role → the combined view (buildFacetDetail matches all roles for the key),
  // matching the public page which is always role-combined.
  const payload = await buildFacetDetail(session.userId, { kind, role: undefined as FacetRole | undefined, key, label });

  const states: Record<string, { rating: number | null; libraryStatus: string | null; onWatchlist: boolean }> = {};
  for (const i of payload.items) {
    if (i.rating != null || i.libraryStatus || i.onWatchlist) {
      states[i.id] = { rating: i.rating, libraryStatus: i.libraryStatus, onWatchlist: i.onWatchlist };
    }
  }

  // H5.6 — per-id Fandex Score for the client-side "Fandex Score" sort. Only the
  // viewer's own catalog items carrying this facet get a score (via the discovery
  // cache's facets); public pool items not in their library have none and sort
  // last. Combined view (no role), matching the public page.
  const profile = buildProfile(session.userId);
  const fandexById: Record<string, number> = {};
  for (const v of itemsWithFacet({ kind: kind as FacetKind, role: undefined, key })) {
    const sc = computeFandexScore(v.facets, profile)?.score;
    if (sc != null) fandexById[v.id] = sc;
  }

  // Q24 (2026-07-19) — itemsWithFacet only covers the catalog POOL (browsed=0
  // OR acted-on), so a facet-page item you HAVEN'T touched yet — a thin,
  // persisted-but-browsed=1 row — never got a score, even though that's
  // exactly the item a viewer wants scored ("is this worth discovering?").
  // The client sends the ids it actually rendered; score any not already
  // covered above directly from that item's own stored provider links.
  const idsParam = searchParams.get("ids");
  if (idsParam) {
    const requested = [...new Set(idsParam.split(",").map((s) => s.trim()).filter(Boolean))];
    for (const id of requested) {
      if (id in fandexById) continue;
      const links = loadLinks(id);
      if (!links.length) continue;
      const item = get<{ type: MediaType }>("SELECT type FROM media_items WHERE id = ?", [id]);
      if (!item) continue;
      const merged = mergeLinks(links, item.type);
      const sc = computeFandexScore(extractFacets(links, item.type, merged), profile)?.score;
      if (sc != null) fandexById[id] = sc;
    }
  }

  // Q28 (2026-07-19) — REVERTS Q18's "Your average (Bayesian)" stat (too
  // opaque for a non-technical viewer) in favor of a plain-language "Fandex
  // impact": what does this tag actually DO to an item's score. `gain × dev_f`
  // is the tag's MAXIMUM possible per-item contribution — what an item
  // carrying ONLY this tag would move by. In computeFandexScore's weighted
  // mean, adding any other matched facet can only dilute a single facet's own
  // contribution toward zero, never amplify it past this ceiling — so it's a
  // meaningful "best case" number, not an average across real mixed items.
  // Same points currency the Why-breakdown shows, so the two surfaces agree.
  // tag-only; person/company facets don't carry a single BA_f/classWeight the
  // same way.
  let tagImpact: { points: number; direction: "up" | "down" | "neutral"; ratedCount: number } | null = null;
  if (kind === "tag") {
    const facetMeta = profile.meta.get(`tag||${key}`);
    if (facetMeta?.BA != null && facetMeta.n != null) {
      const dev = facetMeta.BA - profile.baseline;
      const cfg = getScoringConfig();
      const gain = dev >= 0 ? cfg.mappingConstantUp : cfg.mappingConstantDown;
      const points = Math.round(gain * dev * 10) / 10;
      tagImpact = {
        points,
        direction: Math.abs(points) < 0.5 ? "neutral" : points > 0 ? "up" : "down",
        ratedCount: facetMeta.n,
      };
    }
  }

  return NextResponse.json({
    stats: {
      userAvg: payload.stats.userAvg,
      userCount: payload.stats.userCount,
      communityAvg: payload.stats.communityAvg,
      delta: payload.stats.delta,
      baseline: payload.stats.baseline,
    },
    states,
    fandexById,
    tagImpact,
  });
});
