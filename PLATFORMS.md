# Platform Reference

Every platform Fandex uses or has considered, in three tables: **metadata**, **two-way sync**, **one-time import**. Capability rows are authoritative from code (`src/lib/sources/catalog.ts`); **cost, licence and scale re-researched 2026-08-20** against published terms. Prose and deep dives → grep the [archive](docs/archive/history.md) for `platform deep dives`.

**Decisions taken 2026-08-23** (Nils): remove OMDb now · drop RAWG’s metadata role now, keeping it as a connector · build the IMDb CSV import next · open neither GiantBomb nor anime. The work is the `PL` section of [TASKS.md](TASKS.md).

⚠️ **Two rows on this page were WRONG until 2026-08-23, and both were load-bearing.** Steam’s Companies column said ❌ and Steam has contributed developer + publisher facets all along (`src/lib/facets.ts:208-211`). And this page implied games depend on RAWG more than they do: measured on the catalog, IGDB covers 907 of 1,035 games, Steam 808, RAWG 741, and the **IGDB ∪ Steam union is 965**, leaving RAWG uniquely reaching **70**. A capability cell is a claim about code; check it against `facets.ts` before planning around it.

**Status** ✅ live · 🔵 built, hidden · ⏸️ parked · ❔ unevaluated · ❌ rejected  **·  Score value** ●●● high · ●● medium · ● narrow · – none
**R** read · **W** write · **`*`** exists in their data model but not via a supported official API

⚠️ **Scale rule before adding any provider call:** cost is driven by **catalog breadth × crawler appetite**, not pageviews. A cold `/tag/` page cost **14 provider calls** when that was measured. **Price new calls in cold-facet-page units.** ⚠️ The worked example used to be RAWG's 20k/mo quota, which **retired 2026-09-02**; the tightest remaining ceiling is IGDB's, and IGDB is now the ONLY games provider, so a new games call has no second source to fall back on. → [docs/scalability.md](docs/scalability.md)

---

## 1. Metadata — what it gives, what it costs

The Fandex Score reads **only** facets off persisted `media_links`: tags, people, companies, franchise. It is forbidden by test from reading ratings, popularity or release date (`docs/fandex-score.md` §4). **"Score value" = how much of those four it carries**, not how much data it has.

