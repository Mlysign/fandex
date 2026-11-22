# Fandex: facts sheet

_Draft for Nils to edit. Written 2026-11-22. Every claim is traced at the bottom._

## What Fandex is

Fandex is an app and a website that keep your films, shows, games and books in one list. It puts their release dates on one calendar and tells you on the day something comes out.

## What is different about it

**Rate your shows. Find your next book.**
Fandex learns your taste from what you rate in one kind of media and uses it for the others. It estimates what you would rate a book, a game, a film or a show you have not tried yet.

**Everything you're waiting for, on one calendar.**
One calendar shows the release dates of films, shows, games and books. The app sends a notification at 09:00 on the day a title on your wishlist comes out, a new season starts or the next episode airs.

**Your taste, in numbers.**
Fandex shows what you like and why: which genres, people and studios raise or lower your ratings. Every estimate has a "Why?" sheet that shows what it is based on. Only your own ratings count, not other people's.

## What it does

- Keep a wishlist and a library of films, shows, games and books.
- Rate a title from 1 to 10.
- See release dates on a month calendar, in the dates for your country.
- Get a reminder at 09:00 on release day, on the day a new season starts or on the day the next episode airs. There are three switches in Settings.
- Tick off episodes as you watch. An "Up next" list and a home-screen widget show the next episode of each show.
- See a "Recommended for you" list on the home screen.
- See an estimated rating for each title, called the Fandex Score. It is a number that says what you would probably rate it, worked out from your own ratings.
- See statistics about your own taste on an Insights page.
- Sync with Trakt (films and shows).
- Import a Letterboxd or IMDb list from a file.
- Download your data.
- Read titles in the language of the country you set. The app's own menus and buttons are in English only.

## Where it runs

- **Android app:** on Google Play from 16 February 2027.
- **Website:** fandex.org, in any browser.
- **No iPhone app.** The website works in an iPhone browser. Release reminders work only in the Android app, not on the website.

## Price

Free. There are no ads today. This sheet makes no promise about the future.

## Where the data comes from

- Films and shows: The Movie Database (TMDB), for titles, artwork, descriptions, cast and crew. Where to watch comes from JustWatch, through TMDB.
- Games: IGDB. Steam supplies store tags. Wikidata supplies some game credits.
- Books: Open Library and Hardcover.
- Watch history for films and shows: Trakt, if you connect your Trakt account.
- Trailers: YouTube.

Fandex is not endorsed or certified by any of these providers.

## Who made it

[name as Nils wants it shown], a solo developer in Germany.

## Contact

[press contact address]

## Numbers

- Launch on Google Play: 16 February 2027 (plan dated 2026-11-22).
- About 4,600 pages for single titles on fandex.org: 4,614 at the first publish on 2026-10-10, fewer since 105 duplicate games were merged on 2026-10-23.
- 853 books carry titles from Hardcover (measured 2026-11-22).
- On the owner's own films, the estimated rating landed within one point of the real rating 44% of the time, against 41% for simply guessing the owner's average (measured 2026-10-27, one person, so a first check and not a general result).

---

## Where each claim comes from

| Claim | File and place |
|---|---|
| Keeps films, shows, games and books in one list; calendar; Up next | `docs/app.md`, "What is built": Home, Wishlist, Calendar rows |
| Notification at 09:00 for a wishlisted release, a new season, the next episode; three switches; not on the website | `docs/app.md`, "Release reminders" row |
| Reminder wording for a show you are caught up on | same row ("a show you are caught up on") |
| Dates for your country | `docs/app.md`, Calendar row (`lib/regionalDates.ts`) |
| Rate 1 to 10 | `docs/app.md`, Item page row |
| Recommended for you | `docs/app.md`, Home row |
| Fandex Score as "what you would probably rate it", "Why?" sheet | `docs/app.md`, Item page row; `STATUS.md`, H5 row |
| Insights page | `docs/app.md`, Insights row |
| Only your own ratings count | `docs/release-plan/index.html`, id `st-3-proof`; "From your own ratings" in id `s-say` |
| Message wording and meanings | `docs/release-plan/index.html`, section `strategy`, ids `st-1` to `st-3` |
| Home-screen widget, ticking episodes | `docs/app.md`, Home-screen widget and Wishlist rows |
| Trakt sync | `docs/app.md`, Settings row; `PLATFORMS.md` table 2 |
| Letterboxd and IMDb import from a file | `docs/app-parity.md`, Import row |
| Download your data | `docs/app.md`, Settings row ("download", `/v1/me/export`); id `s-say` "Export everything" |
| Titles in the country's language; menus English only | `docs/app.md`, Search row (0.3.60); `docs/release-plan/index.html`, id `s-lang` |
| Launch 16 February 2027, Android app on Play and fandex.org | `STATUS.md`, "What's open"; `docs/release-plan/index.html`, id `g-sub` |
| No iPhone app; website works in a browser | `docs/website.md` ("fandex.org is files", the app in a browser); no iOS app appears in any doc |
| Free; no ads today; no promise | `docs/release-plan/index.html`, id `s-dont`; `STATUS.md`, Monetization (nothing is live, ads planned) |
| TMDB, JustWatch via TMDB | `PLATFORMS.md` table 1, TMDB and JustWatch rows |
| IGDB for games; Steam tags; Wikidata game credits | `PLATFORMS.md` table 1, IGDB, Steam, Wikidata rows |
| Open Library and Hardcover for books | `PLATFORMS.md` table 1; `docs/app.md`, "Books and board games" |
| Trakt for watch history | `PLATFORMS.md` table 2, Trakt row |
| YouTube trailers | `docs/app.md`, Item page row |
| Not endorsed or certified | `src/lib/legal/content/en/imprint.ts`, line 71; `docs/release-plan/index.html`, id `s-dont` |
| 4,614 item pages, 105 duplicates folded | `STATUS.md`, Roadmap, "Website" row |
| 853 Hardcover books with titles | `STATUS.md`, Prod, `fandex-api` bullet |
| 44% against 41% | `STATUS.md`, Roadmap, "H5" row |

## Unsure about

- **Play date versus Play status.** STATUS.md says the Play launch is paused until the developer account is upgraded. The plan page gives a fallback of 9 March 2027. The sheet says 16 February 2027 as asked. Change it if the account is late.
- **No iPhone app.** No document states "no iOS app" as a decision. It is true because only an Android build exists. Check the wording.
- **The page count.** STATUS.md gives 4,614 only for 2026-10-10 and says it is lower now without a new figure. "About 4,600" is rounded from that. Replace it with a fresh count from `build.json` before sending.
- **The 44% figure** is one person's ratings and is shown as such. Drop it if it reads as a claim about everyone.
- **Pool size.** STATUS.md says 11,496 titles in the pool, and in the same file 11,521 after a re-derive, both on 2026-11-22. Most of them are only the score's baseline and have no page, so neither is used.
- Steam sync exists only for accounts carried over from the old website. Left out on purpose.
- **Naming providers:** whether Steam and Wikidata may be named as providers in public copy is not stated. Steam's terms ask for its name and logo on pages that use its API (`PLATFORMS.md`, Steam terms box), and that has not been audited page by page.
- **IGDB** is the only games source, and its licence question is open (`STATUS.md`). Naming it is factual, but the owner may want to decide first.
- **Donations** are marked live in `STATUS.md` (H3 row) and are left out. "Free, no ads today" stays true with them, but check.
- **JustWatch** is named from `PLATFORMS.md`. The attribution the app shows to users was not checked.
- **Type count.** Board games are built but off until a BGG token exists, so the sheet says four types.
