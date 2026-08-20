# Fandex — Status

_Your index of every game, movie & show._ · **This file = current state only.** Open work in detail → [TASKS.md](TASKS.md). Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it, don't read it).

_Last updated: 2026-08-20 (SEO: structured data, a crawlable release calendar, the homepage hub; Search Console verified)._

> **Ten decisions were locked on 2026-08-17** — Impressum approved, affiliate signups unparked (**superseded 2026-08-19: ads-first, affiliate demoted**), H3.0 closed as won't-do (never quote a cost), the Score's 0–100 range relabelled as a target rather than re-tuned, H3.8 approved, `PRUNE_ON_BOOT` stays on, the Score tuning approved as-is. **They are settled — see the top of [TASKS.md](TASKS.md) and don't re-open them.**

---

## 🟢 Prod is BACK, deployed, and the leak is confirmed fixed

fandex.org is **up, serving, and running `main`'s HEAD** as of 2026-08-12. It was down from **2026-07-22** on a Railway compute-usage pause, and served only a ~32-minute window on 2026-08-07.

**⚠️ The last blocker was CI, not billing — learn this one.** Railway auto-deploy has **Wait for CI ON**, so a red CI silently blocks every deploy. On 2026-08-12 the `npm audit` job began failing against an *unchanged* dependency tree (a nanoid advisory published after the last green run), and pushes stopped reaching prod — `uptime` climbed straight through them with no restart. Fixed by a lockfile-only bump; the deploy fired **automatically** the moment CI went green. **If a push doesn't seem to reach prod, check `gh run list --workflow=ci.yml` before suspecting Railway.** Everything committed since 2026-07-22 — H1, the mockup rebuild, PR13–PR16, the legal pages, Score calibration, the circuit breaker, all of H3/H4, P18 — is now live for the first time.

**The 2026-07-22 root cause is now verified dead in production**, not just in theory:

- **`rr.db` is 37.7 MB** (peak was 2,487 MB). The perf audit's §B inflation question is answered.
- **The write gate holds under a replayed crawl** — 15 anonymous Googlebot-UA facet requests (~900 thin rows if broken) changed `media_items`/`media_links`/`media_external_ids` by **zero**.
- **The memory ramp is dead** — `cgroupMb.fileMb` flat at **74–76 MB** across ~7 h of uptime, then **reclaimed to 25** as the box idled. Not a climb toward 2,000. First window long enough to prove a plateau.
- **`libRowsWithoutState` / `wishRowsWithoutState` = 0/0** on prod — the cache-table drop is now unblocked.

→ full readings in [the archive](docs/archive/history.md), grep `PR17 post-outage verification`.

- **Backups were proven by a real restore drill on 2026-08-12** — `integrity_check` ok, every user table exact, every real (`browsed=0`) catalog row exact at 1994, lag 6m39s. **PR17 is CLOSED.** ⚠️ **That proof expired five days later and nobody noticed:** migration 16 (2026-08-17) broke Litestream outright, and nothing replicated until 2026-08-19. **A restore drill proves the backup you had that day, not the one you have now** — re-run it after ANY schema change, which is the lesson this cost two days to learn.

**Still on you, on the infrastructure side:** run the restore drill (commands in [TASKS.md](TASKS.md)). **There is no variable to set.** The file reclaimed itself 331.4 → 154.2 MB when migration 18 triggered `db.ts`’s post-migration VACUUM.

**No prod sweeps left.** Steam cross-link ran 2026-08-17 (131 games, cursor drained), Wikidata franchise ran 2026-08-14. `PRUNE_ON_BOOT=0` is optional now the guard has held three times. The remaining judgement call is **the TWA decision**; the affiliate signup is no longer the next step (direction changed 2026-08-19).

⚠️ **The 340 MB WAL was never a benign high-water mark — it was the backup outage, and it is still 340.8 MB.** Litestream could not parse the schema, so it could not advance its read position, so SQLite could not checkpoint past it; that is why `wal_checkpoint(TRUNCATE)` answered `busy: 1` twice. This file recorded it as a quirk needing no action from 2026-08-12 to 2026-08-19. **A WAL that will not truncate is a symptom to chase.**

**Watch that it STAYS up.** The app never crashed in either outage — `uptime` climbed monotonically both times, so it was **un-routed**, which reads as a billing/pause action, not a technical one. If usage is still near the cap, resumed traffic re-accrues. **That "days, not hours" gate is now MET** (continuous since 2026-08-12), which is what unparked the affiliate signups — every program reviews the applicant site, and it has been serving cleanly.

