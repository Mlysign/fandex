import type { Metadata } from "next";
import HomePageClient from "./HomePageClient";
import CatalogHub from "@/components/CatalogHub";
import { readHomeSnapshot, PEOPLE_RAIL_SIZE } from "@/lib/homeSnapshot";
import { popularPeople } from "@/lib/popularPeople";

// `/` — a thin SERVER shell around the interactive client Home.
//
// SEO (2026-08-20): this file used to BE the client page. It was
// `"use client"` end to end and fetched `/api/home`, so a crawler got 36 KB
// with an `sr-only` h1 and not one link to the catalog — a dead end at
// priority 1.0, with 2,022 item pages reachable only through the sitemap.
// Splitting the client half into HomePageClient.tsx makes room for a
// server-rendered block that ships real links on first byte.
//
// SEO (2026-08-26): that split fixed the BOTTOM of the page and left the top
// exactly as it was. The rails are the actual content, the reason anyone is on
// this page, and they still arrived through a `useEffect` fetch of `/api/home`.
// `/api/` is under the robots Disallow. Googlebot's renderer honours robots.txt
// for subresources, so those links were not "probably missed": the renderer was
// blocked from fetching the data that would have produced them.
//
// So the day's public rails now come from `home_snapshot`, built once a day off
// the request path, and are handed to the client component as PROPS. The
// components did not have to change. `PosterCard` has always rendered a real
// `<a href>` via `Link`, and a client component's first render is server HTML.
// The only thing that ever made those links invisible was where the data came
// from.
//
// ⚠️ Reading the snapshot here is one indexed SELECT and a JSON.parse. Keep it
// that way: no session read (the HTML must stay identical for every viewer and
// for a crawler), and no provider call, ever.
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
  const snapshot = readHomeSnapshot();

  // The people rail is a pure LOCAL read (even the portraits come out of stored
  // provider payloads, see lib/popularPeople.ts), so it is safe to compute
  // here when there is no snapshot yet. The poster rails are not: they need the
  // provider fan-out, and rebuilding those on a request path is the thing the
  // snapshot exists to prevent. A fresh volume therefore shows people and the
  // hub while the first scheduled build lands, rather than nothing.
  const people = snapshot?.people ?? popularPeople().slice(0, PEOPLE_RAIL_SIZE);

  return (
    <>
      <HomePageClient
        initialTrending={snapshot?.trending ?? []}
        initialUpcoming={snapshot?.upcoming ?? []}
        people={people}
        hasSnapshot={!!snapshot}
      />
      <div className="px-5 pb-10">
        <div className="max-w-5xl mx-auto">
          <CatalogHub />
        </div>
      </div>
    </>
  );
}
