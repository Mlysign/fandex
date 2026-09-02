# Fandex: Task Tracker

> **This file holds only what is still open.** Settled calls and standing constraints → [docs/decisions.md](docs/decisions.md). Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it; never read it end to end). One-page state → [STATUS.md](STATUS.md).
>
> ⚠️ **A decision is not a task and a constraint is not a task.** Both kept accumulating here and crowding out the actual work — 280 lines on 2026-09-02, of which most was already closed. If an entry has no next action, it belongs in one of the two files above.

- **Legend:** ⬜ not started · 🔵 in progress / needs input · ⏸️ blocked · ✅ done
- **Convention:** an entry is 2 to 4 sentences plus a commit hash once done. The full story (root cause, files touched, verification) belongs in the commit message, not here. **When a section is fully done, move it to the archive the same session.** This file blew past its 200-line CI guard twice (441 lines, then 374) from skipping that step.

---

## ⚠️ Needs Nils: this is the whole list

Three items. Everything else in this file is work I can do without him, and every settled call moved to [docs/decisions.md](docs/decisions.md).

1. **Android TWA (P15/P16): ⏸️ PAUSED until the developer account is a BUSINESS account.** (Nils, 2026-08-23.) The package is built and sideloaded on the Pixel 8 with no address bar, and the Play Console entry exists (name `Fandex`, package `org.fandex.twa`, Free). ⚠️ **The 12-testers/14-days gate applies to PERSONAL accounts only**, so a closed test now is likely throwaway work: upgrade first, then re-check whether the gate applies at all. Remaining steps, and the trap that Google re-signs the store build so `TWA_CERT_FINGERPRINT` needs a SECOND fingerprint appended → [docs/twa-play-store.md](docs/twa-play-store.md).

2. **⬜ Should the collapsed type filter stay collapsed on DESKTOP?** (2026-09-02.) SM53 shipped it collapsed everywhere, which is the consistency he asked for, but it costs a tap on Home and Discover where vertical space is not scarce. One line to gate on a breakpoint. Only worth changing if it annoys him in use.

3. **⬜ Reveal the Discord client secret and set `DISCORD_CLIENT_SECRET`** in `.env` and in Railway. (2026-09-02.) The app now EXISTS: name `Fandex`, **client id `1544627875955744818`** (public), with both redirect URIs saved (`https://fandex.org/api/auth/discord/callback` and the localhost one for dev). The secret is the only piece left and it stays his — the code reads it from the environment, so it never has to pass through a session here. Press **Reset Secret** on the app's OAuth2 page to get one. → the Discord entry under "Still open elsewhere".


## H3: Monetization 🔵 ads-first since 2026-08-19

**Goal:** revenue covers upkeep (Railway, domain, third-party APIs).

**⚠️ THE PLAN CHANGED 2026-08-19.** Nils's call, after a per-1,000-user revenue model: **go live → wait for traction → ads → premium (ad-free + extras)**. Affiliate is **demoted, not cancelled**; the code stays built and dark. Full reasoning → [docs/monetization-go-live.md](docs/monetization-go-live.md), the "DIRECTION CHANGED" section.

The three findings that decided it, so nobody re-derives them:
- **Per 1,000 monthly actives: ads ~€150, premium ~€60, donations ~€14, affiliate ~€3.** Affiliate is last by 20 to 50 times.
- **Fandex is past-tense.** People log what they already played or watched, so a buy link on an item already in a library arrives after the purchase decision. Only the **wishlist** and the **calendar** are pre-purchase surfaces.
- **Affiliate is the only method that cannot clear its own cliff.** Covering upkeep once TMDB's $149/mo commercial tier applies needs ~1,000 users on ads, ~2,300 on premium, and **~45,000 on affiliate**.

