# SEO and organic reach

**Why this file exists.** Monetization went ads-first on 2026-08-19, and the first
gate is **10,000 pageviews/month**. Nothing in the repo was about getting there.
This is the reference for what fandex.org exposes to a crawler, what was measured,
and what is still open.

Live traffic numbers live at `/dev/analytics`. ⚠️ **That page is a client beacon,
so crawlers are invisible to it by design** — it is the right population for the
ads decision and the wrong one for judging reach. Reach belongs in Search Console.
→ [[telemetry-self-hosted]]

---

## ✅ Search Console is verified (2026-08-20)

**Property:** `fandex.org`, a **Domain** property (covers `www` and both protocols, survives any redeploy).
**Method:** DNS TXT on the apex, added by hand in Cloudflare:

```
Type: TXT   Name: @   Content: google-site-verification=sONMjRE03Xj6G-qEGLfsiuQg9ujBS9i_2uN1sGpy88U
```

⚠️ **Do not delete that record.** Removing it un-verifies the property and every
report empties out. Search Console offered to write it itself via an OAuth grant
against the Cloudflare account; that was declined deliberately, because standing
write access to the zone that serves fandex.org is a much larger permission than
one TXT record needs.

`sitemap.xml` is submitted. It showed **"Couldn't fetch"** immediately after
submission, which is Search Console's pending state rather than a fault: the
sitemap answers in **180 ms** with `200`, 417 KB and `application/xml`, serves
Googlebot's user-agent identically, is not covered by any `Disallow`, and
`fandex.org` is grey-clouded in Cloudflare so no bot challenge sits in front of
it. If it still reads "Couldn't fetch" after ~24 h, that is worth chasing.

**The three reports worth reading, once Google has crawled for a few days:**

| Report | The question it answers |
|---|---|
| **Pages** (Indexing) | How many of the 2,037 sitemap URLs are indexed, and how many sit in **"Crawled – currently not indexed"** |
| **Performance** → Queries | What people search to land here. The first real evidence of which surface earns traffic |
| **Performance** → Pages | Whether item pages, facet pages or the calendar months carry it |

Expect nothing useful for several days. Coverage data lags crawling, and the
site is new to the index.

**Checked 2026-08-20, hours after verifying:** every report reads *"Processing
data, please check again in a day or so."* That is the normal fresh-property
state, not a fault. An independent check the same day said what the reports will
say later: `site:fandex.org` returned **two results, both the homepage**, under
`http://fandex.org` and `https://www.fandex.org`. Zero of the 2,022 item pages,
zero facet pages, zero calendar months. `/dev/analytics` agreed from the other
side: **1** visit classed `search` in 30 days.

So the pipeline is fine and the index is empty. Both were fixed the same day
(see host canonicalization below); the wait is Google's.

Optional, five minutes: [Bing Webmaster Tools](https://www.bing.com/webmasters)
can **import** a verified Search Console property in one click. Bing is small
but free, and it feeds DuckDuckGo.

---

## What a crawler sees (audit, 2026-08-20, measured against live prod)

| Surface | State |
|---|---|
| `sitemap.xml` | 2,037 URLs — 2,022 items, 8 calendar months, 6 legal, 1 root |
| item pages | Title, description, canonical, OG, `index, follow`, **and JSON-LD since 2026-08-20**. Link out to ~25 facet pages, **0 to other items** |
| facet pages | Crawlable, indexable, **not in the sitemap** (deliberate, see below). Thin ones are `noindex, follow` since 2026-08-20 |
| `/calendar/{YYYY-MM}` | **New 2026-08-20.** SSR, 8 months in the sitemap |
| `/calendar` | The interactive app. Client-rendered, robots-disallowed, correctly |
| `/` | **74 outbound links since 2026-08-20** — 30 titles, 36 genres, 8 calendar months, all server-rendered |

### ✅ Structured data (`src/lib/jsonLd.ts`)

`Movie` / `TVSeries` / `VideoGame` plus a `BreadcrumbList` on every public item
page, and an `ItemList` on every calendar month.

⚠️ **`aggregateRating` is deliberately absent, and there is a test asserting it
stays absent.** Google's review-snippet policy is that a rating must come from
the site's own users. Every number Fandex could put there (TMDB, Trakt, IGDB,
RAWG, Steam, IMDb) is somebody else's aggregate that we display under
attribution, and marking those up as this page's own aggregate is what earns a
structured-data manual action — a sitewide penalty, not a lost star. Fandex's own
ratings are not an alternative either: one user's score is not an aggregate.
Revisit only when there are real per-item user ratings at volume.

