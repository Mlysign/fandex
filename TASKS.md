# Fandex: Task Tracker

> **This file holds only what is still open.** Settled calls and standing constraints → [docs/decisions.md](docs/decisions.md). Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it; never read it end to end). One-page state → [STATUS.md](STATUS.md).
>
> ⚠️ **A decision is not a task and a constraint is not a task.** Both kept accumulating here and crowding out the actual work — 280 lines on 2026-09-02, of which most was already closed. If an entry has no next action, it belongs in one of the two files above.

- **Legend:** ⬜ not started · 🔵 in progress / needs input · ⏸️ blocked · ✅ done
- **Convention:** an entry is 2 to 4 sentences plus a commit hash once done. The full story (root cause, files touched, verification) belongs in the commit message, not here. **When a section is fully done, move it to the archive the same session.** This file blew past its 200-line CI guard twice (441 lines, then 374) from skipping that step.

---

## ⚠️ Needs Nils: this is the whole list

Six items. Everything else in this file is work I can do without him, and every settled call moved to [docs/decisions.md](docs/decisions.md).

0. **🔵 APP + WEBSITE ON CLOUDFLARE: the website is online (2026-10-10). Four things need Nils.** The plan is [docs/app-plan.md](docs/app-plan.md); the references are [docs/website.md](docs/website.md), [docs/worker.md](docs/worker.md) and [docs/app.md](docs/app.md).
   - **(a) Keep using the app and the site, and say what is off.** Fixed from his three passes on 2026-10-10: the episode section on title pages (now with dates and a details sheet), Settings, "Available on", the filter button under Android's bar, the widget's look, Up next listing unscheduled episodes, facet pages with one title, the poster under the trailer. He confirmed a rating, an episode tick and a default-types change work. **Asked of him and not answered yet:** a tick on the widget, a studio and a tag page he knows (their titles come from TMDB by name, and a wrong match is possible), the episode sheet on the phone. **Never run for real by anybody: Disconnect, Download, Delete, a change of country or platforms, any write on `/dev/scoring`.**
   - **(b) ✅ Privacy policy read by Nils 2026-10-10, no objection.** Was: read the privacy policy (`/legal/en/privacy`, `/legal/de/privacy`). Rewritten 2026-10-10 for Cloudflare, Trakt-only sign-in, what stays on the device, the YouTube embed, and export and deletion by email. Terms and Contact lost their references to the old Settings page. It is his name on it.
   - **(c) ✅ Done 2026-10-10, by me at his request:** the 30-day expiry rule `expire-d1-exports` is on `fandex-backups` for the `d1/` prefix only. Was: **(c) One command, before 2026-11-03**, which makes the policy's "nightly copies are kept for 30 days" true. Today the nightly exports are never deleted, so a deleted account would stay in them. It only touches `d1/`; the `railway/` snapshots are not affected: `cd worker && npx wrangler r2 bucket lifecycle add fandex-backups expire-d1-exports d1/ --expire-days 30 --jurisdiction eu`. The syntax was checked against Wrangler's help; the command itself was not run, because a standing rule that deletes his backups is his to switch on.
   - **(d) The IGDB licence email** to partner@igdb.com. A draft is in his Gmail drafts.
   - **Optional:** a Cloudflare API token as the repository secret `CLOUDFLARE_API_TOKEN`, which is what a daily rebuild in GitHub Actions needs (the workflow is not written). Until then the site changes when `node mobile/web/publish.mjs` is run. Also optional: resubmit `sitemap.xml` in Search Console, and delete the two dead `_railway-verify` TXT records and the empty R2 bucket `fandex-litestream`.
   - **Next, mine, in order** ([docs/app-parity.md](docs/app-parity.md), "The order from here"): Settings' rest; static facet pages and the related rails on static item pages; a studio's and a tag's games on facet pages (needs a Worker route). Live since 2026-10-11 and never pressed by anybody: Accept, Deny and Add on the Review section of `/dev/scoring` (7 cards), and "Hide from suggestions" on a title's page.
   - **Still owed, mine, after 2026-10-12:** run the insights command from docs/worker.md's table. It reads a rolling 24 hours, so the two count queries only leave the top of it a day after the 2026-10-11 deploy.
   - **Waiting on him:** the widget's look and feel, which he wants to go through together; do not redesign it unasked. Google sign-in and joining two accounts are at the bottom of docs/app.md.