**The economics pivot on TMDB, not on hosting.** Upkeep is small (Railway Hobby $5/mo + usage, domain ~€10/yr, all APIs currently €0), but TMDB's free API is **non-commercial only** and commercial use is **$149/mo**. So "commercial" multiplies upkeep ~10× overnight; any paid model must clear ~$155/mo before netting a cent. Trakt requires case-by-case approval for monetizing apps. ⚠️ **RAWG no longer figures in this at all** — it was retired as a data provider 2026-09-02, so the "$298/mo commercial minimum" figure elsewhere (TMDB $149 + RAWG $149) is now TMDB alone. **Donations are the gray zone**: TMDB doesn't say whether donation-funded counts as commercial.

**Consciously accepted risk:** Fandex monetizes on the free TMDB/Trakt tiers. Failure mode is **API-key revocation without notice**, not a fine.

**Built 2026-08-03: H3.3 ✅ donations live · H3.4 ✅ affiliate DARK behind `MONETIZATION_ENABLED` · H3.9 ✅ go-live checklist.** → grep the archive for `H3 monetization v1`. **The one thing to know before touching any of it:** the catalog's store rows are Steam/PSN/GOG/Xbox/Nintendo/Epic/itch.io and only **GOG** is affiliate-capable, so `affiliate.ts` has *two* mechanisms, a rewriter for GOG-shaped links and `buildBuyLinks()` synthesizing per-title search links. → [[monetization-h3]]

**H3.8 gates, approved 2026-08-17 and instrumented 2026-08-19** (`/dev/analytics` measures both directly):
- **Ads → 10,000 pageviews/mo** (Monumetric's stated minimum). A better-RPM tier exists at 50k+ pv (Freestar/Mediavine, $15–40+ vs Monumetric's $10–20). Not a second gate, just worth re-checking which network fits.
- **Freemium → 3,500 sustained weekly actives.** The old "roughly 1k+" napkin figure never netted out TMDB's $149/mo license. Actives needed to clear **just** the license (≈€137, no margin): 2%/1€ → 6,850 · 2%/2€ → 3,425 · 5%/1€ → 2,740 · 5%/2€ → 1,370. Even the best-case corner is above 1k. 3,500 clears it with real margin at a *conservative* 3%/1.50€.
- ⚠️ **A client beacon does NOT exclude crawlers**, whatever this line used to say: the big ones render the page and POST to it. They are filtered by user agent, and since 2026-08-31 the dashboard also skips the days before that filter shipped, so **the ads gate reads 4% and not 62%**. Both numbers were of the same two counters. Right population for an ads decision either way, wrong one for SEO (use Search Console). → [[telemetry-self-hosted]]
- **The WAU meter is `users.last_seen_at`**, stamped in `getSession()` once per user per UTC day. The action-based union over `user_library`/`user_watchlist`/`user_item_state` stays as the conservative cross-check; it counts only users who took a WRITE action, so a pure browser is captured by nothing in this schema. Both live in `src/lib/telemetry.ts` (`userMetrics`) and `src/lib/userAnalytics.ts` — read them there rather than from a copy here.

**If affiliate is ever revived:** sign up → set the env vars → flip `MONETIZATION_ENABLED` → run the post-go-live cookie check. The runbook is still accurate and still in the go-live doc; only its priority changed.

---

## Still open elsewhere

### Added 2026-09-02 (Nils)

- **⬜ Discord as a login provider.** Identity-only: Discord holds no library, so it is the Google
  shape, not the Trakt shape. Three registration points carry the invariants — extend
  `AuthProvider` (`src/types/index.ts`) and **NOT `Source`**, which would make Discord legal as a
  store link, a release date and an `/api/sync` target; add `"discord"` to `IDENTITY_ONLY_PROVIDERS`
  (`syncClient.ts`) or `staleProviders()` fires a doomed sync on every `/library` load; render the
  mark through `<BrandGlyph source="discord" />` in the UI's text colour, because **Google is the
  only brand-colour exception** and a coloured Discord mark breaks the site-wide rule. Google's own
  routes are 75 lines total, so the build is small; the surfaces are `SignInDialog` and Settings →
  "Add login method". ✅ **The Discord app EXISTS as of 2026-09-02**: client id
  `1544627875955744818`, both redirect URIs saved (prod + localhost), developer ToS accepted. Only
  `DISCORD_CLIENT_SECRET` is outstanding and it is Nils's to set (Needs Nils #3) — the code reads
  both credentials from the environment, so the secret never passes through a session here. The
  integration itself is still to write and can be merged dark before the secret lands.

