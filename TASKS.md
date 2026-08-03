# Fandex — Task Tracker

> **This file holds only what is still open.** Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it for the "why" behind a past decision; never read it end to end). One-page state → [STATUS.md](STATUS.md).

- **Legend:** ⬜ not started · 🔵 in progress / needs input · ⏸️ blocked · ✅ done
- **Convention:** an entry is 2–4 sentences + a commit hash once done. The full story (root cause, files touched, verification) belongs in the commit message, not here. **When a section is fully done, move it to the archive the same session** — this file blew past its 200-line CI guard twice (441 lines, then 374) from skipping that step.

---

## ⚠️ Needs Nils — nothing else is blocked on anything but these

1. **Railway dashboard** — prod has been down since 2026-07-22 and the billing reset didn't fix it. Check for a manual resume / current usage. Unblocks PR17 → P18, and gets ~2 weeks of committed work actually live. (See STATUS.md.)
2. **Review the Impressum** — content complete 2026-08-03, no placeholders left (H4.0's advice was "a standard imprint, nothing special"). Read `/legal/de/imprint`; the German version is the operative one. Once you're happy, H4.2 closes and **all of H3 unblocks**.
3. **Set `NEXT_PUBLIC_SUPPORT_URL=https://ko-fi.com/nilsmlynarek` on Railway** — it's in the local `.env` already, and the link is live in all three surfaces locally. `NEXT_PUBLIC_*` is build-time inlined, so it needs a **redeploy**, not just an env change. Still open: the monthly-running-cost placeholder on the support page (that's H3.0's number). On Ko-fi itself: **no tiers, no perks, no memberships** — a donation with consideration is a taxable supply and a much stronger "commercial use" reading against TMDB's non-commercial-only free tier.
4. **Build + sign the Android TWA** (P15) — Bubblewrap/PWABuilder → package name + signing-cert SHA-256 → set `TWA_PACKAGE_NAME`/`TWA_CERT_FINGERPRINT` on Railway.
5. **H3.0 — confirm the upkeep baseline**: the actual Railway monthly bill + domain + any other recurring cost. One number; it goes in the H3 section below.
6. **H3.8's thresholds are defined but NOT approved** (your call, 2026-08-02: "leave it defined but unapproved"). A future session must not read them as settled.
7. **Sign up for the affiliate programs** — **PARKED 2026-08-03 until Railway is back** (your call). Every program reviews the site URL on the application, so applying while fandex.org 404s buys a rejection, and reapplying is worse than a first application. Sequence once prod is up: **GOG first** (the only merchant the catalog already product-links), then Humble → Fanatical → GMG, **Amazon LAST** — applying starts a 180-day/3-qualifying-sale clock that closes the account if missed, and Amazon is the only movie/show coverage. Full walkthrough → [docs/monetization-go-live.md](docs/monetization-go-live.md).

---

## Open — carried forward from Phase 6

- **P15** 🔵 · Med · ~25k — **Digital Asset Links** (`/.well-known/assetlinks.json`) + stable HTTPS origin for the Play Store TWA. Serving infra done (`src/app/.well-known/assetlinks.json/route.ts`, env-driven). Blocked on you (see above).
- **P16** ⬜ · Low · ~60k — Verify **OAuth + cookie flow inside the TWA**: re-register prod redirect URIs per provider; test webview behaviour + deep-link return / `sameSite`. Needs P15 first.
- **P18** 🔵 · Med · after PR17 · ~10k — **JustWatch clickable streaming links (UX, not monetization).** Attribution shipped 2026-07-31 (TMDB's watch-provider terms mandate the credit; nothing carried it before). **Still open:** making the provider rows real links via the JustWatch Content Partner API — that reverses the deliberate per-region link-drop at `src/lib/sources/project.ts:68` and needs a `PROJECTION_VERSION` bump + full-catalog re-projection, **the same class of heavy op that blew the Railway compute budget once already**. Deferred until PR17 confirms prod is healthy. Not pursuing a JustWatch revenue-share deal (your call, 2026-07-18).

---

## PR17 — post-outage verification ⏸️

Context: public facet/discover pages were persisting an unbounded pool of thin `browsed`-only rows (crawler traffic × 60/page), ballooning `rr.db` to 2.5 GB and causing the Railway usage-limit outage. **PR13–PR16 are done** (gate the writes to logged-in users, prune + VACUUM the tail) — full incident writeup in the archive. Only verification remains.

**Cannot run while deployments are paused** — the site 404s at Railway's edge, so no endpoint is reachable. Checklist pre-written 2026-07-27 so this is a one-shot run; every step has the literal command and expected value inline:

1. **DB size — also the answer to the old perf §B.** Open `https://fandex.org/api/dev/scoring` in a browser logged in as the admin user first (this and dbsize share the `SCORING_ADMIN_USER_IDS` gate — non-admins and a cookie-less `curl` both get a 404), then hit `https://fandex.org/api/dev/dbsize`. Expect top-level `fileMb` ≈ **36.5** and `tables.find(t => t.name === "media_items").rows` ≈ **2,012**. **If `fileMb` is anywhere near the old ~2.5 GB, that's the unexplained inflation resurfacing** — the performance audit's §B, which was archived precisely because it can't be measured while prod is down. The prune+VACUUM should have settled it; this reading is what confirms or reopens it.
2. **Memory ramp is actually dead** — `curl https://fandex.org/api/health` (public). Read **`cgroupMb.fileMb`** **after several hours of uptime**, not right after a redeploy (a fresh process hasn't had time to re-ramp, so an early read looks healthy regardless). Expect a plateau in the low tens/hundreds of MB, not a climb toward 2,000 — **the plateau, not any single reading, is the proof.**
3. **Sitemap + render** — `curl -s https://fandex.org/sitemap.xml | grep -c "<url>"` → ≈ **2,013**. Then load `https://fandex.org/` and confirm no console/server errors.
4. **Litestream survived the VACUUM** — via the Railway shell: `litestream snapshots -config /etc/litestream.yml /app/data/rr.db`. **UNVERIFIED since the 2026-07-22 outage — don't skip.** Expect a generation newer than `18d8221abccc198d` (the pre-VACUUM one) and a bucket in the low tens of MB, consistent with a 36.5 MB DB. (It read 10.6 MB right after the VACUUM, down from a 13.9 GB peak — never confirmed as a stable new generation.)
5. **Tidy stale WAL sidecars** — `ls -la /app/data/`; if `rr.db.tmp-shm` / `rr.db.tmp-wal` are still dated **Jul 17** (untouched by the VACUUM), delete them. Otherwise just note which.
6. **Close out** — append the actual readings vs. the expected values to `docs/archive/history.md`, update the `prod-incidents` memory file with the confirmed-stable outcome, and flip this section + STATUS.md to closed.

**Readiness probes:** 2026-07-28, 07-30, 07-31 and 08-02 all got the identical `404 {"status":"error","code":404,"message":"Application not found"}`. Steps 4–5 need the Railway console regardless and are out of reach for any unattended session.

**Accepted consequences of the fix:** public facet pages show fewer clickable titles to logged-out visitors and crawlers (the chosen trade for bounded growth), and pruned browsed items lose their public URLs.

---

## H3 — Monetization 🔵 v1 built 2026-08-03; donations live, affiliate dark

**Goal:** revenue covers upkeep (Railway, domain, third-party APIs).

**The economics pivot on TMDB, not on hosting.** Upkeep is small (Railway Hobby $5/mo + usage, domain ~€10/yr, all APIs currently €0) — but TMDB's free API is **non-commercial only** and commercial use is **$149/mo**. So "commercial" multiplies upkeep ~10× overnight; any paid model must clear ~$155/mo before netting a cent. Trakt requires case-by-case approval for monetizing apps. RAWG is safe (free commercially to 20k req/mo + 100k MAU, no redistribution). **Donations are the gray zone** — TMDB doesn't say whether donation-funded counts as commercial.

**MODEL DECISION (locked 2026-07-18): v1 = donations + affiliate links (incl. gray-market key shops) only.** Ads and the one-time ad-free unlock are **deferred, not cancelled** — parked as Path B alongside freemium, all triggered by H3.8. **Consciously accepted risk:** Fandex monetizes on the free TMDB/Trakt tiers ("under the radar"). Failure mode is **API-key revocation without notice**, not a fine. **Do NOT contact TMDB/Trakt about commercial terms while under the radar.**

**Built 2026-08-03 — H3.3 ✅ (donations, live) · H3.4 ✅ (affiliate, DARK behind `MONETIZATION_ENABLED`) · H3.9 ✅ (go-live checklist).** Full write-ups → [archive](docs/archive/history.md), grep `H3 monetization v1`. Operating instructions → [docs/monetization-go-live.md](docs/monetization-go-live.md). **The one thing to know before touching any of it:** the catalog's store rows are Steam/PSN/GOG/Xbox/Nintendo/Epic/itch.io and only **GOG** is affiliate-capable, so `affiliate.ts` has *two* mechanisms — a rewriter for GOG-shaped links and `buildBuyLinks()` synthesizing per-title search links for the merchants we have programs with. → [[monetization-h3]]

**Still open:**
- **H3.0** ⬜ · High · **you** · ~0k — confirm the upkeep baseline (see "Needs Nils" above). Feeds the support page, which deliberately carries no cost figure.
- **Affiliate program signups** ⏸️ — parked on Railway (see "Needs Nils" #7); every program reviews the applicant site.
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

**What's left before affiliate revenue exists:** Railway back → sign up (GOG first, **Amazon last** — its 180-day/3-sale clock closes the account if missed) → set the env vars → flip `MONETIZATION_ENABLED` → run the post-go-live cookie check. All of it is in the go-live doc.

---

## H4 — Legal & compliance ✅ CLOSED 2026-08-03

**Nothing open.** H4.0 (advice: a standard imprint suffices) and H4.2 (Impressum written, filled, live in DE + EN) closed the epic. Full write-ups → [archive](docs/archive/history.md), grep `H3 monetization v1`. Live reference docs: [docs/compliance-review.md](docs/compliance-review.md) · [docs/cookie-assessment.md](docs/cookie-assessment.md) · [docs/monetization-legal.md](docs/monetization-legal.md).

**Three standing guards this epic leaves behind — read before touching the legal surface, monetization, or anything claimed "reachable":**

1. **A cookie banner is not needed today** — §25 TDDDG's strictly-necessary exemption covers all three cookies. ⚠️ **Any analytics, affiliate *tracking script*, or ad script triggers the banner requirement** (equal-prominence Accept/Reject). H3.4's links are plain outbound `<a href>`s specifically to stay inside the exemption; a Fandex-hosted `/out?url=` redirect or click pixel would break it. → [docs/cookie-assessment.md](docs/cookie-assessment.md)
2. **"The nav reaches it" is a different claim per auth state.** H4.1 put the legal links on `/profile` alone, reasoning `AppNav` reaches `/profile` from anywhere — true logged-in, false for anon ("You" is a `<button>` opening `SignInDialog`, and `/profile` bounces anon to `/`). No anonymous visitor could reach any `/legal/*` page. Now in the sign-in dialog *and* on every legal page. → [[anon-legal-reachability]]
3. **The Impressum stays `noindex, nofollow, noarchive, nosnippet` + out of `sitemap.ts`** now that it carries a real home address. Those directives, not `ProtectedText`'s client-side assembly, are what crawlers actually honour.

---

## Still open elsewhere

- **Fandex Score `priorStrength` (C=5) + per-role class weights may want re-tuning** now that the aggregate is a raw sum rather than a damped mean. **Time-gated:** revisit after a few weeks of real scores under the new formula (4 days as of 2026-08-02 — too soon; a re-tune now would fit noise).
- **Platform integrations** — Hardcover / Open Library / AniList are chosen but not started. See [PLATFORMS.md](PLATFORMS.md).

---

## Recently closed (2026-08-03) — pointers only

Everything below is fully written up in [docs/archive/history.md](docs/archive/history.md) — grep `H3 monetization v1`. Earlier sessions (G#/SM34–37, the eight closed questions) are archived too.

- **H3 v1 built** — donations live, affiliate layer dark behind `MONETIZATION_ENABLED`, go-live checklist written. → [[monetization-h3]]
- **H4 epic closed** — H4.0's advice in, Impressum written + filled in both locales.
- **⚠️ A `//` comment rendered as visible page text** after a `return` was wrapped in a fragment. tsc, 540 tests, lint and build all passed; a human spotted it. `react/jsx-no-comment-textnodes` is now an eslint ERROR. → [[jsx-comment-in-children-renders]]
- **Logged, not fixed (yours):** `--color-accent` in light theme measures **4.47:1** on `--color-surface` — just under AA for body text, while the token's comment claims 4.5:1+. App-wide, not specific to the new links. `#856619` clears it.
