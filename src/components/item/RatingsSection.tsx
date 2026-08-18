"use client";
import { format } from "date-fns";
import type { CommunityRating } from "@/types";
import { SOURCE_LABELS } from "@/lib/constants";
import { ScoreBadge, RatingsBreakdown } from "./primitives";

type PersonalRating = { source: string; rating: number };

// Ratings cluster (T13): platform/community/critic scores, plus a read-only
// summary of the user's own rating/review/library status. B6 (2026-07-28)
// moved the actual rate/watch CONTROLS onto the two-button bar next to the
// Fandex Score panel (PersonalSection) — this section only ever displays.
export default function RatingsSection({
  hasScores, communityRatings, steamReview,
  personalRating, personalRatings, libraryStatus, libraryStatusSources = [], reviewedAt, review,
}: {
  hasScores: boolean;
  communityRatings: CommunityRating[];
  steamReview: string | null;
  personalRating: number | null;
  personalRatings: PersonalRating[];
  libraryStatus: string | null;
  /** Which connected account(s) report that status. See EnrichedItem. */
  libraryStatusSources?: string[];
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
            /* Hand-matched to <ScoreBadge>'s shape because it sits in the same
               row but isn't a numeric score. 2026-08-18: both dropped the Steam
               blue they were tinted with — see components/BrandGlyph.tsx. Keep
               the two in step if either is restyled. */
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm bg-surface-elevated border border-border text-text-primary">
              <span className="text-[10px] uppercase tracking-wide font-bold text-text-secondary">Steam</span>
              {steamReview}
            </span>
          )}
        </div>
      )}

      {(libraryStatus || hasPersonal || review) && (
        <div className="flex items-center gap-3 flex-wrap">
          {libraryStatus && (
            /* MB15 (2026-08-14, Nils): this badge said a bare "✓ Owned" and
               named no source. Directly under it sits "Your wishlists", whose
               first row for a game is Steam with a "View on Steam →" link — so
               the page read as "you own this on Steam" for a title whose
               ownership actually came from RAWG. The status now carries the
               account that reports it. `capitalize` is scoped to the status
               word only: applying it to the whole badge would render "Rawg". */
            <span className="text-xs px-2 py-1 rounded-full bg-surface-elevated text-text-secondary">
              <span className="capitalize">✓ {libraryStatus}</span>
              {libraryStatusSources.length > 0 &&
                ` on ${libraryStatusSources.map((s) => SOURCE_LABELS[s] ?? s).join(" · ")}`}
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