## 🟡 `/library` + `/wishlist` do not work under `next dev` (DEV ONLY — prod is fine)

**Production is unaffected.** A `next start` build hydrates both pages and renders real items; fandex.org is fine and this was never a user-facing outage. It does mean **neither page can be developed or verified against the dev server**, which is exactly why it went unnoticed — the smoke sweeps run against prod.

Under `next dev` both pages render their toolbar server-side and then sit on **“Loading…” forever**: React never hydrates the `<main>` subtree, no effect runs, `/api/library` is never requested, and **clicking a tab does nothing**. Cause is measured, not guessed: `useSearchParams()` postpones the Suspense boundary (React comment marker **`$~`**) and the dev client never resumes it. Swapping that one call for a plain `URLSearchParams` makes the page work instantly.

**Workaround today:** verify those two pages against the prod build — `npm run build && npm start` (the `prod` launch config, :3100). Diagnosis, the ruled-out fixes, and the three real options → [TASKS.md](TASKS.md).

⚠️ **Contradicting observation, 2026-08-18 — do not act on it yet, but do not assume the section above is still complete either.** During the AN batch, `/wishlist` **hydrated and rendered real items under `next dev`** (checked for a `__reactFiber` key on `<main>`, saw the item list). One observation, one page, one session — not enough to declare this fixed, and the cause is unknown: that session also added a state branch to `MyStuffView`, so the component itself changed. **Re-check both pages under `next dev` before spending any time on the three options in TASKS.md** — the bug may already be gone, or may be intermittent, which would itself change which fix is right.

## ▶ What's open

| | Item | Blocked on |
|--|------|--|
| 🔴 | **Backups were DEAD 2026-08-17 → 2026-08-19. Fixed; the restore drill is yours** | **You:** two Console commands, in [TASKS.md](TASKS.md). Migration 16 put SQLite 3.44+ syntax in a view; Litestream v0.3.13 embeds ~3.40 and replicated **nothing** for two days. Railway volume backups are Pro-only, so it was the only copy. Live again (`9d63a68`, new generation, bucket 33.6 → 181.8 MB). **No variable to set — the file reclaimed itself, 331.4 → 154.2 MB.** |
| 🟡 | **`/library` + `/wishlist` dead under `next dev`** | **Your call** which fix (see TASKS.md). Prod unaffected; verify those pages on the `prod` launch config meanwhile. |
| 🔵 | **H3 — monetization, now ADS-FIRST** | **Nobody, yet.** Direction changed 2026-08-19; the next move is traffic, not a signup. Watch the two gates on `/dev/analytics`. Affiliate demoted; GOG is one optional email. → [docs/monetization-go-live.md](docs/monetization-go-live.md) |
| 🔵 | **P15/P16 — Android TWA** | **You:** do it or park it — full context in [TASKS.md](TASKS.md) (Fandex as a thin Play Store wrapper of the website, the 2026-06-18 decision; needs a signing key + a one-off $25 Play account). |
| 🔵 | **RAWG cross-link sweep** | **You**, once RAWG is back — it was down all of 2026-08-17. 168 games lack a RAWG link. Not urgent: they have IGDB as a second source now, so they still score. |

**The mobile batch is COMPLETE, 15/15 (2026-08-17).** MB7 — "the bottom nav scrolls away on Insights" — was never the nav: the page **overflowed horizontally**, Chrome shrink-to-fit zoomed the *layout* viewport out (812 → ~1017) while the visual viewport stayed 812, and the `fixed bottom-0` bar pinned itself ~205px below the fold. Five sources, all `min-width: auto` on a flex/grid item. **Two rules worth keeping: `truncate` does nothing inside a flex row without `min-w-0`, and this class of bug must be verified at SEVERAL widths (320/360/412) — a single-width pass gave a false green and shipped an incomplete fix that Nils caught on his phone.**

**The cache tables are gone (migration 16, 2026-08-17).** `user_library` and `user_watchlist` are now VIEWS over `user_item_state`, so migration 3's expand-then-contract finally contracted and `rebuildCaches` is deleted — drift is no longer absent but impossible. Proven byte-exact on all 2,017 real rows through **both** apply paths (`scripts/verify-cache-views.mjs`, `scripts/rehearse-cache-view-migration.mjs`). **Two traps recorded in [TASKS.md](TASKS.md): a code-only rollback breaks every library write, and `CREATE INDEX` on these names now throws at boot.**

