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

## ⬜ Your step, and everything else waits on it: verify Search Console

**Nothing below is measurable until this is done.** There is no way to know
whether a single Fandex page is indexed, what queries reach it, or whether the
2026-08-20 changes did anything, without it. Ten minutes, no deploy needed.

1. Go to [search.google.com/search-console](https://search.google.com/search-console),
   sign in, **Add property → Domain** (the left option, not "URL prefix").
   Enter `fandex.org`.
2. Google shows a **TXT record**. In Cloudflare → the `fandex.org` zone → **DNS**
   → **Add record**: type `TXT`, name `@`, content = the string Google gave you.
   Leave proxy off (TXT records aren't proxied anyway).
3. Back in Search Console, click **Verify**. If it fails, wait a few minutes for
   DNS and retry; Cloudflare usually propagates in under one.
4. **Sitemaps** in the left nav → submit `sitemap.xml`.

A Domain property is the right choice over URL prefix: it covers `www` and
`https` together, and it needs no HTML meta tag, so it survives any redeploy.

**Then, and only then, three reports are worth reading:**

| Report | The question it answers |
|---|---|
| **Pages** (Indexing) | How many of the 2,030 sitemap URLs are actually indexed, and how many sit in **"Crawled – currently not indexed"** |
| **Performance** → Queries | What people search to land here. The first real evidence of which surface earns traffic |
| **Performance** → Pages | Whether item pages, facet pages or the new calendar months carry it |

Optional, five more minutes: [Bing Webmaster Tools](https://www.bing.com/webmasters)
can **import** a verified Search Console property in one click. Bing is small but
free, and it feeds DuckDuckGo.

---

## What a crawler sees (audit, 2026-08-20, measured against live prod)

| Surface | State |
|---|---|
| `sitemap.xml` | 2,030 URLs — 2,022 items, 8 calendar months, 6 legal, 1 root |
| item pages | Title, description, canonical, OG, `index, follow`, **and JSON-LD since 2026-08-20**. Link out to ~25 facet pages, **0 to other items** |
| facet pages | Crawlable, indexable, **not in the sitemap** (deliberate, see below). Thin ones are `noindex, follow` since 2026-08-20 |
| `/calendar/{YYYY-MM}` | **New 2026-08-20.** SSR, 8 months in the sitemap |
| `/calendar` | The interactive app. Client-rendered, robots-disallowed, correctly |
| `/` | ⚠️ **A crawl dead-end — see below** |

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

---

## Still open

### 🔴 The homepage is a crawl dead-end

`/` is priority 1.0 in the sitemap, 36 KB, has an `sr-only` `<h1>`, and contains
**zero links to any catalog content**. Nothing flows from the highest-authority
URL on the domain into 2,022 item pages; they are reachable only via the sitemap,
and facet pages only one hop beyond that.

The fix is an SSR hub block on `/` — recently added, a few popular titles, top
genres. Two constraints: it must be **anonymous-safe** (no session read, no thin
writes) and **bounded-cache backed**, or it becomes a per-request provider
fan-out on the most-hit page on the site.

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