| Platform | Media | Status | Tags | Cast/crew | Companies | Franchise | Dates | Ratings | Score | Cost & licence | Verdict |
|---|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|---|---|
| **TMDB** | movie, show | ✅ | ✅ genres+keywords | ✅ dir/creator/writer/cast | ✅ prod cos, networks | ✅ collections | ✅ | ✅ | ●●● | Free **non-commercial only** · **$149/mo** commercial <$1M rev | **Keep.** All four facet kinds. 9 calls per cold facet page. $149/mo the moment ads ship. |
| **IGDB** | game | ✅ | ✅ genres, themes, keywords, modes | ❌ | ✅ dev+pub | ✅ franchises | ✅ | ✅ | ●●● | **Free, no monthly cap**, 4 req/s · Twitch account | **Keep + prefer.** Healthiest provider on this page. |
| **Steam** | game | ✅ | ✅ **unique** store tags | ❌ | ✅ dev+pub | ❌ | ✅ | ✅ label | ●● | Free · ✅ **terms READ 2026-08-23 (PL5): commercial use is NOT prohibited**, 100k calls/day, but attribution is mandatory | **Keep, and it is a fuller source than this page said.** Deckbuilding/Tower Defense exist here and nowhere else, and it carries companies (corrected 2026-08-23), which is what made dropping RAWG from the facet paths safe. See the terms box below. |
| **RAWG** | game | ✅ | ✅ genres+tags | ❌ | ✅ dev+pub | ❌ | ✅ | ✅ | ●● | **20k req/mo** free NC · **$149/mo for 50k** | ⚫ **RETIRED ENTIRELY 2026-09-02** (Nils). It had answered `401` continuously since 2026-08-20 and still did on 2026-09-02, so its monthly quota did not reset on schedule and the integration had contributed nothing for two weeks. Gone from `SOURCES`, `METADATA`, browse, search, the personalized feed and the calendar's popular month. **No longer a connector either.** ⚠️ Stored rows survive and nothing deletes a link: 603 links remain, and 16 games are RAWG-only with all 16 in the user's library. Supersedes the 2026-08-23 "drop the metadata role, keep the connector" decision below. → `docs/decisions.md` |
| **Wikidata** | all | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ● | **Free, CC0** | **Keep.** Powers the `ip` facet. Ideal licence. |
| **OMDb** *(the only source of IMDb, Rotten Tomatoes & Metacritic scores)* | movie, show | ✅⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ only | **–** | 1k/day free · **CC BY-NC 4.0** | 🔴 **DECIDED 2026-08-23: remove NOW, not at ads** (PL1). NC at every tier so it cannot be paid for, contributes **zero** to the Score, and the key already 401s. Certification survives via TMDB; RT, IMDb rating, awards and box office do not. |
| **JustWatch** *(via TMDB)* | movie, show | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | – | Free via TMDB watch-providers | Keep as-is. Direct partner API not needed. |
| **MobyGames** | game | ❔ | ✅ genres | ✅ **deep game credits** | ✅ | ❌ | ✅ | ✅ | ●●● | 720 req/h NC · **commercial $4,999.99/mo** | 🔴 **Rejected on cost.** Would fill IGDB's missing credits, at 33× TMDB+RAWG combined. |
| **GiantBomb** | game | ❔ | ✅ concepts, themes | ✅ people | ✅ | ✅ franchises | ✅ | ✅ | ●●● | Free, no hard limit · **commercial needs written permission** | 🟡 **Best free fix for game credits, and DECIDED AGAINST 2026-08-23.** Not opened: commercial use needs written permission, the same terms class that parked Backloggd/Hardcover. Re-raise only with new information. |
| **TVmaze** | show | ❔ | ✅ genres | ✅ cast+crew | ✅ networks | ❌ | ✅ | ✅ | ●● | Free, **CC BY-SA 4.0** · commercial licence for high volume | 🟡 Viable show backup. ⚠️ Share-alike licence needs reading before use. |
| **TheTVDB** | show | ❔ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ●● | Licence-based; **paid for commercial**; $11.99/yr user-PIN model | 🟡 Redundant with TMDB, which is better and cheaper here. |
| **OpenCritic** | game | ❔ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | – | Free; terms unverified | Ratings only → **zero Score value**. Skip. |
| **HowLongToBeat** | game | ❔ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ playtime | – | No official API | Playtime already comes from IGDB `time_to_beat`. Skip. |
| **TheGamesDB** | game | ❔ | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ● | Free; terms unverified | Redundant with IGDB. Skip. |
| **AniList** | anime, manga | ⏸️ | ✅ genres+tags | ✅ staff | ✅ studios | ✅ | ✅ | ✅ | ●●● | Free, 90 req/min · licence above **$150/mo revenue** | ⚠️ **Metadata half is fine; the CONNECTOR is barred by terms** (see table 2). |
| **MyAnimeList** | anime, manga | ❔ | ✅ | ✅ | ✅ studios | ❌ | ✅ | ✅ | ●● | Free, OAuth | Secondary anime id source. |
| **Kitsu** | anime, manga | ❔ | ✅ | ⚠️ thin | ✅ | ❌ | ✅ | ✅ | ●● | Free, open | Third anime option; weakest of the three. |
| **Open Library** | book | ⏸️ | ✅ subjects | ✅ authors | ✅ publishers | ✅ series | ✅ | ❌ | ●●● | **Free, open** | Best books metadata whenever books revive. |
| **Google Books** | book | ❔ | ✅ categories | ✅ authors | ✅ publishers | ❌ | ✅ | ✅ | ●● | Free tier + key | Secondary books source only. |
| **Hardcover** | book | ⏸️ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ●●● | Personal token only | ⏸️ **Parked on usage terms** ("offline use only"), not capability. |
| **BoardGameGeek** | board game | ❔ | ✅ categories, mechanics | ✅ designers, artists | ✅ publishers | ✅ families | ✅ | ✅ | ●●● | Free XML API2 · read-only, throttled | Rich facets, but opens a whole new media type. |
| **MusicBrainz / Discogs** | music | ❔ | ✅ genres | ✅ artists | ✅ labels | ❌ | ✅ | ❌ | ●● | MusicBrainz **CC0**; Discogs free w/ key | For a future music type. |
| **Podcast Index / Listen Notes** | podcast | ❔ | ✅ categories | ❌ | ❌ | ❌ | ✅ | ❌ | ● | Podcast Index free; Listen Notes paid tiers | Thin facets. Low priority. |
| **Simkl** | movie, show, anime | ❔ | ⚠️ thin | ❌ | ❌ | ❌ | ✅ | ✅ | ● | Freemium, proprietary | 🔴 **Direct competitor tracker** — expect the same competing-service clause as AniList. |

