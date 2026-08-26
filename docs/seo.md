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
| item pages | Title, description, canonical, OG, `index, follow`, **and JSON-LD since 2026-08-20**. ~25 facet links, **plus sibling titles since 2026-08-23** (`buildLocalRails`, server-rendered, 0 provider calls; 6 of 10 sampled gained 3–14 links) |
| facet pages | Crawlable, indexable, **not in the sitemap** (deliberate, see below). Thin ones are `noindex, follow` since 2026-08-20 |
| `/calendar/{YYYY-MM}` | **New 2026-08-20.** SSR, 8 months in the sitemap |
| `/calendar` | The interactive app. Client-rendered, robots-disallowed, correctly |
| `/` | **94 outbound links since 2026-08-26**: 30 titles and 20 people from the day's `home_snapshot`, plus 36 genres and 8 calendar months from the hub. All server-rendered, **0 provider calls per view** |

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
`/api/home` — an endpoint under the `/api/` disallow. The hub added **44** of
today's links server-side: 36 genre facet pages and 8 calendar months.

⚠️ **"Recently added" (30 catalog titles) was removed from the hub on
2026-08-26** (Nils). It was the hub's only item links, but the day's rails at the
TOP of the page now server-render ~30 titles from the actual content, which is a
better place for them. Do not re-add it: two lists of titles on one page compete
for the same crawl budget and only one of them is something a person reads.

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

### ✅ The daily home snapshot (2026-08-26)

**The homepage hub above fixed the BOTTOM of `/` and left the top exactly as it
was.** The rails are the page's actual content, and they arrived through a
`useEffect` fetch of `/api/home`. `/api/` is under the robots `Disallow`, and
**Googlebot's renderer honours robots.txt for subresources**, so this was never a
"probably seen": the renderer was *blocked* from fetching the data that would
have produced those links. Every poster on the highest-authority url on the
domain was invisible to search, by construction.

Nils's design, and it solves the cost problem in the same move: **build the whole
public page once a day on the server, store it, serve every visitor and every
crawler out of the table.**

- `home_snapshot` (migration 21) holds one row per region: the day's trending,
  upcoming and people rails as JSON. Written by a boot-plus-hourly job in
  `src/instrumentation.ts`, read by `page.tsx` as one indexed SELECT.
- The rails are handed to `HomePageClient` as **props**. Nothing about the
  components had to change: `PosterCard` has always rendered a real `<a href>`
  via `Link`, and a client component's first render *is* server HTML. Where the
  data came from was the only thing making those links invisible.
