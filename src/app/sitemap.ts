import type { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/baseUrl";
import { listPublicItems } from "@/lib/detail/publicDetail";
import { publicItemHref, PUBLIC_ITEMS_INDEXABLE } from "@/lib/publicUrl";
import { LEGAL_LOCALES } from "@/lib/legal/types";
import { indexableMonths } from "@/lib/calendarMonths";
import { sitemapFacets } from "@/lib/facetSnapshot";
import { publicFacetHref } from "@/lib/facetUrl";

// P13 — sitemap: the landing page plus one entry per public item page.
//
// listPublicItems only returns items that HAVE links, which is exactly what the
// page can render — a linkless item 404s, and a sitemap full of 404s is worse
// than a small sitemap. As of PR13 (2026-07-22) it's also scoped to the catalog
// POOL, not every row in media_items — see the comment on listPublicItems for
// why that distinction is now load-bearing (a public facet page's browsed-but-
// unowned titles are not catalog entries and must not be advertised for crawl).
//
// Scale: the pool is a couple thousand items vs Google's 50,000-URL / 50 MB
// per-file limit, so one file is fine. If the catalog ever nears that
// (books/anime would push it), this needs splitting — `generateSitemaps` is the
// Next API for a sitemap index.

// MUST be request-time. sitemap.ts is a Route Handler that Next CACHES BY
// DEFAULT (prerendering it at build), but this one reads SQLite — and during
// `next build` on Railway the volume holding rr.db isn't mounted, so a
// build-time render would bake in a sitemap containing only "/" and never
// update. force-dynamic makes it query the live DB per request, so newly synced
// items appear without a redeploy.
export const dynamic = "force-dynamic";

// H4.1 — indexable legal docs, both locales. `imprint` is deliberately
// excluded: it's noindex (a placeholder pending H4.0's legal advice), and a
// sitemap entry for a noindex page is contradictory — see page.tsx.
const INDEXABLE_LEGAL_DOCS = ["privacy", "terms", "support"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const landing: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    // SEO (2026-08-20) — the public release-calendar months. Deliberately the
    // SAME window the pages navigate within (calendarMonths.ts): advertising a
    // month the pages won't link to would open a crawl path with no way back,
    // and advertising one outside the window would advertise a noindex page.
    // Eight URLs, each a provider fan-out cached 6 h — do not widen this
    // casually. `weekly` because a month's lineup genuinely moves.
    ...indexableMonths().map((month) => ({
      url: `${BASE_URL}/calendar/${month}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    // SEO (2026-09-02, Nils's call) — the SWEPT facet hub pages.
    //
    // These were deliberately excluded until now, and the gate was the
    // under-linking: a facet page rendered 60 titles and linked 33% of them, so
    // advertising thousands of them was advertising hub pages that dead-end.
    // `facetSnapshot` fixes the ones it builds (measured 419/419 on one run), and
    // `sitemapFacets` returns exactly those, so a facet is advertised precisely
    // while it is a good page.
    //
    // ⚠️ It is a CURATED list, not "all facet pages". There are thousands of
    // facets and 1,202 indexable people alone; the sweep targets the ~56 the
    // homepage links. Do not widen this to every facet without widening the sweep
    // first — that is the same trade this entry exists to have got right.
    //
    // ⚠️ They are the pages most likely to actually rank. Search Console on
    // 2026-09-02 had 4,089 of 4,090 URLs sitting in "Discovered – currently not
    // indexed", and item pages carry provider text that appears on dozens of
    // other sites. A facet page AGGREGATES instead of repeating, which is the
    // difference that earns an index slot.
    ...sitemapFacets().map((f) => ({
      url: `${BASE_URL}${publicFacetHref({ kind: f.kind, key: f.key })}`,
      lastModified: new Date(f.builtAt),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...LEGAL_LOCALES.flatMap((locale) =>
      INDEXABLE_LEGAL_DOCS.map((doc) => ({
        url: `${BASE_URL}/legal/${locale}/${doc}`,
        changeFrequency: "yearly" as const,
        priority: 0.3,
      }))
    ),
  ];

  // Soft launch (PUBLIC_ITEMS_INDEXABLE=false): pages stay readable + unfurlable,
  // but listing them here would be handing Google an enumeration of the owner's
  // library — the exact thing the soft launch defers. Pages also send `noindex`.
  // Flip the flag to enumerate all ~2,500 (TASKS.md P13b).
  if (!PUBLIC_ITEMS_INDEXABLE) return landing;

  const items = listPublicItems();

  return [
    ...landing,
    ...items.map((i) => ({
      url: `${BASE_URL}${publicItemHref(i)}`,
      // last_synced is when we last refreshed this item — the closest honest
      // "changed at" signal available.
      lastModified: i.updatedAt ? new Date(i.updatedAt * 1000) : undefined,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
