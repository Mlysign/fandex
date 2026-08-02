# ReleaseRadar — Task Tracker

> 📄 **Two-file setup:** [STATUS.md](STATUS.md) is the short, human-readable digest (live state + next actions — read that first). **This file (TASKS.md) is the detailed working log** — notes, changelog, gotchas, next steps for what's still open. Keep them in sync: when a task's high-level state changes, update the one-liner in STATUS.md too.

- **Status legend:** ⬜ Not started · 🔵 In progress · ✅ Done · ⏸️ Blocked
- **Epic tags:** A Insights · B Search/Discovery · C Detail/Component/Caching · D Library · E Audits · F Data/Profile · G Foundations/tech-debt · H Post-launch/growth.
- **Notes convention:** keep an entry to 2–4 sentences + a commit hash once it's done; put the full story (root cause, every file touched, every verification step) in the commit message, not here. Archive a section into `docs/archive/history.md` (with a one-line pointer left behind) once every item in it is done — this file grew past its 200-line CI guard twice (441 lines pre-2026-07-18, 374 lines pre-2026-07-28) from skipping that step; don't let it happen a third time.

---

**Archive note (2026-07-28, re-archived after re-growing to 374 lines):** everything finished lives in **[docs/archive/history.md](docs/archive/history.md)** — Phases 0–6, the resolved audit findings (D#/A#/U#/P#/S#), the closed QA/nav/smoketest findings (`Q#`/`N#`/`SM#`/`PR#` through 2026-07-27), H2 (data-model hardening), H1 (UI/UX overhaul) + its mockup-vs-live rebuild, H5 (Fandex Score, all sub-tasks + calibration), and the small-tasks batch's completed items (S1/S3/S5/S6/S7/S8/S11). Grep it for a keyword when you need the "why" behind a past decision; don't read it end to end. This file holds only what's still open.

**Audit-passes summary** (full detail in the archive): five review passes — Phase 1 data/architecture, Phase 3 UI/UX, Phase 5 productionization + security — produced findings D1–D9, A1–A7, U1–U15, P1–P17, S1–S13. **Every one is resolved.** Verdict, still true: the data *model* is a genuine strength (identity-agnostic users + canonical `media_items` + per-source links + a merge layer); the issues were about *how state was stored within that model* and a few monoliths, not the core shape. Productionization/security fundamentals were sound from the start (parameterized SQL, no XSS sinks, verified OAuth) — the real gaps were credential-handling-at-rest and public-internet hardening, both closed.

---

## Shared facet cache · More-like-this · TMDB attribution · SM33 · 8th sweep — 2026-07-31 (ID `T#`) — ✅ ALL DONE, archived

Shared derived-facet cache (`src/lib/facetCache.ts`), the item-detail "More like this" rail, TMDB/JustWatch attribution, SM33's tap targets fixed, `--color-media-*` relocated out of `@theme`. Full changelog → [docs/archive/history.md](docs/archive/history.md).

---

## Home rails · rotating stats · facet palette · detail rebuild · unrate · perf — 2026-07-30 (ID `R#`) — ✅ ALL DONE, archived

Nils's six-cluster feedback (R1–R10): Home's rails rebuilt on real trending endpoints + the calendar's own algorithm + daily rotation; two rotating stat-highlight panels; 17 facet hues → 4 gold-family colours by facet class; item detail rebuilt against its (mobile-only) mockup; unrate wired (the backend already existed, unreachable); rating an item clears the wishlist; `/api/library` cut from 38.9MB by dropping raw provider blobs nothing read. Full changelog + every trap found while building it → [docs/archive/history.md](docs/archive/history.md).

---

## Calendar sources + global layout order — 2026-07-28 (ID `L#`) — ✅ ALL DONE, archived

Calendar gained Wishlist/Library/**Popular** chips + month-scoped provider fetches with cross-source popularity ranking (`src/lib/popularMonth.ts`), and `SubBar` became the ONE page header for every list page in a fixed order. Full changelog (L1–L8, incl. the 207px sticky-header trade-off and the anon-persist bug found in passing) → [docs/archive/history.md](docs/archive/history.md).

---

## Open — carried forward from Phase 6

- **P15** 🔵 · Med · later · ~25k — **Digital Asset Links** (`/.well-known/assetlinks.json`) + stable HTTPS origin for the Play Store TWA. Serving infra done (`src/app/.well-known/assetlinks.json/route.ts`, env-driven). **Blocked on you:** build/sign the TWA (Bubblewrap/PWABuilder) → package name + signing-cert SHA-256 → set `TWA_PACKAGE_NAME`/`TWA_CERT_FINGERPRINT` on Railway → verify the endpoint.
- **P16** ⬜ · Low · later · ~60k — Verify **OAuth + cookie flow inside the TWA**: re-register prod redirect URIs per provider; test webview behavior + deep-link return / `sameSite`. Needs P15 unblocked first.
- **P18** 🔵 · Med · after PR17 · ~10k — **JustWatch clickable streaming links (UX only, not monetization).** **Attribution half done 2026-07-31** — the required "Streaming availability data by JustWatch" credit (TMDB's watch-provider terms mandate it; nothing on the page carried it before) now renders under the provider rows whenever `streamingProviders.length > 0`, pure markup, no data change. **Still open:** making the provider rows themselves real links via the JustWatch Content Partner API/data-partner token — that reverses the deliberate per-region link-drop in `src/lib/sources/project.ts:68` and needs a `PROJECTION_VERSION` bump + a full-catalog re-projection, the same class of heavy operation that blew the Railway compute budget once already. **Deliberately deferred until PR17 confirms prod is healthy post-outage.** **Not pursuing a JustWatch revenue-share deal** (2026-07-18, your call) — no negotiation, independent of H3's monetization gates.
- **Mockup-vs-live rebuild** ✅ 2026-07-27, done + committed, archived — full 4-round changelog + the 8 intentionally-open judgment calls: `docs/mockup-gap-audit.md` (structural) and `docs/ui-overhaul.md` §11 (token-adjacent). Summary in the archive.
- **P13b** ✅ 2026-07-19 — Indexing on. Whole library sitemapped + indexable.

---

## Small-tasks batch — 2026-07-27 (ID `S#`) — ✅ ALL DONE

S1–S11 all shipped in commit `34f87fe`; full write-ups in [docs/archive/history.md](docs/archive/history.md). S2/S4/S9/S10 were listed here as open until 2026-07-28 — a bookkeeping lag, not outstanding work.

---

## Catalog-pool blowup + memory ramp — 2026-07-22 (ID `PR#`) — PR13–PR16 done, PR17 blocked

Public facet/discover pages were persisting an unbounded pool of thin, browsed-only rows (crawler traffic × 60/page, unbounded by construction), ballooning `rr.db` to 2.5 GB and costing a Railway usage-limit outage. PR13–PR16 (gate the writes to logged-in users, prune + VACUUM the tail) are done — full incident writeup + numbers in the archive. Only verification remains:

- **PR17** ⏸️ **BLOCKED until the Railway billing cycle resets (~2026-08-01) — resume mid-August** · Sonnet · ~6k — **Verify + close out.** Cannot run while deployments are paused: the site 404s at Railway's edge, so no endpoint is reachable. **Checklist pre-written 2026-07-27 (task `S7`)** so this is a one-shot run once service is back — every step below has the literal command/URL and the expected value inline, nothing left to look up:
  1. **DB size** — open `https://fandex.org/api/dev/scoring` in a browser logged in as the admin user first (this and dbsize share the `SCORING_ADMIN_USER_IDS` gate — non-admins get a 404, and a plain `curl` without the session cookie will 404 too), then hit `https://fandex.org/api/dev/dbsize`. Expect top-level `fileMb` ≈ **36.5** and, inside the `tables` array, the `media_items` entry's `rows` ≈ **2,012** (`tables.find(t => t.name === "media_items").rows` if reading the raw JSON).
  2. **Memory ramp is actually dead** — `curl https://fandex.org/api/health` (no auth needed, public by design). Read **`cgroupMb.fileMb`** — do this **after several hours of uptime**, not right after a redeploy (a fresh process hasn't had time to re-ramp yet, so an early read would look healthy regardless). Expect it to plateau in the low tens/hundreds of MB, not climb toward 2,000 — that plateau, not any single reading, is the actual proof.
  3. **Sitemap + site render** — `curl -s https://fandex.org/sitemap.xml | grep -c "<url>"` → expect ≈ **2,013**. Then load `https://fandex.org/` in a browser and confirm it renders with no console/server errors.
  4. **Litestream backup generation survived the VACUUM** — via the Railway console/shell: `litestream snapshots -config /etc/litestream.yml /app/data/rr.db`. This has been **UNVERIFIED since the 2026-07-22 outage** — don't skip it. Expect a snapshot generation newer than `18d8221abccc198d` (the pre-VACUUM one) and a bucket size in the low tens of MB, consistent with the 36.5 MB DB (the bucket read 10.6 MB right after the VACUUM, down from a 13.9 GB peak — that was the last data point, never confirmed as a stable new generation).
  5. **Tidy stale WAL sidecar files** — via the Railway console: `ls -la /app/data/` → if `rr.db.tmp-shm` / `rr.db.tmp-wal` are still there dated **Jul 17** (i.e. untouched by the VACUUM), delete them. If they're gone or have a newer date, nothing to do — just note which.
  6. **Record + close out** — append a before/after entry to `docs/archive/history.md` (steps 1-5's actual readings vs the expected values above) and update the `prod-db-size-and-page-cache` memory file (not a repo doc — `~/.claude/projects/.../memory/prod-db-size-and-page-cache.md`) with the confirmed-stable outcome. Update this PR17 entry and STATUS.md's catalog-pool-blowup line from "unverified"/"blocked" to closed.

**Readiness probes, no action possible until prod is back:** 2026-07-28, 2026-07-30, 2026-07-31 and **2026-08-02** all re-checked `https://fandex.org/api/health` — still `404 {"status":"error","code":404,"message":"Application not found"}`, identical body every time (2026-08-02 request_id `3IjCjEYMROGHG6NH9I3ezw`), so steps 1–3 above (the only ones reachable without the Railway console even once the site is back) remain untested. **The expected ~2026-08-01 billing-cycle reset did NOT restore service** — this stopped being a "wait it out" situation on 2026-08-02 and is now a Railway-dashboard action item for Nils (check whether the pause needs a manual resume, or whether usage is still over the cap). Steps 4–5 need the Railway console regardless and are out of reach for any unattended session.

**Known accepted consequences:** public facet pages show fewer clickable titles for logged-out visitors and crawlers (the chosen trade for bounded growth), and pruned browsed items lose their public URLs.

---

## Phase 7 — Post-launch roadmap (future, not yet scoped)

Big post-launch initiatives added _2026-07-15_. Epic **H**.

**Closed/archived from this phase (see `docs/archive/history.md`):** the 2026-07-17 QA sweep (Q3, Q7–Q12), the nav/back-button deep-dive (N3/N4), every smoke-test pass through 2026-07-27 (SM1–SM17), both logged-in QA rounds (Q14–Q31), the 2026-07-20 cost/memory/lock-spike incident (PR1–PR9), the 2026-07-21 image-optimizer memory incident (PR10–PR12), and H5 — Fandex Score (H5.1–H5.7, fully done incl. calibration). Full design record for H5 stays live (not archived) at **[docs/fandex-score.md](docs/fandex-score.md)** since it's a reference doc, not a changelog — same reason **[docs/ui-overhaul.md](docs/ui-overhaul.md)** stays live for H1.

*(H1 — UI/UX overhaul (mobile-first polish, H1.0–H1.6f) — ✅ DONE 2026-07-20 through 2026-07-27; full history archived. Design system + per-page changelog for H1.6e/f still lives in [docs/ui-overhaul.md](docs/ui-overhaul.md) §10.)*

*(H2 — data-model hardening — done; full history in the archive.)*

### H3 — Monetization strategy 🟢 scoped + model locked (2026-07-18)
**Goal:** Fandex is self-sufficient — revenue covers upkeep (Railway hosting, domain, third-party API costs) and ideally turns a profit. **Hard gate (2026-07-18): H4.0 (legal advice) + H4.2 (Impressum with serviceable address) must be done before any monetization goes live** — the first affiliate link makes the site commercial under §5 DDG. Affiliate/ad tracking also triggers the cookie-banner requirement (H4.4).

**Recon findings (2026-07-18, verified against code + current provider terms):**
- **The economics pivot on TMDB, not on hosting.** Upkeep baseline is small: Railway Hobby is $5/mo + usage (typical small app $5–8/mo; **actual bill unconfirmed — H3.0**), domain ~€10/yr, all APIs currently €0. But TMDB's free API is **non-commercial only**; commercial use costs **$149/mo** (<$1M revenue tier). So "commercial" multiplies upkeep ~10× overnight — any paid/affiliate model must clear ~$155/mo before it nets a cent. **Donations are the gray zone** (does donation-funded = commercial? TMDB doesn't say — H3.1 asks them). Trakt likewise requires case-by-case approval for apps that monetize; RAWG is safe (free for commercial use up to 20k req/mo + 100k MAU, no redistribution).
- **The "existing streaming/store CTAs" premise was half wrong** (checked in code): there are **no JustWatch links** — `project.ts:68` deliberately drops TMDB's per-region JustWatch URL, and streaming providers render as **non-clickable badges** (`LowerSections.tsx:69-81`). The only real store CTA is **Steam** (`normalize.ts:342`, `ItemView.tsx:102`) — and **Steam has no affiliate program**. RAWG store rows (GOG/Epic/etc.) are passed through verbatim (`normalize.ts:382`). There is **no central link-builder**; an affiliate hook means a shared `buildStoreLink()` called from ~5 inline builders.
- **Affiliate reality check:** game keys — GMG ~5%, Humble 10%, Fanatical ~5% first-time/2% returning; movies/shows — Amazon PartnerNet (Blu-ray/DVD 6%, Prime Video Channels bounties; new 180-day rules from 2026-04-14). JustWatch has a partner program (data/widget + branded-link requirement; whether partners share affiliate revenue is **unconfirmed, <60%**). At current traffic, plausible affiliate revenue is tens of €/mo — **it does not clear the $149/mo TMDB license**.
- **Payments (if/when freemium):** at this scale a merchant-of-record (Paddle / Lemon Squeezy, ~5% + 50¢ + surcharges) beats Stripe (~3% but you handle EU VAT yourself). Kleinunternehmerregelung fits comfortably (limits 25k€ prior year / 100k€ current; affiliate income counts toward it).

**MODEL DECISION (locked 2026-07-18, revised same day — launch scope narrowed):** **v1 launch = donations + affiliate links (incl. gray-market key shops) only.** Ads and the one-time ad-free unlock are **deferred, not cancelled** — parked as Path B alongside freemium, both triggered by the same user-threshold decision point (H3.8). Rationale: donations + affiliate need no consent banner (no tracking cookies), keep the compliance surface small for launch, and match actual traffic (ad RPMs are near-zero below a few thousand pageviews/mo anyway — the deferral costs little revenue now). **Consciously accepted risk:** Fandex monetizes on the free TMDB/Trakt tiers ("under the radar") — see H3.1 note below. Failure mode is **API key revocation without notice**, not a fine — local DB retains synced data, but ingestion/enrichment breaks. Do NOT contact TMDB/Trakt about commercial terms while under-the-radar (don't surface the app). ⚠️ Legal consequence of going live with *either* stream: site is commercial under §5 DDG → **H4.0 + H4.2 (Impressum) move to the critical path now**; affiliate click-cookies still need an H4.4 cookie-banner check even without ads.

**Parked for later (Path B, ad/freemium options already researched, revisit at H3.8 threshold):**
- **Ads:** EthicalAds (~$2.50 RPM, cookie-free, but developer-audience only — Fandex likely doesn't qualify) → AdSense (no minimum, $3–10 RPM, needs consent banner) → Monumetric (10k pv/mo, $10–20 RPM) → Freestar/Mediavine (50k+ pv or sessions, $15–40+ RPM, gaming/entertainment-friendly). All non-EthicalAds options trigger the real H4.4 banner build.
- **One-time ad-free unlock:** MoR checkout (Lemon Squeezy/Paddle, ~5%+50¢), `ad_free` entitlement flag, H4.5 Widerruf terms — only meaningful once ads exist to be free of.
- **Freemium subscription:** full Path B, needs TMDB commercial license ($149/mo) + Trakt approval.

**Tasks (v1 launch scope):**

- **H3.0** ⬜ · High · first (you) · ~0k — **Confirm the upkeep baseline:** actual Railway monthly bill + domain + any other recurring costs. One number, goes in this file.
- **H3.3** ⬜ · Med · after H4.2 · ~10k — **Donations rail:** Ko-fi and/or GitHub Sponsors + a modest "Support Fandex" link (/profile footer, next to the H4.1 legal links). No tracking, no cookies → banner-neutral.
- **H3.4** ⬜ · Med · after H4.2 · ~30k — **Affiliate implementation:** shared `buildStoreLink()` helper (normalize.ts ×4 sites, ItemView.tsx:102, RAWG passthrough rewrite), program signups — GMG/Humble/Fanatical/Amazon PartnerNet **+ gray-market (Eneba/Instant Gaming/Kinguin — decided in, note reputational + key-provenance risk)**, affiliate-link labeling per H4.9 ("Werbung"/affiliate disclosure), cookie-banner check per H4.4 (some programs set click-cookies). **Gates: H4.0 + H4.2 live.**
- **H3.8** 🔵 defined 2026-08-02, execute at threshold — **Path B trigger.** Two independent arms with different metrics and different numbers. ⚠️ **Explicitly NOT approved (asked 2026-08-02, your answer: "leave it defined but unapproved").** Treat the numbers below as a worked proposal, not a decision — do not let a future session read them as settled. Nothing depends on this until a threshold is near, which is why leaving it open costs nothing today:
  - **Ads arm → pageviews, 10,000/mo (Monumetric's stated minimum, TASKS.md's own H3 recon).** No revenue-vs-cost arithmetic needed — Monumetric doesn't require covering a fixed license fee the way freemium does. A second, better-RPM tier exists at 50k+ pv/mo (Freestar/Mediavine, $15–40+ RPM vs Monumetric's $10–20) — not a separate hard gate, just worth re-checking which network fits once past 10k.
  - **Freemium arm → weekly active users, corrected to account for TMDB's $149/mo commercial license, which the original "roughly 1k+ actives" estimate didn't net out.** At 2–5% conversion / 1–2€/mo (the original range), actives needed to clear **just** the license cost (≈€137 at current FX, no margin left):

    | conversion | price | actives to clear €137/mo |
    |--|--|--|
    | 2% | 1€ | 6,850 |
    | 2% | 2€ | 3,425 |
    | 5% | 1€ | 2,740 |
    | 5% | 2€ | 1,370 |

    Even the best-case cell (1,370) is above the original "roughly 1k+" napkin figure once the license is actually subtracted rather than ignored. **Trigger set at 3,500 sustained WAU** — clears the license with real margin (€157.5/mo) at a *conservative* 3%/1.50€ combo rather than the table's optimistic corner, leaving room for Trakt's separate case-by-case commercial approval (no published fee found, but not assumed free) and normal churn.
  - **The metric, checked against the live schema:** no page-view/session log exists, and `users.last_seen_at` is a false friend — it's updated **only** on a RAWG login or Steam OAuth callback (`src/app/api/auth/rawg/route.ts:72`, `.../steam/callback/route.ts:65`), never on an ordinary revisit via an existing 30-day session cookie, and never at all for TMDB/Trakt logins. It undercounts badly. The best signal **computable today** is "touched library/wishlist/rating in the last 7 days" — verified working against the real DB:
    ```sql
    SELECT COUNT(DISTINCT user_id) wau FROM (
      SELECT user_id, added_at ts FROM user_library WHERE added_at >= :weekAgo
      UNION ALL SELECT user_id, reviewed_at FROM user_library WHERE reviewed_at >= :weekAgo
      UNION ALL SELECT user_id, added_at FROM user_watchlist WHERE added_at >= :weekAgo
      UNION ALL SELECT user_id, added_at FROM user_item_state WHERE added_at >= :weekAgo
      UNION ALL SELECT user_id, reviewed_at FROM user_item_state WHERE reviewed_at >= :weekAgo
    )
    ```
    Caveat: this only counts users who took a write action (rate/wishlist/mark-watched) — a pure browser (calendar/discover/detail pages, no interaction) isn't captured by anything in the schema today. **Scoped follow-up, not built here:** make `users.last_seen_at` a real signal by touching it in `getSession()`/`withUser()` on every authenticated request, rate-limited to once per calendar day per user to avoid write amplification on a hot path — small, named, not attempted this session.
  - At either threshold: revisit ads (H3.6, parked) + one-time unlock (H3.7, parked) + TMDB commercial license / Trakt approval / freemium build, sunset "under the radar" status.
- **H3.9** ⬜ · High · before either stream ships · ~5k — **Monetization go-live checklist:** H4.0/H4.2 live on every route, affiliate labeling correct, cookie-banner state matches actual cookies set, H4.3/H4.5 docs match reality (declare affiliate data flows), gray-market shops clearly labeled as such.

**Est. total for v1 launch scope: ~40–45k** (H3.3, H3.4, H3.8, H3.9). Ads (H3.6) and one-time unlock (H3.7) numbered but parked — revisit at H3.8 threshold, ~40k combined when picked back up. **JustWatch clickable links are still happening — just as a UX feature, not a monetization play; moved to P18 (see "Open — carried forward" above), no revenue-share negotiation planned.** Suggested order: **H4.0/H4.1/H4.2 first (now critical path)** → H3.0 + H3.8-definition → H3.4 (revenue core) → H3.3 → H3.9 gate check.

### H4 — Legal & compliance 🟢 scoped (2026-07-18)
**Goal:** the app meets all legal requirements to operate publicly — **especially EU / Germany** (operator is DE-based). Effectively a **gate before promoting or monetizing publicly**: §5 DDG mandates an Impressum for anything beyond purely-private use (fines up to €50k, §33 DDG), and GDPR governs the personal data already stored. Scoping decisions locked 2026-07-18 (two rounds): **Claude drafts all docs, Nils reviews** (not-a-lawyer caveat accepted for a hobby project); **bilingual EN + DE** for the legally sensitive docs; **monetization legal is in scope now** (H3 overlap pulled forward). **Round 2:** legal links live in a **footer at the bottom of /profile only** (BGH two-click rule: imprint must be reachable from every page in ≤2 clicks — satisfied once H1 makes /profile reachable from everywhere; a global footer is convention, not law); **no postal address anywhere for now** — Nils will obtain real legal advice; **Impressum itself is deferred to the H3 gate** (defensible position: a free, ad-free, non-commercial hobby service is exempt from §5 DDG; that exemption dies with the first affiliate link/payment).

**Recon findings (2026-07-18, verified against code + current law):**
- **Very favorable starting position:** identity-less users (no email/real name stored — only provider IDs, display names, avatars, encrypted tokens), cookies are essential-only (session + OAuth state + pending intent), zero analytics/tracking scripts, no third-party embeds.
- **Cookie banner: not needed today.** §25 TDDDG's strictly-necessary exemption covers all current cookies — a privacy-policy notice suffices. ⚠️ Any analytics, affiliate tracking, or ad scripts added in H1/H3 **triggers the banner requirement** (equal-prominence Accept/Reject) — hard guard on those epics.
- **Deletion is structurally cheap:** every `user_*` table has `ON DELETE CASCADE` from `users(id)`, and `PRAGMA foreign_keys = ON` is set on the connection (db.ts:23) — cascades will fire.
- **Backup wrinkle:** Litestream replicas retain deleted rows until retention expiry — the privacy policy must state the backup retention window as the true erasure horizon.

**Tasks** (docs H4.2/H4.3/H4.5 can run in parallel once H4.1 exists; H4.0 gates *publishing* the Impressum, not drafting it):

- **H4.0** ⬜ · High · before H3 (you) · ~0k — **Obtain legal advice on Impressum + address:** whether/when Fandex needs an Impressum, and how to satisfy the "ladungsfähige Anschrift" without publishing the home address (c/o at a trusted person is valid if mail reliably arrives; P.O. box is not; paid services ~3–15 €/mo exist as fallback). **Gates H3 go-live, blocks nothing in H4.**
- **H4.2** ⬜ · High · **critical path since the 2026-07-18 H3 model decision** (ads/affiliate = commercial under §5 DDG) · ~10k — **Impressum (DE + EN):** §5 DDG mandatory content — name, serviceable address (per H4.0 legal advice), email + second fast contact channel; §18 Abs. 2 MStV responsible-person line. Anti-scraping when it ships: `noindex` on the page + address rendered as image/JS-inserted (duty is availability to visitors, not crawlers). **Do not build before H4.0 advice is in.** The route + `noindex` + sitemap-exclusion mechanics are already live (H4.1) with a deliberately empty placeholder — only the §5 DDG content itself remains gated.
- **H4.1/H4.3–H4.10** ✅ **all done** — legal page infra, privacy policy, cookie assessment, ToS, account deletion + export (GDPR), support page, monetization legal prep, and the compliance review pass. Full per-task write-ups → [docs/archive/history.md](docs/archive/history.md). **H4.10's two logged findings are both CLOSED as of 2026-08-02:**
  - **Anon reachability of `/legal/*` — fixed.** Your call: put the links at the bottom of the **sign-in dialog**, which is exactly where the anonymous nav path terminates (`AppNav`'s "You" slot is a `<button>` opening `SignInDialog` when `authed === false`, not a link to `/profile`). New `LegalLinks.tsx` holds the one list + the SM33 tap-target handling; `LegalFooter` now renders it too, so the two can't drift. **Verified on a genuinely anonymous production build** (`127.0.0.1` is a separate cookie host from `localhost`, so no session, and your own stayed untouched): nav "You" → dialog → "Imprint" → `/legal/en/imprint`, all four links at 44px effective height, single row, zero overlaps. Found and fixed one real bug while verifying: `AppNav` never unmounts, so the dialog stayed open **full-screen at z-index 110 over the page you'd just navigated to** — it now closes at the point of navigation (an `onNavigate` prop, not a route-watching effect, since setState-in-effect is an eslint ERROR here).
  - **ToS / RAWG password transit — fixed.** Your call: add a sentence, in EN **and** DE. Wording checked against `src/app/api/auth/rawg/route.ts` first: the password is used once for the RAWG login call and never stored (the old bcrypt hash was removed in S5); only the returned token is kept, encrypted. The sentence also names the alternative — connect one of the other three providers if you'd rather Fandex never handled it.

**Est. total ~110k now** (+~10k H4.2 at the H3 gate); **only H4.0/H4.2 remain — every other H4 sub-task is done** (H4.6/H4.7 pulled forward during the Railway outage since they had no H1-IA dependency; H4.1/H4.3–H4.5/H4.8–H4.10 likewise buildable without H4.0/H4.2, since every doc is explicit it's under review pending legal advice — nothing published claims to be final). H4.0 (legal advice) and H4.2 (Impressum) sit at the **H3 gate** — monetization must not go live before both are done.

See [[data-model-gaps-and-plan]], [[trakt-sync-completeness]], [[testing-and-migrations]], [[discovery-insights-rebuild]], [[platform-integration-architecture]], [[public-item-pages-p13]].

---

## Smoke test — 2026-08-02 (ID `SM#`) — 10th sweep, during a real RAWG outage

*(Sweeps 1–9, SM1–SM33: all closed, archived → [history.md](docs/archive/history.md). **Correction: the 9th sweep's 58–60 s cold Discover load was blamed on the catalog pool cache — MISATTRIBUTED, see `G1` below.**)*

Run on the **production build** (`npm run start`, :3100) after `SM34` made the dev server useless for these routes; logged in (cookies ignore port). The sweep's value this time was accidental: **RAWG was genuinely down throughout**, so the degraded-provider paths got exercised for real rather than simulated. Severity: 🟠 fix soon · 🟡 minor · 🔵 nice-to-know.

**✅ SM35/SM36/SM37 all fixed + verified the same day (`10b93b9`)** — against the still-live outage, not a mock: games load-more 0 → 40 items, anon browse 0 → 40 games, Home's trending 0 → 2 games with all three rails rendering under the Games filter, and the Sync button's effective hit area 59×44 with zero neighbour overlap. Fixing SM35 surfaced a **third** RAWG-only site the sweep hadn't reached — `/api/discover`'s cold-start branch, which is the **anonymous/public** path — so a logged-out visitor lost games while a signed-in one didn't. The dual-source pull now lives once in `discoverFeed.ts` (`fetchGamePageAllSources` / `fetchTrendingGames` / `dedupeGames`); `src/lib/discoverFeedSources.test.ts` pins "a games pull survives one source being down" (confirmed non-vacuous: reverting the fix fails 4 of 7). **SM34 deliberately not fixed** — dev-server artifact, production unaffected.

| ID | Sev | Type | Area | Finding (with repro) |
|----|:--:|:--:|------|----------------------|
| SM35 | ✅ | data | Discover · games load-more | **Games "Load more" is RAWG-only, so it's a dead control whenever RAWG is down.** `/api/discover?section=games&page=N` → `items: 0` (repeatable), while `section=movies`/`shows` return 20/19. In the UI: filter to Games, click "Load newer releases" → 11 s, **no new cards, no message, button stays enabled**, so it can be clicked forever. Cause: the section path calls `fetchGamePage` (RAWG) alone, whereas `personalizedFeed` pulls `fetchGamePage` **+ `fetchIgdbGamePage`** — which is why the *initial* browse still showed 18 IGDB games. Every other games surface degraded fine (calendar-popular returned 9 IGDB games; Home's Upcoming 10). Fix shape: mirror the dual-source pull in the section path. |
| SM36 | ✅ | ux | Home · Popular rail | **With the Games type filter on, the whole "Popular right now" rail silently disappears.** Only 2 of 3 rails render (`Recommended for you`, `Upcoming`). Cause: games trending is RAWG-only (`fetchRawgTrendingGames`, a 60-day `-added` window) and IGDB has no trending equivalent, so `/api/home`'s `trending` came back `{movie:6, show:9}` with zero games. Vanishing beats erroring, but a rail disappearing with no explanation is indistinguishable from a bug to a user. |
| SM37 | ✅ | a11y | /library · Sync button | At 375px the **"Sync" button is 60×34px** — under the repo's own 44px convention, and it carries no `.tap-44*` class, so the effective hit area really is 34px tall. Same class as SM33. (The 1×1 "Skip to content" link is the standard visually-hidden skip-link pattern — correct, not a finding.) |
| SM34 | 🔵 | env | dev server only | **Not a product bug — a `next dev` (Turbopack) hydration failure that will waste the next sweep's time if unrecorded.** On a **hard load** of `/library` or `/wishlist`, the `<main>` subtree never hydrates: `Object.keys(main).filter(k=>k.startsWith('__react'))` is `[]` while `body`/`nav` both have fibers, `init()`'s effect never runs, the only request made is AppNav's `/api/auth/me`, and the SSR'd "Loading…" spinner sits there forever with **zero console errors**. Client-side navigation to the same route works (31 cards). **Ruled out:** my `http.ts`/`discoverFeed.ts` changes (reverted them to `7c442b8` — reproduces identically) and stale `.next` (reproduces after `rm -rf .next` + restart). **Production build is completely fine** — 300 cards, both fetches, `main` hydrated. Recorded in `smoketest.md` as a gotcha. |

**Held up well:** anon status codes + page titles for all 10 routes (`/settings` → "Settings · Fandex", `/discover` → "Discover · Fandex" — SM26's fixes hold), `/dashboard` 308 → `/wishlist`, branded 404, `robots.txt` body correct, sitemap 2,538 urls. Gated APIs all 401 (`/api/library`, `/api/watchlist`, `/api/account/export`, `/api/insights`, `/api/dev/dbsize`, and `/api/calendar/popular` **before** validating its `month` param). Insights math reconciles **exactly** on four independent dimensions (byType 1,635 = histogram 1,635 = byTypeHistogram 1,635 = items[] 1,635 = `ratedTotal`). **C8/SM21 tab regression fully passes** (`?tab=wishlist`, pathname stays `/library`, `<h1>` All→Wishlist, `history.length` +1 exactly, title deliberately unchanged, Back → All with query dropped, 95 cards = the real wishlist count). `/library` first paint capped at **exactly 300** cards (SM19's fix). Item detail: **exactly one `/api/detail`** (the second "detail" hit is `/api/detail/similar`, a different endpoint — the 2026-07-30 double-mount fix holds) and one trailer iframe. **Fandex Score composes exactly**: center 67 + Σ13 real contributions 18.6 = 85.6 → 86 displayed, with all 14 capped reasons at `contribution: 0`, carrying `impact`, and separated by a real divider ("NOT COUNTED FOR THIS TITLE — OUTSIDE THE TOP MATCHES THIS ITEM SELECTS"). "More like this" renders with 12 items where the catalog supports it (2 for a sparse unreleased movie → correctly hidden). Mobile 375px: no horizontal overflow, bottom nav 53px with the desktop bar `display:none`. Zero console errors anywhere; zero unexplained server errors.

**The new circuit breaker (G1) verified against a real outage, not a mock:** `/api/health` reported `openProviderCircuits: {"api.rawg.io": {...}}` throughout, the log showed `provider_circuit_opened` after 3 failures then correct exponential re-open backoff (30 s → 60 s → 120 s), and the compact one-line skip log held (no stack spam) across hundreds of skips. **Not covered, explicitly:** anon *client-side* behaviour (the SM8 Back-button test, the sign-in dialog, the anon "You" nav slot) — going anon needs the session cleared and `/api/auth/logout` is forbidden mid-sweep, so anon was cookie-less `curl` only (status codes, redirects, titles, API error shapes). Also not re-run: section F's tag-taxonomy round trip and any live rating write.

---

## Provider latency isolation — 2026-08-02 (ID `G#`)

- **G1** ✅ **done 2026-08-02** — **A dead provider stalled every browse request for a minute, and we had no way to see it.** RAWG was fully down (Cloudflare **522** after ~19.8 s) and `http.ts` retried each 5xx twice → ~60 s/call; `fetchPages` fires 5 RAWG pages under one `Promise.all` and `/api/home` reaches RAWG twice → a cold `/api/home` measured **2.2 minutes**. We had per-source *failure* isolation but no per-source *latency* isolation. Fixed with a per-host **circuit breaker** + a total-time **budget** (8 s on browse, deliberately unbounded on sync/pull) in `src/lib/http.ts`, plus `bestEffort()` in `discoverFeed.ts`. **Cold `/api/home` 2.2 min → 8.4 s**; `/api/health` now reports `openProviderCircuits`. **The breaker THROWS rather than returning a synthetic 503** — a fake 503 would read as `!res.ok` to the pull adapters and turn an outage into an empty library under the prune invariant; a test guards that. Also closed a latent bug the 522s hid: a provider *timeout* would have 500'd `/api/discover` outright. Full write-up + the corrected §A sizing → [docs/performance-audit.md](docs/performance-audit.md).
- **G2** ✅ **closed 2026-08-02 (your call: leave as-is).** The breaker made a dead RAWG cost ~8 s once rather than 60 s per request, and SM35/SM36 gave games a real second source on every surface — so the outage no longer costs enough to justify demoting a genuine catalog source that is also your own account's login provider. Original question and evidence kept below. — **Is RAWG's outage ours or theirs, and does RAWG stay a required source?** Almost certainly theirs: the 522 hit `https://rawg.io/` itself and an unauthenticated `api.rawg.io/api/games` equally, so it's not our key or our quota. Worth re-checking once it's back that the key still works. The bigger question: IGDB already carried the games category alone throughout the outage (Home rendered games fine), so is RAWG worth keeping as a source we wait on at all — and note RAWG is also the **login provider** for your own account, which is a separate dependency from its catalog role.
- **G3** ✅ **done 2026-08-02.** The browse budget now reaches the adapter-mediated fetchers, via a browse-vs-sync distinction rather than a blanket change: `traktGetPublic` and `igdbQuery` take an **opt-in** budget passed only by their browse callers (the four Trakt anticipated/trending functions + `discoverIgdbUpcoming`), so enrichment — which shares those same two helpers and would rather wait than lose an item's metadata — keeps the unbounded default. Hydration is bounded at its **call site** instead (`Promise.race`, 6 s in `liveDiscover.hydrateFacets`), because `fetchById` is shared with enrichment and hydration already has a defined fallback: the list-payload genres its `catch` has always used. A test pins that a budget passed by one caller can't leak into the next call through the same helper.

---

## Tag admin + score rework — 2026-07-29 (ID `T#`) — full changelog archived

New tag-admin table, an inline category picker on every tag chip app-wide, and the Fandex Score rebuilt as an unbounded raw sum (fixing the narrow 40–80 range and cross-page score disagreement). Full changelog, incl. the same-day Spirited Away two-score follow-up → [docs/archive/history.md](docs/archive/history.md). **2 of 4 open questions closed 2026-07-30, 2 still open (time-gated, not attempted):**
- ⬜ **`priorStrength` (C=5) and the per-role class weights may want re-tuning** now that the aggregate is a raw sum instead of a damped mean — revisit once a few weeks of real scores under the new formula are visible (it's been 4 days as of 2026-08-02 — still too soon).
- ✅ **CLOSED 2026-08-02 (your call: keep as-is).** Whether `capped` (a facet that scored but didn't make the top-N cut) is the right long-term treatment. Verified during the 10th sweep that the greying **and** the divider ("NOT COUNTED FOR THIS TITLE — OUTSIDE THE TOP MATCHES THIS ITEM SELECTS") both render, and that `center + Σ(non-capped contributions)` reproduces the headline exactly (67 + 18.6 = 85.6 → 86). It reads as "safely explained" rather than "confusingly excluded", and it's the only thing answering "why isn't this tag counted".

---

## Scoring follow-ups + type-import tech debt — 2026-07-30 (ID `F#`) — ✅ ALL DONE, archived

Closed two of the tag-admin batch's open questions (item-page tag-chip grouping, /api/detail scoring the persisted links) plus made `consistent-type-imports` an eslint ERROR repo-wide (catches a real standalone-script crash tsc/vitest/Next all elide). Full changelog (F1–F4, incl. the eslint --fix JSX-comment-mangling trap and the Discover scroll-restoration non-bug) → [docs/archive/history.md](docs/archive/history.md).

---

## Remaining work (current)

- **Android TWA:** P15 🔵 blocked on you building/signing the TWA; P16 ⬜ needs a live OAuth-in-TWA verification pass once P15 unblocks.
- **PR17** ⏸️ blocked until Railway resumes — see the catalog-pool-blowup section above (re-confirmed down 2026-08-02).
- **H3 monetization** 🟢 scoped; H3.8's trigger defined 2026-08-02 but **explicitly NOT approved** (your call — don't read the numbers as settled); H3.0/H3.3/H3.4/H3.9 not started. **H4** — all done except **H4.0** (legal advice, needs Nils) + **H4.2** (gated on H4.0). **P18** 🔵 JustWatch clickable links deferred to after PR17 (attribution done 2026-07-31).
- **Provider latency isolation** — `G1`/`G2`/`G3` and the 10th sweep's `SM35`/`SM36`/`SM37` all ✅ closed 2026-08-02. Nothing open in this theme. The only time-gated item left anywhere is `priorStrength`/role-weight re-tuning (needs a few weeks of scores; 4 days as of 2026-08-02).
- Everything else (Phases 0–6, H1, H2, H5, the S# small-tasks batch, all audit findings, all QA/smoke-test/production-incident history, and the **mockup-gap closeout** — A1/B5/B6/B7/C8, decided AND built 2026-07-28) is done — see [docs/archive/history.md](docs/archive/history.md), or [STATUS.md](STATUS.md) for the live one-page digest.
