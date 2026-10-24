# Fandex: Status

_Your index of every game, movie, show & book._ · **This file is current STATE only.** Open work in detail → [TASKS.md](TASKS.md). Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it, don't read it). Rules → [AGENTS.md](AGENTS.md) and the `CLAUDE.md` in each package.

_Last updated: **2026-10-23**. State only, per the doc conventions in AGENTS.md: what is true now, not what happened when._

> **Settled calls and standing constraints → [docs/decisions.md](docs/decisions.md).** Every line there is closed; re-opening one wastes Nils's time.

---

## ▶ What's open

| | Item | Blocked on |
|--|------|--|
| 🔵 | **A native Android app and a website on one Cloudflare backend.** Live: the API (`api.fandex.org`, [docs/worker.md](docs/worker.md)), the app on Nils's Pixel 8 ([docs/app.md](docs/app.md)), and fandex.org, a static build of the app with a page for every pool title, tag, person, studio and calendar month ([docs/website.md](docs/website.md)). The app's screens are ports of the old site's ([docs/app-parity.md](docs/app-parity.md)). Steam syncs again since 2026-10-23, from the device through the Worker. ⚠️ A second browser tab runs on an in-memory copy of the catalog (a patch to expo-sqlite, `mobile/patches`) and downloads it again each time. ⚠️ Provider-fetching Worker paths reach 10 to 20 ms of CPU on a cold isolate against a 10 ms free-plan limit; none was terminated in about fifty requests, and if error 1102 appears the fix is Workers Paid at $5 a month. | **Nils**, for TASKS.md item 0: keep using both and say what is off, and the IGDB licence email. |
| 🟠 | **Games are IGDB-ONLY, and IGDB is the one with the open licence question.** RAWG was retired 2026-09-02, so `IGDB_ENABLED=0` takes games' browse to nothing. The question is with partner@igdb.com (Nils, 2026-10-04). → [docs/decisions.md](docs/decisions.md), [PLATFORMS.md](PLATFORMS.md) | **Nobody today, but know the shape.** |
| 🟢 | **The 2026-10-23 codebase review is fixed and live.** Open routes that could spend D1's daily reads are rate limited and capped, each account has its own share of the daily writes, covers are checked by their bytes, the app's sync is guarded against session changes and against undoing an edit made during a Trakt sync, CI audits and lints all three packages, and the old Next.js site's code is deleted (tag `old-site-final`). Report: TASKS.md, "2026-10-23 review". | **Nils**, for a Trakt test (TASKS.md 5). |
| 🟢 | **The taxonomy sweep runs weekly** (Mondays 08:08, "Fandex weekly taxonomy sweep" on this PC, `scripts/taxonomy-sweep/`). It never changes a row that was already there, and `category-merge` needs a flag the schedule does not pass (2026-10-23). → [[taxonomy-sweep-weekly]] | **Nobody.** |
| ⏸️ | **The native app on Google Play** (decided 2026-10-23, in place of the TWA), PAUSED until the developer account is upgraded Personal → Business. → [docs/play-store.md](docs/play-store.md), [TASKS.md](TASKS.md) item 2 | **Nils.** |

## 🟢 Prod: fandex.org is three Cloudflare Workers and a database

**Railway is gone (deleted 2026-10-05). Cloudflare, free plan.** A push to `main` deploys nothing: the website goes out with `node mobile/web/publish.mjs` and the API with `npx wrangler deploy` from `worker/`.

- **`fandex-api`** is the API and the cron, on D1, at `api.fandex.org` since 2026-10-23 (where the edge cache works) and still at `fandex-api.fandex-worker.workers.dev` for APKs from before. Deployed 2026-10-23 with migrations 0004 (`provider_aliases`) and 0005 (`source` on the taxonomy tables). Its cron is walking the 1,698 TMDB links stored before projection v4, about three days from the evening of 2026-10-23.
- **`fandex-web`** serves the site: files a build wrote, and a small Worker for what no file answers; `/v1/*` goes to the API through a service binding. **`fandex-www`** redirects www to the apex.
- ⚠️ **D1's daily read allowance ran out once (2026-10-10).** The open routes that read many rows a call are rate limited and capped per day since 2026-10-23 (`DAILY_DELTA_CAP`, `DAILY_LOOKUP_CAP`); a normal day is far under both.
- **A first-time visitor reads the catalog from files** (`/catalog/`, written by the site build) and then asks the API once.
- **The site is as fresh as its last build.** It is rebuilt every morning by the Windows task "Fandex nightly site" on Nils's PC (06:30), from the newest commit on `main` whose CI passed (2026-10-23).
- **Security headers** on every page; the full Content-Security-Policy is **enforced** since 2026-10-24 (report-only from 2026-10-23; a signed-in session showed no violation).
- **D1 is the only live copy of the library, and its backup restores** (drill passed 2026-10-05). ⚠️ **`rr-2026-10-04.db` must never be deleted**: it holds the only copy of the RAWG, Steam and Trakt blobs. Both Railway snapshots are in R2 (`fandex-backups/railway/`) and under `data/prod-snapshots/`.
- ⚠️ **The legal pages are live text.** `src/lib/legal/content` is what `/legal/…` shows after the next publish.
- **Google sign-in is live on fandex.org, in a browser only** (2026-10-11).
- **Destructive things are tested on this machine, never on the live account**: `node worker/scripts/dev-stack.mjs`. → [docs/worker.md](docs/worker.md), [smoketest.md](smoketest.md)

