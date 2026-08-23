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
// ⚠️ SERVER-RENDERED FIRST SINCE 2026-08-23, then upgraded on the client.
//
// This used to be a bare `useEffect` fetch, and the cost of that was invisible
// until someone counted links instead of looking at the page: `/movie/
// dune-part-two` server-rendered **39 internal links — 14 tags, 9 people,
// navigation, and not one sibling title.** The rails were there for a person
// and absent for a crawler, so all 2,037 item pages were dead ends reachable
// only through the sitemap.
//
// `initial` now carries the viewer-INDEPENDENT half (both rails, real hrefs)
// straight from the server render, so the links exist in the first byte. The
// fetch below still runs, and still owns everything per-viewer: the Fandex
// Score, rating/wishlist state, and the MB11 provider top-up. That top-up is
// the reason the fetch cannot simply be deleted — and the reason it must stay
// on the CLIENT: it is a quota-priced provider call, and the item page is the
// most-crawled surface in the catalog (docs/scalability.md §4.2).
//
// So: a crawler gets the local rails. A person gets those instantly, then the
// scores and any top-up a moment later, with no layout jump because the cards
// are already in place.
//
// Mounted EXACTLY ONCE in ItemView's shared content tree, not once per
// breakpoint — the 2026-07-30 detail rebuild found that a `lg:hidden` +
// `hidden lg:block` split mounts BOTH trees (CSS visibility isn't conditional
// rendering), which would double this fetch and double the rails.
export interface RelatedPayload {
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

export default function RelatedRails({
  itemId, type, initial,
}: {
  itemId: string;
  type: MediaType;
  /** The server-rendered, viewer-independent rails. Undefined only from a
   *  caller that has no server render to offer. */
  initial?: RelatedPayload;
}) {
  const router = useRouter();
  const [data, setData] = useState<RelatedPayload | null>(initial ?? null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/detail/similar?id=${itemId}&type=${type}`)
      .then((r) => (r.ok ? r.json() : null))
      // ⚠️ A FAILED FETCH MUST NOT WIPE THE SERVER RENDER. Falling back to
      // `{franchise: null, items: []}` here (which is what this did before the
      // server render existed) would take a page that had just painted real,
      // working rails and blank them on a transient network error. Keep what
      // the server gave us and let the upgrade be the thing that is missing.
      .then((d: RelatedPayload | null) => {
        if (cancelled || !d) return;
        setData({ franchise: d.franchise ?? null, items: d.items ?? [] });
      })
      .catch(() => { /* keep `initial` */ });
    return () => { cancelled = true; };
  }, [itemId, type]);

  const franchise = data?.franchise ?? null;
  const similar = data?.items ?? [];
  const showSimilar = similar.length >= MIN_SIMILAR;

  // No loading skeleton, as before: a slow or empty response leaves the rest of
  // the page as-is instead of a visible jump. With `initial` present there is
  // usually nothing to wait for anyway.
  if (!franchise && !showSimilar) return null;

  const card = (item: MediaCardItem) => (
    <PosterCard key={item.id} item={item} onSelect={(i) => router.push(buildItemHref(i))} />
  );

  return (
    <div className="space-y-10">
      {franchise && (
        // Cross-media by design — a franchise rail mixes the movies, shows and
        // games under one IP, and PosterCard's type chip is what tells them
        // apart. NEWEST first since 2026-08-23, and over the cap the survivors
        // are chosen by crowd attention rather than by slicing the date sort.
        // The server decides both; see lib/franchise.ts.
        <Rail title={`More from ${franchise.label}`}>{franchise.items.map(card)}</Rail>
      )}
      {showSimilar && <Rail title="More like this">{similar.map(card)}</Rail>}
    </div>
  );
}
