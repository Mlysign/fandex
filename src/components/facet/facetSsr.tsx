import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { BASE_URL } from "@/lib/baseUrl";
import { PUBLIC_ITEMS_INDEXABLE } from "@/lib/publicUrl";
import type { FacetPrefix } from "@/lib/facetUrl";
import { isFacetPrefix, prefixToKind, slugToKey, publicFacetHref } from "@/lib/facetUrl";
import { canonicalTagKey } from "@/lib/tagAlias";
import type { FacetSort, PublicFacetPayload } from "@/lib/detail/publicFacetDetail";
import { buildPublicFacetDetail, isFacetSort, facetRobots } from "@/lib/detail/publicFacetDetail";
import { getSession } from "@/lib/session";
import PublicFacetView from "@/components/facet/PublicFacetView";

// P17 — shared SSR for the three public facet routes (/person, /tag, /studio).
// Each route is a thin wrapper that pins its prefix; everything else lives here.

const ROLE_LABEL: Record<FacetPrefix, string> = { person: "Person", tag: "Tag", studio: "Studio" };

// cache() dedupes the provider build across generateMetadata + the render (both
// need the payload). Keyed by (prefix, slug, sort) so metadata and body — which
// pass the SAME sort from searchParams — resolve to one build per request. The
// session doesn't need to be in this key: it can't change mid-request, so both
// callers see the same persist decision regardless of which one runs first.
//
// T12 (2026-07-29): also returns `hasSession` (from the ONE getSession() call
// already made here) so FacetPageBody can pass it to PublicFacetView without a
// second cookie/JWT/DB round-trip — getSession() itself isn't cache()-wrapped,
// so calling it again here would double that work on every facet-page request.
const resolve = cache(async (prefix: string, slug: string, sort: FacetSort): Promise<{ payload: PublicFacetPayload | null; hasSession: boolean }> => {
  if (!isFacetPrefix(prefix)) return { payload: null, hasSession: false };
  let key = slugToKey(slug);
  if (!key) return { payload: null, hasSession: false };
  // H5.6: a tag bundle's member spellings resolve to the canonical key, so the
  // provider pool + metadata use the canonical (the body separately 308s the URL).
  if (prefix === "tag") key = canonicalTagKey(key);
  // PR14: only a real session earns a write. cookies() is readable (though not
  // writable) from a Server Component, so this is safe to call from metadata
  // generation too — see @/lib/session.
  const session = await getSession();
  const payload = await buildPublicFacetDetail({ kind: prefixToKind(prefix), key }, { page: 0, sort, persist: !!session });
  return { payload, hasSession: !!session };
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
  const { payload: found } = await resolve(prefix, slug, sortOf(searchParams));
  if (!found || (found.total === 0 && !found.person)) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }
  const label = found.label;
  const description =
    prefix === "person" ? `Every movie and show ${label} worked on, with ratings and where to watch.`
    : prefix === "studio" ? `Movies, shows and games from ${label}, ranked by rating.`
    : `The best ${label} movies, shows and games, ranked by rating.`;
  const canonical = `${BASE_URL}${publicFacetHref({ kind: found.kind, key: found.key })}`;

  // SEO (2026-08-20) — the soft-launch switch, plus a noindex for the thin tail
  // (a facet listing fewer than 3 titles). See facetRobots for why the test is
  // pool size and not linkable count.
  const robots = facetRobots(found.total, PUBLIC_ITEMS_INDEXABLE);

  return {
    title: label,
    description,
    ...(robots ? { robots } : {}),
    alternates: { canonical },
    openGraph: { title: label, description, url: canonical, type: "website", images: found.person?.profileUrl ? [{ url: found.person.profileUrl, alt: label }] : undefined },
    twitter: { card: "summary", title: label, description },
  };
}

export async function FacetPageBody({
  prefix, slug, searchParams,
}: { prefix: FacetPrefix; slug: string; searchParams?: Record<string, string | string[] | undefined> }) {
  // H5.6: 308 a bundled member spelling to its canonical url so the whole bundle
  // lives at one address. Only tags have aliases; person/studio pass through.
  if (prefix === "tag") {
    const key = slugToKey(slug);
    const canonical = canonicalTagKey(key);
    if (canonical && canonical !== key) permanentRedirect(publicFacetHref({ kind: "tag", key: canonical }));
  }
  const sort = sortOf(searchParams);
  const { payload: found, hasSession } = await resolve(prefix, slug, sort);
  if (!found || (found.total === 0 && !found.person)) notFound();
  // T12 (2026-07-29): `hasSession` came from the SAME getSession() call
  // `resolve` already made (React's cache() dedupes the call across
  // generateMetadata + here) — passing it down as a plain boolean lets
  // PublicFacetView decide synchronously, on its very first render, whether
  // to hold the grid behind a skeleton until /api/facet/mine is ready.
  // Deliberately NOT a client-side probeSession() round-trip: on a throttled
  // connection that round-trip is exactly the window where an unrated item
  // would otherwise flash on screen.
  return <PublicFacetView initial={found} prefix={prefix} kind={found.kind} roleLabel={ROLE_LABEL[prefix]} isLoggedIn={hasSession} />;
}
