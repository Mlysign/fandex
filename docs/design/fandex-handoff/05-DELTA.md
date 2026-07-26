# 05 · DELTA — everything that differs from the brief

Read this before building. If an element is not listed as shipping in the brief
and not listed here, **it does not exist** — do not infer it. Blunt on purpose.

---

## (a) Elements I INTRODUCED that the brief did not mention

### A1. Calendar **Agenda (list) view** — page: `/calendar`
- **What:** a second calendar view alongside the month grid: releases grouped
  under "This week / Next week / <Month>", each row = date stack + poster thumb +
  title + type + platform meta + a `BellPlus` remind action. Toggled by one pill
  button in the header (Month ⇄ List).
- **Why:** the month grid is poor on a phone for "what's actually coming" — cells
  are tiny and multi-release days overflow. Agenda is the better mobile default
  for scanning upcoming releases; month is better for shape-of-the-month.
- **Data:** per release: `id`, `title`, `mediaType`, `releaseDate`, `platforms[]`
  (display strings), `posterUrl`, and a per-user `reminderSet: boolean`.
- **Recommendation:** default to **Agenda on mobile**, **Month on desktop**;
  persist the user's last choice.

### A2. Discover **Advanced Filters** surface — page: `/discover`
- **What:** a filter panel with tri-state include/exclude controls for
  **Wishlisted** and **Already-rated**, plus **include/exclude tag** chips. (This
  directly implements your later request.) On mobile it is a bottom **Sheet**
  opened from a `SlidersHorizontal` button; on desktop it is a left rail / inline
  panel.
- **Why:** "index of everything you've played/watched/want to" implies heavy
  re-filtering of one's own corpus; include/exclude of wishlist & rated state is
  the core power-user move.
- **Data:** requires per-item, per-user flags: `isWishlisted`, `isRated` (and
  ideally `userRating`), plus a tag vocabulary with `tagId`/`label`, and the
  ability to query items by include-tags AND NOT exclude-tags. **See (d).**

### A3. **Facet pages** as first-class routes — Tag facet & Person facet
- **What:** a Tag (genre/tag) landing and a generic Person (actor OR director)
  landing. Each: identity header, a **stats-overview panel** (your average vs
  catalogue average, and the resulting Fandex Score impact), then a results/
  filmography grid. Person also has a "Known for" rail and a facts list.
- **Why:** you explicitly asked for Facet (Tag) and Facet (Person) and for the
  stats overview. They are the natural drill-down target from tags on the detail
  page and names in a cast list.
- **Route assumption (unverified):** `/tag/[slug]` and `/person/[id]`. The brief
  did not lock facet routes — **confirm before building.** They are not in the
  locked IA nav (reached contextually).
- **Data:** Tag facet needs `tag.label`, `tag.description`, `titleCount`,
  `userRatedCount`, `userAvgForTag`, `catalogueAvgForTag`, `scoreImpact`,
  `relatedTags[]`, and a filtered item list. Person facet needs `person.name`,
  `roles[]`, `bornDate`, `basedIn`, `creditCount`, `worksInTags[]`, `bio`,
  `knownFor[]`, `filmography[]`, and the same per-user stat quartet
  (`userAvg`, `catalogueAvg`, `scoreImpact`, `ratedCount`). **See (d).**

### A4. **Home stats strip + "best-rated genre" card** — page: `/` (logged-in)
- **What:** a 3-cell strip (tracked / avg rating / wishlist) and a single
  "your best-rated genre" card above the rails.
- **Why:** gives the logged-in home a personal spine before the discovery rails.
- **Data:** `stats.tracked`, `stats.avgRating`, `stats.wishlistCount`,
  `topGenre.{label,ratedCount,userAvg}`.

### A5. **Search "People" and "Matching tags" result groups** — page: `/discover`
- **What:** search results are grouped Titles / People / Tags, not titles only.
- **Why:** names and tags are legitimate search targets in a catalogue app.
- **Data:** search must return typed results: `titles[]`, `people[]`, `tags[]`.

### A6. **Quick-action bar on Poster Card** (Rate + Bookmark) & **rated** state
- **What:** every poster card carries an inline Rate and Bookmark control.
- **Why:** rating and wishlisting are the two verbs the whole product is built
  on; putting them on the card removes a navigation step.
- **Data:** per card, per user: `userRating`, `isWishlisted`; write endpoints for
  both. **Cost note:** this multiplies per-item personalization on every list.

