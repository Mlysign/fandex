# Launch posts: drafts

_Draft for Nils to edit, 2026-11-22. One post per place, in launch-week order, written as you. The place, its rule and the format come from `plan-data.js` (`launchWeek` and the `ch-*` items). The subreddit rules are being re-read by someone else, so every choice that leans on a rule is marked **[check rule]**. Facts are reused from `facts-sheet.md` and `store-listing.md`, which trace each one to a file._

_A line marked **(optional: use only once Steam connect ships)** stays out until a new user can connect Steam. Today only accounts from the old website can._

| Place | Day | Leads with |
|---|---|---|
| r/SideProject | Tue 16 Feb | Message 1, "Rate your shows. Find your next book." |
| r/Android | Wed 17 Feb | Message 2, the calendar and the reminders |
| Show HN | Thu 18 Feb | Message 3, the score and how it works |
| r/droidappshowcase | Fri 19 Feb | Message 1, gamer version: "Rate your movies. Find your next game." |
| Lemmy !android@lemdro.id | Fri 19 Feb | Message 2 |
| AlternativeTo | before launch | Message 1, show version: "Rate your books. Find your next show." |
| Product Hunt | Thu 25 Feb, optional | The slogan, "Know what's next." |
| r/indiehackers | Thu 25 Feb | Numbers, written after launch |

Play link used below: `https://play.google.com/store/apps/details?id=org.fandex.app` (the package name from `plan-data.js`, item `ad-entry`; check it once the entry exists).

---

## 1. r/SideProject

**Title**

```text
Fandex - rate your shows, find your next book. One tracker for movies, shows, games and books
```

**Body**

```text
[30 second screen recording]

I built Fandex on my own over [Nils: how long]. It's a tracker for movies, shows, games and books in one place. There's an Android app, and the same thing runs in a browser at fandex.org.

The part I cared about most: rate your shows, find your next book. When you rate things, Fandex works out which genres, people and studios you rate high or low. It then uses that on every type. So if you've rated a lot of shows and no books, it can still tell you which books you'd probably like.

What's in it today:
- One wishlist and library for all four types
- A release calendar with the dates for your country, and a phone notification at 9am on the day something you wishlisted comes out
- A number on each title that guesses what you'd rate it, from your own ratings only. Tap the question mark and it shows what pushed it up or down
- Sync with Trakt, and import from a Letterboxd or IMDb export file
- A home-screen widget with the next episode of each show
(optional: use only once Steam connect ships) - Bring in your Steam library and wishlist

It's free and has no ads. I'm a game developer by trade, so games get the same treatment as movies here.

Two things I'd like to hear about. Does the cross-type part make sense when you try it, or does it feel like a trick? And what would you miss first, coming from the tracker you use now?

Android: https://play.google.com/store/apps/details?id=org.fandex.app
Web: https://fandex.org
```

**Rule this follows:** launch posts are welcome, the title is "Name - short description", the format is "I made this" with a 30 second recording. [check rule] whether the sub wants the video uploaded as the post (then the links go in a first comment) or a text post with the video linked. [check rule] whether two links in the body are allowed.

---

## 2. r/Android (the long text post)

**Title**

```text
I built a release calendar for movies, shows, games and books that reminds you on release day. Here's how it works on Android, and what's missing
```

**Body**

```text
Hi r/Android. I'm Nils, a game developer in Germany, and for the last [Nils: how long] I've been building Fandex on my own. It's out on Google Play today. Some background, because this sub asks for detail and I'd rather show my work.

What it's for
Everything you're waiting for, on one calendar. Movies, shows, games and books share one month view. The dates are the ones for your country, so a film shows up on the day it opens where you live, not the US date.

Put a title on your wishlist and the phone shows a notification at 9am on the day it comes out. The same works for a new season of a show you're caught up on, and for the next episode. There are three switches in Settings, one for each kind of reminder.

How the reminders work
They're scheduled on the phone itself. There's no push service and no server sending them. The app plans them after every sync and sets them as local notifications, so they arrive even if my server is down that morning. Android asks for the notification permission once.

Other Android bits
- A home-screen widget with the next episode of each show. You can tick an episode watched from the widget without opening the app.
- Your library and the catalog are kept on the phone, so search and your lists work without a connection.
- No ads and no tracking SDKs. You can download a copy of your data or delete your account in Settings.

The other half: your taste
Rate what you've watched, played and read from 1 to 10. Each title then gets a number that guesses what you'd rate it, worked out from your ratings only. What other people think doesn't count. A "Why?" sheet shows which genres, people and studios moved it.

Sync and import
- Trakt sync for movies and shows, both ways: ratings, watchlist and watched episodes.
- Import from a Letterboxd or IMDb export file.
(optional: use only once Steam connect ships) - Steam: your library and wishlist come in when you connect your account.

What it doesn't do (yet)
- The app's menus are English only. Titles show in the language of the country you pick.
- No iPhone app. fandex.org works in any browser, but reminders only exist in the Android app.
- No reviews, no social feed. It's ratings and lists.
- The taste number needs some ratings before it means much.

It's free. I'd really like to hear what breaks on your phone, and what you'd want from the calendar that isn't there. I'll be in the comments all day.

https://play.google.com/store/apps/details?id=org.fandex.app
```

