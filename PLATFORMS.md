# Platform Evaluation & Capability Reference

Living reference for every external platform Fandex integrates with or has
considered: what each can do, and its current status. One table, expand as new
platforms are assessed.

> Current-state rows are authoritative from code (`src/lib/sources/catalog.ts`,
> `types.ts`, `constants.ts`). Candidate rows are evaluations against the current
> API landscape (last updated 2026-07-14).

## Two roles a platform can play

- **Connectable** — user authenticates and we sync both ways (pull wishlist/library, push ratings, status, wishlist add/remove). Backed by a `MediaSource` adapter.
- **Metadata / database provider** — read-only catalog, scores, and enrichment. No per-user write-back.

A platform can be both. A capability is only claimed when the matching adapter method exists; consumers check capabilities declaratively.

## Status legend

✅ `Implemented` live · 🔵 `Hidden` built but hidden in UI · ⬜ `To do` chosen for integration · ❔ `To evaluate` candidate, not decided · ❌ `Rejected` ruled out

## Platforms

Capabilities: **R** read, **W** write, blank = not supported. Rating column for
metadata providers means score read only. **`*`** marks a capability the platform
has in its data model but that is not reachable through a supported official API
(unofficial scraper, closed, or no API — see Notes). Split into **Active**
(actually live in the app) and **Candidates** (evaluated but not built) so a
session working on existing platforms doesn't have to scan 13 speculative rows
it doesn't need — only pull in "Candidates" when actually discussing expanding
to a new platform/media type.

### Active (implemented or hidden)

| Platform | Media | Role | Status | Auth | Wishlist | Library | Rating | Review | Status W | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Trakt.tv | movie, show | Connectable | ✅ Implemented | oauth | R/W | R | R/W | | yes | Rating and watched history are separate. |
| Steam | game | Connectable + Metadata | ✅ Implemented | openid | R | R | | | | Read-only; wishlist pull only. **Also the best TAG source for games** — see below. |
| RAWG | game | Connectable | ✅ Implemented | credentials | R/W | R | R/W | | yes | No review text. |
| TMDB | movie, show | Connectable | ✅ Implemented | oauth | R/W | R | R/W | | | No watched concept; library = rated items. |
| Letterboxd | movie | Connectable | 🔵 Hidden | oauth | R/W | R | R/W | R | yes | Hidden until a working API key exists. |
| IGDB | game | Metadata | ✅ Implemented | | | | R | | | Games catalog + community/critic scores. |
| IMDb | movie, show | Metadata | ✅ Implemented ⚠️ | | | | R | | | Rating via OMDB — **inherits the OMDB key gap below** (no scores in prod today). |
| Rotten Tomatoes | movie, show | Metadata | ✅ Implemented ⚠️ | | | | R | | | Critic score, also sourced from OMDB (`Ratings[Source="Rotten Tomatoes"]`) — **inherits the OMDB key gap below**. |
| Metacritic | movie, show, game | Metadata | ✅ Implemented | | | | R | | | Critic score. |
| OMDB | movie, show | Metadata | ✅ Implemented ⚠️ | apikey | | | R | | | Feeds IMDb rating, box office, awards. **⚠️ Config, not code: the `OMDB_API_KEY` is currently invalid, so no IMDb/RT scores actually land in prod.** Check this before debugging a missing rating. |

#### Steam as a game TAG source (2026-08-13)

Steam has by far the best tag vocabulary for games, and it is now what makes a
multi-tag game search work at all. Measured live: `Tower Defense` **4,080**
games · `Deckbuilding` **4,515** · **both together 277**. The same pair returns
**zero** from TMDB, RAWG and IGDB combined — IGDB's keyword list matches a handful
of obscure indies and the other two have no such tag.

- **Search:** `IStoreQueryService/Query/v1` with **`tagids_must_match`** — a list
  of groups that OR within and **AND between**, which is exactly the shape a
  multi-tag filter needs. Tag names resolve via the existing `GetTagList` map.
