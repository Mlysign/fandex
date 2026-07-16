import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { BASE_URL } from "@/lib/baseUrl";
import { isPublicType, isUuid, slugify, PUBLIC_ITEMS_INDEXABLE } from "@/lib/publicUrl";
import { loadPublicDetail } from "@/lib/detail/publicDetail";
import { PublicEnrichedItem } from "@/lib/detail/enrich";
import PublicItemView from "@/components/item/PublicItemView";

// P13 — the public, server-rendered detail page: `/{type}/{uuid}/{slug}`.
//
// Server-rendered so the HTML carries the real content: crawlers and link
// unfurlers (WhatsApp/Discord/Slack/iMessage) do NOT run our JavaScript, so the
// client-rendered /item page shows them an empty shell. Here the title,
// description and poster are in the markup on first byte.
//
// Content-wise this is the SAME page as authed /item — same enrichment pipeline
// (lib/detail/enrich.ts), same sections — minus the per-user blocks, which
// PublicItemView swaps for a sign-in hook.

interface Params {
  type: string;
  id: string;
  slug: string;
}

// cache() dedupes this across generateMetadata + the page render, which both
// need the item. Without it every request would run the whole enrichment
// pipeline TWICE — including the live provider searches and the OMDB fetch.
const resolve = cache(async (type: string, id: string): Promise<PublicEnrichedItem | null> => {
  if (!isPublicType(type) || !isUuid(id)) return null;
  const item = await loadPublicDetail(id);
  // The type segment must match the item's real type, so /game/<movie-uuid>/x
  // 404s instead of serving one item under two URLs (duplicate content).
  if (!item || item.type !== type) return null;
  return item;
});

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  // `slug` is deliberately ignored — the canonical below always rebuilds it from
  // the current title, so every slug variant reports one canonical URL.
  const { type, id } = await params;
  const item = await resolve(type, id);
  if (!item) return { title: "Not found", robots: { index: false, follow: false } };

  const year = item.releaseDate ? item.releaseDate.slice(0, 4) : null;
  const title = year ? `${item.title} (${year})` : item.title;
  const description =
    item.description?.slice(0, 200) ??
    `${item.title} — release date, ratings and where to watch, on Fandex.`;
  const canonical = `${BASE_URL}/${type}/${id}/${slugify(item.title)}`;
  const image = item.posterUrl ?? item.backdropUrl;

  return {
    title,
    description,
    // Soft launch: readable + unfurlable, but not indexed. The OG/twitter tags
    // below still work — unfurlers read those and ignore `robots`. Flip
    // PUBLIC_ITEMS_INDEXABLE to drop this (TASKS.md P13b).
    ...(PUBLIC_ITEMS_INDEXABLE ? {} : { robots: { index: false, follow: false } }),
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      images: image ? [{ url: image, alt: item.title }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function PublicItemPage({ params }: { params: Promise<Params> }) {
  const { type, id, slug } = await params;
  const item = await resolve(type, id);
  if (!item) notFound();

  // The slug is cosmetic — the UUID already resolved the item — but a wrong or
  // outdated one redirects to the canonical form, so a retitled item's old links
  // keep working AND search engines see a single URL per item.
  //
  // PERMANENT (308), not redirect()'s default 307: a temporary redirect tells
  // Google to keep indexing both URLs, splitting link equity.
  const canonicalSlug = slugify(item.title);
  if (slug !== canonicalSlug) permanentRedirect(`/${type}/${id}/${canonicalSlug}`);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-100">
      <PublicItemView item={item} />
    </div>
  );
}
