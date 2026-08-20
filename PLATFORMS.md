# Platform Reference

Every platform Fandex uses or has considered, in three tables: **metadata**, **two-way sync**, **one-time import**. Capability rows are authoritative from code (`src/lib/sources/catalog.ts`); **cost, licence and scale re-researched 2026-08-20** against published terms. Prose and deep dives → grep the [archive](docs/archive/history.md) for `platform deep dives`.

**Status** ✅ live · 🔵 built, hidden · ⏸️ parked · ❔ unevaluated · ❌ rejected  **·  Score value** ●●● high · ●● medium · ● narrow · – none
**R** read · **W** write · **`*`** exists in their data model but not via a supported official API

⚠️ **Scale rule before adding any provider call:** cost is driven by **catalog breadth × crawler appetite**, not pageviews. A cold `/tag/` page costs **14 provider calls**; RAWG's free quota is 20k/mo, so ~5,000 of them exhaust a month. **Price new calls in cold-facet-page units.** → [docs/scalability.md](docs/scalability.md)

---

## 1. Metadata — what it gives, what it costs

The Fandex Score reads **only** facets off persisted `media_links`: tags, people, companies, franchise. It is forbidden by test from reading ratings, popularity or release date (`docs/fandex-score.md` §4). **"Score value" = how much of those four it carries**, not how much data it has.

| Platform | Media | Status | Tags | Cast/crew | Companies | Franchise | Dates | Ratings | Score | Cost & licence | Verdict |
|---|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|---|---|
| **TMDB** | movie, show | ✅ | ✅ genres+keywords | ✅ dir/creator/writer/cast | ✅ prod cos, networks | ✅ collections | ✅ | ✅ | ●●● | Free **non-commercial only** · **$149/mo** commercial <$1M rev | **Keep.** All four facet kinds. 9 calls per cold facet page. $149/mo the moment ads ship. |
| **IGDB** | game | ✅ | ✅ genres, themes, keywords, modes | ❌ | ✅ dev+pub | ✅ franchises | ✅ | ✅ | ●●● | **Free, no monthly cap**, 4 req/s · Twitch account | **Keep + prefer.** Healthiest provider on this page. |
| **Steam** | game | ✅ | ✅ **unique** store tags | ❌ | ❌ | ❌ | ✅ | ✅ label | ●● | Free · re-read terms before going commercial | **Keep.** Deckbuilding/Tower Defense exist here and nowhere else. |
| **RAWG** | game | ✅ | ✅ genres+tags | ❌ | ✅ dev+pub | ❌ | ✅ | ✅ | ●● | **20k req/mo** free NC · **$149/mo for 50k** | 🔴 **Drop the metadata role.** Fully overlapped by IGDB; paid tier is only 2.5× free. Keep as connector. |
| **Wikidata** | all | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ● | **Free, CC0** | **Keep.** Powers the `ip` facet. Ideal licence. |
| **OMDb** *(the only source of IMDb, Rotten Tomatoes & Metacritic scores)* | movie, show | ✅⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ only | **–** | 1k/day free · **CC BY-NC 4.0** | 🔴 **REMOVE before ads.** NC at every tier, contributes **zero** to the Score, and the key is already invalid (401s today). |
| **JustWatch** *(via TMDB)* | movie, show | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | – | Free via TMDB watch-providers | Keep as-is. Direct partner API not needed. |
| **MobyGames** | game | ❔ | ✅ genres | ✅ **deep game credits** | ✅ | ❌ | ✅ | ✅ | ●●● | 720 req/h NC · **commercial $4,999.99/mo** | 🔴 **Rejected on cost.** Would fill IGDB's missing credits, at 33× TMDB+RAWG combined. |
| **GiantBomb** | game | ❔ | ✅ concepts, themes | ✅ people | ✅ | ✅ franchises | ✅ | ✅ | ●●● | Free, no hard limit · **commercial needs written permission** | 🟡 **Best free fix for game credits.** Same class of terms risk that parked Backloggd/Hardcover. Ask before building. |
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
| **Trakt** | movie, show | ✅ | oauth | R/W | R | R/W | – | ✅ | **R/W** | Free. ⚠️ **2026 free caps: watchlist 250, ratings 10k, 5 lists.** VIP 5,000/20k/100. **Monetized apps need approval.** Only source of per-episode state. |
| **TMDB** | movie, show | ✅ | oauth | R/W | R | R/W | – | – | – | No watched concept; "library" = rated items. Commercial licence as in table 1. |
| **RAWG** | game | ✅ | credentials | R/W | R | R/W | – | ✅ | – | No review text. ⚠️ **Quota exhausted today — 401 on every call.** |
| **Steam** | game | ✅ | openid | R | R | – | – | – | – | Free. Read-only by design. |
| **Letterboxd** | movie | 🔵 | oauth | R/W | R | R/W | R | ✅ | – | 🔴 **No working API key; 401s on every call.** Built and hidden. |
| **AniList** | anime, manga | ⏸️ | oauth | R/W | R | R/W | R | ✅ | – | 🔴 **Barred by terms:** API prohibited "within competing, non-complementary services of the same nature… anime and manga list or tracker services". Fandex is one. ⚠️ Verify by hand — `docs.anilist.co` 403s to automated fetch. |
| **MyAnimeList** | anime, manga | ❔ | oauth | R/W | R | R/W | – | ✅ | – | Free. Viable AniList alternative **without** the competing-service clause. |
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
| **IMDb** | movie, show | CSV export (list / watchlist / ratings) | **Free** | title, year, **IMDb id**, your rating, dates | 🟢 stable id we already store | 🟢 **Best target. Build this first.** |
| **Steam** | game | Web API | Free | owned games, wishlist, playtime | 🟢 appid | ✅ Already live as a connector. |
| **Trakt** | movie, show | API / VIP export | Free | everything | 🟢 trakt+imdb+tmdb ids | ✅ Already live as a connector. |
| **Letterboxd** | movie | CSV in ZIP (`diary`, `ratings`, `watchlist`, `lists`) | ⚠️ **Pro, $35/yr** | title, year, rating, watched date, review | 🟡 title+year | 🟡 Richer than IMDb, but paywalled on their side. |
| **MyAnimeList** | anime | XML export, native | Free | title, MAL id, score, status, episodes | 🟢 MAL id | 🟡 Only once anime is a media type. |
| **AniList** | anime | Export via API / 3rd-party → MAL XML | Free | same as MAL | 🟢 | 🟡 Import is unaffected by the connector terms clause. |
| **Backloggd** | game | CSV export | ⚠️ **Backers only** (paid) | title, rating, status | 🟢 IGDB ids | 🟡 Maps cleanly, paywalled export. |
| **HowLongToBeat / Grouvee** | game | CSV / JSON export | Free | title, status, playtime | 🔴 title only | 🟡 No stable shared id. |
| **Goodreads** | book | CSV export | Free | title, ISBN, rating, shelves | 🟢 ISBN | ⏸️ Books postponed. |
| **BoardGameGeek** | board game | XML API2 collection | Free | collection, ratings | 🟢 BGG id | ⏸️ New media type. |
| **Simkl** | movie, show, anime | Native export | Free | watchlist, history, ratings | 🟢 | 🟡 Easiest competitor migration path if ever wanted. |
| **GOG / Epic / itch.io** | game | ❌ none | – | – | – | 🔴 Unofficial endpoints only. |
| **PSN / Xbox / Nintendo** | game | ❌ none | – | – | – | 🔴 Not available. |

