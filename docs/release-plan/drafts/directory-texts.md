# Fandex: texts for app directories

_Draft for Nils to edit. Written 2026-11-22. Character counts were made with a script (`node`), counting characters and not bytes._

## (a) AlternativeTo

**Name:** Fandex

**Tagline** (47 characters): Everything you're waiting for, on one calendar.

**Description** (499 characters):

Fandex keeps your films, shows, games and books in one list and puts their release dates on one calendar. On Android it reminds you at 09:00 on the day a wishlisted title comes out, a new season starts or the next episode airs. Rate what you have seen and Fandex estimates what you would rate other titles, from your own ratings only. Tap Why? to see what moved the number. It syncs with Trakt, imports Letterboxd and IMDb ratings and watchlists, and exports your data. Free, on Android and the web.

_Optional sentence. Use only once Steam connect ships (today a new account cannot connect Steam). Add it after "exports your data." and check the length again (68 characters):_ Connect Steam to bring in the games you own and your Steam wishlist.

**Suggested tags:** media tracker, tv show tracker, movie tracker, game tracker, book tracker, release calendar, watchlist, recommendations, backlog, Trakt

**Platforms:** Android, Web (no iPhone app)

**Price:** Free

### Alternative to TV Time

- **Why Fandex is an alternative:** Fandex tracks shows and films, lets you tick off episodes and shows what to watch next, which is what many people used TV Time for. [not verified]
- **What TV Time did better or differently:** TV Time had about 25 million users. Fandex is new and small. TV Time shut down on 15 July 2026, so it is no longer available to compare.

### Alternative to Trakt

- **Why Fandex is an alternative:** Fandex also tracks shows and films with a calendar and episode reminders on Android, and it adds games and books.
- **What Trakt does better or differently:** Trakt is the longer-established service [not verified] for watch history, with its own calendar and episode alerts. Fandex uses Trakt for that history when you connect an account, and has no history of its own beyond what you tick in the app.

### Alternative to Letterboxd

- **Why Fandex is an alternative:** Fandex covers shows, games and books as well as films, has a release calendar, and can import your Letterboxd export so your ratings come with you.
- **What Letterboxd does better or differently:** Letterboxd has a large community (30 million or more members) with reviews and lists. Fandex has ratings only, and no reviews.

### Alternative to Goodreads

- **Why Fandex is an alternative:** Fandex lets you rate and wishlist books, shows when an upcoming book is out, and recommends books from what you rated in films, shows and games.
- **What Goodreads does better or differently:** Goodreads is built around books, with a very large community (150 million or more members). Fandex has no reviews, and its book data comes from Open Library and Hardcover, so some books are missing.

### Alternative to Backloggd

- **Why Fandex is an alternative:** Fandex has an Android app and a release calendar with reminders for upcoming games, plus films, shows and books in the same list.
- **What Backloggd does better or differently:** Backloggd is made for games only, with logs, reviews [not verified] and a gaming community of 650,000 or more. Fandex treats games as one of four types and has no reviews.

---

## (b) Generic directory entries

**At most 60 characters** (54 characters):

Films, shows, games and books on one release calendar.

**At most 160 characters** (156 characters):

Fandex keeps films, shows, games and books in one list and their release dates on one calendar. On Android it reminds you on the day. Free, also on the web.

**At most 500 characters** (499 characters):

Fandex is a tracker for films, shows, games and books. Wishlist what you are waiting for and see every release date on one calendar. On Android you get a reminder at 09:00 on the day a title comes out, a new season starts or the next episode airs. Rate titles from 1 to 10 and Fandex estimates what you would rate others, using only your own ratings. A Why? sheet shows what moved each number. It syncs with Trakt and imports Letterboxd and IMDb ratings and watchlists. Free, on Android and the web.

_Optional sentence for the 500 text. Use only once Steam connect ships (today a new account cannot connect Steam). It replaces "A Why? sheet shows what moved each number.", which keeps the text at 491 characters:_ It brings in your Steam games too.

---

## Where each claim comes from