**Rule this follows:** a detailed text post from an account at least 3 months old with history in the sub. Mods filter every self post, so it may take hours to appear. Answer every comment the same day. [check rule] whether a Play link is allowed in the body or must go in a comment. [check rule] whether there's a required flair or a weekly self-promotion day instead of a free post.

---

## 3. Show HN

**Title** (HN cuts titles at 80 characters; this is 65)

```text
Show HN: Fandex, a taste score for movies, shows, games and books
```

Link: `https://fandex.org`

**First comment**

```text
Hi HN. I'm Nils, a game developer. Fandex is a tracker for movies, shows, games and books, with an Android app and the same app running on the web. You can browse the calendar, search and open any title without signing up. To get your own numbers you need to sign in and rate a few things.

The part I'd like feedback on is the score. Your taste, in numbers: every title gets a number that means "what you'd probably rate this, times ten". It's not a quality rating and it ignores what everyone else thinks. A test fails the build if the score code reads crowd ratings or popularity.

How it works, roughly:
- It starts from your average rating for that medium.
- Each title carries facets: genres and other tags, people (director, writer, author, developer), studios, franchise.
- For each facet you've rated enough titles with, it looks at how far your ratings sit from your own average, smoothed so three titles don't swing it much.
- The title's number is your average plus the weighted sum of those deviations. The gain is fitted to your own ratings, so 72 should mean about a 7.
- A title you already rated is scored as if you hadn't rated it, so it can't quote itself back to you.

There's no model in the ML sense. It's a sum you can read, and the "Why?" sheet shows the parts. The same facets work across media, which is why rating shows can score a book you've never touched.

How good is it? Honestly, modest. On my own 939 film ratings it lands within one point of my real rating 44% of the time. Guessing my average does that 41% of the time. It does better on games than on films. The app shows you the same check on your own ratings, so you can judge it for yourself.

The stack: Expo and React Native for the Android app and the website from one code base. The site is a static build on Cloudflare. A Cloudflare Worker with D1 holds accounts and the catalog. The score runs on the device, not the server, against a copy of the catalog kept on the phone.

Data comes from TMDB, IGDB, Open Library and Hardcover, and Trakt if you connect it. This product uses the TMDB API but is not endorsed or certified by TMDB. Fandex uses Trakt but is not endorsed or certified by Trakt.

I'd like to hear where the score is obviously wrong for you, and whether showing the parts of the sum helps or just adds noise.
```

**Rule this follows:** it must be usable without signing up, which fandex.org is (calendar, search, title pages). Never ask for votes. Post at about 15:00 German time (9am US East). HN's own guidelines are stable and not part of the Reddit re-read, so nothing here is marked.

---

## 4. r/droidappshowcase

**Title**

```text
Fandex: rate your movies, find your next game. A tracker and release calendar for movies, shows, games and books
```

**Body**

```text
[store stills]

Hi, I'm Nils. I made Fandex, a free Android app that keeps movies, shows, games and books in one list.

Rate your movies. Find your next game. The ratings you give in one type shape the suggestions in the others. Fandex looks at which genres, people and studios you rate high or low, and uses that on every type. So the movies you loved help pick the game you play next.

Also in it:
- A release calendar with the dates for your country, and a notification at 9am on release day
- A number on each title that guesses what you'd rate it, with a sheet that shows why
- Trakt sync, and import from Letterboxd or IMDb
- An Up next widget for your shows
(optional: use only once Steam connect ships) - Your Steam library and wishlist, synced

No ads. The menus are English only for now. Feedback is very welcome, especially on the games side.

https://play.google.com/store/apps/details?id=org.fandex.app
```

**Rule this follows:** one app post a week; r/androidapps now sends launch posts here; the format is a showcase post with the stills. [check rule] the required title format or flair, and whether stills go in a gallery post or as links.

---

## 5. Lemmy: !android@lemdro.id

**Title**

```text
Fandex: one calendar for upcoming movies, shows, games and books, with a reminder on release day
```

**Body**

```text
I'm a solo developer and this is my app. Everything you're waiting for, on one calendar: movies, shows, games and books in one month view, with the release dates for your country.

Wishlist something and your phone gets a notification at 9am on the day it's out. Same for a new season of a show you're caught up on, and for its next episode. The reminders are scheduled on the phone, with no push service.

You can also rate titles from 1 to 10, and Fandex guesses what you'd rate the rest, from your own ratings only. It syncs with Trakt and imports Letterboxd and IMDb export files. There's an Up next widget for shows.
(optional: use only once Steam connect ships) Steam libraries and wishlists sync too.

Free, no ads, no tracking SDKs. Menus are English only. Happy to answer questions.

https://play.google.com/store/apps/details?id=org.fandex.app
```