- The client fetch stays, and its job changed. It no longer decides what is on
  the page, only who is looking: the per-user overlay (watchlist, rating, the
  viewer's Fandex Score) and the recommendation rail.

**Measured on the dev server against the real database, 2026-08-26:** `/` serves
**94 server-rendered internal links** (30 items, 20 people, 36 genres, 8 months),
and **six page loads moved the `/api/health` provider counters by 0**. Before
this, every cold 30-minute cache entry cost a TMDB + Trakt + IGDB + RAWG fan-out.

⚠️ **Four things about it are load-bearing.** All four are commented where they
live; this is the index.

1. **A failed build must never replace a good snapshot.** The sketch said "clear
   the table, then rebuild"; clearing first is exactly what turns a provider
   outage into an empty homepage. The write is a single atomic replace *after* a
   build that validated, and a thin build keeps the previous row. Same shape as
   the prune invariant.
2. **The builder writes catalog rows on purpose, and PR15 still holds.** It calls
   `persistDiscoverItems` directly rather than handing `persistDiscoverBatch` a
   fake user, so the request-path gate keeps its exact shape. The write is bounded
   at 30 titles a day regardless of traffic, which is the opposite of the
   unbounded crawler-driven writes PR15 exists to stop. Without it the cards
   resolve read-only and come back `linkable: false`, which defeats the point.
3. **`home_snapshot_item` is the fourth entry in `dbPrune`'s `PRUNABLE_WHERE`,
   and the first that is not user state.** The titles `/` links arrive
   `browsed = 1` with nobody acting on them, so the boot prune would delete
   exactly them and leave a crawler a page of 404s. Pinned by a test.
   The snapshot refresh is also sequenced **after** `bootPrune` resolves: both
   run at boot, and a row pinned between the prune computing its id list and
   executing the delete is not protected.
4. **The table is bounded by its PRIMARY KEY, not by a sweep.** One row per
   region, `INSERT OR REPLACE`. It is written off a schedule and read on the
   busiest page in the app, which is the pair of properties that grew
   `facet_page_cache` to 222.8 MB; a bound that cannot be forgotten beats a timer
   that can.

**The cost of the design, stated plainly:** the snapshot is built for
`DEFAULT_COUNTRY` only, so a signed-in visitor whose region differs now sees the
same public rails as everyone else. Region only ever reached `upcomingPool`'s
calendar window, and one shared upcoming list is a far smaller loss than a
per-region provider fan-out on `/`.

### ✅ The daily calendar snapshot (2026-08-26)

The same move as the home snapshot, applied to the calendar (Nils: "can we apply
the same logic to the calendar page?"). `calendar_snapshot` (migration 22) holds
the ranked popular-releases pool for **twelve months, per region in use**, built
once a day. It buys three things, and only the first was asked for.

| | before | after |
|---|---|---|
| paging 11 months, signed in | 10.4 s, **33 provider calls** | 1.3 s, **0** |
| first hit on a month, fresh process | 1.24 s | 12–20 ms |
| 20 anonymous month-page requests | a fan-out per cold month | **0** |
| linkable items on `/calendar/2026-09` | **8 of 15** | **15 of 15** |

The last row is the one nobody asked for and it is the SEO one.
`/calendar/{YYYY-MM}` is public, indexed and in the sitemap, and it persists with
a null user by design (PR15's write gate, held by construction), so any title we
did not already hold rendered as **dead text with no href**. The daily builder
persists the shown titles once, bounded, off the request path, so those pages
ship real links.

**Three layers now, and each answers a different question.** `candidatesForMonth`
tries them in order:

1. the in-memory cache: *have I already PARSED this month?*
2. `calendar_snapshot`: *has the SERVER already fetched it today?*
3. the provider fan-out: the only layer that costs quota.

The table did not make the cache redundant and the cache did not make the table
unnecessary. The cache dies on every deploy (`docs/scalability.md` §3.6) and prod
deploys often; the table survives that. But a stored month is ~103 KB of JSON, so
reading it on every request would trade a network call for a parse on the request
path.

⚠️ **Layer 3 stays.** The servable range is ±12 months while the snapshot covers
−5..+6, and a link shared into one of those outer months must not rot. Those
months are `noindex` and linked from nowhere, so the crawl volume reaching them is
small. Do not "simplify" this into snapshot-only.

⚠️ **The window is −5..+6, not ±5, and the extra future month is load-bearing.**
`indexableMonths()` advertises −1..+6 in the sitemap. A five-month future window
would leave `/calendar/{+6}` outside the snapshot while it is still a crawlable,
indexed url, quietly falling back to a live fan-out on a crawler's request.
Nothing would surface it: the page renders, the links work, the bill goes up. A
test asserts the snapshot window stays a **superset** of the indexable one.

⚠️ **It is built per REGION IN USE, and the first version was not.** That version
built `DEFAULT_COUNTRY` only, copying the home snapshot, and every test passed.
Paging eleven months while signed in still moved the provider counters by 33,
because `/api/calendar/popular` passes the **viewer's** region through and the
account testing it is `DE`. Every signed-in visitor outside the default country
would have kept the old slow path and the full provider bill, from a change whose
whole point was removing both. **It measured as working because the anonymous
path genuinely was fixed.** The region set now comes from `users.country`, capped
at 8 with a log line when the cap bites.

⚠️ **This table can grow and `home_snapshot` cannot, and the difference is the
key.** `home_snapshot` is keyed by region alone, so `INSERT OR REPLACE` makes
growth structurally impossible. This one is keyed by region **and month** over a
window that SLIDES: every month that passes retires one key and mints another. The
build deletes out-of-window months and out-of-use regions on every run. A slow
version of the shape that grew `facet_page_cache` to 222.8 MB, and slow is worse,
because nobody would connect it back to this file.

`calendar_snapshot_item` is the fifth clause in `dbPrune`'s `PRUNABLE_WHERE`. It
pins only the titles a month page actually SHOWS (15 of the 40-deep pool), and the
whole pin set is rebuilt on each build rather than edited per month, because a
slipped release can sit in two months at once.

**Measured footprint:** 12 months × 2 regions = 24 rows, ~2.2 MB, 215 pinned
catalog rows.

### ✅ Popular people, and what it is honestly ranking (2026-08-26)

The rail that replaced "Recently added". 20 faces, each linking `/person/{slug}`.

**Zero provider calls, portraits included**, and that is the part worth knowing:
TMDB's item payload embeds `credits.cast[].profile_path` and
`credits.crew[].profile_path`, and `projectRawData` keeps them, so the portrait is
already in a `media_links` blob (measured: 297 of 300 sampled tmdb rows carry at
least one). The obvious implementation, resolving each name through
`/search/person` and then `/person/{id}`, would have put two TMDB calls per face
on the most-hit page in the app.

⚠️ **"Popular" here means weighted presence in OUR catalog, not a popularity
feed.** A person scores the sum over their pool titles of role weight (director
1.3, cast 0.6, scaled by billing prominence) times a mild recency factor. It moves
as the catalog syncs and it favours people attached to current titles, but it is a
statement about this catalog. `rotateRailFresh` at the daily build is what stops
the same 20 faces sitting on `/` forever.

⚠️ **The rail only links people at or above `MIN_INDEXABLE_TITLES` (3).**
`/person/{slug}` is `noindex, follow` below that, and the whole point of the rail
is to move link equity from the strongest page on the site into person pages.
Linking a one-title person spends it on a page we asked Google to drop. Measured
on the live catalog: 8,356 distinct people, **1,202 clear the threshold**, 453 have
five or more. `popularPeople.MIN_TITLES` mirrors the constant rather than
importing it (that module pulls the whole provider fan-out), and a test asserts
the two agree.

⚠️ **`src/lib/personRail.ts` has no imports, deliberately.** `roleLabel` started
next to the ranking code, `PersonCard` imported it, and `HomePageClient` is a
client component, so Turbopack followed `PersonCard → popularPeople → db.ts →
better-sqlite3` into the browser bundle and `/` returned a 500 on
`Can't resolve 'fs'`. `tsc`, lint and 1,019 tests were all green: nothing but
loading the page exercises the client/server module graph.

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

> **2026-08-21:** the item url is now **two** segments, `/{type}/{slug}` (below),
> so the two-segment arm is the canonical one again and the three-segment arm
> counts the legacy redirect. Both still map to the key `/[type]/[id]`, which is
> deliberately NOT renamed: a new key would split every item page's history.

---

## Still open

### 🔵 Facet pages are not in the sitemap, on purpose

They are already crawled heavily via item-page links — that crawl is what filled
`facet_page_cache` to 222 MB on 2026-08-19. Enumerating thousands of
`force-dynamic` provider-fanout URLs would invite more of exactly that. **Fix the
under-linking first, then reconsider** (see below: the pages DO render links, they
just link only the titles we already hold).

### ✅ Facet pages DO server-render item links (re-measured 2026-08-26)

This section used to say a facet page renders **zero** `<a href>` in its server
HTML, measured 2026-08-21. **That is false now**, and it is the second doc claim
in three days to describe a gap that was not there.

Re-measured against a real `next start` build on 2026-08-26:

| page | server-rendered item links |
|---|---|
| `/tag/action` | **40** |
| `/tag/cyberpunk` | **35** |
| `/person/christopher-nolan` | **13** |

The reason is the one this session learned on Home: `PublicFacetView` is
`"use client"`, but it seeds its state from `initial.items`: **props**, not a
fetch. It has no `if (!hydrated) return null` guard either, and a client
component's first
render IS server HTML, so the links are in the first byte. Client-ness was never
what hid them.

⚠️ **What IS still open is the UNDER-LINKING, which is a different problem with a
different fix.** Those pages render up to 60 items each and link only the ones we
already hold: `persistDiscoverBatch` gets a null user on an anonymous render
(PR15's write gate), so a provider title we have never ingested comes back
`linkable: false` and renders without an href. `/person/christopher-nolan`
linking 13 of 60 is that, not a rendering bug. See the `MIN_INDEXABLE_TITLES`
note above for why the thin-page threshold deliberately tests pool size rather
than linkable count.

The fix, if it is worth doing, is the one the home and calendar snapshots
already use: persist a bounded set once a day off the request path, so the
crawler-visible page links rows that exist. Do not persist on the request path;
that is the write amplification that grew `media_items` to ~676k rows.

### ✅ Item pages link to sibling items (shipped 2026-08-23)

`buildLocalRails` (`src/lib/detail/relatedRails.ts`) renders both related rails
server-side, from the catalog pool, at **zero provider calls**. The MB11 provider
top-up deliberately stays on the client path: the item page is the most-crawled
page type, and SSR-ing the top-up would buy a quota-priced call per cold page and
**approximately zero new links**, because a title we do not already hold comes
back `linkable: false` under the PR15 write gate.

⚠️ **This section said "still open" here and in STATUS.md until 2026-08-26,
three days after it shipped.** If a doc claims a gap, check the code before
planning work around it.