---

## 2. Two-way user sync

| Platform | Media | Status | Auth | Wishlist | Library | Rating | Review | Status W | Episodes | Cost / limits & blockers |
|---|---|---|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| **Trakt** | movie, show | ✅ | oauth | R/W | R | R/W | – | ✅ | **R/W** | Free. ⚠️ **2026 free caps: watchlist 250, ratings 10k, 5 lists, and NOTHING in the adapter handles a rejected write** (PL2, a live bug: a user past 250 gets a silent partial push). VIP 5,000/20k/100. **Monetized apps need approval.** Only source of per-episode state. |
| **TMDB** | movie, show | ✅ | oauth | R/W | R | R/W | – | – | – | No watched concept; "library" = rated items. Commercial licence as in table 1. |
| **RAWG** | game | ✅ | credentials | R/W | R | R/W | – | ✅ | – | No review text. ⚠️ **Quota exhausted today — 401 on every call.** |
| **Steam** | game | ✅ | openid | R | R | – | – | – | – | Free. Read-only by design. |
| **Letterboxd** | movie | 🔵 | oauth | R/W | R | R/W | R | ✅ | – | 🔴 **No working API key; 401s on every call.** Built and hidden. |
| **AniList** | anime, manga | ⏸️ | oauth | R/W | R | R/W | R | ✅ | – | 🔴 **Barred by terms:** API prohibited "within competing, non-complementary services of the same nature… anime and manga list or tracker services". Fandex is one. ⚠️ Verify by hand — `docs.anilist.co` 403s to automated fetch. |
| **MyAnimeList** | anime, manga | ❔ | oauth | R/W | R | R/W | – | ✅ | – | Free. Viable AniList alternative **without** the competing-service clause. ⏸️ **Anime as a media type was decided against 2026-08-23** (new type, ~9 enumeration points `tsc` will not flag). |
| **Simkl** | movie, show, anime | ❔ | oauth | R/W | R | R/W | – | ✅ | R/W | Freemium. 🔴 Direct competitor; expect terms friction. |
| **Hardcover** | book | ⏸️ | personal token only | R/W | R | R/W | R/W | ✅ | – | ⏸️ Parked: no OAuth, tokens expire on a shared Jan 1 reset, no app credential, writes undocumented. |
| **Backloggd** | game | ❔ | none (scrape) | R* | R* | R* | R* | – | – | Unofficial scraper on public profiles. Built on IGDB ids so it dedupes cleanly. Blocker is access method. |
| **BoardGameGeek** | board game | ❔ | token | R public | R public | R | – | – | – | **Read-only, no write-back.** Collection is async + throttled. |
| **StoryGraph** | book | ❔ | – | – | – | – | – | – | – | ❌ No official API; fragile cookie scraper only. |
| **Spotify / Last.fm** | music | ❔ | oauth | – | R | – | – | – | – | Listening data; weak wishlist/rating semantics. |
| **Goodreads** | book | ❌ | oauth (closed) | R/W* | R* | R/W* | R/W* | ✅* | – | ❌ API closed to new keys since Dec 2020. Unreachable. |
| **Audible / Libro.fm** | audiobook | ❌ | – | – | – | – | – | – | – | ❌ No public API. **Audiobooks are a FORMAT of `book`, not a platform** — never build these. |
| **GOG / Epic / itch.io** | game | ❌ | – | – | – | – | – | – | – | ❌ No official library API. |
| **PSN / Xbox / Nintendo** | game | ❌ | – | – | – | – | – | – | – | ❌ No public API at any price. |

---

## 3. One-time list import