**Rule this follows:** active members may post their own app; no links to your own site or blog, so the store link is the only link and fandex.org is not named. [check rule] whether "active member" means a minimum account age or number of comments on that instance.

---

## 6. r/indiehackers (skeleton, written after launch)

**Title**

```text
I launched a solo-built media tracker a week ago. [number] installs, [number] sign-ups, and what I'd do differently
```

**Body**

```text
Last Tuesday I launched Fandex, an Android app and website for tracking movies, shows, games and books in one place. I built it alone. Here are the numbers from the first [number] days, and I'd like your read on them.

The numbers
- Play installs: [number]
- Accounts created: [number] ([number] still active after a week)
- Titles rated: [number] in total, [number] per active account
- fandex.org page views: [number] a day at the peak, [number] now
- Cost of running it in launch week: [left out on purpose, see the plan's "Avoid" list]

Where they came from
- r/SideProject: [number] upvotes, [number] comments, [number] installs that day
- r/Android: [number] / [number] / [number]
- Show HN: [front page or not], [number] visits
- Press mails: [number] sent, [number] replies
- [the channel that surprised me]

What worked
[one or two short paragraphs]

What didn't
[one or two short paragraphs]

What people asked for most
1. [request]
2. [request]

What I'm unsure about
[the question for this sub: one thing, phrased so people can answer it]

The app, if you want to look: https://play.google.com/store/apps/details?id=org.fandex.app
```

**Rule this follows:** one product, the Self Promotion flair, framed as asking for feedback; the format is "what the launch taught me" with real numbers. [check rule] whether the link is allowed in the body or only in a comment. [check rule] whether the flair name is still "Self Promotion". Running costs are a placeholder that stays empty: the plan's "Avoid" list says no figure for running costs.

---

## 7. AlternativeTo listing

The per-app "alternative to" texts (TV Time, Trakt, Letterboxd, Goodreads, Backloggd) are in `directory-texts.md`. This is the main listing, led by message 1 in its show version, since the first people to reach there are former TV Time users.

**Name:** Fandex

**Tagline** (37 characters)

```text
Rate your books. Find your next show.
```

**Description** (588 characters)

```text
Fandex keeps your movies, shows, games and books in one list. Rate what you've seen, played and read, and it works out which genres, people and studios you like. It uses that across every type, so your books help pick your next show. Each title gets a number that guesses what you'd rate it, from your own ratings only, with a Why sheet that shows what moved it. Release dates for your country sit on one calendar, and the Android app reminds you at 9am on release day. It syncs with Trakt, imports Letterboxd and IMDb files, and lets you download your data. Free, on Android and the web.
```

Optional line, use only once Steam connect ships: `It also syncs your Steam library and wishlist.`

**Notices** (for the listing's notes field, if it has one)

```text
This product uses the TMDB API but is not endorsed or certified by TMDB.
Fandex uses Trakt but is not endorsed or certified by Trakt.
```

**Rule this follows:** the listing is free; paid only speeds up the review. List it as an alternative to TV Time, Trakt, Letterboxd, Goodreads and Backloggd. AlternativeTo is not a subreddit, so nothing here is marked [check rule].

---

## 8. Product Hunt (optional)

**Tagline** (max 60; this is 51)

```text
Know what's next in movies, shows, games and books
```

**Description** (max 260; this is 252)

```text
One list and one release calendar for movies, shows, games and books, with a reminder on release day. Rate what you know and Fandex guesses what you'd rate the rest, from your own ratings only. Tap Why to see what moved the number. Android and the web.
```

**First comment**

```text
Hi Product Hunt, I'm Nils. I built Fandex alone, and it's free.

Know what's next has two meanings for me. What comes out next: every movie, show, game and book you're waiting for sits on one calendar, with the dates for your country, and the Android app reminds you at 9am on the day. And what to pick next: rate things you know, and Fandex guesses what you'd rate the rest. It learns across types, so rating shows helps it suggest books.

The guess comes only from your own ratings, not from what everyone else thinks. The Why sheet shows which genres, people and studios moved it. It's a modest predictor and I say so in the app, which shows how close it has been on your own ratings.

It syncs with Trakt and imports Letterboxd and IMDb export files.
(optional: use only once Steam connect ships) Your Steam library and wishlist come in too.

I'd like to know where it gets your taste wrong. I'll be here all day.
```

**Rule this follows:** a launch starts at 12:01am Pacific; a weekday brings more traffic; only if the week left energy. Tagline 60 characters, description 260. Product Hunt is not a subreddit, so nothing here is marked [check rule].