- **🔵 Search Console: 4,089 of 4,090 sitemap URLs are "Discovered – currently not indexed", 1 is
  indexed.** (Breakdown from Nils, 2026-09-02.) **ONE reason, and it is the crawl-priority bucket,
  not the quality one**: Google has found these URLs and has not fetched them. So there is nothing
  in the pages to fix — verified independently against live prod, where `sitemap.xml` answers 200
  with 4,341 URLs (4,334 in the canonical 2-segment shape, so no redirect chains) and a Googlebot-UA
  fetch of `/movie/the-innocents` returns 200, `index, follow`, a self-referencing canonical and 29
  internal links. ⚠️ **"Crawled – currently not indexed" is the bucket that would mean thin content,
  and it is EMPTY.** Do not go thickening pages; that is answering a question nobody asked.
  What actually moves this: **external links** (the domain is ~2 weeks old with near-zero authority,
  and crawl budget is rationed to unproven sites), then internal link depth. ⚠️ Dumping 4,341 URLs
  at once on a new domain is itself part of the signal. **Mostly it is time.** →
  [docs/seo.md](docs/seo.md) ⚠️ that file still says 2,037 URLs; it is 4,341.

  **The ranked plan, after Nils asked "would a link from nilsmlynarek.eu be enough?" (2026-09-02).**
  Short answer no, and the goal itself is wrong: ⚠️ **"all 4,341 indexed" is not achievable and not
  worth chasing.** Item pages are provider-derived metadata that appears on dozens of other sites,
  so once Google does crawl them many will land in "Crawled – currently not indexed" on merit. The
  target is the pages that can actually rank: calendar months, facet pages, and items where we add
  something. In order of what actually moves the needle:
  1. **External links.** nilsmlynarek.eu is real, live and topically relevant (a game developer's
     portfolio), so it is worth adding and costs nothing. But it is a small static site with **no
     robots.txt, no sitemap.xml and one outbound link (LinkedIn)**, so its own authority is thin.
     Treat it as one nudge, not a fix.
  2. **Places with real traffic**: Show HN, Product Hunt, the subreddits for the trackers we import
     from. Mostly `nofollow`, so no PageRank, but they get the domain crawled and can earn real
     editorial links, which is the thing that compounds.
  3. **Internal link depth**, the only lever that is ours. "Discovered, not crawled" usually means a
     URL is known ONLY from the sitemap with little pointing at it. Fixing the facet under-linking
     (open, below) and then putting facet pages in the sitemap deepens the graph into the item
     pages, which is exactly the shape that raises crawl priority.
  4. **A smaller sitemap.** 4,341 URLs at a uniform 0.7 priority tells Google nothing about which
     matter. Speculative, cheap, reversible.


### Older

- **⬜ Desktop mockups for the filter panel**, once the mobile one has been used in anger.

- **⬜ Nothing uses the media-type setting to SPEND less.** Three places could, in value order:
  `/api/discover?q=` still fetches disabled types (the only real provider-call saving, since search
  is uncached and games are 2 of its 4 calls); `/api/library` and `/api/calendar` already take
  `?type=` and could default it from the setting, cutting a 1,942-item payload instead of filtering
  it in the browser; and the Discover fan-out could skip a disabled section. ⚠️ Only the first saves
  QUOTA — `_pageCache` keys carry no userId, so another visitor's games request in the same
  15-minute window pays anyway.

