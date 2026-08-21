"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Rail from "@/components/Rail";
import PosterCard from "@/components/PosterCard";
import { buildItemHref } from "@/lib/itemUrl";
import type { MediaCardItem } from "@/components/cardItem";
import type { MediaType } from "@/types";

// The item page's two related rails: "More from {franchise}" above "More like
// this". Was SimilarRail.tsx (2026-07-31, T6) until the franchise rail joined it
// on 2026-08-21.
//
// ONE component and ONE fetch for both, which is not just tidiness: the server
// drops franchise siblings out of the similar ranking so a title can't appear in
// both rails, and that dedupe is only possible where both lists are built. Two
// components fetching two endpoints would each be blind to the other.
//
// Fetched client-side deliberately: like <PersonalSection>, this is per-viewer
// (an anonymous visitor gets the same titles but no Fandex Score and no
// rating/wishlist state), and the server-rendered part of the item page must
// stay session-independent.
//
// Mounted EXACTLY ONCE in ItemView's shared content tree, not once per
// breakpoint — the 2026-07-30 detail rebuild found that a `lg:hidden` +
// `hidden lg:block` split mounts BOTH trees (CSS visibility isn't conditional
// rendering), which would double this fetch and double the rails.
interface RelatedPayload {
  /** null when the item carries no franchise, or carries one nothing else in
   *  the catalog shares. Most items: the median franchise has ONE member. */
  franchise: { label: string; items: MediaCardItem[] } | null;
  items: MediaCardItem[];
}

// Below 3, a recommendation rail reads as a bug (empty-feeling shelf) rather
// than a deliberately sparse one. The franchise rail is held to a lower bar on
// purpose: it is a complete index, not a suggestion, so "the one other Half-Life
// game" is a true and useful answer where two loose recommendations aren't.
const MIN_SIMILAR = 3;

export default function RelatedRails({ itemId, type }: { itemId: string; type: MediaType }) {
  const router = useRouter();
  const [data, setData] = useState<RelatedPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/detail/similar?id=${itemId}&type=${type}`)
      .then((r) => (r.ok ? r.json() : { franchise: null, items: [] }))
      .then((d: RelatedPayload) => { if (!cancelled) setData({ franchise: d.franchise ?? null, items: d.items ?? [] }); })
      .catch(() => { if (!cancelled) setData({ franchise: null, items: [] }); });
    return () => { cancelled = true; };
  }, [itemId, type]);

  const franchise = data?.franchise ?? null;
  const similar = data?.items ?? [];
  const showSimilar = similar.length >= MIN_SIMILAR;

  // No loading skeleton, as before: a slow or empty response leaves the rest of
  // the page as-is instead of a visible jump.
  if (!franchise && !showSimilar) return null;

  const card = (item: MediaCardItem) => (
    <PosterCard key={item.id} item={item} onSelect={(i) => router.push(buildItemHref(i))} />
  );

  return (
    <div className="space-y-10">
      {franchise && (
        // Cross-media by design — a franchise rail mixes the movies, shows and
        // games under one IP, and PosterCard's type chip is what tells them
        // apart. Chronological, oldest first (the server sorts it).
        <Rail title={`More from ${franchise.label}`}>{franchise.items.map(card)}</Rail>
      )}
      {showSimilar && <Rail title="More like this">{similar.map(card)}</Rail>}
    </div>
  );
}