- **⚠️ `filters.tagids` is silently IGNORED.** It answers HTTP 200 with the whole
  catalog (260,878 records) for every query, so three different tag combinations
  come back byte-identical and all of them look like they worked. A test pins the
  correct key for exactly this reason.
- **`sort: 2`** is measured, not guessed — of sorts 0–5 it is the only one that
  surfaces real titles; the rest are alphabetical or lead with asset flips.
- **Tags were already scored, before any of this.** `normalizeSteam` sets
  `out.tags = d.resolvedTags` and `mergeLinks`' `TAG_SOURCES` already lists
  `steam`, so a Steam link's tags have always reached `extractFacets` and the
  Fandex Score. What was missing was only *search* — tags existed on the ~495
  linked games and nowhere else.
- **Terms:** `IStoreQueryService` is **undocumented** — it is what the store
  front-end uses — but it sits on `api.steampowered.com` behind the existing
  `STEAM_API_KEY`, the same class of dependency as `IStoreBrowseService/GetItems`
  (already used for app details) and rather safer than `searchSteamByName`, which
  scrapes store HTML. It can change without notice. **Re-read Steam's API terms
  on commercial use before flipping `MONETIZATION_ENABLED`** — not a blocker
  while the site is non-commercial, but it is the kind of clause that parked both
  Backloggd and Hardcover.

### Candidates (to do / to evaluate / rejected)

| Platform | Media | Role | Status | Auth | Wishlist | Library | Rating | Review | Status W | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Hardcover | book (+ audiobook format) | Connectable + Metadata | ⏸️ **Parked 2026-08-03** | personal token only — no OAuth | R/W | R | R/W | R/W | yes | Technically the best books connector, but **parked on its usage terms**, same call as Backloggd: the API is documented as *"only for offline use"*, reachable *"from localhost or APIs"*, with site allowlisting *"a way down the line"*. Also: no OAuth, tokens expire on a shared Jan 1 reset, no app-level credential (which gates the metadata role too), writes undocumented. See deep dive. |
| Open Library | book | Metadata (+ light write) | ⏸️ Postponed with books | account | R/W | R | | | partial | Free open catalog + covers; primary books metadata source. Nothing blocks it — it's postponed only because `book` as a media type is (2026-08-03), and it isn't worth the type's cost on its own. |
| AniList | anime, manga | Connectable + Metadata | ⚠️ Needs Nils | oauth | R/W | R | R/W | R | yes | Capability is fine (OAuth2 shipped, 90 req/min, documented writes). Gated on one TERMS clause barring use in competing list/tracker services — see the deep dive. |
| Google Books | book | Metadata | ❔ To evaluate | apikey / oauth | W | R | | | | Bookshelf write is dated; secondary metadata only. |
| StoryGraph | book | Connectable | ❔ To evaluate | | | | | | | No official API; only a fragile unofficial cookie scraper. |
| MyAnimeList | anime, manga | Connectable | ❔ To evaluate | oauth | R/W | R | R/W | | yes | Alternative / secondary id source to AniList. |
| MusicBrainz / Discogs | music | Metadata | ❔ To evaluate | | | | | | | Album catalog for a future music type. |
| Spotify / Last.fm | music | Connectable | ❔ To evaluate | oauth | | R | | | | User listening data; weak wishlist/rating semantics. |
| Podcast Index / Listen Notes | podcast | Metadata | ❔ To evaluate | apikey | | | | | | Podcast catalog; little standard write-back. |
| BoardGameGeek | board game | Metadata (read-only) | ❔ To evaluate | token (July 2025) | R public | R public | R | | | XML API2 is read-only (no write-back); collection is async + throttled; opens board games as a new type. See deep dive. |
| Backloggd | game | Connectable (read) / Metadata | ❔ To evaluate | none (scrape) | R* | R* | R* | R* | | Unofficial scraper only (public profiles). Built on IGDB ids → a Backloggd wishlist merges/dedupes cleanly with RAWG. Value = merging a user's Backloggd + RAWG wishlists. Blocker is access method, not data. See deep dive. |
| Goodreads | book | Connectable | ❌ Rejected | oauth (closed) | R/W* | R* | R/W* | R/W* | yes* | Full API existed but closed to new keys since Dec 2020, never reopened. Capabilities unreachable. |
| Audible / Libro.fm | audiobook | Connectable | ❌ Rejected | none (no public API) | R/W* | R* | R/W* | | yes* | No public API (only unofficial/reverse-engineered clients). Model audiobooks as a book format instead. |