### A7. Micro-elements: **eyebrow labels**, **"FOR YOU" pill**, **stacked-card
brand mark**, **status-bar chrome in mockups**. Cosmetic; no data. The status
bar in the mockups is device chrome for presentation, **not** a component to build.

---

## (b) Brief items I dropped, merged, or relocated

- **Nav can't hold all 7 routes.** The adaptive nav exposes 5: Home, Discover,
  Calendar, Library, Profile. **Wishlist is relocated** to a tab/section inside
  Library (they are the same "my stuff" surface); **Insights is relocated** under
  Profile. **Settings** is a sub-page of Profile as specified. If you require
  Wishlist as its own nav item, drop Calendar or Library from the bar — flag which.
- **"Similar items" is out of scope** (per brief) — I kept a "More like this"
  rail ONLY on the item-detail mockup as a placeholder frame; **do not build the
  recommendation logic.** It can render an empty/omitted section. Called out so
  it isn't mistaken for in-scope. If you want it fully gone, delete that rail.
- **Discover default sort = Popularity** (hard constraint) is honored. Note: an
  earlier facet/search mockup showed "Top rated" as the default chip — that was
  a facet-page default, **not** Discover. Discover opens on Popularity.

---

## (c) Where the design conflicts with the hard constraints

- **Media accent hexes — RESOLVED toward the shipping values.** Direction 2a's
  mockups used earthier variants (game `#6FA287`, movie `#B4623C`, show
  `#5C6B9C`). The tokens (`01`/`02`) instead ship the **required** hexes
  **game `#4ade80`, movie `#f59e0b`, show `#a78bfa`** to preserve semantics and
  downstream dependencies. **Consequence:** implemented screens will look a touch
  more saturated on the type dots than the 2a canvas mockups. This is intended.
  If design pushes back and wants the earthy variants, that is a hex change to a
  shipping token and must be re-approved — **do not change it silently.**
- **Fonts vs. "no CDN / no web fonts" (04 mockups only).** Production uses
  DM Serif Display / Space Grotesk / Space Mono via **next/font (self-hosted)**.
  The static mockups in `04-pages/` may not fetch fonts, so they fall back to
  Georgia / system-ui / ui-monospace. The mockups therefore under-sell the
  editorial serif — judge type from the tokens, not the mockups.
- **No other conflicts.** Stack (Next 16 / React 19 / Tailwind v4 `@theme` /
  lucide-react), dark-default, and the Score badge are all respected. No
  CSS-in-JS is used or implied.

---

## (d) Data assumptions I could not verify — validate these early

1. **Per-user, per-item personalization at list scale.** Cards, filters and
   facet stats assume every item can cheaply carry `userRating`, `isWishlisted`,
   `isRated`, and a personal **Fandex Score**. If these are expensive to compute
   per row, the card action bar (A6), Discover include/exclude (A2) and facet
   stats (A3) degrade or need batching.
2. **Fandex Score model.** Assumed a 0–100 personal taste-match computed per
   user per item, with a neutral baseline band 65–79. The **"score impact"**
   number on facet pages (e.g. "+6", "+7") assumes the model can attribute how a
   tag/person moves a user's aggregate score. **This attribution may not exist** —
   if not, replace the "+N Score impact" cell with a plain "you rate these +1.2
   above your baseline" statement (which only needs averages).
3. **Facet aggregates.** `catalogueAvgForTag` / per-person catalogue average and
   `userAvgForTag`/`userAvg` assume ratings are aggregable by tag and by person
   credit. Requires a tag taxonomy and a person↔title credit graph.
4. **Runtime / "hours" stat** on Insights assumes a duration per item (film
   runtime, show episode counts × length, game HLTB-style estimate). Game "hours"
   especially may be unavailable — if so, drop the "hours" headline stat or label
   it "titles" instead.
5. **Ratings distribution** (Insights histogram) assumes a 1–10 personal rating
   scale with counts per bucket. Confirm the rating scale (1–10 vs 5-star vs
   0–100) — the whole Insights page depends on it.
6. **Provider / where-to-watch data** (detail page) assumes availability by
   provider with stream/rent/buy + price. This is typically a licensed third-party
   feed (e.g. JustWatch-style). If absent, the "Where to watch" section is empty.
7. **Reminders** (`reminderSet` on calendar) assume a notification system exists.
8. **Facet routes** (`/tag/[slug]`, `/person/[id]`) are assumed, not locked (see A3).
