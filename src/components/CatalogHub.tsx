import Link from "next/link";
import { hubItems, hubGenres } from "@/lib/homeHub";
import { buildItemHref } from "@/lib/itemUrl";
import { publicFacetHref } from "@/lib/facetUrl";
import { indexableMonths, monthLabel } from "@/lib/calendarMonths";

// SEO (2026-08-20) — the server-rendered browse block at the bottom of `/`.
//
// This exists because `/` linked to nothing. It is a SERVER component on
// purpose: Home's rails are a client island fetching `/api/home`, which is
// robots-disallowed, so everything above this renders as an empty shell to a
// crawler. See lib/homeHub.ts for why the data is the local catalog and not
// the provider feed.
//
// It is also the only browse surface an anonymous visitor gets on the landing
// page, which is a real second job — until now a logged-out arrival saw a
// "Guest mode" panel and three rails they could not act on.
//
// ⚠️ Keep it a server component with no client hooks. The moment it needs
// `"use client"` it stops being crawlable and the dead end comes back.

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-label text-text-secondary mb-2">{title}</h3>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">{children}</div>
    </div>
  );
}

// `min-w-0 break-words` is not decoration. These are flex items, so each one
// defaults to `min-width: auto` — its min-content width, which for a title is
// its LONGEST WORD. One 35-character unbroken title would push the row past a
// 320px viewport, and horizontal overflow there makes mobile Chrome shrink-to-
// fit the whole layout and drop the fixed bottom nav below the fold (MB7).
// Measured clean at 320/360/412; this keeps it that way for titles we have not
// ingested yet.
const LINK_CLASS =
  "min-w-0 break-words text-sm text-text-secondary hover:text-text-primary transition-colors underline-offset-2 hover:underline";

export default function CatalogHub() {
  const items = hubItems();
  const genres = hubGenres();
  const months = indexableMonths();

  // No `return null` when the catalog is empty — an empty hub on a fresh DB is
  // a real state, and a block that vanishes is indistinguishable from one that
  // broke. The genre and month groups need no catalog rows at all, so they
  // render regardless and the section is never blank.
  return (
    <section aria-labelledby="browse-heading" className="border-t border-border pt-6 mt-4 space-y-6">
      <h2 id="browse-heading" className="font-serif text-serif-md text-text-primary">
        Browse Fandex
      </h2>

      {items.length > 0 && (
        <Group title="Recently added">
          {items.map((i) => (
            <Link key={i.id} href={buildItemHref(i)} className={LINK_CLASS}>
              {i.title}
            </Link>
          ))}
        </Group>
      )}

      <Group title="By genre">
        {genres.map((g) => (
          <Link key={g.key} href={publicFacetHref({ kind: "tag", key: g.key })} className={LINK_CLASS}>
            {g.label}
          </Link>
        ))}
      </Group>

      <Group title="Release calendar">
        {months.map((m) => (
          <Link key={m} href={`/calendar/${m}`} className={LINK_CLASS}>
            {monthLabel(m)}
          </Link>
        ))}
      </Group>
    </section>
  );
}
