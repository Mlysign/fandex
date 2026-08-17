# Fandex — Task Tracker

> **This file holds only what is still open.** Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it for the "why" behind a past decision; never read it end to end). One-page state → [STATUS.md](STATUS.md).

- **Legend:** ⬜ not started · 🔵 in progress / needs input · ⏸️ blocked · ✅ done
- **Convention:** an entry is 2–4 sentences + a commit hash once done. The full story (root cause, files touched, verification) belongs in the commit message, not here. **When a section is fully done, move it to the archive the same session** — this file blew past its 200-line CI guard twice (441 lines, then 374) from skipping that step.

---

## ✅ Decisions LOCKED 2026-08-17 — do not re-open these

Nils answered the full open-decision list in one pass. Treat every line here as settled; a future session that re-raises one is wasting his time.

1. **Impressum: APPROVED as-is.** H4.2 closes. **All of H3 is unblocked.**
2. **Affiliate signups: GO, starting with GOG, now.** The "prod stably up for days, not hours" gate is met (serving since 2026-08-12). Sequence unchanged: GOG → Humble → Fanatical → GMG → **Amazon LAST**. Claude does not do the signups — they carry his tax/payment identity.
3. **H3.0 is CLOSED as WON'T DO. The support page must NEVER quote a running-cost figure — permanently, not "until we have one".** The qualitative line ("Hosting, Domain und die Dienste … gehen auf eigene Rechnung") stays; no number ever joins it. Do not re-add H3.0 as an open item.
4. **Fandex Score range: RELABEL (option c).** 0–100 is a **target, not a rule**. His reasoning, worth keeping: *exceeding 100 is rare and makes an item stand out — it promotes the score rather than making it unbelievable.* So **no re-tune, no top-N change, `ip` stays at 3.** `docs/fandex-score.md` §1 updated to match. SM39 finding 2 is CLOSED.
5. **The three franchise calls stand.** Smash Bros + PlayStation All-Stars stay removed from Metal Gear; the `metal gear solid` → `metal gear` bundle stays; the game `Journey` stays unattached from the `Journey Collection` movie collection.
6. **MB7: deferred, then FIXED and confirmed working on Nils's device the same day.** It was never the nav — Insights overflowed horizontally, Chrome shrink-to-fit zoomed the layout viewport out, and the `fixed bottom-0` bar pinned below the fold. **The mobile batch is 15/15.** → archive, grep `MB — mobile testing batch`.
7. **Android TWA (P15/P16): NEEDS MORE DETAIL** before he acts — "Bubblewrap" read as belonging to a different project. See the P15/P16 section.
8. **H3.8 thresholds: APPROVED.** Ads at **10,000 pageviews/mo**, freemium at **3,500 sustained weekly-actives**. The long-standing "defined but explicitly NOT approved" guard is **retired** — these are now real triggers.
9. **`PRUNE_ON_BOOT` stays ON** (the guard has held in prod three times). **`priorStrength` / role-weight re-tune: NOT needed — current tuning approved as good.** That time-gated item is closed.
10. **Shimmer/blank-state check: DONE**, and it found a real bug — Discover rendered "No results for X" for ~300 ms *before* the search started, because the search is debounced 300 ms while `searchLoading` is only set inside `runSearch`. Fixed with a `searchedQ` gate. → archive, grep `SM44 heal budget`.

---

- **Legal pages — all `TODO(...)` strings resolved** ✅ 2026-08-17. Two were factually wrong after that day's decisions (privacy claimed no postal address was published while the approved Imprint publishes one; terms claimed H3.8 was undecided), and `TODO(H4.3)` was answered per-case rather than as one blanket claim. **The rule that outlives it: strings in `src/lib/legal/content/{de,en}/*.ts` `body:` arrays RENDER to users — they are not code comments.** → grep the archive for `TODO(H4.3)`.

## ⚠️ Needs Nils — this is the whole list

Everything else in this file is either done or a standing constraint. Only three things are waiting on a human.

1. **Sign up for the affiliate programs — GOG first.** Unparked 2026-08-17: prod has been stably up since 2026-08-12 and the Impressum is approved, so both gates are clear. Sequence: **GOG** (the only merchant the catalog already product-links) → Humble → Fanatical → GMG → **Amazon LAST**, because applying to Amazon starts a 180-day / 3-qualifying-sale clock that closes the account if missed. Then set the env vars and flip `MONETIZATION_ENABLED`. Full walkthrough → [docs/monetization-go-live.md](docs/monetization-go-live.md). **Claude does not do these** — they carry your tax and payment identity.