**Episode tracking is LIVE and populated (MB14 + MB16, 2026-08-16).** Per-episode watched state for shows, two-way with Trakt: the item page's season tracker, Home's vertical **Up next** list, and the library's **Progress** tab. Prod synced 12,318 episodes across 280 shows.

**⚠️ The lesson from MB14, because it cost five deploys:** `/sync/watched/shows` carries **no** episode data in any variant, though Trakt documents `seasons` as default-on. A mocked unit test of the *documented* shape passed the whole time. **Measure a provider's response against a real account before building on it** — episodes come from `/sync/history/episodes` (bulk) or `/shows/{id}/progress/watched` (per-show, `completed: true` only). → [[trakt-episode-endpoints]]

**The anonymous surface works (AN1–AN6, 2026-08-18, `f5bad29`, live).** Current state, not a changelog: **the release calendar is PUBLIC** (Popular only for anon; Wishlist/Library are locked chips that open the sign-in dialog), `/wishlist` shows a sign-in gate instead of redirecting, the nav search box works logged out, every Home card carries its Rate/Wishlist bar, and **platform colour-coding is gone site-wide** in favour of `<BrandGlyph>` — `TYPE_COLORS` (game/movie/show) is a different axis and stays. `withOptionalUser` is the wrapper for a route serving both audiences; it does not weaken PR15's write gate. → [archive](docs/archive/history.md), grep `AN — the anonymous surface`.

Everything else is done. **H1, H2, H4, H5, PR17, SM38–SM48, franchise/IP scoring (swept on prod), the facet-page compute + quota exposure, all five audit passes, all 11 smoke sweeps, every production incident, and the full performance audit.** Grep [the archive](docs/archive/history.md) for any of them.

**P18 closed 2026-08-03.** "Where to watch" rows are clickable + show an offer-type line, via TMDB's own per-region link and the existing lazy self-heal path — not the JustWatch Content Partner API or a full-catalog re-projection TASKS.md previously (incorrectly) had it blocked on. Same session: a **boot-time prune of the browsed tail, default ON** (`PRUNE_ON_BOOT=0` to disable — see below), `omdbConfigured()`, and cache-contraction drift counts in `/api/dev/dbsize`. → [archive](docs/archive/history.md), grep `P18 streaming links`.

**⚠️ The boot prune has now run against prod.** Every server boot runs a bounded prune of browsed-only catalog rows nobody acted on (small batches, 5s budget, skips if free space is low, never VACUUMs), default ON. Prod booted with it enabled and **nothing broke** — `user_library` 1,912 and `user_watchlist` 96 are unchanged, `media_items` is 2,267. It has since run a second time (the 2026-08-12 redeploy) deleting 255 browsed-only rows with **zero** user rows touched, and **Litestream is now confirmed by a restore drill**, so the original reason to disable it is gone. `PRUNE_ON_BOOT=0` is now a preference, not a precaution.

**H3 v1 landed 2026-08-03.** Donations are **live** (Ko-fi, in the footer, the sign-in dialog and the `/profile` list). The affiliate layer is **built and dark** behind `MONETIZATION_ENABLED`, which defaults off — H3's legal gate expressed as code. H3.8's Path B trigger stays **defined but explicitly NOT approved**.

**H4 closed 2026-08-03.** The Impressum is written and filled in both locales; German is the operative version.

**Performance is closed (2026-08-02).** The probes stay in `scripts/`; **measure before optimising** (§A was mis-sized by 100× once).

**Two admin dashboards are live and self-hosted (2026-08-19): `/dev/analytics` (traffic) and `/dev/users` (audience).** Both sit behind the existing `SCORING_ADMIN_USER_IDS` allowlist. `/dev/analytics` answers the two questions H3.8's thresholds ask and nothing else could: **pageviews/30d vs the 10,000 ads gate**, **signed-in WAU vs the 3,500 freemium gate**, and the **anonymous-vs-signed-in split** that decides which arm is even worth building. No Google Analytics, no third-party script, no cookie, no IP stored.

Two things to know before touching it. **The tables are pre-aggregated counters, never per-event rows** (migration 17): one row per (day, dimension), so cardinality is bounded by the dimension set instead of by traffic. A row per pageview is the exact shape that grew the DB to 2,487 MB on 2026-07-22. And **it counts real-browser pageviews only**, because it is a client beacon: crawlers and no-JS requests are invisible by design. That is the correct population for an ads decision and the wrong one for judging SEO reach, which belongs in Search Console.

