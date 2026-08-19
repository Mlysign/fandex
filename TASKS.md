# Fandex — Task Tracker

> **This file holds only what is still open.** Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it for the "why" behind a past decision; never read it end to end). One-page state → [STATUS.md](STATUS.md).

- **Legend:** ⬜ not started · 🔵 in progress / needs input · ⏸️ blocked · ✅ done
- **Convention:** an entry is 2–4 sentences + a commit hash once done. The full story (root cause, files touched, verification) belongs in the commit message, not here. **When a section is fully done, move it to the archive the same session** — this file blew past its 200-line CI guard twice (441 lines, then 374) from skipping that step.

---

## ✅ Decisions LOCKED 2026-08-17 — do not re-open these

Nils answered the full open-decision list in one pass. Treat every line here as settled; a future session that re-raises one is wasting his time. **One (#2) was later superseded by Nils himself on 2026-08-19; it is struck through rather than removed, and that is the only kind of change this list takes.**

1. **Impressum: APPROVED as-is.** H4.2 closes. **All of H3 is unblocked.**
2. **~~Affiliate signups: GO, starting with GOG, now.~~ SUPERSEDED 2026-08-19 by Nils** (see H3 below): the plan is ads-first and affiliate is demoted. Recorded rather than deleted, so the reversal is visible. The original text, still true as of 2026-08-17: The "prod stably up for days, not hours" gate is met (serving since 2026-08-12). Sequence unchanged: GOG → Humble → Fanatical → GMG → **Amazon LAST**. Claude does not do the signups — they carry his tax/payment identity.
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

Everything else in this file is either done or a standing constraint.

1. **🔴 Prove the restore works.** Two Console commands, detailed in the backups section below. The only urgent item: backups replicate again, but "replicating" and "restorable" are different claims and only the first has been checked. **No Railway variable to set — the file already reclaimed itself, 331.4 → 154.2 MB.**

2. **Android TWA (P15/P16): do it, or park it explicitly.** Full context is in the P15/P16 section below — it is Fandex shipped as a thin Play Store wrapper of the website (your 2026-06-18 decision), and it needs a signing key plus a one-off $25 Play account. Either answer is fine; it blocks nothing. Right now it just reads as in-progress work that isn't progressing.

3. **Re-run the RAWG cross-link sweep once RAWG is back up.** It was down all of 2026-08-17 (timeouts, open circuit), so 168 games still lack a RAWG link. Same shape as the Steam and IGDB sweeps that did run: `POST /api/dev/crosslink {"source":"rawg","maxItems":25}` from the browser console on fandex.org while logged in, repeating with the returned `afterId` **until the cursor drains** — never chasing the `needing` count, which never reaches zero. Not urgent: those games now have IGDB as a second source, so they still score.

4. **Optional, and no longer urgent: the GOG affiliate signup.** Demoted 2026-08-19 with the rest of the affiliate plan (see H3 below). Worth one email anyway, because GOG's dashboard is a free click meter on a site that deliberately collects no click data of its own. **Do NOT apply to Amazon** — its 180-day / 3-sale clock starts at signup, and the self-referral shortcut is a terms breach that closes the account rather than a loophole.

**Standing constraints — not tasks, but do not violate them:**
- **Ko-fi: no tiers, no perks, no memberships.** A donation with consideration is a taxable supply *and* a much stronger "commercial use" reading against TMDB's non-commercial-only free tier.
- **The support page never quotes a running-cost figure** (H3.0, closed as won't-do 2026-08-17). The qualitative "it costs money to run" line stays; no number ever joins it.
- **Do NOT contact TMDB or Trakt about commercial terms** while monetizing on their free tiers — the accepted risk is key revocation, and asking invites it.
- **Watch that prod stays up.** Continuous since 2026-08-12; both prior outages were un-routings (billing/pause), never crashes — `uptime` climbed monotonically through both.

## 🔴 Backups were DEAD for two days (2026-08-17 → 2026-08-19). Fixed and replicating; the restore drill is yours.

**Found in the Railway deploy log while checking something else, not by any alarm.** Litestream logged this once a second, for two days:

```
malformed database schema (user_watchlist) - near "ORDER": syntax error
```

Migration 16 wrote `json_group_array(source ORDER BY source)` into the wishlist view. **`ORDER BY` inside an aggregate's argument list is SQLite 3.44.0+ (2023-11-01)**; better-sqlite3 ships 3.53 so the app was fine, and **Litestream v0.3.13 embeds ~3.40** and could not parse it. SQLite parses the WHOLE schema before preparing ANY statement, so the backup daemon could not run a single query. **Railway volume backups are Pro-plan only** (the Backups tab reads "No Backups"), so Litestream was the only copy of the database.

**Fixed and live** (`9d63a68`): the sort moved into a subquery, which SQLite deliberately will not flatten into an outer aggregate query, so the ordering is preserved exactly. Migration 18 replays `createCacheViews`, because migration 16 had already run on prod and editing `cacheViews.ts` alone would have shipped nothing. Verified byte-identical on all 2,023 live rows, through **both** apply paths, and against a **real SQLite 3.40 CLI** — which cannot count `users` on the old schema and reads everything on the new one.

**Confirmed working on prod:** new generation `c62d7dc17a0fd0cb`, `snapshot written` in 3.0 s, WAL segments streaming, zero schema errors in the boot log, and the bucket went **33.6 MB → 181.8 MB**.

### ⬜ Your step, and it is now the ONLY one: the restore drill

Railway → releaseradar → **Console** (I can drive the browser, but the harness blocks typing into a production shell, correctly):

```
litestream restore -config /etc/litestream.yml -o /tmp/restore-test.db /app/data/rr.db
```

then check it is real, not merely present:

```
node -e "const D=require('better-sqlite3');const d=new D('/tmp/restore-test.db',{readonly:true});console.log(d.pragma('integrity_check'));for(const t of ['users','user_identities','user_item_state','media_items'])console.log(t, d.prepare('SELECT COUNT(*) n FROM '+t).get().n);console.log('browsed=0', d.prepare('SELECT COUNT(*) n FROM media_items WHERE browsed=0').get().n);"
```

Compare against live via `/api/dev/dbsize`, then `rm /tmp/restore-test.db`.

### ✅ The file already reclaimed itself — no VACUUM step, and none was ever needed

**`rr.db` went 331.4 MB → 154.2 MB on the fix deploy**, unprompted. `src/lib/db.ts` VACUUMs whenever a migration actually applies (added for H2a), migration 18 applied, so it fired. **It ran with Litestream attached and completed fine.**

A `VACUUM_ON_BOOT=1` entrypoint flag was added earlier this session and **removed the same day**: it was a third copy of something the codebase already does twice, and it rested on a premise the 331→154 drop disproves — that VACUUM needs the exclusive lock before Litestream attaches. The manual lever, if the file ever bloats again with no migration pending, is `POST /api/dev/prune {"action":"vacuum","confirm":"VACUUM"}`, which checks free space first.

**The WAL is still 340.8 MB** and this did not touch it. That one genuinely does need the last connection to close cleanly with Litestream detached.

### ⚠️ The memory ramp is NOT page cache. My first answer was wrong; here is the measurement.

Sampled `/api/health` every 5 min for ~10 h. Over one container's life:

| | start | end |
|--|--|--|
| **node RSS** | 95 MB | **420 MB** |
| litestream RSS | 33 MB | 24 MB (flat throughout) |
| `heapUsed` | ~30 MB | ~30 MB |
| `fileMb` (page cache) | 60 | oscillates 38–360, repeatedly reclaimed |

So: **the ramp is the node process, it is native memory (heap is flat), and Litestream is not involved.** `fileMb` is noise around a flat mean, not the trend — which kills the "cgroup bills page cache over a big file" story that the 2026-07-22 incident made the obvious one to reach for.

That puts it in the same family as 2026-07-21 (`rss` ramping while `heapUsed` sits still ⇒ native, not a JS leak), and the prime suspect is SQLite's own allocation against a large file. **Unfalsified either way right now.** The file is 154 MB instead of 331, so the next few days answer it for free: if the ramp shrinks proportionally it was the DB size, and if it does not, it is something else and the step shape (95→120→138→201→215→231→420) is the clue to chase.

### Corrected belief

STATUS and PR17 recorded the 340 MB WAL as a benign high-water mark that "cannot be reclaimed while Litestream runs" and "needs no action". **That was this bug.** Litestream could not advance its read position, so SQLite could not checkpoint past it, which is why `wal_checkpoint(TRUNCATE)` returned `busy: 1` twice. A WAL that will not truncate is a symptom worth chasing, not a quirk to document.

## Open — carried forward from Phase 6

### P15/P16 — the Android app. Read this before deciding; "Bubblewrap" needed context.

**This is Fandex, not a different project.** It traces back to a decision you locked on **2026-06-18**: *"public website first, Android as a PWA/TWA wrapper"* — i.e. Fandex ships to the Play Store as a **thin Android app that just displays fandex.org**, not as a separate codebase. Two months on, the name of the tool (Bubblewrap) carried none of that context. Fair.

**What a TWA is.** A *Trusted Web Activity* is an Android app whose entire content is your website, rendered by the user's Chrome. No second codebase, no rewrite, no separate release of features — you ship the website, the app shows it. The only reason it isn't just a browser shortcut is that a TWA can **hide the browser address bar**, so it looks like a native app. Hiding that bar is exactly what needs proving you own the domain — which is what P15 is.

**What's already built (by Claude, done):** `src/app/.well-known/assetlinks.json/route.ts` serves the Digital Asset Links file Google's verifier fetches. It's env-driven and currently returns an empty `[]`, which is valid JSON and simply means "no app claims this origin yet". **P14 (PWA manifest + service worker) is also done** — that's the prerequisite that makes the site installable at all.

**What only you can do, and why.** Generating the Android package requires creating a **signing key** and a **Play Console account** — a credential and an account tied to your identity, so Claude does not do it. The mechanical shape:
1. Run **Bubblewrap** (Google's CLI) or **PWABuilder** (a website that does the same thing without installing anything) against `https://fandex.org/manifest.webmanifest`. Output: a signed `.aab` plus two values — the **package name** (e.g. `org.fandex.twa`) and the signing cert's **SHA-256 fingerprint**.
2. Set those as `TWA_PACKAGE_NAME` and `TWA_CERT_FINGERPRINT` on Railway. The route above starts serving a real claim; verify at `/.well-known/assetlinks.json`.
3. Upload the `.aab` to the Play Console. (Google charges a **one-off $25** developer registration.)

**The rest of the context** (what a TWA is and is not, Bubblewrap, the signing key, the one-off $25 Play account) → [archive](docs/archive/history.md), grep `P15/P16 Android TWA`.

## Closed epics — pointers only (full write-ups in the archive)

- **PR17 — post-outage verification** ✅ 2026-08-12. All five steps; the leak and the memory ramp are confirmed dead in prod and backups proven by a real restore drill. Two corrected beliefs before touching backups: an **unchanged** Litestream generation is the HEALTHY signal, and `wal-truncate` reclaims nothing while Litestream runs. → grep `PR17`.
- **Smoke test 2026-08-12 (11th run)** ✅ All five findings fixed (SM38–SM42). The valuable half was the RAWG outage it ran during, which re-verified the three 2026-08-02 single-source games bugs as fixed under the exact condition that exposed them. → grep `Smoke test 2026-08-12 11th run`.

---

## H3 — Monetization 🔵 ads-first since 2026-08-19; donations live, affiliate built + dark + demoted

**Goal:** revenue covers upkeep (Railway, domain, third-party APIs).

**⚠️ THE PLAN CHANGED 2026-08-19. Read this before acting on anything below it.** Nils's call, after a per-1,000-user revenue model: **go live → wait for traction → ads → premium (ad-free + extras)**. Affiliate is **demoted, not cancelled**; the code stays built and dark. Full reasoning, the model, and the numbers → [docs/monetization-go-live.md](docs/monetization-go-live.md), the "DIRECTION CHANGED" section at the top.

The three findings that decided it, so nobody re-derives them:
- **Per 1,000 monthly actives: ads ~€150, premium ~€60, donations ~€14, affiliate ~€3.** Affiliate is last by 20 to 50 times.
- **Fandex is past-tense.** People log what they already played or watched, so a buy link on an item already in a library arrives after the purchase decision. Only the **wishlist** and the **calendar** are pre-purchase surfaces.
- **Affiliate is the only method that cannot clear its own cliff.** Covering upkeep once TMDB's $149/mo commercial tier applies needs ~1,000 users on ads, ~2,300 on premium, and **~45,000 on affiliate**.

**The economics pivot on TMDB, not on hosting.** Upkeep is small (Railway Hobby $5/mo + usage, domain ~€10/yr, all APIs currently €0) — but TMDB's free API is **non-commercial only** and commercial use is **$149/mo**. So "commercial" multiplies upkeep ~10× overnight; any paid model must clear ~$155/mo before netting a cent. Trakt requires case-by-case approval for monetizing apps. RAWG is safe (free commercially to 20k req/mo + 100k MAU, no redistribution). **Donations are the gray zone** — TMDB doesn't say whether donation-funded counts as commercial.

**Consciously accepted risk:** Fandex monetizes on the free TMDB/Trakt tiers ("under the radar"). Failure mode is **API-key revocation without notice**, not a fine. **Do NOT contact TMDB/Trakt about commercial terms while under the radar.**

**Built 2026-08-03 — H3.3 ✅ (donations, live) · H3.4 ✅ (affiliate, DARK behind `MONETIZATION_ENABLED`) · H3.9 ✅ (go-live checklist).** Full write-ups → [archive](docs/archive/history.md), grep `H3 monetization v1`. **The one thing to know before touching any of it:** the catalog's store rows are Steam/PSN/GOG/Xbox/Nintendo/Epic/itch.io and only **GOG** is affiliate-capable, so `affiliate.ts` has *two* mechanisms — a rewriter for GOG-shaped links and `buildBuyLinks()` synthesizing per-title search links for the merchants we have programs with. → [[monetization-h3]]

**Still open:**
- **H3.0** ✅ **CLOSED as WON'T DO 2026-08-17** — the support page never quotes a cost figure. Permanent, not pending.
- **Affiliate program signups** 🔵 **DEMOTED 2026-08-19.** Was "GO, GOG first" (2026-08-17); the revenue model retired that urgency. **GOG alone is still worth one email**, mainly because its dashboard is a free click meter on a site that collects no click data of its own. **Do NOT apply to Amazon**: the 180-day / 3-qualifying-sale clock starts at signup, Amazon pays **1% on video games** (6% on Blu-ray/DVD) since June 2025, and self-referring to beat the clock is an explicit terms breach that closes the account rather than a shortcut. **Nils does any signup himself** — they carry his tax/payment identity.
- **H3.8** ✅ **APPROVED 2026-08-17, and now THE PLAN rather than a parked Path B.** Both gates became measurable on 2026-08-19 (`/dev/analytics`). **Ads → 10,000 pageviews/mo** · **Freemium → 3,500 sustained weekly actives.**
  - **Ads → 10,000 pageviews/mo** (Monumetric's stated minimum). A better-RPM tier exists at 50k+ pv (Freestar/Mediavine, $15–40+ vs Monumetric's $10–20) — not a second gate, just worth re-checking which network fits.
  - **Freemium → 3,500 sustained weekly-active users.** The old "roughly 1k+ actives" napkin figure never netted out TMDB's $149/mo license. Actives needed to clear **just** the license (≈€137, no margin): 2%/1€ → 6,850 · 2%/2€ → 3,425 · 5%/1€ → 2,740 · 5%/2€ → 1,370. Even the best-case corner is above 1k. 3,500 clears it with real margin at a *conservative* 3%/1.50€, leaving room for Trakt's separate approval and normal churn.
  - **✅ Both gates are instrumented (2026-08-19)** — `/dev/analytics` measures them directly, plus the anon-vs-signed-in split that decides which arm is worth building. Self-hosted, no third-party analytics, no cookie. ⚠️ **Client beacon, so crawlers are invisible by design** — right population for an ads decision, wrong one for SEO (use Search Console). → [[telemetry-self-hosted]]
  - **The metric, as checked against the schema in July 2026:** no pageview/session log existed then, and **`users.last_seen_at` is a false friend** — it's written only on a RAWG login or Steam OAuth callback (`src/app/api/auth/rawg/route.ts:72`, `.../steam/callback/route.ts:65`), never on an ordinary revisit via an existing 30-day cookie, and never at all for TMDB/Trakt. It undercounts badly. The best signal computable today (verified against the real DB) is "touched library/wishlist/rating in the last 7 days":
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
  - **✅ `last_seen_at` is real (2026-08-03)** — stamped in `getSession()`, one write per user per UTC day, best-effort, only after epoch validation. It is the meter, not the trigger. → grep the archive for `last_seen_at`.

**If affiliate is ever revived:** sign up → set the env vars → flip `MONETIZATION_ENABLED` → run the post-go-live cookie check. The runbook is still accurate and still in the go-live doc; only its priority changed.

---

- **SM39 — the Fandex Score range** ✅ CLOSED 2026-08-17. Root cause (prod's hand-tuned gains) fixed 2026-08-14; the residual out-of-range was then **relabelled, not re-tuned** — 0–100 is a target, see `docs/fandex-score.md` §1 and the locked-decisions list above. → grep the archive for `SM39`.

- **Franchise / IP as a scoring factor** ✅ CLOSED 2026-08-17. Built + Wikidata-swept 2026-08-14; the panel was cleared on prod 2026-08-17 (metal gear bundled, two crossover cameos removed, 70 of 71 suggestions applied). `ip` stays at **3**. → grep the archive for `Franchise / IP`.

## 🟡 `/library` + `/wishlist` are dead under `next dev` — DEV ONLY, and the fix is DECIDED

**Prod is unaffected** and always was; a `next start` build hydrates both pages. **Nils decided 2026-08-17: option 1, leave it** — do not restructure `MyStuffView`. Cause is measured: `useSearchParams()` postpones the Suspense boundary (React `$~` marker) and the dev client never resumes it. Looks like a Turbopack bug in Next 16.3.0.

**Two things to carry forward.** Verify those pages on the `prod` launch config (:3100), and **re-test them on the next `next` bump** — a Dependabot PR is the moment. Diagnostic: `Object.keys(document.querySelector("main")).some(k => k.startsWith("__reactFiber"))` false on `<main>` but true on `body` = unhydrated subtree, not a slow fetch.

⚠️ **Re-check before spending any time on it:** `/wishlist` hydrated normally under `next dev` on 2026-08-18. One observation, and `MyStuffView` changed that session, so it may be fixed or intermittent. Full write-up, the three options and the ruled-out experiments → [archive](docs/archive/history.md), grep `library + wishlist dead under next dev`.

- **Drop the `user_library` / `user_watchlist` cache tables** ✅ DONE 2026-08-17 (migration 16 — they are VIEWS now). **Two traps live on in migration 16's own comment and in `src/lib/cacheViews.ts`: a code-only rollback breaks every library write, and `CREATE INDEX` on either name throws at boot.** → grep the archive for `migration 16`.

- **Advanced search's Fandex Score (SM43–SM48)** ✅ FULLY CLOSED 2026-08-17 — the last two open items (the IGDB cross-link backfill and the shimmer/blank-state check) both landed. → grep the archive for `SM44 heal budget`.

## Still open elsewhere

- **Fandex Score `priorStrength` (C=5) + per-role class weights may want re-tuning** now that the aggregate is a raw sum rather than a damped mean. **Time-gated:** revisit after a few weeks of real scores under the new formula (4 days as of 2026-08-02 — too soon; a re-tune now would fit noise).
- **Platform integrations** — **AniList is now the lead candidate.** Books (Hardcover + Open Library) are ⏸️ **postponed as a media type, 2026-08-03.** See [PLATFORMS.md](PLATFORMS.md).
  - **Hardcover ⏸️ PARKED — same call as Backloggd (yours, 2026-08-03).** PLATFORMS.md said "verify the auth first"; it was verified and failed, but the deciding fact turned out to be the usage terms, not OAuth: the docs call the API *"only for offline use at this time"*, reachable *"from localhost or APIs"*, with site allowlisting *"a way down the line"*. A hosted multi-user site is the case they haven't provided for. Secondary findings: no third-party OAuth (promised, not shipped), tokens expire on a **shared Jan 1 reset** so every user breaks the same day, no app-level credential (which gates the *metadata* role too), and the write mutations are entirely undocumented. Full write-up + the API constraints worth keeping (60 req/min, `_ilike` disabled, Typesense search) → PLATFORMS.md deep dive.
  - **The media-type cost is now measured** and lives in PLATFORMS.md ("What adding a media type actually costs") so it isn't re-derived. Two things worth knowing before any future type proposal: **no migration is needed** (`media_items.type` is plain TEXT, no CHECK constraint), and **`tsc` won't help you** — only one `Record<MediaType, …>` exists, so adding a union member compiles clean while silently doing nothing at the other ~9 app-level enumeration points.

---

## Recently closed — pointers only

Everything below the line is fully written up in [docs/archive/history.md](docs/archive/history.md). **Grep it; don't read it.**

- **2026-08-12 / 2026-08-03** → grep `PR17 post-outage verification`, `H3 monetization v1`, `P18 streaming links`.
  - **Two light-theme contrast gaps stay deliberately unfixed and are yours to call** (they change the design, not a value): `--color-accent-hover` is **3.47:1**, accent text on `--color-surface-inset` is **4.32:1**. No light-theme toggle is wired, so neither is user-visible yet.
- Earlier sessions (G#/SM34–37, the eight closed questions) are archived too.