## Key finding: audiobooks are a format, not a platform

Hardcover, Open Library, and Literal all model an audiobook as an edition of the
same book with a format flag. Adding a `book` media type plus a format facet
(ebook / physical / audiobook) covers audiobooks with no separate integration.
Do not build Audible/Libro.fm connectors. (Still true, and still the right shape —
but `book` itself is postponed as of 2026-08-03, so this is guidance for whenever
books are revived, not a live plan.)

## Priority

**Books are POSTPONED as a media type (Nils, 2026-08-03)** — the connector half
parked on Hardcover's usage terms (see deep dive), and a `book` type with no
connector and no settled catalog source isn't worth the surface it costs. Open
Library alone remains viable whenever books are revived; nothing about it is
blocked, it just isn't worth doing on its own right now.

1. **Anime / manga** — AniList. Capability-ready (OAuth2 shipped, 90 req/min,
   documented write mutations, extends the show model rather than adding a type)
   but **⚠️ gated on a TERMS clause, not on engineering** — its API is barred from
   "competing noncomplementary services of the same nature… Anime/Manga
   list/tracker services". The **metadata-only** half is unaffected and could ship
   independently. See the deep dive at the bottom of this file.
2. **Books** — ⏸️ postponed. Revive via Open Library (metadata, no auth), and
   revisit Hardcover only if it ships OAuth + the site allowlist its docs promise.
3. **Later phase** — music, podcasts, board games.

### What adding a media type actually costs (measured 2026-08-03)

Sized against the real code while evaluating books, so the next type-adding
proposal doesn't have to re-derive it. **A naive grep badly overstates this** —
72 files match a media-type literal, but most are provider-internal (`"movie" |
"tv"` for TMDB/Trakt API shapes) or tests. The genuine app-level enumeration
points are ~10:

`types/index.ts` (the `MediaType` union) · `lib/schemas.ts:12` (`zMediaType`, the
validation gate) · `lib/constants.ts:4` (`TYPE_COLORS`) · `lib/publicUrl.ts:30`
(`PUBLIC_TYPES` → SEO routes + sitemap) · `components/ui/TypeFilter.tsx:25` and
`components/SubBar.tsx:94` (filter defaults) · `lib/insights.ts:124` and
`components/insights/InsightsView.tsx:166` (histograms) · `lib/affiliate.ts`
(one array + three unions) · `app/api/search/route.ts:13`.

Two findings that matter more than the count:

- **No migration is needed.** `media_items.type` is plain indexed TEXT with **no
  CHECK constraint** (`db.ts:112`), so a new type stores fine on an existing DB.
  This removes `migrations.ts` — and its two-apply-path trap — from the job.
- **TypeScript will not help you.** There is exactly **one** `Record<MediaType,
  …>` in the codebase (`constants.ts:4`). Every other site matches on a literal,
  so adding a member to the union **compiles clean everywhere** while silently
  doing nothing in the other nine. Budget for finding them by hand, not by `tsc`.

## Adding a connectable platform

The registry pattern means: implement the `MediaSource` contract, add a `CATALOG`
entry declaring its capabilities, register it in `registry.ts`. No per-provider
`if` branches elsewhere.

1. Add the `SourceMeta` entry to `CATALOG` (label, color, media types, auth, capabilities).
2. Implement an adapter under `src/lib/sources/adapters/`, covering only the methods its capabilities claim.
3. Register it in `SOURCES` in `registry.ts`.
4. Add auth routes and token handling for its auth model.
5. Handle ID resolution (cross-ref via TMDB/ISBN where possible, else search).