## 🧭 Monetization: ads-first since 2026-08-19

**Nils's call: go live → wait for traction → ads → premium (ad-free + extras).** Affiliate is demoted, not cancelled, and nothing is live. Per 1,000 monthly active users the model said: ads ~€150 · premium ~€60 · donations ~€14 · affiliate ~€3. Going commercial costs at least TMDB's ~$149/mo tier. → [docs/archive/old-site/monetization-go-live.md](docs/archive/old-site/monetization-go-live.md). `/dev/analytics` counts the website's pageviews (no identifier, no cookie).

## 🔎 Organic reach

**Ads-first means the bottleneck is traffic.** Search Console is verified for `fandex.org` through a DNS TXT record on the apex (⚠️ deleting it un-verifies the property). The static site carries the old site's structured data, sitemap and robots rules. → [docs/archive/old-site/seo.md](docs/archive/old-site/seo.md) (written for the old site; the reasoning still holds).

## 🗺️ Roadmap

| Area | Status |
|------|:--|
| Hosting + deploy | ✅ Cloudflare since 2026-10-10, deployed by hand. → [docs/website.md](docs/website.md) |
| Backups | ✅ D1 Time Travel (7 days) and a nightly export to R2 in the EU; exports under `d1/` expire after 30 days. |
| **Cloudflare Worker + D1** (phase 1) | ✅ 2026-10-04. Catalog, accounts, IGDB proxy, calendar, cron, export. Books (Open Library, Hardcover facts only) and board games (BGG, behind its token) since 2026-10-17. Hardened 2026-10-23. |
| **Expo app** (phase 2) | 🔵 On a Pixel 8 against the real account. `fandex-0.3.17.apk` installed 2026-10-24: every product-review fix (typo-tolerant search last), and Discord sign-in returning through fandex.org. |
| **Website** (phase 3) | 🔵 Online 2026-10-10: the app in a browser and 4,713 static item pages with their rails, facet pages, calendar months and the legal pages (publish of 2026-10-23). |
| **H5** Fandex Score | ✅ → [docs/fandex-score.md](docs/fandex-score.md) |
| **H4** legal & compliance | ✅ |
| **H3** monetization | 🔵 ads-first; donations live, affiliate dark |
| The native app on Play | ⏸️ paused on the account upgrade; the native app, not the TWA (2026-10-23) → [docs/play-store.md](docs/play-store.md) |
| The old Next.js site | 🗑️ Deleted 2026-10-23 after running nowhere since 2026-10-05. At the tag `old-site-final`, the visual reference for the app. Its rules: [docs/archive/old-site/invariants.md](docs/archive/old-site/invariants.md). |

## ✅ Quality bar (re-run 2026-10-24, after the product review closed)

Three packages, each with its own bar, plus one lint over all of them:

- **root** (`src/lib`, the shared modules): **368 tests** · `tsc` clean · `npm run lint` **0 errors** and 0 warnings across root, `worker/` and `mobile/`.
- **`worker/`**: **299 tests** inside workerd against a local D1 · `tsc` clean · the bundle builds (`wrangler deploy --dry-run`).
- **`mobile/`**: **273 tests** · `tsc` clean.
- **`npm audit --omit=dev`**: root and `worker/` clean; `mobile/` has high advisories only through Expo's build CLI, which never reaches the bundle, so CI fails it on critical only.

---
_✅ done · 🔵 needs input / in progress · ⏸️ blocked · 🟢 later · 🔴 broken_
