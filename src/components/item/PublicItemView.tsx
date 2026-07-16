"use client";
import { useState } from "react";
import Link from "next/link";
import { EnrichedItem } from "@/types";
import { PublicEnrichedItem } from "@/lib/detail/enrich";
import { SOURCE_COLORS, SOURCE_LABELS } from "@/lib/constants";
import { TypeBadge } from "@/components/Badges";
import { fmtDate } from "./format";
import MediaGallery from "./MediaGallery";
import RatingsSection from "./RatingsSection";
import FactsSection from "./FactsSection";
import LowerSections from "./LowerSections";

// P13 — the PUBLIC item view. Deliberately the SAME sections as the authed
// /item page (MediaGallery · RatingsSection · FactsSection · LowerSections), so
// a logged-out visitor sees the same trailer, cast, facts, where-to-watch, DLC,
// tags and community scores. All of that is public catalog data; withholding it
// only made the page look broken.
//
// The ONLY difference vs /item: the two per-user blocks — "your rating" and the
// wishlist panel — are replaced by a sign-in hook. Everything else is identical.
//
// `item` is a PublicEnrichedItem, so it has no rating/review/libraryStatus to
// render even by accident. The sections take an EnrichedItem, so we widen it
// here with the per-user fields explicitly empty — this is the one boundary
// where that happens, and it is where the personal data ISN'T.
export default function PublicItemView({ item }: { item: PublicEnrichedItem }) {
  const [idx, setIdx] = useState(0);

  const enriched: EnrichedItem = {
    ...item,
    platformSources: [], // per-user; a logged-out reader has none
  };

  // Poster first, then any additional artwork — matches /item's gallery order.
  const imgs: string[] = [];
  if (item.posterUrl) imgs.push(item.posterUrl);
  for (const u of item.images ?? []) if (u && !imgs.includes(u)) imgs.push(u);

  const dates = item.dates ?? [];
  const communityRatings = item.communityRatings ?? [];
  const hasScores = communityRatings.length > 0 || !!item.steamReviewLabel;

  return (
    <main className="max-w-6xl mx-auto px-6 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,420px)_1fr] gap-8">
        <MediaGallery images={imgs} idx={Math.min(idx, Math.max(0, imgs.length - 1))} setIdx={setIdx} title={item.title} />

        <div className="min-w-0 space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <TypeBadge type={item.type} />
          </div>

          <h1 className="text-3xl font-bold leading-tight">{item.title}</h1>

          {dates.length > 0 ? (
            <div className="space-y-1">
              {dates.map((d) => (
                <div key={d.source} className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: SOURCE_COLORS[d.source] ?? "#888" }} />
                  <span className="text-neutral-400 text-xs w-16">{SOURCE_LABELS[d.source] ?? d.source}</span>
                  <span className="text-neutral-200">{fmtDate(d.date)}</span>
                </div>
              ))}
            </div>
          ) : item.releaseDate ? (
            <p className="text-sm text-neutral-400">{fmtDate(item.releaseDate)}</p>
          ) : (
            <p className="text-sm text-neutral-600">TBA</p>
          )}

          {item.tagline && <p className="text-base text-neutral-400 italic">{item.tagline}</p>}

          {/* Community/critic scores only. canRate=false + the personal props
              nulled means this renders the scores row and nothing else — the
              "your rating" half is what the sign-in hook below replaces. */}
          <RatingsSection
            type={item.type}
            hasScores={hasScores}
            communityRatings={communityRatings}
            steamReview={item.steamReviewLabel ?? null}
            canRate={false}
            personalRating={null}
            personalRatings={[]}
            libraryStatus={null}
            reviewedAt={null}
            review={null}
            hoverRating={null}
            setHoverRating={() => {}}
            ratingAction={false}
            onRate={() => {}}
            onMarkWatched={() => {}}
          />

          {/* ── Stands in for "your rating" + the wishlist panel ── */}
          <SignInHook type={item.type} />

          <FactsSection enriched={enriched} type={item.type} />

          {item.description && <p className="text-sm text-neutral-300 leading-relaxed">{item.description}</p>}
        </div>
      </div>

      <LowerSections enriched={enriched} type={item.type} />
    </main>
  );
}

function SignInHook({ type }: { type: EnrichedItem["type"] }) {
  const verb = type === "game" ? "played" : "watched";
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-neutral-200">Rate it, track it, don&apos;t lose it</p>
        <p className="text-xs text-neutral-500 mt-0.5">
          Sign in to rate this, mark it {verb}, and sync your wishlist across Trakt, Steam &amp; more.
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Link
          href="/"
          className="text-sm px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
        >
          Sign in
        </Link>
        <Link href="/" className="text-sm px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors">
          Create an account
        </Link>
      </div>
    </div>
  );
}
