"use client";
import { useState } from "react";
import { EnrichedItem } from "@/types";
import { PublicEnrichedItem } from "@/lib/detail/enrich";
import { SOURCE_COLORS, SOURCE_LABELS } from "@/lib/constants";
import { TypeBadge } from "@/components/Badges";
import { fmtDate } from "./format";
import MediaGallery from "./MediaGallery";
import RatingsSection from "./RatingsSection";
import FactsSection from "./FactsSection";
import LowerSections from "./LowerSections";
import PersonalSection from "./PersonalSection";
import BackButton from "@/components/ui/BackButton";
import type { TagDisplayCategory } from "@/lib/tags";

// P13 — THE item view. One page, one url, for everyone.
//
// Everything here renders from `item`, which the SERVER built with no user data:
// gallery, title, dates, community scores, facts, credits, trailer, cast,
// where-to-watch, tags. That's why a logged-out visitor (and a crawler, and a
// link unfurler) sees the full page.
//
// The single per-user block — your rating + wishlist — is <PersonalSection>, a
// client island that checks the session itself and swaps between a sign-in hook
// and the real interactive controls. Nothing above it may depend on a session,
// or the server HTML would vary per viewer and the SSR guarantee would break.
export default function ItemView({ item, tagOverrides, tagCategories }: {
  item: PublicEnrichedItem;
  // Global tag taxonomy, read on the server (see LowerSections). Viewer-
  // independent, so it doesn't compromise the SSR guarantee described above.
  tagOverrides?: Record<string, string>;
  tagCategories?: TagDisplayCategory[];
}) {
  const [idx, setIdx] = useState(0);

  // The sections take an EnrichedItem. This is the ONE place that widens the
  // public type, and it's where the per-user fields are explicitly empty.
  const enriched: EnrichedItem = { ...item, platformSources: [] };

  const imgs: string[] = [];
  if (item.posterUrl) imgs.push(item.posterUrl);
  for (const u of item.images ?? []) if (u && !imgs.includes(u)) imgs.push(u);

  const dates = item.dates ?? [];
  const communityRatings = item.communityRatings ?? [];
  const hasScores = communityRatings.length > 0 || !!item.steamReviewLabel;

  const ids: Record<string, string> = {};
  for (const s of item.sources ?? []) ids[s.source] = s.sourceId;
  const steamAppId = ids.steam;

  return (
    <main className="max-w-6xl mx-auto px-6 py-6">
      {/* T14 (2026-07-29) — the item and facet pages had no back affordance at
          all. /discover is the fallback for a hard-loaded/shared link; a real
          in-app visit (e.g. from Discover, a facet page, Insights) uses
          router.back() instead, landing you exactly where you were. */}
      <BackButton fallbackHref="/discover" className="mb-4" />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,420px)_1fr] gap-8">
        <MediaGallery images={imgs} idx={Math.min(idx, Math.max(0, imgs.length - 1))} setIdx={setIdx} title={item.title} />

        <div className="min-w-0 space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <TypeBadge type={item.type} />
          </div>

          <h1 className="font-serif text-serif-2xl text-text-primary leading-tight">{item.title}</h1>

          {dates.length > 0 ? (
            <div className="space-y-1">
              {dates.map((d) => (
                <div key={d.source} className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: SOURCE_COLORS[d.source] ?? "#888" }} />
                  <span className="text-text-secondary text-xs w-16">{SOURCE_LABELS[d.source] ?? d.source}</span>
                  <span className="font-mono text-text-primary">{fmtDate(d.date)}</span>
                </div>
              ))}
            </div>
          ) : item.releaseDate ? (
            <p className="text-sm font-mono text-text-secondary">{fmtDate(item.releaseDate)}</p>
          ) : (
            <p className="text-sm font-mono text-text-secondary">TBA</p>
          )}

          {item.tagline && <p className="text-base text-text-secondary italic">{item.tagline}</p>}

          {/* Community/critic scores — public, so server-rendered. Nulled
              personals means this renders the scores row only; the per-user
              half lives in <PersonalSection> below. */}
          <RatingsSection
            hasScores={hasScores}
            communityRatings={communityRatings}
            steamReview={item.steamReviewLabel ?? null}
            personalRating={null}
            personalRatings={[]}
            libraryStatus={null}
            reviewedAt={null}
            review={null}
          />

          <PersonalSection
            itemId={item.id}
            type={item.type}
            ids={ids}
            title={item.title}
            releaseDate={item.releaseDate}
            posterUrl={item.posterUrl}
            steamStoreUrl={steamAppId ? `https://store.steampowered.com/app/${steamAppId}` : null}
          />

          <FactsSection enriched={enriched} type={item.type} />

          {item.description && <p className="text-sm text-text-secondary leading-relaxed">{item.description}</p>}
        </div>
      </div>

      <LowerSections enriched={enriched} type={item.type} tagOverrides={tagOverrides} tagCategories={tagCategories} />
    </main>
  );
}