## Deep dives (2026-07-14)

Detailed evaluations for platforms where the one-line table row hides an
important caveat.

### Hardcover — verdict: integrate, gate on auth

GraphQL (Hasura) endpoint at `api.hardcover.app/v1/graphql`. Full read/write:
`me { user_books }` filtered by `status_id` (1 want-to-read, 2 reading, 3 read,
5 DNF) gives wishlist + library in one model; ratings, reviews (`review_raw`),
and custom lists are readable; writes go through mutations like `insert_user_book`
and `insert_list_book`, and per the maintainer anything the UI can do is
available (rating + status writes included). Rich metadata (contributors, tags,
series, covers) means it can also be the books database provider.

Two risks before committing:
- **Auth for multi-user.** Documented access is a personal Bearer API key from
  account settings. Whether Hardcover offers a proper third-party OAuth app flow
  is **unconfirmed (<60% confidence)**. If it does not, each user must paste their
  own token — poor onboarding. Verify this first.
- **Stability.** Still self-described as early-access; schema shifts (they already
  removed `_eq` title search for performance). Rate limiting is informal: space
  writes to ~1/sec, concurrent writes to one list error.

#### ⏸️ VERDICT 2026-08-03: **PARKED — same reasoning as Backloggd.** Books are postponed as a media type.

The gate above was checked before writing any code. It failed, and the deciding
factor turned out not to be OAuth at all but Hardcover's own stated usage terms
(see finding 4). Decision by Nils, 2026-08-03: **park Hardcover, and postpone
`book` as a media type entirely.** Revisit if Hardcover ships OAuth + a site
allowlist, which their docs say they intend to.

The gate fails, and four facts turned up that change the shape of the integration: 

