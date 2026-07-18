import type { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/baseUrl";
import { PUBLIC_TYPES } from "@/lib/publicUrl";

// P13 — robots policy. The landing page and the public item pages
// (`/{type}/{uuid}/{slug}`) are server-rendered catalog content, meant to be
// indexed. Everything else is authed + client-rendered (an empty shell to a
// crawler), so it stays disallowed along with the API.
//
// `/item` stays disallowed even though it shows the same titles: it's the AUTHED
// interactive view, so a crawler could only ever see it empty, and indexing both
// would be duplicate content. The public page is the canonical one.
//
// P17 — the public facet pages (`/person/ /tag/ /studio/`) are the same kind of
// SSR catalog content, so they're ALLOWED too. They must stay crawlable even
// while noindex (PUBLIC_ITEMS_INDEXABLE=false): a crawler has to FETCH a page to
// see its noindex tag, so a Disallow would hide the tag, not enforce it. The old
// `/insights/facet` is covered by the `/insights` disallow (it's now a redirect).
//
// SM7 (2026-07-19) — MUST be request-time, same reason as sitemap.ts: without
// this, Next prerenders the route once at `next build` time on Railway, baking
// in whatever NEXT_PUBLIC_BASE_URL was (or wasn't) set during the BUILD phase —
// which shipped `Host: http://localhost:3000` to production even though the
// runtime env var was correct (proven by sitemap.ts, which already had this and
// rendered the right origin).
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", ...PUBLIC_TYPES.map((t) => `/${t}/`), "/person/", "/tag/", "/studio/"],
      disallow: ["/api/", "/dashboard", "/discover", "/library", "/insights", "/settings", "/item"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
