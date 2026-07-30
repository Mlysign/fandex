"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Rail from "@/components/Rail";
import PosterCard from "@/components/PosterCard";
import { buildItemHref } from "@/lib/itemUrl";
import type { MediaCardItem } from "@/components/cardItem";
import type { MediaType } from "@/types";

// "More like this" (2026-07-31, T6) — the mockup's placeholder rail
// (05-DELTA b: "Recommendation logic out of scope"), now built. Fetched
// client-side deliberately: like <PersonalSection>, this is per-viewer (an
// anonymous visitor gets the same titles but no Fandex Score column), and the
// server-rendered part of the item page must stay session-independent.
//
// Mounted EXACTLY ONCE in ItemView's shared content tree, not once per
// breakpoint — the 2026-07-30 detail rebuild found that a `lg:hidden` +
// `hidden lg:block` split mounts BOTH trees (CSS visibility isn't conditional
// rendering), which would double this fetch and double the rail. Same reason
// <PersonalSection> only appears once now.
export default function SimilarRail({ itemId, type }: { itemId: string; type: MediaType }) {
  const router = useRouter();
  const [items, setItems] = useState<MediaCardItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/detail/similar?id=${itemId}&type=${type}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => { if (!cancelled) setItems(d.items ?? []); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [itemId, type]);

  // Below 3, a rail reads as a bug (empty-feeling shelf) rather than a
  // deliberately sparse one — no loading skeleton either, so a slow/empty
  // response just leaves the rest of the page as-is instead of a visible jump.
  if (!items || items.length < 3) return null;

  return (
    <Rail title="More like this">
      {items.map((item) => (
        <PosterCard key={item.id} item={item} onSelect={(i) => router.push(buildItemHref(i))} />
      ))}
    </Rail>
  );
}
