# Fandex: texts for app directories

_Draft for Nils to edit. Written 2026-11-22. Character counts were made with a script (`node`), counting characters and not bytes._

## (a) AlternativeTo

**Name:** Fandex

**Tagline** (47 characters): Everything you're waiting for, on one calendar.

**Description** (484 characters):

Fandex keeps your films, shows, games and books in one list and puts their release dates on one calendar. You get a notification at 09:00 on the day a wishlisted title comes out, a new season starts or the next episode airs. Rate what you have seen and Fandex estimates what you would rate other titles, worked out from your own ratings. Tap Why? to see what moved the number. It syncs with Trakt, imports Letterboxd and IMDb lists and exports your data. Free, on Android and the web.

**Suggested tags:** media tracker, tv show tracker, movie tracker, game tracker, book tracker, release calendar, watchlist, recommendations, backlog, Trakt

**Platforms:** Android, Web (no iPhone app)

**Price:** Free

### Alternative to TV Time

- **Why Fandex is an alternative:** Fandex tracks shows and films, lets you tick off episodes and shows what to watch next, which is what many people used TV Time for.
- **What TV Time did better or differently:** TV Time had about 25 million users and a large community around each show. Fandex has neither. TV Time shut down on 15 July 2026, so it is no longer available to compare.

### Alternative to Trakt

- **Why Fandex is an alternative:** Fandex also tracks shows and films with a calendar and episode reminders, it is free, and it adds games and books.
- **What Trakt does better or differently:** Trakt is the longer-established service for watch history, with its own calendar and episode alerts. Fandex uses Trakt for that history when you connect an account, and has no history of its own beyond what you tick in the app.

### Alternative to Letterboxd

- **Why Fandex is an alternative:** Fandex covers shows, games and books as well as films, has a release calendar, and can import your Letterboxd export so your ratings come with you.
- **What Letterboxd does better or differently:** Letterboxd has a large community (30 million or more members) with reviews and lists. Fandex has ratings only, and no reviews.

### Alternative to Goodreads

- **Why Fandex is an alternative:** Fandex lets you rate and wishlist books, shows when an upcoming book is out, and recommends books from what you rated in films, shows and games.
- **What Goodreads does better or differently:** Goodreads is built around books, with a very large community (150 million or more members). Fandex has no reviews, and its book data comes from Open Library and Hardcover, so some books are missing.

### Alternative to Backloggd

- **Why Fandex is an alternative:** Fandex has an Android app and a release calendar with reminders for upcoming games, plus films, shows and books in the same list.
- **What Backloggd does better or differently:** Backloggd is made for games only, with logs, reviews and a gaming community of 650,000 or more. Fandex treats games as one of four types and has no reviews.

---

## (b) Generic directory entries

**At most 60 characters** (54 characters):

Films, shows, games and books on one release calendar.

**At most 160 characters** (158 characters):

Fandex keeps your films, shows, games and books in one list, puts their release dates on one calendar and reminds you on the day. Free on Android and the web.

**At most 500 characters** (475 characters):

Fandex is a tracker for films, shows, games and books. Wishlist what you are waiting for and see every release date on one calendar. A notification arrives at 09:00 on the day a title comes out, a new season starts or the next episode airs. Rate titles from 1 to 10 and Fandex estimates what you would rate others, using only your own ratings. A Why? sheet shows what moved each number. It syncs with Trakt and imports Letterboxd and IMDb lists. Free, on Android and the web.

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
- **"A large community around each show" (TV Time).** Not in the documents. Remove it if you cannot source it. The 25 million users figure is sourced.
- **Backloggd "logs and reviews".** `PLATFORMS.md` lists reading its reviews through a scraper, which implies they exist. The market section does not describe its features.
- **Letterboxd "lists".** Supported by the export file names in `PLATFORMS.md`, not by the market section.
- **Goodreads "very large community" and the 150M+ figure.** From the market table, which cites Wikipedia and a note that some figures came from search summaries. Check before using in a post.
- **Trakt "longer-established".** Inferred from the pricing history (Feb 2025) in the market section. No founding date is in the documents.
- **"Imports Letterboxd and IMDb lists".** Built and seen end to end on the local stack, with the file picker on Android needing a later APK (`docs/app-parity.md`). Confirm the shipped APK has it.
- **"Syncs with Trakt"** is the project's own approved wording. Trakt sync covers films and shows. It implies no partnership.
- Steam sync exists only for accounts carried over from the old website. Left out on purpose.
- **Play date.** These texts name no date. Play launch is paused on an account upgrade (`STATUS.md`).
- **Tags** are suggestions, not checked against AlternativeTo's tag list.
- **Character counts:** the AlternativeTo description is 484 characters, "about 500" as asked.