2. **Android TWA (P15/P16): do it, or park it explicitly.** Full context is in the P15/P16 section below — it is Fandex shipped as a thin Play Store wrapper of the website (your 2026-06-18 decision), and it needs a signing key plus a one-off $25 Play account. Either answer is fine; it blocks nothing. Right now it just reads as in-progress work that isn't progressing.

3. **Re-run the RAWG cross-link sweep once RAWG is back up.** It was down all of 2026-08-17 (timeouts, open circuit), so 168 games still lack a RAWG link. Same shape as the Steam and IGDB sweeps that did run: `POST /api/dev/crosslink {"source":"rawg","maxItems":25}` from the browser console on fandex.org while logged in, repeating with the returned `afterId` **until the cursor drains** — never chasing the `needing` count, which never reaches zero. Not urgent: those games now have IGDB as a second source, so they still score.

**Standing constraints — not tasks, but do not violate them:**
- **Ko-fi: no tiers, no perks, no memberships.** A donation with consideration is a taxable supply *and* a much stronger "commercial use" reading against TMDB's non-commercial-only free tier.
- **The support page never quotes a running-cost figure** (H3.0, closed as won't-do 2026-08-17). The qualitative "it costs money to run" line stays; no number ever joins it.
- **Do NOT contact TMDB or Trakt about commercial terms** while monetizing on their free tiers — the accepted risk is key revocation, and asking invites it.
- **Watch that prod stays up.** Continuous since 2026-08-12; both prior outages were un-routings (billing/pause), never crashes — `uptime` climbed monotonically through both.

## Open — carried forward from Phase 6

### P15/P16 — the Android app. Read this before deciding; "Bubblewrap" needed context.

**This is Fandex, not a different project.** It traces back to a decision you locked on **2026-06-18**: *"public website first, Android as a PWA/TWA wrapper"* — i.e. Fandex ships to the Play Store as a **thin Android app that just displays fandex.org**, not as a separate codebase. Two months on, the name of the tool (Bubblewrap) carried none of that context. Fair.

**What a TWA is.** A *Trusted Web Activity* is an Android app whose entire content is your website, rendered by the user's Chrome. No second codebase, no rewrite, no separate release of features — you ship the website, the app shows it. The only reason it isn't just a browser shortcut is that a TWA can **hide the browser address bar**, so it looks like a native app. Hiding that bar is exactly what needs proving you own the domain — which is what P15 is.

**What's already built (by Claude, done):** `src/app/.well-known/assetlinks.json/route.ts` serves the Digital Asset Links file Google's verifier fetches. It's env-driven and currently returns an empty `[]`, which is valid JSON and simply means "no app claims this origin yet". **P14 (PWA manifest + service worker) is also done** — that's the prerequisite that makes the site installable at all.

**What only you can do, and why.** Generating the Android package requires creating a **signing key** and a **Play Console account** — a credential and an account tied to your identity, so Claude does not do it. The mechanical shape:
1. Run **Bubblewrap** (Google's CLI) or **PWABuilder** (a website that does the same thing without installing anything) against `https://fandex.org/manifest.webmanifest`. Output: a signed `.aab` plus two values — the **package name** (e.g. `org.fandex.twa`) and the signing cert's **SHA-256 fingerprint**.
2. Set those as `TWA_PACKAGE_NAME` and `TWA_CERT_FINGERPRINT` on Railway. The route above starts serving a real claim; verify at `/.well-known/assetlinks.json`.
3. Upload the `.aab` to the Play Console. (Google charges a **one-off $25** developer registration.)
4. **P16** then verifies the thing that most plausibly breaks: **OAuth inside the app's webview** — Trakt/TMDB/Steam redirect URIs re-registered for prod, deep-link return, and `sameSite` cookie behaviour on the round-trip. This is why P16 exists as separate work rather than "it just works".

**The honest cost/benefit.** Benefit: a Play Store listing and an installable icon without maintaining an Android app. Cost: a $25 account, a signing key you must never lose, and P16's OAuth verification — the webview is a genuinely different cookie environment from desktop Chrome, and sign-in breaking there is the realistic failure.

**Decide:** do it, or explicitly park P15/P16 so they stop reading as in-progress work. Either is fine — **the website is unaffected either way**, and nothing else depends on this.
- **P18** ✅ 2026-08-03 — **JustWatch clickable streaming links.** Its original blocker (a JustWatch Content Partner API + a full-catalog re-projection) turned out to be wrong on both counts: TMDB already returns a per-region `link` in the payload already fetched, and the existing lazy self-heal path (`ensureTmdbDetail`) delivers it one detail view at a time — no mass op needed. → [archive](docs/archive/history.md), grep `P18 streaming links`.

---

## Closed epics — pointers only (full write-ups in the archive)

- **PR17 — post-outage verification** ✅ 2026-08-12. All five steps; the leak and the memory ramp are confirmed dead in prod and backups proven by a real restore drill. Two corrected beliefs before touching backups: an **unchanged** Litestream generation is the HEALTHY signal, and `wal-truncate` reclaims nothing while Litestream runs. → grep `PR17`.
- **H4 — legal & compliance** ✅ 2026-08-03. Three standing guards survive it, reproduced verbatim in `AGENTS.md`: a cookie banner isn't needed today but **any analytics/affiliate-tracking/ad script triggers it**; **"the nav reaches it" is a different claim per auth state** ([[anon-legal-reachability]]); the Impressum stays `noindex, nofollow, noarchive, nosnippet` and out of `sitemap.ts`. Live refs: [compliance-review](docs/compliance-review.md) · [cookie-assessment](docs/cookie-assessment.md) · [monetization-legal](docs/monetization-legal.md).
- **Smoke test 2026-08-12 (11th run)** ✅ All five findings fixed (SM38–SM42). The valuable half was the RAWG outage it ran during, which re-verified the three 2026-08-02 single-source games bugs as fixed under the exact condition that exposed them. → grep `Smoke test 2026-08-12 11th run`.
- **Facet-page compute + provider quota** ✅ 2026-08-13. Closed by a persisted SQLite L2 (`facet_page_cache`, `src/lib/facetCacheStore.ts`); `/tag/western` 63.17 s → 0.092 s across a full restart, zero provider calls warm. **⚠️ The "59.8 s render" that motivated it was 93% a dead RAWG, not inherent cost** — don't re-justify cache work with that figure. → grep `Facet-page compute`.

---

- **MB — mobile testing batch (15 notes)** ✅ **COMPLETE 15/15, 2026-08-17.** MB7 was last: "the bottom nav scrolls away on Insights" turned out to be **horizontal overflow**, not the nav — the page overflowed, Chrome shrink-to-fit zoomed the layout viewport out, and the `fixed bottom-0` bar pinned itself below the fold. Five sources, all `min-width: auto` on a flex/grid item. **Two rules worth keeping: `truncate` does nothing inside a flex row without `min-w-0`, and a fixed element must be checked with `bottom` vs `visualViewport.height` at SEVERAL widths (320/360/412) — a single-width pass gave a false green and shipped an incomplete fix.** → grep the archive for `MB — mobile testing batch`.

## H3 — Monetization 🔵 v1 built 2026-08-03; donations live, affiliate dark

**Goal:** revenue covers upkeep (Railway, domain, third-party APIs).

**The economics pivot on TMDB, not on hosting.** Upkeep is small (Railway Hobby $5/mo + usage, domain ~€10/yr, all APIs currently €0) — but TMDB's free API is **non-commercial only** and commercial use is **$149/mo**. So "commercial" multiplies upkeep ~10× overnight; any paid model must clear ~$155/mo before netting a cent. Trakt requires case-by-case approval for monetizing apps. RAWG is safe (free commercially to 20k req/mo + 100k MAU, no redistribution). **Donations are the gray zone** — TMDB doesn't say whether donation-funded counts as commercial.

**MODEL DECISION (locked 2026-07-18): v1 = donations + affiliate links (incl. gray-market key shops) only.** Ads and the one-time ad-free unlock are **deferred, not cancelled** — parked as Path B alongside freemium, all triggered by H3.8. **Consciously accepted risk:** Fandex monetizes on the free TMDB/Trakt tiers ("under the radar"). Failure mode is **API-key revocation without notice**, not a fine. **Do NOT contact TMDB/Trakt about commercial terms while under the radar.**

**Built 2026-08-03 — H3.3 ✅ (donations, live) · H3.4 ✅ (affiliate, DARK behind `MONETIZATION_ENABLED`) · H3.9 ✅ (go-live checklist).** Full write-ups → [archive](docs/archive/history.md), grep `H3 monetization v1`. Operating instructions → [docs/monetization-go-live.md](docs/monetization-go-live.md). **The one thing to know before touching any of it:** the catalog's store rows are Steam/PSN/GOG/Xbox/Nintendo/Epic/itch.io and only **GOG** is affiliate-capable, so `affiliate.ts` has *two* mechanisms — a rewriter for GOG-shaped links and `buildBuyLinks()` synthesizing per-title search links for the merchants we have programs with. → [[monetization-h3]]

**Still open:**
- **H3.0** ✅ **CLOSED as WON'T DO 2026-08-17** — the support page never quotes a cost figure. Permanent, not pending.
- **Affiliate program signups** 🔵 **UNPARKED 2026-08-17 — GO, GOG first.** The uptime gate is met (prod serving since 2026-08-12) and the Impressum is approved, so the §5 DDG gate is clear too. Walkthrough → [docs/monetization-go-live.md](docs/monetization-go-live.md). **Nils does these himself** — they carry his tax/payment identity.
- **H3.8** ✅ **APPROVED 2026-08-17** — the thresholds below are now REAL triggers, not a parked proposal. The previous standing instruction ("defined but explicitly NOT approved — a future session must not read them as settled") is **retired**. **Path B trigger**, two arms with different metrics:
  - **Ads → 10,000 pageviews/mo** (Monumetric's stated minimum). A better-RPM tier exists at 50k+ pv (Freestar/Mediavine, $15–40+ vs Monumetric's $10–20) — not a second gate, just worth re-checking which network fits.
  - **Freemium → 3,500 sustained weekly-active users.** The old "roughly 1k+ actives" napkin figure never netted out TMDB's $149/mo license. Actives needed to clear **just** the license (≈€137, no margin): 2%/1€ → 6,850 · 2%/2€ → 3,425 · 5%/1€ → 2,740 · 5%/2€ → 1,370. Even the best-case corner is above 1k. 3,500 clears it with real margin at a *conservative* 3%/1.50€, leaving room for Trakt's separate approval and normal churn.
  - **The metric, checked against the live schema:** no pageview/session log exists, and **`users.last_seen_at` is a false friend** — it's written only on a RAWG login or Steam OAuth callback (`src/app/api/auth/rawg/route.ts:72`, `.../steam/callback/route.ts:65`), never on an ordinary revisit via an existing 30-day cookie, and never at all for TMDB/Trakt. It undercounts badly. The best signal computable today (verified against the real DB) is "touched library/wishlist/rating in the last 7 days":
    ```sql
    SELECT COUNT(DISTINCT user_id) wau FROM (
      SELECT user_id, added_at ts FROM user_library WHERE added_at >= :weekAgo
      UNION ALL SELECT user_id, reviewed_at FROM user_library WHERE reviewed_at >= :weekAgo
      UNION ALL SELECT user_id, added_at FROM user_watchlist WHERE added_at >= :weekAgo
      UNION ALL SELECT user_id, added_at FROM user_item_state WHERE added_at >= :weekAgo
      UNION ALL SELECT user_id, reviewed_at FROM user_item_state WHERE reviewed_at >= :weekAgo
    )
    ```
    It counts only users who took a write action — a pure browser isn't captured by anything in the schema.
  - **✅ `last_seen_at` is now real (2026-08-03).** Stamped in `getSession()` (`src/lib/session.ts`), the one funnel every authenticated request passes through, rate-limited to **one write per user per UTC day** — `getSession()` runs several times per render, so an unconditional write would turn every authed read into a write. The freshness check is free: it rides along on the SELECT the epoch check already does. Best-effort (a write error is swallowed — a metric must never fail a login) and stamped only **after** epoch validation, so a revoked token can't report its owner active. Verified against the real `data/rr.db`: all three users were 7–11 days stale, a dev-login stamped only that user, and two further authed page loads wrote nothing. **This does not approve H3.8's thresholds** — it's the meter, not the trigger. Activity data is uncollectable retroactively, which is why it went in first.

**What's left before affiliate revenue exists:** Railway back → sign up (GOG first, **Amazon last** — its 180-day/3-sale clock closes the account if missed) → set the env vars → flip `MONETIZATION_ENABLED` → run the post-go-live cookie check. All of it is in the go-live doc.

---

- **SM39 — the Fandex Score range** ✅ CLOSED 2026-08-17. Root cause (prod's hand-tuned gains) fixed 2026-08-14; the residual out-of-range was then **relabelled, not re-tuned** — 0–100 is a target, see `docs/fandex-score.md` §1 and the locked-decisions list above. → grep the archive for `SM39`.

- **Franchise / IP as a scoring factor** ✅ CLOSED 2026-08-17. Built + Wikidata-swept 2026-08-14; the panel was cleared on prod 2026-08-17 (metal gear bundled, two crossover cameos removed, 70 of 71 suggestions applied). `ip` stays at **3**. → grep the archive for `Franchise / IP`.

## 🟡 `/library` + `/wishlist` are dead under `next dev` — DEV ONLY ⬜ your call which fix

**Found 2026-08-17 while verifying migration 16. Production is NOT affected** — a `next start` build hydrates both pages and renders real items, so fandex.org was never broken. (An earlier note in this file said it was; that was wrong, generalised from the dev server before the prod build was tested.) It is also **not** caused by migration 16 — it reproduces on a clean HEAD checkout.

**What it costs:** neither page can be developed or verified against `next dev` at all. That is why it went unnoticed — the smoke sweeps run against prod.

**Symptom (dev):** both routes SSR their full toolbar and then sit on “Loading…” forever. React never hydrates the `<main>` subtree, no effect runs, `/api/library` is never requested, and **clicking a tab does nothing** — no URL change, no `aria-selected` move, zero fetches. That last one is the 5-second reproduction.

**Root cause, measured:** `MyStuffContent` calls `useSearchParams()` (the `?tab=` IS the state, per SM21). That postpones its Suspense boundary — the DOM carries React's **`$~`** postpone marker and the fiber is `dehydrated: true` — and the `next dev` client never resumes it. **Replacing that single call with a plain `URLSearchParams` makes the page hydrate, fetch and render immediately, and the `$~` marker disappears.** That is the whole of it.

**Ruled out by experiment — don't re-try these:**
- **`export const dynamic = "force-dynamic"` on both pages does NOT fix it.** So it is not the static prerender.
- **Moving the `Suspense` boundary out of the client module into the server `page.tsx` does NOT fix it.** So it is not boundary placement.
- Not the API (`/api/library` 1,922 items + `/api/calendar` 95 complete in 3.0 s when fired by hand *on that page*), not `init()` bailing (auth returns a user; last sync 14 h vs a 24 h `SYNC_STALE_MS`, so the auto-sync branch never runs), not a console error, not a failed chunk, not a server error.
- ⚠️ `performance.getEntriesByType('resource')` lists only **completed** requests — "never issued" and "in flight" look identical there. That cost an hour.

**Diagnostic worth keeping:** `Object.keys(document.querySelector('main')).some(k => k.startsWith('__reactFiber'))` — `false` on `<main>` while `true` on `body` means an unhydrated subtree, not a slow request.

**Workaround today:** verify those two pages against the prod build — `npm run build && npm start` (the `prod` launch config, :3100). Proven working there.

**✅ DECIDED 2026-08-17 (Nils): option 1 — leave it, re-test on the next Next.js bump.** Do NOT restructure `MyStuffView` for this; the other two options are recorded only so the reasoning isn't re-derived. Add a re-test of these two pages to the checklist whenever `next` is upgraded (a Dependabot `next` bump is exactly the moment to try it).

**The three options:**
1. **Leave it, use the prod build to verify.** ← chosen. Zero risk, keeps SM21's URL-as-state exactly. Costs dev ergonomics on two pages.
2. **Pass `searchParams` from the server `page.tsx` as a prop** (the other option Next's own docs give). Keeps SSR correct with no flash, drops `useSearchParams` entirely — but a tab switch then needs a server round-trip instead of being instant.
3. **Derive the tab from `window.location.search` + a `popstate` listener.** Keeps switching instant, but the initial render no longer knows the tab server-side, so a deep link to `?tab=progress` flashes the default first.

Worth re-testing on the next Next.js bump before spending effort — this looks like a dev/Turbopack bug in 16.3.0, not a mistake in the app.

---

- **Drop the `user_library` / `user_watchlist` cache tables** ✅ DONE 2026-08-17 (migration 16 — they are VIEWS now). **Two traps live on in migration 16's own comment and in `src/lib/cacheViews.ts`: a code-only rollback breaks every library write, and `CREATE INDEX` on either name throws at boot.** → grep the archive for `migration 16`.

- **Advanced search's Fandex Score (SM43–SM48)** ✅ FULLY CLOSED 2026-08-17 — the last two open items (the IGDB cross-link backfill and the shimmer/blank-state check) both landed. → grep the archive for `SM44 heal budget`.

## Still open elsewhere

- **Fandex Score `priorStrength` (C=5) + per-role class weights may want re-tuning** now that the aggregate is a raw sum rather than a damped mean. **Time-gated:** revisit after a few weeks of real scores under the new formula (4 days as of 2026-08-02 — too soon; a re-tune now would fit noise).
- **Platform integrations** — **AniList is now the lead candidate.** Books (Hardcover + Open Library) are ⏸️ **postponed as a media type, 2026-08-03.** See [PLATFORMS.md](PLATFORMS.md).
  - **Hardcover ⏸️ PARKED — same call as Backloggd (yours, 2026-08-03).** PLATFORMS.md said "verify the auth first"; it was verified and failed, but the deciding fact turned out to be the usage terms, not OAuth: the docs call the API *"only for offline use at this time"*, reachable *"from localhost or APIs"*, with site allowlisting *"a way down the line"*. A hosted multi-user site is the case they haven't provided for. Secondary findings: no third-party OAuth (promised, not shipped), tokens expire on a **shared Jan 1 reset** so every user breaks the same day, no app-level credential (which gates the *metadata* role too), and the write mutations are entirely undocumented. Full write-up + the API constraints worth keeping (60 req/min, `_ilike` disabled, Typesense search) → PLATFORMS.md deep dive.
  - **The media-type cost is now measured** and lives in PLATFORMS.md ("What adding a media type actually costs") so it isn't re-derived. Two things worth knowing before any future type proposal: **no migration is needed** (`media_items.type` is plain TEXT, no CHECK constraint), and **`tsc` won't help you** — only one `Record<MediaType, …>` exists, so adding a union member compiles clean while silently doing nothing at the other ~9 app-level enumeration points.

---

## Recently closed — pointers only

Everything below is fully written up in [docs/archive/history.md](docs/archive/history.md). Earlier sessions (G#/SM34–37, the eight closed questions) are archived too.

**2026-08-12** — grep `PR17 post-outage verification`:

- **PR17 steps 1–3 closed against live prod** — the 2026-07-22 leak is confirmed fixed (byte-identical crawl replay), the memory ramp is dead (`fileMb` flat 74–76 MB over ~7 h), `rr.db` is 37.7 MB. Steps 4–5 still need the Railway shell. → [[prod-incidents]]
- **⚠️ Non-ASCII person slugs hard-404'd** — `personKey`/`slugify` used NFD/NFKD + combining-mark stripping, which does **nothing** for `ø å æ ł ß đ ð þ` (no canonical decomposition), so the next `[^a-z0-9]` strip deleted them: `"Lisa Tønne"` → `/person/lisa-t-nne`, 0 TMDB results. Fixed via a transliteration map in the new `src/lib/translit.ts`. **`tagKey` deliberately excluded — its keys are persisted.** → [[unicode-normalization-lossy-slugs]]
- **Facet payload cache enlarged** — TTL 1 h → 24 h, `max` 500 → 3,000, sized against 17 measured prod payloads rather than a blind multiple. See the open item above.

**2026-08-03** — grep `H3 monetization v1`:

- **P18 closed** — clickable streaming rows + offer-type line, via the existing lazy self-heal path, not a re-projection. Plus a default-ON boot-time prune of the browsed tail, `omdbConfigured()`, and cache-contraction drift counts in `/api/dev/dbsize` (tables still untouched, gated on PR17). → [archive](docs/archive/history.md), grep `P18 streaming links`.
- **H3 v1 built** — donations live, affiliate layer dark behind `MONETIZATION_ENABLED`, go-live checklist written. → [[monetization-h3]]
- **H4 epic closed** — H4.0's advice in, Impressum written + filled in both locales.
- **⚠️ A `//` comment rendered as visible page text** after a `return` was wrapped in a fragment. tsc, 540 tests, lint and build all passed; a human spotted it. `react/jsx-no-comment-textnodes` is now an eslint ERROR. → [[jsx-comment-in-children-renders]]
- **✅ Fixed 2026-08-03:** `--color-accent` in light theme measured **4.48:1** on `--color-surface` (under AA for body text, while its own comment claimed 4.5:1+). Now `#856619` → **4.76:1**; `--color-accent-subtle` was rebased onto the same hue. Verified via `getComputedStyle` in both themes (dark untouched). **Two adjacent gaps left deliberately unfixed — they change the design, not just a value, so they're your call:** `--color-accent-hover` sits at **3.47:1** (it's a *lightening* hover, so clearing AA means inverting it to darken-on-hover), and accent text on `--color-surface-inset` (#ECE6DA) is **4.32:1**. Note the light theme still has no toggle wired, so none of this is user-visible yet.