Check any page against Google's [Rich Results Test](https://search.google.com/test/rich-results).

### ✅ The public release calendar (`/calendar/{YYYY-MM}`)

The one high-intent public query this app can answer ("what games come out in
September"). Three bounds hold it, all in `src/lib/calendarMonths.ts`:

- **It never reads the session.** Region is always `DEFAULT_COUNTRY` and
  `persistDiscoverBatch` always gets `null`, so an anonymous crawler cannot mint
  a `media_items` row. PR15's write gate by construction, not by care.
- **Its crawl space is closed.** Every month link comes from one window, so
  there is no prev/next corridor to walk forever.
- **Outside a wider servable range the route 404s before touching a provider.**
  `Allow: /calendar/` opens the whole path space to anything that guesses the
  pattern, and "nothing links there" was never a bound.

⚠️ `robots.ts` carries **both** `/calendar/` (allow) and `/calendar` (disallow).
A robots matcher takes the **longest** matching pattern, so the month pages are
allowed and the app page is not. **Do not tidy that into one rule.**

### ✅ Thin facet pages are `noindex, follow`

Threshold: **fewer than 3 titles in the pool** (`facetRobots`,
`src/lib/detail/publicFacetDetail.ts`).

⚠️ **The test is POOL SIZE, not linkable count, and the measurement is why.**
`/person/angelina-jolie` renders a full filmography at 175 KB and links exactly
**2** of it, because `linkable` is true only for titles some logged-in visitor's
page view happened to persist. That page is **under-linked, not thin**, and a
linkable-count threshold would have deleted a genuinely useful page over an
unrelated defect. The real thin ones render ~33 KB, the size of an empty shell.

Measured spread, 2026-08-20: `/tag/mystery` 35 linkable · `/tag/action` 28 ·
`/studio/paramount` 16 · `/person/daniel-craig` 7 · `/person/simon-west` 4 ·
`/person/angelina-jolie` 2 · `/person/kadra-yusuf` 1 · `/tag/planetary-alignment` 1.

**`noindex` does not reduce crawl volume** — a crawler still has to fetch the page
to read the tag. It reduces index bloat. Do not cite it as a fix for the
`facet_page_cache` / heap pressure.

### ✅ The homepage hub (`src/components/CatalogHub.tsx`, `src/lib/homeHub.ts`)

`/` used to link to **nothing**: priority 1.0, an `sr-only` h1, 36 KB, and zero
catalog links, because the page was `"use client"` end to end and fetched
`/api/home` — an endpoint under the `/api/` disallow. It now ships **74 outbound
links** server-side: 30 catalog titles, 36 genre facet pages, 8 calendar months.

`page.tsx` is a thin server shell; the interactive half lives in
`HomePageClient.tsx`, unchanged. `/` is now `ƒ (Dynamic)`, which the DB read
requires anyway (Railway's build phase has no volume mounted, same invariant
`sitemap.ts` carries).

**It reads the local catalog, not Home's provider rails**, and that is the whole
design: no provider call on the most-hit page on the site, every link resolves
because pool rows have uuids by definition, and no session read so the HTML is
identical for crawler and human. It only ever SELECTs, so it cannot mint a row
even in principle.

⚠️ **The genre cap was a bug, and a test caught it rather than a reading.** It
was 24 applied after an alphabetical sort, which silently cut puzzle, racing,
rpg, shooter, simulation, sports and strategy — every RAWG game genre — from a
catalog that is a third games, with every other assertion still green. It is now
a safety bound above the real count. If it ever needs to be a real limit, balance
the selection across the three provider maps first.

Genre chips come from the provider genre maps (`providerGenreKeys`), deduped by
provider **target** rather than by key: "science fiction"/"sci fi" share TMDB
878 and "rpg"/"role playing" share one RAWG slug, and linking both would put two
near-identical facet pages in front of a crawler competing for one query.

---

## ✅ Host canonicalization, and the favicon (2026-08-20)

Google had indexed `http://fandex.org` and `https://www.fandex.org`, and neither
is the host we want ranked. Three separate causes, all now closed.

- **`https://www.fandex.org` served the whole app at 200 with no redirect.** A
  second copy of all 2,022 item pages and every facet page. `http://` already
  301s, so www was the live duplicate. Fixed with an exact-host redirect in
  `next.config.ts` (`permanent: true`, which Next emits as **308**; Google treats
  308 and 301 identically for canonicalization). **Done in the repo rather than
  as a Cloudflare rule on purpose:** it ships with the deploy, it is reviewable,
  and it does not touch the account that also holds the verification TXT record.
- **The homepage was the only indexable surface with no canonical.** Item, facet,
  calendar-month and legal pages all had one. Declared in `src/app/page.tsx`,
  **not** in the root layout: metadata is inherited, so `canonical: "/"` on the
  layout would tell Google that `/discover`, `/library` and every other untagged
  page are duplicates of the homepage.
- **`/favicon.ico` returned 404,** which is why the search result still showed an
  old mark. Next was emitting correct `<link rel="icon">` tags for `icon.svg` and
  `icon.png`, but Google's favicon fetcher also probes the host root, and
  `icon.png` is **256x256** where Google's guidance is a square that is a
  multiple of **48**. `scripts/build-favicon.mjs` derives a 16/32/48 `.ico` from
  `src/app/icon.svg`, trimming the launcher-tile padding so the mark fills ~84%
  of the frame instead of ~56% and stays legible at 16px. Re-run it after any
  brand-art change. Google's favicon cache is slow, so expect days, not hours.

---

## ✅ The ads gate was reading 80% crawler (2026-08-20)

`/dev/analytics` showed **5,365 pageviews / 30d**, "54% of the 10,000 ads gate".
The top-pages panel is what gave it away: `/person` 2,855, `/tag` 1,351,
`/studio` 108, against **14** homepage views, 100% anonymous and 5,347 of 5,365
classed `direct`. Nobody reaches 2,855 distinct person pages through a front door
they opened fourteen times. It is the same facet long-tail crawl that filled
`facet_page_cache` to 222 MB.

**The claim that let it stand for a month:** the beacon route's own comment said a
client beacon "excludes crawlers for free". That holds only for crawlers that
fetch HTML and stop. **Googlebot, AhrefsBot and Semrush render the page,** run the
bundle and POST to `/api/telemetry/pv` exactly like a browser.
`isCrawlerUserAgent` (`src/lib/telemetry.ts`) now filters them before the body is
read. Its generic `bot` token is anchored to a delimiter because **CUBOT is a real
Android phone brand**, and a test asserts that a real browser is never dropped: a
false positive silently removes a person from the only number gating the ads
decision.

Counts before 2026-08-20 are unfiltered and **not comparable** to later ones.

Found alongside it: `normalizePathKey` templated item pages as **two** segments,
`/{type}/{uuid}`, while the sitemap ships **three**, `/{type}/{uuid}/{slug}`. So
every view of every item page landed in the `other` bucket and the dashboard could
not show one. `/calendar/{month}` had the same gap. **Template a route against the
sitemap, not against the route folder's name.**

---

## Still open

### 🔵 Facet pages are not in the sitemap, on purpose

They are already crawled heavily via item-page links — that crawl is what filled
`facet_page_cache` to 222 MB on 2026-08-19. Enumerating thousands of
`force-dynamic` provider-fanout URLs would invite more of exactly that. **Fix the
under-linking first, then reconsider.**

### 🔵 Item pages link to no other item pages

Every item page links out to ~25 facet pages and to zero sibling items. A
"related titles" block (same franchise, same director, same genre) would close the
loop and is the cheapest remaining internal-linking win. Note it must use already
persisted rows — the thin-write rule means a crawler-visible surface cannot mint
new ones.