| Claim | File and place |
|---|---|
| Tagline "Everything you're waiting for, on one calendar." | `docs/release-plan/index.html`, section `strategy`, id `st-2` (wording chosen 22 Nov) |
| One list for films, shows, games, books; one calendar | `docs/app.md`, "What is built": Wishlist and Calendar rows |
| Notification at 09:00 on release day, new season, next episode | `docs/app.md`, "Release reminders" row |
| Estimates what you would rate a title, from your own ratings; Why? sheet | `docs/app.md`, Item page row; `docs/release-plan/index.html`, id `st-3-proof`, id `s-say` ("From your own ratings") |
| Rate 1 to 10 | `docs/app.md`, Item page row |
| Syncs with Trakt | `docs/app.md`, Settings row; `docs/release-plan/index.html`, id `s-say` |
| Imports Letterboxd and IMDb lists | `docs/app-parity.md`, Import row |
| Exports your data | `docs/app.md`, Settings row ("download"); id `s-say` "Export everything" |
| Free, Android and the web, no iPhone app | `docs/release-plan/index.html`, market table (Fandex row: Free); `STATUS.md`, "What's open"; `docs/website.md` |
| TV Time: 25 million users, shut down 15 July 2026 | `docs/release-plan/index.html`, section `market`, tile `m-t1` and event `m-ev4` (TechCrunch, source 1) |
| TV Time: tracked shows, episode ticks | not in the docs as a TV Time fact beyond "biggest show tracker" (`m-t1`); the wording "what many people used it for" is general knowledge, see the unsure list |
| Trakt: calendar and episode alerts, $60 a year, free cap | `docs/release-plan/index.html`, market table (Trakt row), tile `m-t2` |
| Trakt: Fandex uses it for watch history on connect | `PLATFORMS.md` table 2 (Trakt, "Only source of per-episode state"); `docs/app.md`, Wishlist row ("Trakt for Progress") |
| Fandex has its own episode ticks without Trakt | `STATUS.md`, Roadmap, Expo app row (0.3.40) |
| Letterboxd: films only, 30M+ members, no calendar listed | `docs/release-plan/index.html`, market table (Letterboxd row), group 4 ("30M members") |
| Letterboxd: reviews and lists | `PLATFORMS.md` table 2 (Review R); table 3 (export holds `reviews`, `lists`) |
| Fandex has ratings, no reviews | `docs/app.md`, Item page row (rate, wishlist, no review field) |
| Goodreads: books, 150M+ | `docs/release-plan/index.html`, market table (Goodreads row) |
| Goodreads: shelves, reviews | `PLATFORMS.md` table 3 (Goodreads export carries shelves, rating) |
| Fandex books from Open Library and Hardcover; coverage gaps | `docs/app.md`, "Books and board games"; `PLATFORMS.md` table 1 (Open Library note) |
| Recommends books from other media | `docs/release-plan/index.html`, id `st-1-means` |
| Upcoming books on the calendar | `docs/app.md`, "Books and board games" ("calendar entries") |
| Backloggd: games, 650K+, no app yet | `docs/release-plan/index.html`, market table (Backloggd row) |
| Backloggd logs and reviews | `PLATFORMS.md` table 2 (Backloggd row: Review R*) |
| Fandex Android app with reminders for upcoming games | `docs/app.md`, "Release reminders" (any wishlisted type) |

## Unsure about

- **TV Time sentence.** The documents say TV Time was the biggest show tracker and gave its user count and closing date. That it was used for ticking episodes and finding what to watch is common knowledge and is not written in the repo. Check it against TechCrunch (source 1) before sending.
- **"A large community around each show" (TV Time).** Not in the documents, so it is gone. The 25 million users figure is sourced.
- **Backloggd "logs and reviews".** `PLATFORMS.md` lists reading its reviews through a scraper, which implies they exist. The market section does not describe its features.
- **Letterboxd "lists".** Supported by the export file names in `PLATFORMS.md`, not by the market section.
- **Goodreads "very large community" and the 150M+ figure.** From the market table, which cites Wikipedia and a note that some figures came from search summaries. Check before using in a post.
- **Trakt "longer-established".** Inferred from the pricing history (Feb 2025) in the market section. No founding date is in the documents.
- **The import on Android.** The import reads ratings and the watchlist, not lists, so the texts now say that. On Android the "Choose your export" button opens the system file picker (`mobile/src/app/(tabs)/import.tsx:180`, `mobile/src/lib/files.ts:16-19`), in every APK since 2026-10-15. No doc records it being tried on the phone. Try it once before posting.
- **"Syncs with Trakt"** is the project's own approved wording. Trakt sync covers films and shows. It implies no partnership.
- Steam sync exists only for accounts carried over from the old website. Left out on purpose.
- **Play date.** These texts name no date. Play launch is paused on an account upgrade (`STATUS.md`).
- **Tags** are suggestions, not checked against AlternativeTo's tag list.
- **Character counts:** recounted with `node` after the fixes: AlternativeTo description 499, generic 54, 156 and 499.
- **The source table above** ("Where each claim comes from") is the first author's. The table below replaces it where they differ.

