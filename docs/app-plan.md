# Fandex as an app and a website on Cloudflare: the plan

_Review draft 2, 2026-10-04. The illustrated version with the diagrams and charts is the artifact
at https://claude.ai/artifact/BJVFj7tRaqVAWzsFTtecgv (private to Nils). This file is the repo copy
so the next session does not have to reconstruct it. Not yet decided: see "Open decisions"._

## Why

The Railway bill was ~€11/month for one real user, and 85% of it was memory held around the clock
by a server whose main job had become serving crawlers. The 2026-10-03 research (13 agents, every
claim skeptic-checked; incident notes in the memory file `zero-cost-hosting-options`) found no free
host that runs the app as built: every free tier lacks the always-on process with a local SQLite
file the code assumes, or is Oracle, which can take the VM away under three different rules. The
only architecture that reaches ~zero AND keeps the personal features is the one below. It is
justified by wanting a native app, not by the money: a home box runs the existing code for one
weekend.

## The shape

Three places code runs: the client (Android app, or the same code in a browser), a Cloudflare
Worker, and the providers. One place shared data lives: D1 (hosted SQLite), holding the catalog
AND the user tables.

| Piece | Role | Monthly |
|---|---|--:|
| Cloudflare Worker (Free) | The catalog API for the app; the account layer (sign-in, sessions, your rows, export, erasure, counters); the renderer of the public web pages; the IGDB and Steam proxy (the only place those secrets live); a daily cron refreshing rows older than 150 days. Limits: 100k requests/day, 10 ms CPU per request, 5 cron triggers. | €0 |
| Cloudflare D1 (Free, EU jurisdiction) | Catalog (~11 MB without provider blobs; 4,507 acted-on items of 15,022) plus users, identities, item state, prefs, hidden items, daily counters. Cap 500 MB. 100k row writes/day is a HARD daily stop. | €0 |
| Cloudflare R2 (Free) | Nightly D1 export. Also where the Litestream replica moves FIRST, before anything on Railway is touched. | €0 |
| Cloudflare static assets | Web client bundle, `/.well-known/assetlinks.json`, the Steam/Trakt callback page. Free and unlimited; not counted against the Worker. | €0 |
| Domain fandex.org | Trakt's https redirect, Steam's return URL, App Links, the privacy policy Play requires. Paid to 2027-07-14. | ≈€1.25 |
| Railway, Litestream, Node server | Gone. | €0 (was ≈€11) |

### Per-provider rules, checked against their own terms 2026-10-03

