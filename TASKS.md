# Fandex — Task Tracker

> **This file holds only what is still open.** Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it for the "why" behind a past decision; never read it end to end). One-page state → [STATUS.md](STATUS.md).

- **Legend:** ⬜ not started · 🔵 in progress / needs input · ⏸️ blocked · ✅ done
- **Convention:** an entry is 2–4 sentences + a commit hash once done. The full story (root cause, files touched, verification) belongs in the commit message, not here. **When a section is fully done, move it to the archive the same session** — this file blew past its 200-line CI guard twice (441 lines, then 374) from skipping that step.

---

## ⚠️ Needs Nils — nothing else is blocked on anything but these

1. **Railway dashboard** — prod has been down since 2026-07-22 and the billing reset didn't fix it. Check for a manual resume / current usage. Unblocks PR17 → P18, and gets ~2 weeks of committed work actually live. (See STATUS.md.)
2. **H4.0 — legal advice on the Impressum**: whether/when Fandex needs one, and how to satisfy the "ladungsfähige Anschrift" without publishing your home address (a c/o at a trusted person is valid if mail reliably arrives; a P.O. box is not; paid services ~3–15 €/mo are the fallback). **Gates H4.2, which gates all of H3.**
3. **Build + sign the Android TWA** (P15) — Bubblewrap/PWABuilder → package name + signing-cert SHA-256 → set `TWA_PACKAGE_NAME`/`TWA_CERT_FINGERPRINT` on Railway.
4. **H3.0 — confirm the upkeep baseline**: the actual Railway monthly bill + domain + any other recurring cost. One number; it goes in the H3 section below.
5. **H3.8's thresholds are defined but NOT approved** (your call, 2026-08-02: "leave it defined but unapproved"). A future session must not read them as settled.

---

## Open — carried forward from Phase 6