- **⬜ The list payload carries ~4.7 MB that only the DETAIL page reads.** `/api/library`, 1,943
  items: `cast` 1,183 KB · `description` 1,014 KB · `images` 966 KB · `storeLinks` 853 KB ·
  `links` 697 KB — 54%, and `MediaCardItem` names none of them. `tags` + `keywords` (552 KB) lost
  their last client reader when `itemFacetIds` went. ⚠️ **Below compression, and riskier**: the
  2026-07-30 audit kept cast/images/description deliberately, and dropping a field from a payload
  two routes and one component share is the exact shape of the bug this list keeps recording.
  Verify every consumer on BOTH routes first.

- **`/library` + `/wishlist` + `/settings` dead under `next dev`: DEV ONLY, and the fix is DECIDED.** ⚠️ **`/settings` joined the list 2026-08-27**, with a worse symptom: it has no loading state, so the dead tree renders the SIGNED-IN chrome with every field empty (four "Connect" buttons, "Watchlist items 0") for an account that has all four connected. That reads as data loss, not as a dead page. **Nils decided 2026-08-17: option 1, leave it.** Do not restructure `MyStuffView`. **Re-test on the next `next` bump**; a Dependabot PR is the moment. Diagnostic: `Object.keys(document.querySelector("main")).some(k => k.startsWith("__reactFiber"))` false on `<main>` but true on `body` means an unhydrated subtree, not a slow fetch. ⚠️ **Re-check first**: `/wishlist` hydrated normally under `next dev` on 2026-08-18, and `MyStuffView` changed that session, so it may be fixed or intermittent. → grep the archive for `library + wishlist dead under next dev`.

- **✅ Facet under-linking is FIXED for the 56 facets `/` links** (2026-09-02, Nils asked for it).
  Measured before: **876 of 2,691 rendered items linkable, 33%** (`/tag/casual` 12/60, `/tag/arcade`
  13/60, `/tag/board-games` 0/5). After, on the anonymous path: **419/419 on the 8 facets of one
  run.** `src/lib/facetSnapshot.ts` sweeps a bounded set daily off the request path with
  `persist: true`, the shape the home and calendar snapshots already use, chosen over relaxing PR14.
  ⚠️ No sitemap or scoring impact: the rows are `browsed = 1`, so outside `POOL_WHERE` by
  construction. ⚠️ The prune pin is real: **177 of 419 rows would have been deleted by the next boot
  prune** without it. → [docs/seo.md](docs/seo.md)
  - **✅ The swept facets are in the sitemap** (2026-09-02, Nils said go). `sitemapFacets()` returns
    rows from `facet_snapshot`, so a facet is advertised exactly while it is a good page and drops
    out when it stops being one; the people half rotates with the rail. ⚠️ **Only the swept ones.**
    The original objection still holds for the rest: enumerating thousands of `force-dynamic`
    fan-out URLs invites the crawl that grew `facet_page_cache` to 222 MB. **Do not widen the
    sitemap without widening the sweep.**
  - **✅ The three dead genre chips are gone from `/`** (2026-09-02). Root cause was **RAWG's
    retirement the day before**: `indie`, `massively-multiplayer` and `platformer` come from
    `RAWG_GENRES`, and nothing resolves them now. ⚠️ Dropping that map would have stripped every
    game genre (strategy, puzzle, arcade, casual, sports all still resolve via IGDB), so the filter
    is the sweep's own measurement instead. ⚠️ The sweep targets `hubGenreCandidates()`, not
    `hubGenres()`, or the chip would oscillate. Verified on the page: 36 chips → 33.

- **Fandex Score `priorStrength` (C=5) + per-role class weights may want re-tuning** now the aggregate is a raw sum rather than a damped mean. **Time-gated**: revisit after a few weeks of real scores under the new formula. ⚠️ **Re-read this after 2026-08-22.** The class weights now decide WHICH facets are selected, not just how much a selected one counts, so a re-tune is a bigger lever than when this was written, and **any measurement taken before that date describes the old selection**.