1. **No OAuth, and none shipped.** The only documented credential is a personal
   Bearer token the user copies from `hardcover.app/account/api`. OAuth for
   third-party app login exists **only as an open feature request** on
   [Hardcover's public roadmap](https://roadmap.hardcover.app/feature-requests)
   (accessed 2026-08-03). The roadmap's `developer api` post is marked
   **Released (2023-12-23)** — that is the personal-token GraphQL API, *not*
   OAuth; don't read the "Released" label as settling this question.
2. **⚠️ Tokens expire annually AND reset on January 1st** (per the official
   [getting-started docs](https://docs.hardcover.app/api/getting-started/)).
   Not a rolling per-user year — a **synchronised** expiry, so every connected
   user's book sync breaks on the same day. The prune invariant holds (a 401
   makes the pull throw, so nothing gets wiped), but the failure is fleet-wide
   and annual, and re-onboarding means every user manually re-pasting a token.
3. **There is no app-level credential at all** — which gates the *metadata* role
   too, not just the connectable one. Serving catalog reads from one
   Fandex-owned token means using a personal account token as a shared app key,
   against the docs' own instruction that tokens *"are not meant to be shared
   and should be kept private"*. That is the same class of finding that parked
   Backloggd, and it matters more now that H3/H4 make Fandex commercial.

4. **⛔ The deciding fact — their stated usage terms exclude a hosted site.**
   The same docs page says the API is *"only for offline use at this time"*,
   that *"you can only access this API from localhost or APIs"*, and that
   allowlisting specific sites is something they *"hope to"* offer but that is
   *"a way down the line"*. Alongside: *"You own your data. This means you can't
   use the API to access and use someone else's data."* Fandex is exactly the
   case not yet provided for — a hosted, multi-user site. This is the **same
   shape of finding that parked Backloggd**: not a breakage risk we could choose
   to accept, but building against what the provider says its interface is for,
   which matters more now that H3/H4 make Fandex commercial.

**Other constraints found (recorded so a future session doesn't re-derive them):**
60 requests/minute · 30 s query timeout · `_like`/`_ilike`/`_regex`/`_similar`
operators are **disabled**, so title matching must go through their
Typesense-backed `search` query (rich: `isbns`, `genres`, `moods`,
`contribution_types`, `featured_series`, `rating`, `has_audiobook`/`has_ebook`,
`description`, cover `image`) · reads are `user_books(where: {user_id, status_id})`,
confirming the 1/2/3/5 status mapping above · **writes are NOT documented** in
any guide (no mutations page, no `user_books` schema page) — the `insert_user_book`
claim is the maintainer's word, unverified · a documented max query depth of 3
that their own example query appears to exceed, so it needs empirical checking ·
*"we may reset tokens without notice while in beta"* on top of the annual expiry.

**Consequence:** Hardcover cannot be a low-friction connector today, and cannot
cleanly be the books *database* provider either — both roles want an app-level
credential that does not exist. Combined with finding 4, **it is parked.**
If it is ever revived, the remaining open question is whether writes work at all.

### BoardGameGeek — verdict: metadata/read-only only

Official access is XML API2 (`boardgamegeek.com/xmlapi2/`). As of **July 2, 2025**
the XML APIs require registration/authorization and an API token. It is a read
API (things, collection, plays, hot items, geeklists, search) with **no official
write path** for ratings or collection changes. Reading a private collection
needs authentication as that user, and there is no clean OAuth (the frontend uses
a username/password login endpoint + cookie). The collection endpoint is async
(returns 202 "queued", must poll) and the whole API is aggressively throttled.

Value is real but narrow: it opens **board games** as a new media type (nothing
else covers them) with an excellent catalog (ranks, weights, player-count polls,
a CSV ranks dump), but only as read-only public data. Pursue only if board games
are wanted as a category; do not expect write-back.

### Backloggd — verdict: to evaluate (blocked on access method)

No official public API — only an unofficial community scraper working on public
profiles. So there is no OAuth and no write-back, and scraping is fragile plus
ToS-risky.

The reason it stays on the table: **wishlist merging.** Backloggd is built on
**IGDB**, and we already key games on IGDB ids, so a user's Backloggd wishlist
would dedupe and merge cleanly with their RAWG wishlist at the id level with no
extra matching work. If the goal is a single combined game wishlist across
sources, Backloggd read access adds real value. The blocker is purely the access
method (scrape vs official API), not data compatibility.

**Both open questions investigated 2026-08-02 — verdict: PARKED, and the second
question answers itself.**

- **"Are we willing to depend on an unofficial scraper?"** — the deciding fact
  isn't breakage risk, it's Backloggd's own Terms of Service, which state:
  *"You agree to access the Website through the interface we provide."*
  ([terms-of-service](https://backloggd.com/about/terms-of-service/), accessed
  2026-08-02). There is no separate anti-bot or anti-scraping clause, but that
  sentence covers it: a scraper is by definition not the provided interface. So
  this isn't a "risk we could accept" — it's building on a documented ToS breach,
  which matters much more now that H3/H4 make Fandex a commercial site than it
  would have for a private hobby tool.
- **No official API exists and none is announced.** Checked their public dev
  updates through
  [March 2026](https://backloggd.medium.com/developer-update-march-2026-09248137756f)
  (accessed 2026-08-02): active development, but on bundles/editions/moderation —
  no API roadmap item at all.
- The two unofficial tools that exist are both immature and would be the whole
  dependency: [Qewertyy/Backloggd-API](https://github.com/Qewertyy/Backloggd-API)
  exposes a single generic `GET /user/:username` and documents no wishlist field,
  and [BearTS/backloggd-go](https://github.com/BearTS/backloggd-go) self-describes
  as "scraping their calls and scraping their website realtime" with ~14 commits
  and no documented endpoints.
- **"Is the wishlist publicly readable?" — still UNCONFIRMED**, and deliberately
  not chased further: Backloggd does have a per-game Wishlist status and profiles
  are social by design, but neither unofficial tool documents a wishlist endpoint,
  and settling it means fetching a real person's profile page, which isn't worth
  doing for a connector the ToS finding already parks. If the ToS position ever
  changes (an official API, or explicit scraping permission), this is the one
  thing left to check.

**Verdict: park until an official API exists.** Revisit if Backloggd announces
one — the data compatibility argument above is unchanged and still good, so this
is a blocked-on-access decision, not a rejected-on-merit one.

Note it adds no *metadata* we lack (IGDB already covers that) and overlaps the
video-game space Steam and RAWG already handle. The unique value is the user's
Backloggd wishlist/logs, nothing else.

---

### AniList — verdict: ⚠️ NEEDS NILS (a terms question, not a technical one)

Evaluated 2026-08-13. **Terms first, capabilities second** — that ordering is
what this file exists to enforce, and it is what parked both Backloggd and
Hardcover. AniList passes on capability and stalls on one clause.

**The deciding clause, quoted verbatim** ([Terms of Use](https://docs.anilist.co/guide/terms-of-use)):

> "Prohibited from use within competing noncomplementary services of the same
> nature. This includes, but is not limited to Anime/Manga list/tracker services."

Fandex **is** a list/tracker service. It is cross-medium rather than anime-specific,
so the honest reading turns entirely on "noncomplementary" and "of the same
nature", and that is a judgement about intent that the docs do not resolve. Two
defensible readings:

- *Complementary:* Fandex indexes games/movies/shows and would let a user pull
  their existing AniList list in alongside — it drives traffic to AniList and
  competes for nothing, since we would not host anime lists as a destination.
- *Same nature:* the moment anime entries are tracked in Fandex, it is a tracker
  containing anime, and the clause names trackers explicitly.

**This is the same shape of risk as TMDB/Trakt, and it interacts badly with them.**
H3's standing decision is to stay *under the radar* on the free TMDB/Trakt tiers
and specifically **not** to ask about commercial terms. AniList is the opposite
case: its terms invite contact (`contact@anilist.co`), and asking is the only way
to resolve the clause — but asking also creates a written record of what Fandex
is, which is exactly what the under-the-radar posture avoids elsewhere. **That
trade is Nils's call, not a session's.**

**Everything else is genuinely good** — this is not a Hardcover-style dead end:

| Question | Answer |
|---|---|
| Hosted, multi-user third-party client? | **Yes.** No allowlisting, no localhost-only restriction (Hardcover's blocker). |
| Commercial / donation-funded use? | **Free below $150/mo revenue**; above that needs a commercial licence via `contact@anilist.co`. Fandex is at €0, so the threshold is not live. |
| Rate limit | **90 req/min**, with `X-RateLimit-Limit` / `X-RateLimit-Remaining` headers; exceeding it costs a 1-minute timeout. Comfortable — and far better documented than most. |
| Third-party OAuth, shipped? | **Yes**, OAuth2 authorization-code grant. Not the "promised but not shipped" state that killed Hardcover. |
| App-level credential for metadata-only? | **Yes** — the public GraphQL endpoint serves media queries unauthenticated, so the *metadata* role needs no user login. This is the half that could ship independently of the tracker question. |
| Write mutations documented? | **Yes** — `SaveMediaListEntry` and friends are first-class in the docs, unlike Hardcover's entirely undocumented writes. |

**Two further prohibitions to design against if it ever proceeds:** using the API
"as a backup or data storage service" and "hoarding or mass collection of data"
are both explicitly banned. Fandex's thin-write/catalog-pool pattern — which
persists provider rows locally — is precisely the shape those clauses target, so
an AniList integration could **not** reuse `persistDiscoverItems` the way the
TMDB/RAWG paths do. That is a real architectural constraint, not a footnote.

**Recommended next step:** if Nils wants anime, the low-risk half is
**metadata-only** (unauthenticated queries, no user lists, no local hoarding),
which sidesteps the tracker clause entirely. The connectable/tracker half should
not start until the clause is resolved. **Do not open an adapter on the strength
of "the OAuth works" — that was the exact mistake Hardcover taught.**