- **P15** 🔵 · Med · ~25k — **Digital Asset Links** (`/.well-known/assetlinks.json`) + stable HTTPS origin for the Play Store TWA. Serving infra done (`src/app/.well-known/assetlinks.json/route.ts`, env-driven). Blocked on you (see above).
- **P16** ⬜ · Low · ~60k — Verify **OAuth + cookie flow inside the TWA**: re-register prod redirect URIs per provider; test webview behaviour + deep-link return / `sameSite`. Needs P15 first.
- **P18** 🔵 · Med · after PR17 · ~10k — **JustWatch clickable streaming links (UX, not monetization).** Attribution shipped 2026-07-31 (TMDB's watch-provider terms mandate the credit; nothing carried it before). **Still open:** making the provider rows real links via the JustWatch Content Partner API — that reverses the deliberate per-region link-drop at `src/lib/sources/project.ts:68` and needs a `PROJECTION_VERSION` bump + full-catalog re-projection, **the same class of heavy op that blew the Railway compute budget once already**. Deferred until PR17 confirms prod is healthy. Not pursuing a JustWatch revenue-share deal (your call, 2026-07-18).

---

## PR17 — post-outage verification ⏸️

Context: public facet/discover pages were persisting an unbounded pool of thin `browsed`-only rows (crawler traffic × 60/page), ballooning `rr.db` to 2.5 GB and causing the Railway usage-limit outage. **PR13–PR16 are done** (gate the writes to logged-in users, prune + VACUUM the tail) — full incident writeup in the archive. Only verification remains.

**Cannot run while deployments are paused** — the site 404s at Railway's edge, so no endpoint is reachable. Checklist pre-written 2026-07-27 so this is a one-shot run; every step has the literal command and expected value inline:

1. **DB size** — open `https://fandex.org/api/dev/scoring` in a browser logged in as the admin user first (this and dbsize share the `SCORING_ADMIN_USER_IDS` gate — non-admins and a cookie-less `curl` both get a 404), then hit `https://fandex.org/api/dev/dbsize`. Expect top-level `fileMb` ≈ **36.5** and `tables.find(t => t.name === "media_items").rows` ≈ **2,012**.
2. **Memory ramp is actually dead** — `curl https://fandex.org/api/health` (public). Read **`cgroupMb.fileMb`** **after several hours of uptime**, not right after a redeploy (a fresh process hasn't had time to re-ramp, so an early read looks healthy regardless). Expect a plateau in the low tens/hundreds of MB, not a climb toward 2,000 — **the plateau, not any single reading, is the proof.**
3. **Sitemap + render** — `curl -s https://fandex.org/sitemap.xml | grep -c "<url>"` → ≈ **2,013**. Then load `https://fandex.org/` and confirm no console/server errors.
4. **Litestream survived the VACUUM** — via the Railway shell: `litestream snapshots -config /etc/litestream.yml /app/data/rr.db`. **UNVERIFIED since the 2026-07-22 outage — don't skip.** Expect a generation newer than `18d8221abccc198d` (the pre-VACUUM one) and a bucket in the low tens of MB, consistent with a 36.5 MB DB. (It read 10.6 MB right after the VACUUM, down from a 13.9 GB peak — never confirmed as a stable new generation.)
5. **Tidy stale WAL sidecars** — `ls -la /app/data/`; if `rr.db.tmp-shm` / `rr.db.tmp-wal` are still dated **Jul 17** (untouched by the VACUUM), delete them. Otherwise just note which.
6. **Close out** — append the actual readings vs. the expected values to `docs/archive/history.md`, update the `prod-incidents` memory file with the confirmed-stable outcome, and flip this section + STATUS.md to closed.

**Readiness probes:** 2026-07-28, 07-30, 07-31 and 08-02 all got the identical `404 {"status":"error","code":404,"message":"Application not found"}`. Steps 4–5 need the Railway console regardless and are out of reach for any unattended session.

**Accepted consequences of the fix:** public facet pages show fewer clickable titles to logged-out visitors and crawlers (the chosen trade for bounded growth), and pruned browsed items lose their public URLs.

---

## H3 — Monetization 🟢 scoped, model locked 2026-07-18

**Goal:** revenue covers upkeep (Railway, domain, third-party APIs). **Hard gate: H4.0 + H4.2 must ship before any monetization goes live** — the first affiliate link makes the site commercial under §5 DDG.

**The economics pivot on TMDB, not on hosting.** Upkeep is small (Railway Hobby $5/mo + usage, domain ~€10/yr, all APIs currently €0) — but TMDB's free API is **non-commercial only** and commercial use is **$149/mo**. So "commercial" multiplies upkeep ~10× overnight; any paid model must clear ~$155/mo before netting a cent. Trakt requires case-by-case approval for monetizing apps. RAWG is safe (free commercially to 20k req/mo + 100k MAU, no redistribution). **Donations are the gray zone** — TMDB doesn't say whether donation-funded counts as commercial.

**Affiliate reality check:** game keys — GMG ~5%, Humble 10%, Fanatical ~5% first-time/2% returning; movies/shows — Amazon PartnerNet (Blu-ray/DVD 6%, Prime Video Channels bounties; new 180-day rules from 2026-04-14). At current traffic that's plausibly **tens of €/mo — it does not clear the $149/mo TMDB license.**

**Implementation reality (verified in code):** there are **no JustWatch links** (`project.ts:68` drops them deliberately) and streaming providers render as **non-clickable badges** (`LowerSections.tsx:69-81`). The only real store CTA is **Steam** (`normalize.ts:342`, `ItemView.tsx:102`) — and **Steam has no affiliate program**. RAWG store rows pass through verbatim (`normalize.ts:382`). There is no central link-builder; an affiliate hook means a shared `buildStoreLink()` called from ~5 inline sites.

**MODEL DECISION (locked 2026-07-18): v1 = donations + affiliate links (incl. gray-market key shops) only.** Ads and the one-time ad-free unlock are **deferred, not cancelled** — parked as Path B alongside freemium, all triggered by H3.8. Rationale: neither needs a consent banner, the compliance surface stays small, and ad RPMs are near-zero below a few thousand pageviews/mo anyway. **Consciously accepted risk:** Fandex monetizes on the free TMDB/Trakt tiers ("under the radar"). Failure mode is **API-key revocation without notice**, not a fine — the local DB keeps synced data but ingestion/enrichment breaks. **Do NOT contact TMDB/Trakt about commercial terms while under the radar.**

**Tasks:**
- **H3.0** ⬜ · High · **you** · ~0k — confirm the upkeep baseline (see "Needs Nils" above).
- **H3.3** ⬜ · Med · after H4.2 · ~10k — **Donations rail:** Ko-fi and/or GitHub Sponsors + a "Support Fandex" link next to the legal links. No cookies → banner-neutral.
- **H3.4** ⬜ · Med · after H4.2 · ~30k — **Affiliate implementation:** shared `buildStoreLink()` (normalize.ts ×4, `ItemView.tsx:102`, RAWG passthrough rewrite), program signups (GMG/Humble/Fanatical/Amazon PartnerNet **+ gray-market Eneba/Instant Gaming/Kinguin — decided in, with noted reputational + key-provenance risk**), affiliate labeling per [docs/monetization-legal.md](docs/monetization-legal.md), and a cookie-banner re-check (some programs set click-cookies). **Gates: H4.0 + H4.2 live.**
- **H3.8** 🔵 **defined 2026-08-02, explicitly NOT approved** — **Path B trigger**, two arms with different metrics:
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
    It counts only users who took a write action — a pure browser isn't captured by anything in the schema. **Scoped, not built:** make `last_seen_at` real by touching it in `getSession()`/`withUser()` once per calendar day per user (rate-limited to avoid write amplification on a hot path).
- **H3.9** ⬜ · High · before either stream ships · ~5k — **Go-live checklist:** H4.0/H4.2 live on every route, affiliate labeling correct, cookie-banner state matches the cookies actually set, H4.3/H4.5 declare affiliate data flows, gray-market shops clearly labeled.

**Est. ~40–45k for v1.** Order: **H4.0 → H4.2** → H3.0 → H3.4 → H3.3 → H3.9.

---

## H4 — Legal & compliance 🟢 all done except two

**Goal:** meet EU/German requirements (operator is DE-based). §5 DDG mandates an Impressum for anything beyond purely private use (fines to €50k, §33 DDG); GDPR governs the data already stored. Locked 2026-07-18: **Claude drafts, Nils reviews** (not-a-lawyer caveat accepted); **bilingual EN + DE**; **no postal address anywhere until H4.0**.

**Why the starting position is favourable:** identity-less users (no email or real name — only provider IDs, display names, avatars, encrypted tokens), essential-only cookies, zero analytics/tracking, no third-party embeds. **A cookie banner is not needed today** — §25 TDDDG's strictly-necessary exemption covers all three cookies; a privacy-policy notice suffices. ⚠️ **Any analytics, affiliate tracking or ad script triggers the banner requirement** (equal-prominence Accept/Reject) — a hard guard on H3.

- **H4.0** ⬜ · High · **you** · ~0k — obtain the legal advice (see "Needs Nils"). Gates *publishing* the Impressum, not drafting it.
- **H4.2** ⏸️ · High · **critical path** · ~10k — **Impressum (DE + EN):** §5 DDG content (name, serviceable address per H4.0, email + a second fast contact channel) and the §18 Abs. 2 MStV responsible-person line. When it ships: `noindex` + address rendered as image/JS-inserted (the duty is availability to visitors, not crawlers). **Do not build before H4.0's advice is in.** Route, `noindex` and sitemap exclusion are already live with an empty placeholder — only the §5 content is gated.
- **H4.1 / H4.3–H4.10** ✅ all done — legal page infra, privacy policy, cookie assessment, ToS, account deletion + export, support page, monetization legal prep, compliance review. Write-ups in the archive; live reference docs: [docs/compliance-review.md](docs/compliance-review.md), [docs/cookie-assessment.md](docs/cookie-assessment.md), [docs/monetization-legal.md](docs/monetization-legal.md).

**⚠️ The reachability trap this epic taught (2026-08-02):** H4.1 put the legal links at the bottom of `/profile`, reasoning that `AppNav` makes `/profile` reachable from anywhere. True logged-in, **false for anonymous visitors** — `AppNav`'s "You" slot is a `<button>` opening `SignInDialog` when `authed === false`, and `/profile` bounces anon to `/` before the footer renders. So no anonymous visitor could reach any `/legal/*` page at all. Fixed by putting the links **in the sign-in dialog**, where the anon nav path actually terminates (`LegalLinks.tsx` is the one shared list, so the two can't drift). Full detail → [[anon-legal-reachability]].

---

## Still open elsewhere

- **Perf §A / §B** — [docs/performance-audit.md](docs/performance-audit.md). §A: the catalog pool cache re-parses the full pool on any membership write (~0.4 s — correctly re-sized after the 2026-08-02 misattribution, see below). §B: why prod's `rr.db` is 2.5 GB while local is ~49 MB. Both deliberately deferred to a supervised pass.
- **Fandex Score `priorStrength` (C=5) + per-role class weights may want re-tuning** now that the aggregate is a raw sum rather than a damped mean. **Time-gated:** revisit after a few weeks of real scores under the new formula (4 days as of 2026-08-02 — too soon; a re-tune now would fit noise).
- **Platform integrations** — Hardcover / Open Library / AniList are chosen but not started. See [PLATFORMS.md](PLATFORMS.md).

---

## Recently closed (2026-08-02) — pointers only

- **G1/G2/G3 — provider latency isolation.** A dead RAWG stalled every browse request for ~2.2 minutes; fixed with a per-host circuit breaker + browse budget in `http.ts`. **The breaker THROWS rather than returning a synthetic 503** — a fake 503 would read as `!res.ok` to the pull adapters and turn an outage into an empty library under the prune invariant. G2 closed (RAWG stays). G3 closed (browse budget reaches the Trakt/IGDB adapters via opt-in, so enrichment keeps its unbounded budget). → [[provider-latency-isolation]]
- **10th smoke sweep (SM34–SM37),** run during the real RAWG outage — which was the useful part. SM35/36/37 all fixed + verified against the live outage. Found a **third** RAWG-only path the sweep hadn't reached (`/api/discover`'s cold-start branch — the *anonymous* one). SM34 deliberately not fixed: a `next dev` Turbopack hydration artifact, production unaffected — recorded in [smoketest.md](smoketest.md) with a 30-second discriminator.
- **⚠️ Correction:** the 9th sweep blamed a 58–60 s cold Discover load on the catalog pool cache. **Misattributed** — the pool rebuild is ~430 ms (`scripts/probe-pool.mjs`); it was the RAWG outage all along. **Measure before optimising.**
- **Eight open questions closed** across the docs (anon legal reachability, ToS/RAWG password transit, G2, G3, `capped`, `data/` 1,061 → 319 MB, Backloggd, H3.8 definition).
