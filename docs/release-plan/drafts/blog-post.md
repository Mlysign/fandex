# Blog post: "Why I built Fandex"

_Draft for Nils to edit, 2026-11-22. For the launch post on fandex.org (`plan-data.js`, `lw-tue`). Everything in it is taken from the app and its docs. The five "[Nils: ...]" slots are where only you can fill in a personal detail. Nothing personal is invented._

---

# Why I built Fandex

I'm a game developer, and Fandex is the tracker I wanted for myself. [Nils: how you kept track of films, shows, games and books before, and what made you stop.]

Most trackers know one slice of you. A film app knows your films. A book site doesn't know any of that, so it suggests what everybody else is reading. None of them can tell you that a show you loved and a novel you hadn't heard of were made for the same person.

That's the first thing Fandex does. Rate your shows, and it can find your next book.

## One taste, used everywhere

When you rate a title from 1 to 10, Fandex looks at what it's made of: its genres and other tags, the people behind it, the studio, the franchise. Over time it learns which of those you rate above your own average and which you rate below it.

Those things don't stop at one kind of media. A writer can work on a show and a novel. A setting or a mood you like turns up in games and films alike. So the same picture of your taste can score a book you've never seen, using nothing but the shows, films and games you rated. [Nils: one real example from your own library, if you have one you like.]

## A number that means one thing

Every title gets a Fandex Score. It answers one question: what would you probably rate this? A 72 means about a 7. It isn't a quality rating, and what other people think doesn't count. Only your own ratings go in.

I wanted it to be honest about itself. Tap the question mark next to the number and the Why sheet shows what pushed it up or down. Open "How the score works" and you see how close it has been on your own ratings. On my own films it lands within one point of my real rating 44% of the time, where just guessing my average does it 41% of the time. That's a modest edge. It does better on games. I'd rather show you that than pretend it reads your mind.

The Insights page shows the same thing from the other side: which genres, people and studios you rate high or low, and how much each one moves your numbers. Your taste, in numbers.

## Everything you're waiting for, on one calendar

The other thing I kept missing was a single place for release dates. Films, shows, games and books all come out on different days in different countries, and most calendars cover one kind of media and one country's dates. [Nils: a release you missed, if there is one worth telling.]

In Fandex they share one month view, with the dates for the country you pick. Put something on your wishlist and the Android app reminds you at 9 in the morning on the day it comes out. The same goes for a new season of a show you're caught up on, and for the next episode. The reminders are set on the phone itself, so they don't depend on my server being up that morning.

## What it is, and what it isn't

Fandex is free and has no ads. It syncs with Trakt, imports your Letterboxd or IMDb export, and lets you download all your data or delete your account from Settings. It runs as an Android app and, from the same code, at fandex.org in any browser.

It doesn't have reviews or a social feed. The menus are in English, though titles show in your country's language. There's no iPhone app, and reminders only work in the Android app.

I built it on my own, in [Nils: when and how you found the time]. If something is wrong or missing, the Support row in the app reaches me, and I read everything.

[Nils: a closing line in your own words, or cut this.]

---

_Notices: This product uses the TMDB API but is not endorsed or certified by TMDB. Fandex uses Trakt but is not endorsed or certified by Trakt. Game data comes from IGDB. Book data comes from Open Library and Hardcover._

_Optional paragraph, use only once Steam connect ships (after "imports your Letterboxd or IMDb export"): "Connect Steam and your library and wishlist come in too."_

---

## Where the claims come from

| Claim | Source |
|---|---|
| Rate 1 to 10; facets: tags, people, studio, franchise | `docs/app.md`, Item page row; `docs/fandex-score.md` §1, §3 |
| Ratings in one medium score another | `docs/release-plan/index.html`, `st-1-proof` (99% of what scores an unrated book comes from films, shows and games) |
| "What you would probably rate this", 72 means about a 7 | `docs/fandex-score.md`, header note of 2026-10-27 |
| Only your own ratings; crowd ignored | `PLATFORMS.md` §1; `index.html`, `st-3-proof` |
| Why sheet; "How the score works" shows how right it has been | `docs/app.md`, Item page row |
| 44% against 41%, better on games | `docs/fandex-score.md` §1 |
| Insights: genres, people, studios, impact on the score | `docs/app.md`, Insights row |
| One calendar, dates for your country, 9am reminders, three kinds | `docs/app.md`, Calendar and Release reminders rows |
| Reminders set on the phone, no server | `docs/app.md`, Release reminders row ("no server, no push service") |
| Trakt sync, Letterboxd and IMDb import, export, delete | `docs/app.md`, Settings row; `docs/app-parity.md`, Import row |
| Android app and same code in a browser | `docs/app.md`, opening of "What is built" |
| No reviews, English menus, titles in country's language, no iPhone app | `facts-sheet.md`; `index.html`, `s-lang` |
| Support row | `docs/app.md`, You row |

## Unsure

- **"Most calendars cover one kind of media and one country's dates"** is a general claim about other apps, not measured in the repo. The market section of `index.html` backs "one kind of media" for Letterboxd, Goodreads and Backloggd, not the country part.
- **"The tracker I wanted for myself"** assumes that is why you built it. Change it if not.
- **"I read everything"** is a promise. Cut it if you can't keep it in launch month.
- **Message 1 is not visible in the app yet** (`index.html`, `st-1-owed`). The effect is real, but a reader can't see the cross-media part happen until the Why sheet names the media (`pr-crosswhy`).
- **"Download all your data"**: the privacy policy says the export is "everything the app holds about you", so "all" is backed. The store listing says "a copy" to be careful.