- **The 2026-08-23 optimization sweep is DONE, all six items.** What is left, and why the WAL is deliberately NOT being reclaimed → [docs/optimization-plan.md](docs/optimization-plan.md) §5.

- **Platform integrations: the open questions were answered 2026-08-23.** What survives as standing context: AniList is **connector-blocked** on a terms clause barring "competing non-complementary services… anime and manga list or tracker services", while its metadata half is unaffected and could ship alone; books (Hardcover + Open Library) stay ⏸️ **postponed as a media type, 2026-08-03**. Capability reference → [PLATFORMS.md](PLATFORMS.md).
  - **Hardcover ⏸️ PARKED**, same call as Backloggd (Nils, 2026-08-03). The deciding fact was the usage terms, not OAuth: the docs call the API *"only for offline use at this time"*, reachable *"from localhost or APIs"*, with site allowlisting *"a way down the line"*. A hosted multi-user site is the case they haven't provided for. Secondary: no third-party OAuth (promised, not shipped), tokens expire on a **shared Jan 1 reset** so every user breaks the same day, no app-level credential, and the write mutations are undocumented. → grep the archive for `platform deep dives`.
  - **The media-type cost is measured** and lives in the archive under `What adding a media type actually costs`. Two things worth knowing before any future type proposal: **no migration is needed** (`media_items.type` is plain TEXT, no CHECK constraint), and **`tsc` won't help you**: only one `Record<MediaType, …>` exists, so adding a union member compiles clean while silently doing nothing at the other ~9 enumeration points.

- **Two light-theme contrast gaps stay deliberately unfixed and are Nils's to call** (they change the design, not a value): `--color-accent-hover` is **3.47:1**, accent text on `--color-surface-inset` is **4.32:1**. No light-theme toggle is wired, so neither is user-visible yet.

---

## Closed: pointers only

Fully written up in [docs/archive/history.md](docs/archive/history.md). **Grep it; don't read it.**

- **Backups** ✅ proven restorable twice (2026-08-20, 2026-08-23), `ALL TABLES MATCH` on all eight tables. The two live rules are in [STATUS.md](STATUS.md) and [AGENTS.md](AGENTS.md). → grep `restore drill`.
- **PL: the platform capability sweep** ✅ all six shipped 2026-08-23. The import's design → [docs/letterboxd-import.md](docs/letterboxd-import.md) (read it before touching `src/lib/import/`); the games two-provider scope split → [AGENTS.md](AGENTS.md). → grep `PL: the platform capability sweep`.
- **Legal pages, all `TODO(...)` resolved** ✅ 2026-08-17. **The rule that outlives it: strings in `src/lib/legal/content/{de,en}/*.ts` `body:` arrays RENDER to users; they are not code comments.** → grep `TODO(H4.3)`.
- **Cache tables dropped** ✅ 2026-08-17, migration 16. `user_library` / `user_watchlist` are VIEWS now. **Two traps live on in migration 16's comment and in `src/lib/cacheViews.ts`.** → grep `migration 16` · [[cache-tables-are-views]]
- **SM39, the Fandex Score range** ✅ CLOSED 2026-08-17, relabelled rather than re-tuned. → grep `SM39`.
- **Franchise / IP as a scoring factor** ✅ CLOSED 2026-08-17. `ip` stays at **3**. → grep `Franchise / IP`.
- **Advanced search's Fandex Score (SM43–SM48)** ✅ FULLY CLOSED 2026-08-17. → grep `SM44 heal budget`.
- **PR17 post-outage verification** ✅ 2026-08-12. Two corrected beliefs before touching backups: an **unchanged** Litestream generation is the HEALTHY signal, and `wal-truncate` reclaims nothing while Litestream runs. → grep `PR17`.
- **Smoke test 2026-08-12 (11th run)** ✅ SM38–SM42 fixed. → grep `Smoke test 2026-08-12 11th run`.
- Earlier sessions (G#/SM34–37, the eight closed questions, `P18 streaming links`, `H3 monetization v1`) are archived too.
