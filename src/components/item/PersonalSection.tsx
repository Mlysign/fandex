"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { EnrichedItem, MediaType, Source } from "@/types";
import RatingsSection from "./RatingsSection";
import WishlistPanel from "./WishlistPanel";

// P13 — the ONE section that differs between a logged-out and a logged-in
// viewer, on the ONE shared item url.
//
// The page around this is server-rendered WITHOUT user data (so it's fast,
// cacheable, crawlable and unfurls), and this island fills in the per-user half
// on the client:
//   401 → the sign-in hook
//   200 → the real rating stars, watched/played state and wishlist panel
//
// It deliberately owns ALL the per-user state. The server render must never
// depend on a session, or the public HTML would vary per user and the SSR
// guarantee (and any future caching) breaks.

interface PlatformStatus { source: Source; onList: boolean; supported: boolean }

interface DetailResponse {
  item?: Partial<EnrichedItem>;
  platforms?: PlatformStatus[];
  resolvedMediaItemId?: string | null;
}

export default function PersonalSection({
  itemId,
  type,
  ids,
  title,
  releaseDate,
  posterUrl,
  steamStoreUrl,
}: {
  /** uuid when the item is stored; a source id (`tmdb-693134`) when it's live. */
  itemId: string;
  type: MediaType;
  /** Source ids, so a live item can be persisted on first rate/wishlist. */
  ids: Record<string, string | number>;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  steamStoreUrl: string | null;
}) {
  const [state, setState] = useState<"loading" | "anon" | "user">("loading");
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [mediaItemId, setMediaItemId] = useState<string | null>(null);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [ratingAction, setRatingAction] = useState(false);
  const [platformAction, setPlatformAction] = useState<string | null>(null);

  // `ids` is an object literal rebuilt by the parent on EVERY render, so
  // depending on it directly would give `load` a new identity each render → the
  // effect refires → setState → render → refire: an infinite fetch loop. Depend
  // on a serialized key instead, which only changes when the ids really do.
  const idsKey = JSON.stringify(ids);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ id: itemId, type });
    for (const [k, v] of Object.entries(JSON.parse(idsKey) as Record<string, string>)) {
      if (v != null) p.set(`${k}Id`, String(v));
    }
    const res = await fetch(`/api/detail?${p}`);
    // 401 = logged out. Any other failure also degrades to the sign-in hook:
    // showing rating controls we can't persist would be worse than not showing
    // them at all.
    if (!res.ok) { setState("anon"); return; }
    const data: DetailResponse = await res.json();
    setDetail(data);
    setMediaItemId(data.resolvedMediaItemId ?? null);
    setState("user");
  }, [itemId, type, idsKey]);

  // Fetch-on-mount: this is the whole point of the island — the server can't
  // know the session, so the per-user half is resolved here. `load` is async, so
  // its setState calls all happen after an await, not synchronously in the
  // effect body; the rule can't see through the callback. Same justified disable
  // the discover + insights/facet pages already use for this pattern.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  // Target an existing row by id, else send the identity so the server creates
  // it on write (this is what lets a live /discover item be rated directly).
  const body = (extra: Record<string, unknown>) =>
    mediaItemId ? { mediaItemId, ...extra } : { type, title, releaseDate, posterUrl, ids, ...extra };

  async function handleRate(n: number | null) {
    setRatingAction(true);
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body({ rating: n })),
      });
      const data = await res.json().catch(() => ({}));
      if (data.mediaItemId && !mediaItemId) setMediaItemId(data.mediaItemId);
      await load();
    } finally {
      setRatingAction(false);
    }
  }

  async function handleMarkWatched() {
    setRatingAction(true);
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body({ status: type === "game" ? "played" : "watched" })),
      });
      const data = await res.json().catch(() => ({}));
      if (data.mediaItemId && !mediaItemId) setMediaItemId(data.mediaItemId);
      await load();
    } finally {
      setRatingAction(false);
    }
  }

  async function togglePlatform(provider: string, onList: boolean) {
    setPlatformAction(provider);
    try {
      if (onList) {
        await fetch("/api/watchlist", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mediaItemId: mediaItemId ?? itemId, source: provider }),
        });
      } else {
        await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, title, releaseDate, ids, targetProvider: provider }),
        });
      }
      await load();
    } finally {
      setPlatformAction(null);
    }
  }

  // Reserve the height while loading so the server-rendered content above
  // doesn't jump once this resolves.
  if (state === "loading") {
    return <div className="h-24 rounded-xl border border-neutral-800 bg-neutral-900/40 animate-pulse" />;
  }

  if (state === "anon") return <SignInHook type={type} />;

  const item = detail?.item ?? {};
  return (
    <div className="space-y-4">
      <RatingsSection
        type={type}
        hasScores={false} /* community scores are server-rendered above */
        communityRatings={[]}
        steamReview={null}
        canRate
        personalRating={item.rating ?? null}
        personalRatings={item.ratings ?? []}
        libraryStatus={item.libraryStatus ?? null}
        reviewedAt={item.reviewedAt ?? null}
        review={item.review ?? null}
        hoverRating={hoverRating}
        setHoverRating={setHoverRating}
        ratingAction={ratingAction}
        onRate={handleRate}
        onMarkWatched={handleMarkWatched}
      />
      <WishlistPanel
        platforms={detail?.platforms ?? []}
        loading={false}
        platformAction={platformAction}
        onToggle={togglePlatform}
        steamStoreUrl={steamStoreUrl}
      />
    </div>
  );
}

function SignInHook({ type }: { type: MediaType }) {
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
        <Link href="/" className="text-sm px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors">
          Sign in
        </Link>
        <Link href="/" className="text-sm px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors">
          Create an account
        </Link>
      </div>
    </div>
  );
}
