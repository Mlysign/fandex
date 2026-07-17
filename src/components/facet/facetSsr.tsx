import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BASE_URL } from "@/lib/baseUrl";
import { PUBLIC_ITEMS_INDEXABLE } from "@/lib/publicUrl";
import { isFacetPrefix, prefixToKind, slugToKey, publicFacetHref, FacetPrefix } from "@/lib/facetUrl";
import { buildPublicFacetDetail, isFacetSort, FacetSort, PublicFacetPayload } from "@/lib/detail/publicFacetDetail";
import PublicFacetView from "@/components/facet/PublicFacetView";

// P17 — shared SSR for the three public facet routes (/person, /tag, /studio).
// Each route is a thin wrapper that pins its prefix; everything else lives here.

const ROLE_LABEL: Record<FacetPrefix, string> = { person: "Person", tag: "Tag", studio: "Studio" };

// cache() dedupes the provider build across generateMetadata + the render (both
// need the payload). Keyed by (prefix, slug, sort) so metadata and body — which
// pass the SAME sort from searchParams — resolve to one build per request.
const resolve = cache(async (prefix: string, slug: string, sort: FacetSort): Promise<PublicFacetPayload | null> => {
  if (!isFacetPrefix(prefix)) return null;
  const key = slugToKey(slug);
  if (!key) return null;
  return buildPublicFacetDetail({ kind: prefixToKind(prefix), key }, { page: 0, sort });
});

function sortOf(sp: Record<string, string | string[] | undefined> | undefined): FacetSort {
  const s = sp?.sort;
  const v = Array.isArray(s) ? s[0] : s;
  return isFacetSort(v) ? v : "popular";
}

export async function buildFacetMetadata(
  prefix: FacetPrefix,
  slug: string,
  searchParams?: Record<string, string | string[] | undefined>
): Promise<Metadata> {
  const found = await resolve(prefix, slug, sortOf(searchParams));
  if (!found || (found.total === 0 && !found.person)) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }
  const label = found.label;
  const description =
    prefix === "person" ? `Every movie & show ${label} worked on, with ratings and where to watch — on Fandex.`
    : prefix === "studio" ? `Movies, shows and games from ${label}, ranked by rating — on Fandex.`
    : `The best ${label} movies, shows and games, ranked — on Fandex.`;
  const canonical = `${BASE_URL}${publicFacetHref({ kind: found.kind, key: found.key })}`;

  return {
    title: label,
    description,
    ...(PUBLIC_ITEMS_INDEXABLE ? {} : { robots: { index: false, follow: false } }),
    alternates: { canonical },
    openGraph: { title: label, description, url: canonical, type: "website", images: found.person?.profileUrl ? [{ url: found.person.profileUrl, alt: label }] : undefined },
    twitter: { card: "summary", title: label, description },
  };
}

export async function FacetPageBody({
  prefix, slug, searchParams,
}: { prefix: FacetPrefix; slug: string; searchParams?: Record<string, string | string[] | undefined> }) {
  const sort = sortOf(searchParams);
  const found = await resolve(prefix, slug, sort);
  if (!found || (found.total === 0 && !found.person)) notFound();
  return <PublicFacetView initial={found} prefix={prefix} kind={found.kind} roleLabel={ROLE_LABEL[prefix]} />;
}