- **TMDB**: the key MAY ship in the app (no secrecy clause; staff: "putting it client side is
  fine"; limit per IP). Called from the client; the Worker also calls it for shared rows. Every
  stored row must be refreshed or dropped within 6 months. Free tier is non-commercial.
- **Trakt**: fully device-direct. Since 2026-10-01 `client_secret` is deprecated and optional on
  every `/oauth` endpoint including the device-token one; PKCE with an https redirect (verified App
  Link). 500 GET / 5 min per user. Nothing Fandex uses is VIP-only. Caching for your users'
  features is expressly welcome; mirroring Trakt into a catalog is not.
- **IGDB**: Worker only. The Twitch client secret and app token may never reach users; IGDB rejects
  user tokens and tells you to proxy. 4 rps per client id, app-wide. The 24-hour Twitch cache
  clause vs IGDB's "store and serve" FAQ is unresolved and moves with us unchanged.
- **Steam**: Worker only for the library (`GetOwnedGames` needs the key, which "must not be
  distributed within your application in any way"). Login is OpenID with an https `return_to` on
  fandex.org; store `appdetails` is keyless but undocumented.
- **Google**: stays as a sign-in. Android Sign in with Google (Web client id, no secret) gives an
  ID token; the Worker verifies it against Google's public keys and issues a session. Same in a
  browser via Google Identity Services.
- **Discord, Letterboxd**: dropped. CSV import stays, parsed on the device and pushed to Trakt.

### Why accounts stay

Trakt holds nothing about games, and IGDB has no user API. Game ratings and wishlists exist only
in Fandex's own table today and would be stuck on one device without accounts. So per-user state
keeps a home we own: user tables in D1, written only by the Worker for a signed-in session. That
brings back Google as a sign-in, cross-device and web parity, export, counters, AND the duties:
erasure, export, a privacy policy naming accounts, and the schema rule that a `user_id` column is
what makes a table personal.

### "Updated by the users", the one safe form

Clients send `(provider, type, id)` or `(provider, month)`. The Worker looks in D1, fetches from
the provider on a miss with ITS credentials, writes, returns. Clients never supply catalog rows.
Users may write their OWN rows under their session. A global daily fetch cap (one counter row)
protects the 100k-writes/day budget, which fails hard since 2026-09-01.

## Where each feature runs

| Feature | Client | Worker + D1 | Provider |
|---|---|---|---|
| Release calendar | renders, filters | serves months; fetches a month on first request; cron | TMDB, IGDB |
| Up Next | from Trakt progress | – | Trakt |
| Library / watchlist | pulls Trakt, writes result to your rows | keeps your rows; Steam owned games | Trakt, Steam |
| Ratings | writes Trakt + TMDB directly, and your rows | keeps your rows | Trakt, TMDB |
| Episode tracking | client ↔ Trakt | – | Trakt |
| Fandex Score | over the on-device catalog copy (~4.5k pool, ~12 MB, <1 s/pass) | serves DERIVED facets, never raw blobs; pool = the shared catalog | – |
| Search | on-device catalog first; TMDB direct | IGDB search | TMDB, IGDB |
| Item detail | from the D1 row | fills a miss on demand (the old `/r/` job) | TMDB, IGDB, Steam |
| Discover | TMDB discover direct | IGDB browse | TMDB, IGDB |
| Insights | client | – | – |
| Hidden items, prefs | applied locally | stored in your rows | – |
| Sign-in | Google / Trakt / Steam produce a token | verifies, finds or creates the account, issues a session; three-outcome rule on an existing identity | Google, Trakt, Steam |
| Franchises, IP aliases | shows them | D1 + cron sweep | TMDB, IGDB, Wikidata |
| Taxonomy admin | later, on the web client | tables in D1, CLI-edited until then | – |
| Public pages, SEO | – | rendered from D1 (see below) | – |
| Accounts, export, erasure | buttons | schema-derived, ported | – |
| Telemetry | same-origin beacon | daily counters, no user id (~5k of 100k writes/day at today's crawler volume) | – |

## The website

Two layers, one Worker. Public layer: item, person, tag, studio and calendar pages, crawlable, a
URL for everything (App Links open the app when installed). Personal layer: the app's own web
build served as static files, hydrating on the public HTML.

**One rule: the same React component produces the crawlable HTML and the interactive page. No
separate template.** What is open is WHERE React renders the public HTML, because the free Worker
kills a request past 10 ms CPU (error 1102, an error page, not a slow one) and a Worker cannot read
its remaining budget, so "try React, fall back if slow" is not buildable. Three single-source routes:

| Route | Monthly | Catch |
|---|--:|---|
| React on the Worker, free | €0 | only if the heaviest item page renders well under 10 ms WITH margin (isolate CPU accounting accumulates); cold pages, which crawlers request, are the ones that fail |
| React on the Worker, paid | $5 flat | 30 s CPU/request, limits rise by orders of magnitude; the constraint disappears; no memory metering |
| React in a daily Pages build | €0 | new items get a page the next day; 20,000-file cap (~9,300 files today); no CPU limit |

First task of phase 3 is the measurement: the real item page's React render on a free Worker,
timed on the twenty heaviest items. Under ~5 ms on all of them → free Worker. Otherwise → the
daily build by default, with the $5 plan as the upgrade for the day the lag matters. Only one route
is built.

## Effort (working days, from the repo's line counts)

UI to rebuild: ~17,800 lines TSX in any stack (minimal scope ~7,500). `src/lib`: 11.3k–14.8k lines
are dependency-free TypeScript that port verbatim to React Native; ~10.3k SQL-bound lines re-plumb
onto expo-sqlite. Kotlin and Flutter reuse only the type shapes, and with the website in the plan
they mean building the UI twice (the web client is Expo's web target for free).

| Stack | Minimal app | Parity |
|---|--:|--:|
| React Native / Expo | 18–30 | 60–100 |
| Flutter | 30–50 | 100–160 |
| Kotlin + Compose | 35–55 | 120–180 |

## Phases

0. **Make the data safe (1 day, required in every scenario).** Litestream → free R2 bucket, re-run
   the restore drill. The only backup today is a bucket provisioned THROUGH Railway; cancelling the
   plan deletes volume and backup together. Then Railway: public catalog off ($5 floor) or off.
1. **Worker and D1 with accounts (10–15 days).** Catalog schema seeded from a prod export; user
   schema seeded from the current rows; endpoints (item, month, delta, IGDB/Steam proxy, sign-in
   for Google/Trakt/Steam, sessions, your rows, export, erasure); cron; fetch cap; nightly R2
   export; D1 in the EU; tests for the write paths and erasure. Reuses normalisers, merge, facets,
   session and account-merge logic.
2. **Minimal app (18–30 days in Expo).** Google or Trakt sign-in, catalog download and delta sync,
   calendar, library and watchlist, Up Next, item detail, rate, search, and the Kotlin Up Next
   widget with tick-to-watched. Sideloaded; no Play work.
3. **Website (10–20 days).** The measurement first; then public layer with JSON-LD, sitemap,
   robots, caching, the page rate limit, the beacon; personal layer as the web build; App Links.
4. **Switch over (1 day).** A week of daily use, one copy of the old DB in R2, delete Railway,
   point fandex.org at Cloudflare, rewrite the privacy policy (Cloudflare as host and processor, D1
   in the EU, accounts, three sign-ins).
5. **Parity (40–125 days).** Score explainer, Up Next and episodes, Insights, Discover filters,
   platform and media-type prefs, import, franchise rail, taxonomy admin on the web client.
6. **Google Play, if wanted (calendar time).** Organisation account or 12 testers for 14 days;
   Data safety; attribution screens; account deletion in the app.

## Decisions (Nils, 2026-10-04, all as recommended)

- **Stack: Expo, with the home-screen widget in Kotlin.** The widget is a requirement: tick
  episodes watched in Up Next from the home screen. It is native code in every stack (Glance),
  reads the on-device SQLite the app writes, and posts to Trakt directly. Expo with custom
  native code means Gradle dev builds rather than Expo Go.
- **Steam: kept, in phase 5.** Not in the minimal app.
- **Trakt tokens: on the device and in the browser.** Each client syncs Trakt itself and writes
  the result to the user's rows. No background sync with the app closed; the widget covers the
  case that matters.
- **Railway during the build: the $5 floor, public catalog off.** `PUBLIC_CATALOG=0`,
  `BACKFILL_ENABLED=0`, `FACET_SWEEP_ENABLED=0` set on Railway 2026-10-04.
- **IGDB licence: email partner@igdb.com now.**

Still needed from Nils: R2 enabled on his Cloudflare account and a read/write token for a bucket
`fandex-litestream` (step 0), and the IGDB email sent.

## Rules that carry over unchanged

The prune invariant (a failed pull deletes nothing) moves to the client's sync. Identity is
`(source, source_id, media_type)`. A per-user display preference never reaches a pull. Erasure is
schema-derived by the literal `user_id` column; export is written by hand. No aggregate rating in
the JSON-LD; only swept facets in the sitemap. Counters, not events, and no `user_id`. The beacon
gates on request shape, not UA. Never cache an empty provider answer without a short TTL.
