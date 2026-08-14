import { permanentRedirect, redirect } from "next/navigation";
import { publicFacetHref, isLinkableFacetKind } from "@/lib/facetUrl";
import type { FacetRole } from "@/lib/facets";

// P17 — the facet detail experience moved to the PUBLIC pages
// (/person, /tag, /studio), which are provider-sourced and session-aware (the
// you-vs-crowd overlay loads for logged-in viewers). This old authed
// query-param route is kept only to 308 any bookmarked/shared `/insights/facet?…`
// link to its canonical public url so nothing rots. The `key` in the old url was
// already the normalized facet key, so publicFacetHref consumes it directly.
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function LegacyFacetRedirect({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const kind = one(sp.kind);
  const key = one(sp.key);
  // `kind` is a raw query param, so it gets checked rather than cast — an
  // unknown or unlinkable kind falls through to /insights instead of building
  // `/undefined/<key>`, which the old cast happily emitted.
  if (kind && key && isLinkableFacetKind(kind)) {
    permanentRedirect(publicFacetHref({ kind, role: one(sp.role) as FacetRole | undefined, key }));
  }
  redirect("/insights");
}
