import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { BASE_URL } from "@/lib/baseUrl";
import { PUBLIC_ITEMS_INDEXABLE } from "@/lib/publicUrl";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import { TYPE_COLORS } from "@/lib/constants";
import { popularForMonth } from "@/lib/popularMonthFeed";
import { persistDiscoverBatch } from "@/lib/annotateDiscover";
import { buildItemHref } from "@/lib/itemUrl";
import { jsonLdScript } from "@/lib/jsonLd";
import {
  isServableMonth, monthLabel, monthRobots, indexableMonths, monthNav,
} from "@/lib/calendarMonths";

// SEO (2026-08-20) — the public, crawlable release calendar: one page per month.
//
// `/calendar` is the interactive app and stays robots-disallowed: it is client-
// rendered, its data comes from `/api/` (also disallowed), and two of its three
// scopes are per-user, so a crawler could only ever index an empty shell. This
// route is the half that IS public — "what's coming out in September" — served
// as real server HTML on first byte.
//
// Three properties this page holds on purpose, none of them incidental:
//
//   · IT NEVER READS THE SESSION. Region is always DEFAULT_COUNTRY and the
//     persist call always gets `null`, so the HTML is byte-identical for every
//     viewer and — more importantly — an anonymous crawler cannot mint a single
//     media_items row here. That is PR15's write gate, kept by construction
//     rather than by remembering to pass the right argument.
//   · ITS CRAWL SPACE IS CLOSED. Every month link on the page comes from
//     `indexableMonths()`, so there is no corridor a crawler can walk forever.
//     See calendarMonths.ts.
//   · IT DEGRADES INSTEAD OF FAILING. popularForMonth catches per source, so a
//     dead RAWG costs its own titles and not the page.

// Reads BASE_URL to build the canonical, so it must be request-time — the
// standing invariant (SM7): without it Next prerenders at build, and Railway's
// build-phase env is not its runtime env.
export const dynamic = "force-dynamic";

interface Params { month: string }

// dedupes the provider build across generateMetadata and the render.
const load = cache(async (month: string) => {
  const ranked = await popularForMonth(month, DEFAULT_COUNTRY);
  // userId null, always. See the header note.
  return persistDiscoverBatch(ranked, null);
});

function canonicalFor(month: string): string {
  return `${BASE_URL}/calendar/${month}`;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { month } = await params;
  if (!isServableMonth(month)) return { title: "Not found", robots: { index: false, follow: false } };

  const items = await load(month);
  const label = monthLabel(month);
  const title = `Game, movie and TV releases in ${label}`;
  const description = `Everything coming out in ${label} across games, movies and shows, ranked by how much attention each release is getting. Free to browse on Fandex.`;
  const robots = monthRobots(month, items.length, PUBLIC_ITEMS_INDEXABLE);

  return {
    title,
    description,
    ...(robots ? { robots } : {}),
    alternates: { canonical: canonicalFor(month) },
    openGraph: { title, description, url: canonicalFor(month), type: "website" },
    twitter: { card: "summary", title, description },
  };
}

// "2026-09-12" → "Sat 12". The month is already in the heading, so repeating it
// on every row is noise.
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function dayLabel(iso: string | null): string {
  if (!iso || iso.length < 10) return "TBA";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "TBA";
  // UTC, so the weekday can't shift with the server's timezone.
  return `${DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}`;
}

const TYPE_LABEL: Record<string, string> = { game: "Game", movie: "Movie", show: "Show" };

export default async function CalendarMonthPage({ params }: { params: Promise<Params> }) {
  const { month } = await params;
  // Outside the servable range this 404s BEFORE load(), so no provider is
  // touched. See SERVABLE_PAST_MONTHS in calendarMonths.ts.
  if (!isServableMonth(month)) notFound();

  const items = await load(month);
  const label = monthLabel(month);
  const { prev, next } = monthNav(month);
  const months = indexableMonths();

  // An ItemList is the honest shape for a ranked list of releases. The entries
  // point at their own item pages, which carry the per-entity Movie/TVSeries/
  // VideoGame markup — so this describes the LIST and never duplicates it.
  const jsonLd = [{
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Game, movie and TV releases in ${label}`,
    numberOfItems: items.length,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.title,
      ...("linkable" in it && it.linkable === false ? {} : { url: `${BASE_URL}${buildItemHref(it)}` }),
    })),
  }];

  return (
    <div className="min-h-screen bg-surface text-text-primary">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />

      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="font-serif text-serif-2xl leading-tight">
          Releases in {label}
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          The {items.length} biggest game, movie and show releases this month, ranked across TMDB, RAWG and IGDB.{" "}
          <Link href="/calendar" className="underline underline-offset-2 hover:text-text-primary">
            Open the full calendar
          </Link>{" "}
          to filter by type or track what you are waiting for.
        </p>

        <nav aria-label="Other months" className="mt-6 flex flex-wrap gap-2">
          {months.map((m) => (
            <Link
              key={m}
              href={`/calendar/${m}`}
              aria-current={m === month ? "page" : undefined}
              className={
                m === month
                  ? "rounded-full border border-border-strong bg-surface-inset px-3 py-1 text-sm"
                  : "rounded-full border border-border px-3 py-1 text-sm text-text-secondary hover:text-text-primary hover:border-border-strong"
              }
            >
              {monthLabel(m)}
            </Link>
          ))}
        </nav>

        {items.length === 0 ? (
          // Never a bare `null`: an empty month is a real answer, and a page
          // that renders nothing is indistinguishable from one that broke.
          <p className="mt-10 text-text-secondary">
            No releases are confirmed for {label} yet. The providers usually fill a month in
            about eight weeks ahead of it.
          </p>
        ) : (
          <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
            {items.map((it) => {
              const unlinkable = "linkable" in it && it.linkable === false;
              const inner = (
                <>
                  <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-surface-inset">
                    {it.posterUrl ? (
                      <Image
                        src={it.posterUrl}
                        alt=""
                        width={300}
                        height={450}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: TYPE_COLORS[it.type] }}
                      aria-hidden="true"
                    />
                    <span>{TYPE_LABEL[it.type] ?? it.type}</span>
                    <span aria-hidden="true">·</span>
                    <span>{dayLabel(it.releaseDate)}</span>
                  </div>
                  <div className="mt-1 text-sm leading-snug">{it.title}</div>
                </>
              );

              return (
                <li key={it.id}>
                  {unlinkable ? (
                    <div>{inner}</div>
                  ) : (
                    <Link href={buildItemHref(it)} className="block hover:opacity-90">
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <nav aria-label="Nearby months" className="mt-12 flex justify-between text-sm">
          {prev ? (
            <Link href={`/calendar/${prev}`} className="text-text-secondary hover:text-text-primary">
              ← {monthLabel(prev)}
            </Link>
          ) : <span />}
          {next ? (
            <Link href={`/calendar/${next}`} className="text-text-secondary hover:text-text-primary">
              {monthLabel(next)} →
            </Link>
          ) : <span />}
        </nav>
      </main>
    </div>
  );
}