**Nothing here is built.** No OAuth, no adapter, no ongoing quota — by far the cheapest way to absorb a backlog.

| Source | Media | Format | Cost to user | Carries | Matching | Verdict |
|---|---|---|---|---|---|---|
| **IMDb** | movie, show | CSV export (list / watchlist / ratings) | **Free** | title, year, **IMDb id**, your rating, dates | 🟢 stable id we already store | 🟢 **Best target, and DECIDED 2026-08-23: build it next** (PL4). Match local-first via an `imdb` pseudo-source row in `media_links`; budget the provider fallback per IMPORT, not per row. |
| **Steam** | game | Web API | Free | owned games, wishlist, playtime | 🟢 appid | ✅ Already live as a connector. |
| **Trakt** | movie, show | API / VIP export | Free | everything | 🟢 trakt+imdb+tmdb ids | ✅ Already live as a connector. |
| **Letterboxd** | movie | CSV in ZIP (`diary`, `ratings`, `watchlist`, `reviews`, `lists`) | 🟢 **FREE for all members** (corrected 2026-08-23) | title, year, Letterboxd URI, rating (0.5–5.0), dates | 🟢 title+year, and it is a GOOD key here | 🟢 **Best target for reaching a real userbase.** See the box below. |
| **MyAnimeList** | anime | XML export, native | Free | title, MAL id, score, status, episodes | 🟢 MAL id | 🟡 Only once anime is a media type. |
| **AniList** | anime | Export via API / 3rd-party → MAL XML | Free | same as MAL | 🟢 | 🟡 Import is unaffected by the connector terms clause. |
| **Backloggd** | game | CSV export | ⚠️ **Backers only** (paid) | title, rating, status | 🟢 IGDB ids | 🟡 Maps cleanly, paywalled export. |
| **HowLongToBeat / Grouvee** | game | CSV / JSON export | Free | title, status, playtime | 🔴 title only | 🟡 No stable shared id. |
| **Goodreads** | book | CSV export | Free | title, ISBN, rating, shelves | 🟢 ISBN | ⏸️ Books postponed. |
| **BoardGameGeek** | board game | XML API2 collection | Free | collection, ratings | 🟢 BGG id | ⏸️ New media type. |
| **Simkl** | movie, show, anime | Native export | Free | watchlist, history, ratings | 🟢 | 🟡 Easiest competitor migration path if ever wanted. |
| **GOG / Epic / itch.io** | game | ❌ none | – | – | – | 🔴 Unofficial endpoints only. |
| **PSN / Xbox / Nintendo** | game | ❌ none | – | – | – | 🔴 Not available. |

### ⚠️ Letterboxd: the export is FREE, and the API is closed to us BY POLICY (both verified 2026-08-23)