1. **🔴 ROTATE TWO API KEYS. Burned 2026-09-03, and this one is not optional.** ⚠️ **Since 2026-10-04 the TMDB key is in a THIRD place: the Cloudflare Worker.** After rotating it, update `.env` and run `node worker/scripts/push-secrets.mjs`, or the Worker's catalog fetches start answering 401. Looking for the prod DB path I ran `railway ssh "env | grep -i -E 'db|data|sqlite'"`, and it printed `TMDB_API_KEY`, `OMDB_API_KEY` and `STEAM_API_KEY` in full to the session transcript. Two of them match on "db"; the filter was never a safeguard, the command was the mistake. **TMDB** → rotate at themoviedb.org/settings/api, update on Railway, then **redeploy** (it is read at runtime, but a redeploy is the safe default). **Steam** → rotate at steamcommunity.com/dev/apikey, update on Railway. ✅ **OMDb is DONE** — `railway variable delete OMDB_API_KEY`, 2026-09-03, after confirming the only reader is the local `scripts/probe-apis.mjs` and that `noOmdb.test.ts` fails if it returns to `src/`. Railway did not restart the container for it (uptime kept climbing), so the running process still holds the old value until the next deploy; nothing reads it either way. The rule is now in [[railway-cli-and-tool-sandbox]]: never run `env` on the prod box, filtered or not.

2. **Android TWA (P15/P16): ⏸️ PAUSED until the developer account is a BUSINESS account.** (Nils, 2026-08-23.) The package is built and sideloaded on the Pixel 8 with no address bar, and the Play Console entry exists (name `Fandex`, package `org.fandex.twa`, Free). ⚠️ **The 12-testers/14-days gate applies to PERSONAL accounts only**, so a closed test now is likely throwaway work: upgrade first, then re-check whether the gate applies at all. Remaining steps, and the trap that Google re-signs the store build so `TWA_CERT_FINGERPRINT` needs a SECOND fingerprint appended → [docs/twa-play-store.md](docs/twa-play-store.md).

3. **⬜ Should the collapsed type filter stay collapsed on DESKTOP?** (2026-09-02.) SM53 shipped it collapsed everywhere, which is the consistency he asked for, but it costs a tap on Home and Discover where vertical space is not scarce. One line to gate on a breakpoint. Only worth changing if it annoys him in use.

4. **⬜ Decide whether to rotate `DISCORD_CLIENT_SECRET`. His call, not a blocker.** (2026-09-02.) ⚠️ **The secret was printed to a session transcript** while repairing a `.env` line I corrupted: the file had no trailing newline, so an append landed on the end of the secret's value and reading it back to fix it exposed it. The file is repaired and correct. Blast radius, measured: it is in **exactly one local file**, `~/.claude/projects/…/524438af-….jsonl`, and **not** in git history, the repo, or any memory file. So the realistic risk is low and rotation is a 60-second job — **Reset Secret** on the app's OAuth2 page, then update `.env` and Railway. Deleting that one file is the alternative he weighed; it does not undo the transmission. ⚠️ The var **rename is DONE** (I did it on Railway: `NEXT_PUBLIC_DISCORD_CLIENT_ID`, mirroring Google).

5. **⬜ Should the LISTS show a film's date in your country?** (2026-10-10.) The calendar, Home and the item page follow the country setting. Discover, Wishlist, Library, the facet pages and Profile's "coming up" show the one worldwide date the device holds, and 136 of 200 pool films open on another day in Germany (mostly one to three days later, sometimes months). The cheap route is the calendar's: ask `POST /v1/catalog/release-dates` for the films on screen. The thorough one puts a per-country date map in the vector, which re-derives the pool and re-syncs every device. The corrected `release-dates` query was measured on live D1 on 2026-10-11 (9 to 20 rows a film, [docs/worker.md](docs/worker.md)), so the cheap route is priced: a screen of 60 films is about a thousand rows read.

## H3: Monetization 🔵 ads-first, waiting on traffic

**Nothing to do until a gate is hit, and both gates are traffic.** Ads at **10,000 pageviews/mo**,
freemium at **3,500 sustained weekly actives**; `/dev/analytics` measures both. Donations are
live, affiliate is built and dark behind `MONETIZATION_ENABLED` and demoted rather than cancelled.

⚠️ The economics, the two gates and the numbers behind them moved to
[docs/decisions.md](docs/decisions.md) on 2026-09-03 — they are a decision record with no next
action, and this file is for open work. Runbook →
[docs/monetization-go-live.md](docs/monetization-go-live.md). The one thing to know before touching
the code: only **GOG** of the catalog’s store rows is affiliate-capable, so `affiliate.ts` has
two mechanisms. → [[monetization-h3]]

---

## Smoke test, 2026-10-11 (13th run, the first on the new stack)

Scope: fandex.org signed out (static pages by curl, the app in the browser pane), the API by curl, signed in on Nils's Chrome reading only, one look at the phone. **No write was made**: there is no test account on the new stack (SM70). Overall: everything renders, the counts agree across screens and no page errors; the findings are about scale, wrong wording and sort quality. Plan: [smoketest.md](smoketest.md), "The new stack".
Severity: 🟠 fix soon · 🟡 minor · 🔵 nice-to-have.

