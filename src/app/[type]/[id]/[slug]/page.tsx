import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { BASE_URL } from "@/lib/baseUrl";
import { isPublicType, isUuid, slugify, PUBLIC_ITEMS_INDEXABLE } from "@/lib/publicUrl";
import { resolvePublicDetail, ResolvedPublic } from "@/lib/detail/publicDetail";
import { getSession } from "@/lib/session";
import { getUserCountry } from "@/lib/userCountry";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import ItemView from "@/components/item/ItemView";

// P13 — THE item page: `/{type}/{id}/{slug}`. One url for everyone.
//
// The server renders the CATALOG half only — no user data — so crawlers and
// link unfurlers (which don't run our JS) get the real content on first byte,
// and the HTML never varies per viewer. The per-user half (rating, wishlist) is
// a client island inside ItemView that checks the session itself.
//
// The id segment is a uuid, always (H2b): discover persists every item it
// returns, so there is no such thing as a linkable item without a row. It used
// to also accept a source id for live discover results, which is what forced the
// create-on-view write and a second url per item.

interface Params {
  type: string;
  id: string;
  slug: string;
}

// The session is read for ONE thing: the viewer's region, which localizes
// release dates + streaming (T22). It never changes WHICH item is rendered or
// whether it renders, so the cached HTML stays viewer-independent.
async function viewerRegion(): Promise<string> {
  try {
    const session = await getSession();
    return session ? getUserCountry(session.userId) : DEFAULT_COUNTRY;
  } catch {
    return DEFAULT_COUNTRY;
  }
}

// cache() dedupes across generateMetadata + the render, which both need the
// item. The pipeline does live provider calls, so without this every request
// would run the whole thing twice.
const resolve = cache(async (type: string, id: string): Promise<ResolvedPublic | null> => {
  if (!isPublicType(type) || !isUuid(id)) return null;
  const found = await resolvePublicDetail(id, type, await viewerRegion());
  if (!found || found.item.type !== type) return null;
  return found;
});

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  // `slug` is ignored — the canonical below always rebuilds it from the current
  // title, so every slug variant reports one canonical url.
  const { type, id } = await params;
  const found = await resolve(type, id);
  if (!found) return { title: "Not found", robots: { index: false, follow: false } };
  const item = found.item;

  const year = item.releaseDate ? item.releaseDate.slice(0, 4) : null;
  const title = year ? `${item.title} (${year})` : item.title;
  const description =
    item.description?.slice(0, 200) ??
    `${item.title} — release date, ratings and where to watch, on Fandex.`;
  const image = item.posterUrl ?? item.backdropUrl;
  // Every item has a uuid now (H2b), so there is always exactly one canonical
  // url — no more "live item with nothing stable to index" case.
  const canonical = `${BASE_URL}/${type}/${found.canonicalId}/${slugify(item.title)}`;

  return {
    title,
    description,
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

export default async function ItemPage({ params }: { params: Promise<Params> }) {
  const { type, id, slug } = await params;
  const found = await resolve(type, id);
  if (!found) notFound();
  const { item, canonicalId } = found;

  const canonicalSlug = slugify(item.title);

  // Cosmetic slug drift → canonical. Permanent (308), since the uuid→slug
  // mapping IS stable: 307 would tell Google to keep indexing both urls.
  if (slug !== canonicalSlug) permanentRedirect(`/${type}/${canonicalId}/${canonicalSlug}`);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-100">
      <ItemView item={item} />
    </div>
  );
}
