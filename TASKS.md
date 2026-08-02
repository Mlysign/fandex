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
- **H3.8** 🔵 defined 2026-08-02, execute at threshold — **Path B trigger.** Two independent arms with different metrics and different numbers — **decided, pending your approval before either is treated as final:**
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
- **H4.1/H4.3–H4.10** ✅ **all done** — legal page infra, privacy policy, cookie assessment, ToS, account deletion + export (GDPR), support page, monetization legal prep, and the compliance review pass. Full per-task write-ups → [docs/archive/history.md](docs/archive/history.md). **Two things from H4.10 (2026-08-02) still need a decision:** anonymous visitors currently cannot reach `/legal/*` through the app's UI at all (`AppNav`'s "You" slot opens a sign-in dialog instead of linking to `/profile` for anon — low-stakes today since Impressum is still a placeholder, but becomes live-consequential once H4.2 ships); and the ToS doesn't distinguish RAWG's password-transit connect flow from the other three providers' pure OAuth (a disclosure gap, not an inaccuracy).

**Est. total ~110k now** (+~10k H4.2 at the H3 gate); **only H4.0/H4.2 remain — every other H4 sub-task is done** (H4.6/H4.7 pulled forward during the Railway outage since they had no H1-IA dependency; H4.1/H4.3–H4.5/H4.8–H4.10 likewise buildable without H4.0/H4.2, since every doc is explicit it's under review pending legal advice — nothing published claims to be final). H4.0 (legal advice) and H4.2 (Impressum) sit at the **H3 gate** — monetization must not go live before both are done.

See [[data-model-gaps-and-plan]], [[trakt-sync-completeness]], [[testing-and-migrations]], [[discovery-insights-rebuild]], [[platform-integration-architecture]], [[public-item-pages-p13]].

---

## Smoke test — 2026-07-28 (ID `SM#`) — ✅ ALL 15 CLOSED same day, archived

6th sweep (continues SM1–SM17), first one run entirely logged in from the start. Found 15 issues across the five surfaces shipped 2026-07-28 (A1/B5/B6/B7/C8) — 14 fixed same day (incl. reversing C8's "tab switch is not navigation" call), 1 won't-fix (SM25, calendar month view at 375px). Full findings table + closeout write-up: [docs/archive/history.md](docs/archive/history.md).

---

## Smoke test — 2026-08-02 (ID `SM#`) — 9th sweep, full A–F re-run, zero findings — archived

Full A–F checklist re-run (not scoped to one batch, unlike the 7th/8th), logged in via `/api/dev/login`. Zero functional findings. Full write-up → [docs/archive/history.md](docs/archive/history.md). **Its one recorded measurement — a 58–60 s cold Discover load, attributed to the pool cache — was MISATTRIBUTED; see `G1` below.**

---

## Provider latency isolation — 2026-08-02 (ID `G#`)

- **G1** ✅ **done 2026-08-02** — **A dead provider stalled every browse request for a minute, and we had no way to see it.** Chasing the 58 s above found RAWG fully down (`https://rawg.io/` itself → Cloudflare **522** after ~19.8 s), and `http.ts` retrying each 5xx twice turned that into ~60 s per call; `fetchPages` fires 5 RAWG pages under one `Promise.all` and `/api/home` reaches RAWG twice, so a cold `/api/home` measured **2.2 minutes**. We had per-source *failure* isolation (every adapter try/catches) but no per-source *latency* isolation. Fixed with a per-host **circuit breaker** + a total-time **budget** (`budgetMs`, 8 s on browse paths, deliberately unbounded on sync/pull) in `src/lib/http.ts`, plus `bestEffort()` in `discoverFeed.ts`. **`/api/home` cold 2.2 min → 8.4 s, warm 0.39 s**; `/api/health` now reports `openProviderCircuits`. **The breaker THROWS rather than returning a synthetic 503** — the convenient design would have been read as `!res.ok` by the pull adapters and turned an outage into an empty library under the prune invariant; a test guards exactly that. Also fixed a latent pre-existing bug: a provider *timeout* (as opposed to an error status) would have 500'd `/api/discover` outright, which the 522s had been hiding. Full write-up → [docs/performance-audit.md](docs/performance-audit.md).
- **G2** ⬜ · Low · **needs you** — **Is RAWG's outage ours or theirs, and does RAWG stay a required source?** Almost certainly theirs: the 522 hit `https://rawg.io/` itself and an unauthenticated `api.rawg.io/api/games` equally, so it's not our key or our quota. Worth re-checking once it's back that the key still works. The bigger question: IGDB already carried the games category alone throughout the outage (Home rendered games fine), so is RAWG worth keeping as a source we wait on at all — and note RAWG is also the **login provider** for your own account, which is a separate dependency from its catalog role.
- **G3** ⬜ · Low · later · ~5k — **Hydration and the adapter-mediated fetchers have no browse budget.** `liveDiscover.ts`'s `hydrateFacets` (up to 24 TMDB detail calls) and the Trakt/IGDB list fetchers go through `sources/*.ts`, which are shared with sync — so they get the breaker's protection but not `BROWSE_BUDGET_MS`. Fine while TMDB/Trakt are healthy; the same 20 s × 3 ladder is still reachable if one of those goes down instead. Wants a browse-vs-sync distinction at the adapter layer, not a blanket budget change.

---

## Tag admin + score rework — 2026-07-29 (ID `T#`) — full changelog archived

New tag-admin table, an inline category picker on every tag chip app-wide, and the Fandex Score rebuilt as an unbounded raw sum (fixing the narrow 40–80 range and cross-page score disagreement). Full changelog, incl. the same-day Spirited Away two-score follow-up → [docs/archive/history.md](docs/archive/history.md). **2 of 4 open questions closed 2026-07-30, 2 still open (time-gated, not attempted):**
- ⬜ **`priorStrength` (C=5) and the per-role class weights may want re-tuning** now that the aggregate is a raw sum instead of a damped mean — revisit once a few weeks of real scores under the new formula are visible (it's been 4 days as of 2026-08-02 — still too soon).
- ⬜ **Whether `capped` (a facet that scored but didn't make the top-N cut) is the right long-term treatment** — surfaced today as a greyed-out "would-be impact"; worth checking later whether that reads as "safely explained" or "confusingly excluded" as libraries accumulate more facets.

---

## Scoring follow-ups + type-import tech debt — 2026-07-30 (ID `F#`) — ✅ ALL DONE, archived

Closed two of the tag-admin batch's open questions (item-page tag-chip grouping, /api/detail scoring the persisted links) plus made `consistent-type-imports` an eslint ERROR repo-wide (catches a real standalone-script crash tsc/vitest/Next all elide). Full changelog (F1–F4, incl. the eslint --fix JSX-comment-mangling trap and the Discover scroll-restoration non-bug) → [docs/archive/history.md](docs/archive/history.md).

---

## Remaining work (current)

- **Android TWA:** P15 🔵 blocked on you building/signing the TWA; P16 ⬜ needs a live OAuth-in-TWA verification pass once P15 unblocks.
- **PR17** ⏸️ blocked until the Railway billing cycle resets (~2026-08-01) — see the catalog-pool-blowup section above. (Re-confirmed 2026-07-30: `https://fandex.org/api/health` still returns Railway's edge 404, `"Application not found"` — same body as 2026-07-28, unchanged.)
- **H3 monetization** 🟢 scoped; H3.8's Path B trigger defined 2026-08-02, pending your approval; H3.0/H3.3/H3.4/H3.9 not started. **H4 legal/compliance** — every sub-task done except **H4.0** (legal advice, needs Nils) + **H4.2** (Impressum, gated on H4.0).
- **P18** 🔵 JustWatch clickable streaming links — TMDB attribution done 2026-07-31, clickable links deferred to after PR17 — see "Open — carried forward" above.
- **Provider latency isolation** — `G1` ✅ done 2026-08-02 (circuit breaker + browse budget; `/api/home` cold 2.2 min → 8.4 s). `G2` (is RAWG's outage theirs?) needs you; `G3` (no browse budget on the adapter-mediated fetchers) still open.
- Everything else (Phases 0–6, H1, H2, H5, the S# small-tasks batch, all audit findings, all QA/smoke-test/production-incident history, and the **mockup-gap closeout** — A1/B5/B6/B7/C8, decided AND built 2026-07-28) is done — see [docs/archive/history.md](docs/archive/history.md), or [STATUS.md](STATUS.md) for the live one-page digest.
