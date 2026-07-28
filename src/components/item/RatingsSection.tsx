"use client";
import { format } from "date-fns";
import { CommunityRating } from "@/types";
import { ScoreBadge, RatingsBreakdown } from "./primitives";

type PersonalRating = { source: string; rating: number };

// Ratings cluster (T13): platform/community/critic scores, plus a read-only
// summary of the user's own rating/review/library status. B6 (2026-07-28)
// moved the actual rate/watch CONTROLS onto the two-button bar next to the
// Fandex Score panel (PersonalSection) — this section only ever displays.
export default function RatingsSection({
  hasScores, communityRatings, steamReview,
  personalRating, personalRatings, libraryStatus, reviewedAt, review,
}: {
  hasScores: boolean;
  communityRatings: CommunityRating[];
  steamReview: string | null;
  personalRating: number | null;
  personalRatings: PersonalRating[];
  libraryStatus: string | null;
  reviewedAt: number | null;
  review: string | null;
}) {
  const hasPersonal = typeof personalRating === "number" && personalRating > 0;
  if (!(hasScores || libraryStatus || hasPersonal || reviewedAt || review)) return null;

  return (
    <div className="space-y-3">
      {/* Platform / community / critic scores */}
      {(hasScores || hasPersonal) && (
        <div className="flex items-center gap-2 flex-wrap">
          {communityRatings.map((r) => <ScoreBadge key={r.source} r={r} />)}
          {steamReview && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm" style={{ background: "#1b9af71f", color: "#1b9af7" }}>
              <span className="text-[10px] uppercase tracking-wide opacity-80 font-bold">Steam</span>
              {steamReview}
            </span>
          )}
        </div>
      )}

      {(libraryStatus || hasPersonal || review) && (
        <div className="flex items-center gap-3 flex-wrap">
          {libraryStatus && (
            <span className="text-xs px-2 py-1 rounded-full bg-surface-elevated text-text-secondary capitalize">
              ✓ {libraryStatus}
              {reviewedAt && (() => { try { return ` · ${format(new Date(reviewedAt * 1000), "MMM d, yyyy")}`; } catch { return ""; } })()}
            </span>
          )}
          {/* SM31 (2026-07-28): this used to repeat the score as "★ 8 / 10"
              right next to the gold Rate-it button above (PersonalSection),
              which already shows the identical score — the same number
              rendered twice, stacked. The button is the one rating display
              now; this line keeps only what it uniquely adds (the watched
              date) and the per-platform breakdown below. */}
          {review && <p className="text-sm text-text-secondary leading-relaxed italic w-full">&quot;{review}&quot;</p>}
          <div className="w-full"><RatingsBreakdown ratings={personalRatings} /></div>
        </div>
      )}
    </div>
  );
}
