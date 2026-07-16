import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { BASE_URL } from "@/lib/baseUrl";
import { isPublicType, isUuid, slugify, parseItemId, PUBLIC_ITEMS_INDEXABLE } from "@/lib/publicUrl";
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
// The id segment is a uuid (stored item) or a source id (`tmdb-693134`, a live
// /discover result with no row yet). The uuid form is canonical: as soon as the
// item has a row we 308 to it, so an item always has exactly one indexable url.

interface Params {
  type: string;
  id: string;
  slug: string;
}

// The one place a session is read, and ONLY to decide whether we may persist a
// live item — never to change what is rendered.
async function mayPersist(): Promise<{ persist: boolean; region: string }> {
  try {
    const session = await getSession();
    if (!session) return { persist: false, region: DEFAULT_COUNTRY };
    return { persist: true, region: getUserCountry(session.userId) };
  } catch {
    return { persist: false, region: DEFAULT_COUNTRY };
  }
}

// cache() dedupes across generateMetadata + the render, which both need the
// item. The pipeline does live provider calls, so without this every request
// would run the whole thing twice.
const resolve = cache(async (type: string, id: string): Promise<ResolvedPublic | null> => {
  if (!isPublicType(type)) return null;
  const parsed = parseItemId(id);
  if (!parsed) return null;
  const { persist, region } = await mayPersist();
  const found = await resolvePublicDetail(parsed, type, region, { persist });
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
  // Canonical is always the uuid url; a live item has no canonical form yet, so
  // it stays noindex regardless of the flag (nothing stable to index).
  const canonical = found.canonicalId
    ? `${BASE_URL}/${type}/${found.canonicalId}/${slugify(item.title)}`
    : null;

  return {
    title,
    description,
    ...(PUBLIC_ITEMS_INDEXABLE && canonical ? {} : { robots: { index: false, follow: false } }),
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: {
      title,
      description,
      ...(canonical ? { url: canonical } : {}),
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

  // Addressed by a source id but the item HAS a row (either it already did, or a
  // logged-in view just created it) → send it to its canonical uuid url. Not
  // permanent: for an anonymous viewer the same source-id url is still the only
  // address, so this mapping isn't stable enough to cache forever.
  if (canonicalId && !isUuid(id)) redirect(`/${type}/${canonicalId}/${canonicalSlug}`);

  // Cosmetic slug drift → canonical. Permanent (308), since the uuid→slug
  // mapping IS stable: 307 would tell Google to keep indexing both urls.
  if (slug !== canonicalSlug) permanentRedirect(`/${type}/${canonicalId ?? id}/${canonicalSlug}`);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-100">
      <ItemView item={item} />
    </div>
  );
}