⚠️ **An importer is a WRITE PATH into `media_items`** and inherits the thin-write/pool rules in AGENTS.md: insert-only, `browsed` semantics respected, never bypassing `matcher.ts`. **A CSV of 2,000 titles is 2,000 provider searches if matched naively** — which lands straight back on the quota problem. Match against the local catalog first.

---

## Traps that would be lost with the prose

- **Steam search:** use **`tagids_must_match`**. ⚠️ **`filters.tagids` is silently IGNORED** — returns HTTP 200 with the entire 260,878-record catalog, so every query looks like it worked. A test pins the correct key. `sort: 2` is the only sort that surfaces real titles. `IStoreQueryService` is undocumented and can change without notice.
- **Trakt episodes:** ⚠️ a bare `{ ids: { trakt } }` at the top level of `/sync/history` **marks the ENTIRE show watched** — the `seasons` array is what scopes the write.
- **Episode state ≠ episode catalog.** *What you watched* is Trakt only. *What episodes exist* is metadata from TMDB (preferred) or Trakt. `/sync/watched/shows` returns only episodes you HAVE seen, so it can never say season 2 has twelve. → [[mb14-episode-tracking]]
- **`capabilities.episodes.read` gates prune authority** — it decides whether a pull is authoritative about episodes. Never sniff a response shape for this. → [[trakt-sync-completeness]]
- **Adding a media TYPE needs no migration** (`media_items.type` is plain TEXT, no CHECK) and **`tsc` will not help you** — only one `Record<MediaType, …>` exists, so a new union member compiles clean while silently doing nothing at ~9 other enumeration points.
- **Audiobooks are a format, not a platform.** Model as a `book` edition flag. Never build Audible/Libro.fm.
- **Check a provider's USAGE TERMS before its capabilities.** That, not auth or schema, is what parked Hardcover and Backloggd and what gates AniList and GiantBomb.