**`/dev/users`** answers the audience half, read from rows that already exist and storing nothing: registered users, library/wishlist/rating totals with per-media-type splits, data provenance, connected providers, library-size distribution (the `0` bucket is the clearest onboarding drop-off the schema can show), recency buckets, stickiness, and a per-user table that deliberately shows a truncated id rather than the provider display name. **"How often do they use the app" has no exact answer in this schema**, because `last_seen_at` is a single timestamp rather than a visit history, so the page reports three labelled proxies instead of inventing a frequency number.

**⚠️ The privacy policy changed, in both locales.** A "Usage statistics" / „Nutzungsstatistik" section now describes the counting, and `updated` moved to 2026-08-19. `docs/cookie-assessment.md` previously claimed **"zero analytics"**, which this work made false; it is corrected, and it now records why first-party cookieless counting does **not** trigger the consent banner (§25 TDDDG governs storing information on, or reading it from, the user's device, and the beacon does neither) plus the four changes that WOULD trigger it.



## 🧭 Monetization changed direction (2026-08-19)

**Nils's call: go live → wait for traction → ads → premium (ad-free + extras).** Affiliate is **demoted, not cancelled** and the code stays built and dark. The old plan (sign up for seven affiliate programs, GOG first, Amazon last) is retired.

The model that decided it, per **1,000 monthly active users**: **ads ~€150 · premium ~€60 · donations ~€14 · affiliate ~€3.** Affiliate is last by 20 to 50 times, for reasons specific to this app: Fandex is **past-tense** (people log what they already played or watched, so a buy link arrives after the purchase decision), only **GOG** appears in the catalog at all (295 of 1,033 games, while six of the seven programs appear on **zero** items), and Amazon pays **1% on video games**. The settling argument: covering upkeep once TMDB's $149/mo commercial tier applies takes ~1,000 users on ads and **~45,000 on affiliate**, so **affiliate is the only method that cannot clear its own cliff**.

Both H3.8 gates are now measurable rather than theoretical, which is what the two dashboards below are for. Full reasoning + the standing guard against self-referring to beat Amazon's 180-day clock → [docs/monetization-go-live.md](docs/monetization-go-live.md).

## 🔎 Organic reach: the surface is fixed, and it is now measured (2026-08-20)

**Ads-first means the bottleneck is traffic, and nothing in the repo was about reach.** An audit of what fandex.org actually serves a crawler, measured against live prod rather than against the code's intentions, found five gaps. **Four are fixed and Search Console is verified**; the reference, the numbers and what remains live in **[docs/seo.md](docs/seo.md)**.

- **Search Console is VERIFIED** — `fandex.org` as a Domain property, via a DNS TXT record on the apex. ⚠️ **Deleting that record un-verifies the property and empties every report.** The sitemap is submitted; its "Couldn't fetch" is the pending state, not a fault (the sitemap answers in 180 ms with a correct content type and serves Googlebot identically). Expect no useful data for several days.
- **Structured data existed nowhere** — zero `ld+json` across 2,022 indexable pages. Item pages now emit `Movie` / `TVSeries` / `VideoGame` + `BreadcrumbList`, calendar months an `ItemList`. ⚠️ **`aggregateRating` is deliberately absent and a test keeps it absent** — every rating we could publish is somebody else's aggregate shown under attribution, and marking those up as our own earns a structured-data manual action, which is sitewide.
- **The homepage was a crawl dead end** — priority 1.0, an `sr-only` h1, and zero catalog links, because the page was `"use client"` and fetched a robots-disallowed endpoint. It now ships **74 server-rendered links** (30 titles, 36 genres, 8 calendar months) from the local catalog: no provider call on the most-hit page, no session read, and it only ever SELECTs so it cannot mint a row.
- **The release calendar had no indexable surface.** `/calendar/{YYYY-MM}` is new, server-rendered, eight months in the sitemap, with three crawl bounds. ⚠️ `robots.ts` now needs **both** `/calendar/` (allow) and `/calendar` (disallow) — longest match wins, so do not tidy them into one rule.
- **Thin facet pages are `noindex, follow`** below 3 pooled titles. ⚠️ **The threshold is pool size, not linkable count.** `/person/angelina-jolie` renders a full filmography at 175 KB and links 2 of it — under-linked, not thin.

**Still open, both internal-linking:** item pages link to ~25 facet pages and **no sibling items**, and facet pages stay out of the sitemap on purpose until that is fixed. Written up in docs/seo.md.