**This row said "Pro, $35/yr" and that was WRONG.** Letterboxd’s own [Pro page](https://letterboxd.com/about/pro/) lists nine Pro benefits and five Patron benefits; **data export is not among them.** The help centre says plainly: *"there’s an account export option in Settings that bundles your entire account ... into a single ZIP file of CSV documents."* Settings → **Import & Export** → *Export your data*, free, about four clicks.

**The API is not merely keyless.** [letterboxd.com/api-beta](https://letterboxd.com/api-beta/): access is by request only, and *"we are not granting access for data-analysis, visualization or recommendation projects ... or for any usage that recreates current or planned features of our paid subscription tiers."* **Fandex is a recommendation project** (the Fandex Score) **and its stats surfaces overlap Pro’s stats pages**, so an application is declinable on two of their own listed grounds. Treat the hidden connector as dead weight, not as code awaiting a key. The same page points you at the answer: *"If you require your account data in a machine-readable format, we provide import and export facilities."* **The CSV import is the route Letterboxd itself sanctions.**

**Why title+year is a GOOD key here, not a fallback.** The export carries **no TMDB or IMDb id**, only title, year and a Letterboxd URI, and third-party converters solve that by fetching each film page to scrape the IMDb link (one request per title). We do not need to: **Letterboxd "sources all film-related data from The Movie Database (TMDb)"**, so its title and year strings ARE TMDB’s, matched against a movie catalog that is **99.6% TMDB-linked**. Measured on the catalog 2026-08-23: **1,112 movies, 1,108 with a TMDB link, 100% carrying `norm_title` and `release_date`, and exactly ONE `norm_title`+year collision in the whole movie table.**

⚠️ **The quota warning below does NOT apply to movies.** It was reasoned from RAWG’s 20k/month cap. **TMDB has no monthly cap** (50 req/s, IP-based; the old 40-per-10s limit was dropped in 2019), so resolving a few thousand unmatched titles is a rate-shaping problem measured in minutes, not a quota problem. **Movies are the cheap medium to import.**

**Also available, not yet worth building:** every member profile has a public **RSS feed** of new diary entries, needing no auth and no key. That is a *forward* channel after a CSV backfill, and it carries no watchlist.

⚠️ **An importer is a WRITE PATH into `media_items`** and inherits the thin-write/pool rules in AGENTS.md: insert-only, `browsed` semantics respected, never bypassing `matcher.ts`. **A CSV of 2,000 titles is 2,000 provider searches if matched naively** — which lands straight back on the quota problem. Match against the local catalog first.

---

## ✅ Steam Web API terms, READ 2026-08-23 (PL5)

**The headline: commercial use is not prohibited.** There is no non-commercial clause of the OMDb or TMDB kind, which makes Steam the only games provider with no monetization cliff. Limit is **100,000 calls/day**, far above anything measured here.

Four obligations, and two are already met:

- ✅ **No `nofollow` on links to Valve.** The terms say links to Valve "shall not" carry it. Checked across the codebase: every outbound Steam link uses `noopener noreferrer`, and none carries `nofollow`. ⚠️ Keep it that way, and note `StoreLink.tsx` adds `sponsored` to AFFILIATE links: Steam is not an affiliate merchant here (only GOG is), so no Steam link should ever get that token.
- ✅ **A privacy policy covering non-public end-user data.** `/legal/{en,de}/privacy` names Steam explicitly and says what is read.
- ✅ **"Store the Steam Data in a country identified in your privacy policy."** DONE 2026-08-23. Region confirmed by Nils: **Railway `europe-west4`, so the database is in the Netherlands**, now named in both the EN and DE privacy policies. ⚠️ The policy deliberately does NOT claim the data never leaves the EU: Railway and Cloudflare are US companies whose staff can reach what they host, which is a transfer under the GDPR, so the DPF and SCC sentence stays.
- ⚠️ **Valve name and logo must appear** on pages using the API. `BrandGlyph` renders the Steam mark, which likely satisfies this, but it has not been audited page by page.

⚠️ **These terms cover `api.steampowered.com`. They do NOT cover `IStoreQueryService`**, the store front-end's own undocumented endpoint behind the tag search, which remains the separate and larger risk already noted below.

---

## Traps that would be lost with the prose

- **Steam search:** use **`tagids_must_match`**. ⚠️ **`filters.tagids` is silently IGNORED** — returns HTTP 200 with the entire 260,878-record catalog, so every query looks like it worked. A test pins the correct key. `sort: 2` is the only sort that surfaces real titles. `IStoreQueryService` is undocumented and can change without notice.
- **Trakt episodes:** ⚠️ a bare `{ ids: { trakt } }` at the top level of `/sync/history` **marks the ENTIRE show watched** — the `seasons` array is what scopes the write.
- **Episode state ≠ episode catalog.** *What you watched* is Trakt only. *What episodes exist* is metadata from TMDB (preferred) or Trakt. `/sync/watched/shows` returns only episodes you HAVE seen, so it can never say season 2 has twelve. → [[mb14-episode-tracking]]
- **`capabilities.episodes.read` gates prune authority** — it decides whether a pull is authoritative about episodes. Never sniff a response shape for this. → [[trakt-sync-completeness]]
- **Adding a media TYPE needs no migration** (`media_items.type` is plain TEXT, no CHECK) and **`tsc` will not help you** — only one `Record<MediaType, …>` exists, so a new union member compiles clean while silently doing nothing at ~9 other enumeration points.
- **Audiobooks are a format, not a platform.** Model as a `book` edition flag. Never build Audible/Libro.fm.
- **Check a provider's USAGE TERMS before its capabilities.** That, not auth or schema, is what parked Hardcover and Backloggd and what gates AniList and GiantBomb.
