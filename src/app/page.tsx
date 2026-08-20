import type { Metadata } from "next";
import HomePageClient from "./HomePageClient";
import CatalogHub from "@/components/CatalogHub";

// `/` — a thin SERVER shell around the interactive client Home.
//
// SEO (2026-08-20): this file used to BE the client page. It was
// `"use client"` end to end and fetched `/api/home`, so a crawler got 36 KB
// with an `sr-only` h1 and not one link to the catalog — a dead end at
// priority 1.0, with 2,022 item pages reachable only through the sitemap.
// Splitting the client half into HomePageClient.tsx makes room for a
// server-rendered block that ships real links on first byte.
//
// The interactive half is unchanged and still owns everything per-user: the
// session probe, the rails, the highlights, the sign-in dialog. Only the
// wrapper moved.
export const dynamic = "force-dynamic";

// The homepage was the ONLY indexable surface without a canonical (item, facet,
// calendar-month and legal pages all carry one), and it showed: on 2026-08-20
// `site:fandex.org` returned exactly two results, `http://fandex.org` and
// `https://www.fandex.org`, both this page under a host we don't want ranked.
// The www host serves the whole app at 200 with no redirect, so without this tag
// there was nothing telling Google which of the two is the real one.
//
// Declared HERE and not in the root layout on purpose: metadata is inherited, so
// a canonical of "/" on the layout would tell Google that /discover, /library and
// every other page without its own tag are all duplicates of the homepage.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      <HomePageClient />
      <div className="px-5 pb-10">
        <div className="max-w-5xl mx-auto">
          <CatalogHub />
        </div>
      </div>
    </>
  );
}