## Checked on 22 Nov 2026

| Claim | Where it is proven | Verdict |
|---|---|---|
| One list for films, shows, games and books; one calendar | `docs/app.md` lines 16, 17 and 28 | Confirmed |
| Notification at 09:00 on release day, new season, next episode | `mobile/src/lib/releaseReminders.ts:29`; `docs/app.md` line 25 | Confirmed, Android only ("Not on the website", `docs/app.md` line 25). The texts said it with no platform; they now say "On Android" |
| Estimates what you would rate a title, from your own ratings only | `docs/fandex-score.md` lines 17 and 357; `STATUS.md` H5 row | Confirmed |
| Why? sheet shows what moved the number | `docs/app.md` line 18 (`ScoreSeal.tsx`) | Confirmed |
| Rate 1 to 10 | `mobile/src/components/feel.tsx:62` (ten cells); `docs/app.md` line 18 | Confirmed |
| Syncs with Trakt | `PLATFORMS.md` line 53 | Confirmed |
| "Imports Letterboxd and IMDb lists" | `mobile/src/app/(tabs)/import.tsx:136` ("Fandex reads your ratings and your watchlist from it") | **Wrong** (it reads ratings and the watchlist, not lists), reworded. Android file picker confirmed in code, never tried on a phone |
| Exports your data | `mobile/src/app/(tabs)/settings.tsx:753`; route `/v1/me/export` | Confirmed |
| Free; Android and the web; no iPhone app | `STATUS.md` "Monetization" (nothing live) and first row; only an Android build exists | Confirmed |
| Tags and platforms | AlternativeTo's own lists | Not verified |
| TV Time: 25 million users, shut down 15 July 2026 | `docs/release-plan/index.html` tile `m-t1`, event `m-ev4` | Confirmed by the plan; outside source not re-read |
| TV Time: "a large community around each show" | nowhere in the repo | **Not sourced**, removed |
| TV Time: people used it to tick episodes and find what to watch next | nowhere in the repo | [not verified], general knowledge |
| Trakt: calendar and episode alerts | `docs/release-plan/index.html` market table, Trakt row | Confirmed by the plan |
| Fandex "is free" as a reason over Trakt | Trakt has a free tier too (`PLATFORMS.md` line 53, free caps) | **Misleading**, removed |
| Trakt "longer-established" | no founding date in the repo | [not verified] |
| Fandex uses Trakt for watch history; ticks of its own without Trakt | `PLATFORMS.md` line 53; `STATUS.md` Expo app row (0.3.40) | Confirmed |
| Letterboxd 30M+ members, reviews and lists | `docs/release-plan/index.html` market table; `PLATFORMS.md` table 3 (its export holds reviews and lists) | Confirmed by the plan |
| Fandex has ratings, no reviews | `docs/app.md` line 18 (rate, wishlist, hide; no review field) | Confirmed |
| Goodreads 150M+ members | `docs/release-plan/index.html` market table (figure from Sep 2023) | Confirmed by the plan; outside source not re-read |
| Fandex books from Open Library and Hardcover, some missing | `PLATFORMS.md` lines 39 and 41; `docs/app.md` lines 54 and 55 (Open Library coverage gaps) | Confirmed |
| Recommends books from what you rated in other media | `docs/release-plan/index.html` Message 1 | Confirmed by the plan; not visible in the app |
| Upcoming books on the calendar, with reminders | `docs/app.md` lines 25 and 28 to 30 | Confirmed |
| Backloggd: games only, 650K+, no app | `docs/release-plan/index.html` market table | Confirmed by the plan |
| Backloggd logs and reviews | `PLATFORMS.md` line 62 (Review R*) | Implied only; [not verified] |
| Steam (optional sentences only) | `docs/app.md` lines 108 and 109; `PLATFORMS.md` line 56 | Not live for new users; kept out of the main text |
| No em-dash, no en-dash in prose | grep of the file | Confirmed |