## 🗺️ Roadmap

| Area | Status |
|------|:--|
| Hosting + deploy (Railway) | ✅ built · 🟢 back up 2026-08-12 — watch it stays, see above |
| Domain + OAuth + email (fandex.org) | ✅ |
| Backups (Litestream → Railway bucket) | ✅ (24h retention, v0.3.13) |
| Observability (`/api/health`, structured logs) | ✅ incl. `openProviderCircuits` |
| Security (S1–S13, CSP enforced) | ✅ |
| Sync completeness + TMDB enrichment | ✅ |
| SEO — public item pages (P13) + facet pages (P17) | ✅ live + fully indexed |
| **H1** — UI/UX overhaul (mobile-first) | ✅ 2026-07-27. Direction 2a "Ticket · Calm". Design system → [docs/design/fandex-handoff/](docs/design/fandex-handoff/) |
| **H2** — data-model hardening | ✅ |
| **H5** — Fandex Score | ✅ 2026-07-27 incl. calibration; **franchise/IP added 2026-08-14** (§3.6). Design → [docs/fandex-score.md](docs/fandex-score.md) |
| **H4** — legal & compliance | ✅ 2026-08-03, epic closed |
| **H3** — monetization | 🔵 **ads-first since 2026-08-19**; donations live, affiliate built + dark + demoted → [docs/monetization-go-live.md](docs/monetization-go-live.md) |
| Android TWA (P15/P16) | 🔵 needs the TWA build |
| **SEO / organic reach** | 🔵 **open since 2026-08-20** — structured data, a crawlable calendar and the homepage hub shipped; Search Console verified. Internal linking still thin → [docs/seo.md](docs/seo.md) |

## ✅ Quality bar (as of 2026-08-20)

**872 tests** · `npx tsc --noEmit` clean · `npm run lint` 0 errors · `npm run build` clean · `npm audit` 0 vulnerabilities. **This is the standing bar — don't land work below it.**

**Donations are LIVE (2026-08-12)** — Ko-fi renders on the support page, the sign-in dialog and `/profile`, as direct outbound `<a href>`. Setting the Railway variable was necessary but not sufficient: `NEXT_PUBLIC_*` is inlined into the **client bundle at build time**, and Railway only forwards a variable into a Dockerfile build when declared as `ARG`, so the server-rendered page worked while every client surface silently didn't. **Any future client-read `NEXT_PUBLIC_*` needs that Dockerfile line.**

**Dependencies are current as of 2026-08-14** — all four open Dependabot PRs merged after a full local bar *plus* a real JWT sign/verify round-trip, because `jose` is the session library and the suite never exercises a live token. Now on `next` 16.3.0, `react` 19.2.8, `jose` 6.2.8, `@types/node` 26, with CI on `actions/checkout@v7` + `setup-node@v7`. `npm audit` 0 vulnerabilities.

**11th smoke sweep (2026-08-12, live prod, both auth states)** — all five findings (`SM38`–`SM42`) fixed → [archive](docs/archive/history.md), grep `Smoke test 2026-08-12 11th run`. Ran during a genuine RAWG outage, which re-verified the three 2026-08-02 single-source games bugs as **fixed** under the exact condition that exposed them.

**⚠️ `npm audit` went red again on an UNCHANGED tree (2026-08-14) — the second time.** Two `brace-expansion` advisories published since the last green run widened their ranges to cover the exact version the existing override pinned (`5.0.8`), and eslint's own `minimatch@3` chain (`1.1.16`). **This silently blocks the Railway deploy** — Wait-for-CI is ON. Fixed with two *nested* overrides, `1.1.18` under `eslint` and `5.0.9` under `@typescript-eslint/typescript-estree`: the two consumers need different major lines, so one flat override cannot satisfy both. Back to 0 vulnerabilities. **Expect this again — pinning an exact version is a bet that the next advisory won't include it.**

**One dependency added 2026-08-14: `simple-icons`, as a devDependency.** It feeds `scripts/gen-brand-marks.mjs`, which extracts 11 brand paths into the committed `src/lib/brandMarks.ts`. **Nothing in the shipped app imports it** — the package carries 3,453 icons and generating keeps the bundle cost exact rather than trusting a barrel export to tree-shake. Re-run the script after adding a store-link name; it throws on an unknown slug rather than silently skipping a brand.

---
_✅ done · 🔵 needs input / in progress · ⏸️ blocked · 🟢 later · 🔴 broken_