| ID | Sev | Type | Area | Finding (with repro) |
|----|:--:|:--:|------|----------------------|
| SM54 | 🟠 | perf | First app load | **A first visit downloads the catalog through D1: 31 requests, 1.5 MB, 9,122 rows read** (a page of 150 reads 300, measured on live D1). About 550 first-time visitors to `/` or any app address in one UTC day spend D1's 5 million and stop the API for everybody. The build already holds every title; a file would cost nothing. Repro: clear site data, open `/`, count `/v1/catalog/delta`. |
| SM55 | 🟠 | bug | Up next, website | **"No connection. Showing what this device already knows." while online.** Trakt answers the preflight for `/shows/{id}/progress/watched` with 429, the browser reports a network error, and the rail shows 7 episodes in another order where the phone shows 8. Repro: signed in, Home or Wishlist → Progress, network filter `trakt`. ⚠️ My tab was a second tab (a full Trakt sync per load) loaded about six times in ten minutes, which may be what hit the limit. The wrong sentence is certain either way. |
| SM56 | 🟡 | security | Whole site | `http://fandex.org/` answers 200 over plain HTTP, no redirect. HSTS only covers a browser that has been here before. Cloudflare's "Always Use HTTPS" is off. |
| SM57 | 🟡 | ux | Static title page | A signed-out visitor is offered nothing: no Fandex Score panel, no Rate, no Add to wishlist, no "Sign in" anywhere in the HTML. The same title opened inside the app shows all three. This is the page Google sends people to. |
| SM58 | 🟡 | data | Discover, sort | "Rating" puts single-vote 10.0s first (Batman: Arkham Collection, GTA V: Story Mode, Mass Effect: Genesis 2). The old site damped by votes (SM3). |
| SM59 | 🟡 | data | Discover, default | "Popularity" over all types is 35 games in the first 48: a game's count includes Steam reviews and is not comparable with a film's votes. Movies alone start Interstellar, Inception, Deadpool. |
| SM60 | 🟡 | ux | Every app route | The tab title is "Fandex" everywhere: Discover, Calendar, Settings, a person's page, a title opened in the app. The old site had one per route (SM26). |
| SM61 | 🟡 | nav | Title pages in the app | Every card links to `/item/{uuid}` (noindex, no canonical), and `/open/…` lands there too. The public `/{type}/{slug}` address is never linked from inside the app, so the address bar is not the one to share. Share on the page hands out the right one. |
| SM62 | 🟡 | copy | Settings, Home | "Any connected account can be used to log in." Sign-in offers Trakt only. Home's guest panel says "Create account" and leads to a Trakt sign-in. |
| SM63 | 🟡 | data | Wishlist | A rated title is on the wishlist (*The Fall*, rated 7), where rating is meant to take it off. Likely Trakt holds both and the sync mirrors it. Also seen: *Dune: Part Three* (Dec 2026) in the library, unrated, probably a test rating that was cleared. |
| SM64 | 🟡 | ux | Filters sheet | For a second or two "Available on" reads "Nothing loaded here says where it streams" and "…which platforms it runs on", then fills (Disney Plus 333, Netflix 318). A loading state worded as an empty one. |
| SM65 | 🟡 | data | Person page | Ridley Scott: "157 titles" under "Director · Writer". It counts every TMDB credit, producer and thanks included. |
| SM70 | 🟡 | tooling | Testing | Nothing destructive can be tested: no test account, and every write on the one account is a real write to Trakt. Never run by anybody: Hide, Disconnect, Download, Delete, a country or platform change, Review's Accept and Deny. |
| SM66 | 🔵 | error | Game search | A query containing `<script>` gets 502 `provider-unavailable` and "Game search is not answering." Three in a row did not shut game search for the next query. Five (the credential latch's threshold) was NOT tried. |
| SM67 | 🔵 | api | Worker | A wrong method on a real route answers 404, not 405. `HEAD /v1/health` is 404. `/v1/shows/{a film's id}/episodes` is 200 and empty. `/v1/health` says nothing about a provider being down, which the old `/api/health` did. |
| SM68 | 🔵 | a11y | Chips | The type chips expose no pressed state. Tag chips on a title page are 22 px tall: 29 targets under 24 px at 375 px. |
| SM69 | 🔵 | copy | Assorted | `/library` signed out says "Sign in to see your wishlist"; that gate's button says "Sign in" where the others say "Continue with Trakt"; an unknown person's crowd average is an en dash; a title that does not exist offers only "Try again"; `/movie/Alien` (capital A) is a hard 404 while `/movie/any-unknown-slug` gets the app; the app shell's HTML carries `httpEquiv=` as an attribute; typing "nolan" lists Nolan Gerard Funk (1) above Christopher Nolan (11). |

**Held up well:** every address kind answers what docs/website.md says (30 of 30 random sitemap URLs 200, 4,568 entries = 1 + 4,561 + 6); security headers, robots, canonical, Open Graph and JSON-LD on title pages; the legal pages in both languages and the imprint's noindex twice over; legacy uuid addresses 308 to the stored slug; the API refuses bad JSON, oversized bodies, forged tokens and a foreign origin with sane shapes; search (catalog first, then providers, count = cards), the type filter (1,373 + 291 = 1,664), a person filter (11 = 11) and "Netflix 318" → "Show 318 titles"; Back from a title restores the query and results; the calendar pages, opens a busy day and an empty one, and never scrolls; every signed-out gate asks. Signed in: Profile 1,953 / 1,683 / 97 = Lists = Settings; Insights' type tiles and its histogram both sum to 1,683; Up next's boxes are empty at rest; no console error beyond the one 502 above.

**Not re-logged, still true:** calendar-month pages and `/dashboard` are 404; Rate signed out sends you to You and does not bring you back; Profile's "Coming up" uses the worldwide date (Street Fighter 13 Oct, the calendar says 15); Steam is listed as connected and does not sync.

---

## Still open elsewhere

### Added 2026-09-02 (Nils)

- **🔵 Search Console: 4,089 of 4,090 sitemap URLs are "Discovered – currently not indexed", 1 is
  indexed.** (Breakdown from Nils, 2026-09-02.) **ONE reason, and it is the crawl-priority bucket,
  not the quality one**: Google has found these URLs and has not fetched them. So there is nothing
  in the pages to fix — verified independently against live prod, where `sitemap.xml` answers 200
  with 4,341 URLs (4,334 in the canonical 2-segment shape, so no redirect chains) and a Googlebot-UA
  fetch of `/movie/the-innocents` returns 200, `index, follow`, a self-referencing canonical and 29
  internal links. ⚠️ **"Crawled – currently not indexed" is the bucket that would mean thin content,
  and it is EMPTY.** Do not go thickening pages; that is answering a question nobody asked.
  What actually moves this: **external links** (the domain is ~2 weeks old with near-zero authority,
  and crawl budget is rationed to unproven sites), then internal link depth. ⚠️ Dumping several
  thousand URLs at once on a new domain is itself part of the signal. **Mostly it is time.** →
  [docs/seo.md](docs/seo.md). ⚠️ The sitemap total moves daily with the catalog (2,037 → 4,341 →
  4,507 in a month), so count it rather than quoting one: `curl -s https://fandex.org/sitemap.xml
  | grep -c '<loc>'`.

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


### Added 2026-10-11

- **⬜ "More like this" picks odd titles, and it always did.** The rail is the old site's ranking,
  ported as it was: it scores the eight RAREST facets two titles share, and the rarest facets a film
  has are bit-part actors and one-off keywords. On the live catalog Alien gets *Saving Private
  Ryan*, *Top Gun* and *Freddy's Dead*; Inception gets *The Dark Knight Rises*, *The Blue Lagoon*
  and *Platoon*. One thing was changed in the port, because it left the rail empty for 1,074 of
  4,561 titles: facets no other title carries are no longer offered to the ranker
  (`mobile/src/lib/related.ts`). Whether the ranking itself should change (count every shared
  facet, weight genre and director above cast) is Nils's call: it changes what the app recommends.
  ⚠️ `src/lib/similarItems.ts` is shared with the old site's tests; change the caller, or both.

### Added 2026-09-03

- **⬜ The catalog holds duplicate items across sources.** Found while verifying the franchise
  sweep: `Andor` and `Star Wars: Andor` are two separate `media_items` rows, the first already in
  the Star Wars franchise via Wikidata, the second offered by the membership suggester as if it
  were missing. So a franchise can gain a member it visibly already has. ⚠️ **This is an identity
  problem, not a taxonomy one** — `findMatchingItem` never folded them, presumably because the
  titles differ by a franchise prefix that `norm_title` keeps. Worth measuring how many such pairs
  exist before deciding whether to fix it; a title-prefix merge is exactly the shape that
  [[cross-type-identity-merge]] warns about.

- **⬜ The tag tail: ~9,000 tags in Other appearing three times or fewer.** The Review tab's rules
  deliberately stop at the head (91% of everything appearing 20+ times). The tail is not worth a
  card each and is not worth hand-triage either; if it is ever worth doing, it is a bulk-select
  pass in the Tags table against a search, not more rules. ⚠️ **Do not judge coverage by tag COUNT**
  — a rule claiming 12 tags seen 900 times changes more of the site than one claiming 80 nobody
  carries twice.

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
