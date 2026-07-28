# Fandex — Status

_Your index of every game, movie & show._ · High-level roadmap. **Full detail + completion history live in [TASKS.md](TASKS.md).**

**👉 2026-07-28 (latest): logged-in verification is solved, and the mockup-gap backlog is decided + planned.** Two things landed. (1) **`GET /api/dev/login`** (`c1c57a8`) mints a local session from `DEV_LOGIN_USER_ID` — `/library`, `/wishlist`, `/insights`, `/profile`, `/settings` and the item-detail personal block all bounce anonymous visitors, so until now none of them could be checked without a real OAuth round-trip in your own browser. That's why H4.6/H4.7 and the H5 batch both shipped "not yet verified logged-in". Three fail-closed gates (not production · loopback host · real identity row), 7 tests, and it 404s on Railway unconditionally. (2) **The 5 open `docs/mockup-gap-audit.md` items (A1/B5/B6/B7/C8) all had their questions decided** — plan at [.claude/plans/2026-07-28-mockup-gap-closeout.md](.claude/plans/2026-07-28-mockup-gap-closeout.md), not yet executed. Also corrected a **bookkeeping lag**: S2/S4/S9/S10 were listed as open but had shipped in `34f87fe` a day earlier — the whole S1–S11 batch is done.

**👉 2026-07-27: mockup-vs-live rebuild, 4 rounds + a smoketest fix, all committed and pushed (`9d8a7ba`).** H1.6 had applied the design's tokens but kept the app's pre-H1 *structure* almost everywhere (one restyle-not-relitigate rule, over-applied ~30 times) — this pass found and fixed the anatomy gaps. **Round 1:** TypeFilter circles + SortMenu dropdown (Discover/Library/Wishlist/Calendar/facet pages), `Sheet`'s focus-steal bug, Profile's "Recently added". **Round 2** (after Nils flagged "looks nothing like the mockups"): `docs/mockup-gap-audit.md` created; `PosterCard` rebuilt (poster flush to top, score into the meta row, 2-button action bar); Home rebuilt (real logo, guest panel, media-type filter driving all rails); Discover's list/calendar views dropped, sort bar added above the grid; then by decision — Profile merged (mockup shape + appended carousels), Library/Wishlist view toggles dropped, the Library⇄Wishlist tab reordered/restyled defaulting to Wishlist. **Round 3:** Calendar's month-nav row was a genuine responsive bug (5 controls crammed into one wrapping flex row) — split into a clean primary row + a secondary jump-controls row. **Round 4** (autonomous, safe items only): Library/Wishlist title rows, Insights heading, the app icon/favicon/OG-image/manifest set (all still had the old indigo→violet brand), desktop nav's avatar button. **A targeted post-rebuild smoketest then found one real regression (SM17 — the mobile Filters button stranding on wrap when a page has an extra chip), fixed same session.** 8 items remain open (genuine judgment calls), logged in `docs/mockup-gap-audit.md`. 329 tests + typecheck + lint (0 errors) clean throughout, verified live at every step.

**🔴 Still open: fandex.org has been DOWN since 2026-07-22** — Railway paused all deployments at $10.28/$10.00 compute usage; the fix (PR16's prune) already shipped and would resolve the underlying cost driver, but deploys stay paused until the billing cycle resets (~2026-08-01). **No data was at risk.** So H1's UI overhaul, the mockup-vs-live rebuild, and the catalog-pool fixes (PR13–PR16) are all committed but **not yet live in prod** — PR17 is the pre-written one-shot verification checklist for the moment service resumes (see TASKS.md).

**👉 2026-07-23: H4.6 + H4.7 shipped (account deletion + data export)** — the two GDPR items with no dependency on prod or on the H1 IA, so they were buildable during the outage. Settings gained a "Your data" section: a JSON download of everything held about you (tokens excluded, enforced by explicit column lists + a test), and a type-to-confirm account deletion that erases every user-scoped table explicitly rather than trusting `ON DELETE CASCADE`. **Needs your session to eyeball** — but don't run the real deletion on your own account unless you mean it. Details in TASKS.md (H4).

Everything before this point — the full smoke-test/QA/production-incident history (2026-07-17 through 2026-07-27), the Fandex Score epic (H5, fully done incl. calibration), and H1's per-sub-task changelog — has been moved to **[docs/archive/history.md](docs/archive/history.md)**; grep it for the "why" behind a past decision rather than scrolling this file.

---

## 🟢 Live
Fandex is live at **https://fandex.org** and ready to share — hosted on Railway (Cloudflare DNS, HTTPS, email routing), all launch-blockers cleared, security hardened, library complete. Phases 1–6 essentially done.

## ▶ What's left
| | Item | |
|--|------|--|
| 🔵 | **Android TWA** (P15/P16) | Needs you to build the TWA (Bubblewrap/PWABuilder) → package name + cert → set 2 env vars. Serving infra ready. |
| 🔵 | **Mockup-gap closeout** (A1/B5/B6/B7/C8) | All 5 decided 2026-07-28, none built yet. Plan ready to execute: [.claude/plans/2026-07-28-mockup-gap-closeout.md](.claude/plans/2026-07-28-mockup-gap-closeout.md). |
| ⏸️ | **PR17** — post-outage verification | Blocked until Railway resumes (~2026-08-01). Checklist is pre-written; re-confirmed still down 2026-07-28. |
| 🟢 | **H3 monetization · H4 legal** | Scoped, not started. H4.6/H4.7 already done. |

## 🗺️ Roadmap
| Area | Status |
|------|:--|
| Hosting + deploy (Railway) | ✅ |
| Domain + OAuth + email (fandex.org) | ✅ |
| Backups (Litestream → Railway bucket) | ✅ |
| Observability (`/api/health`, structured logs) | ✅ |
| Security (S1–S13, CSP enforced) | ✅ |
| Sync completeness + TMDB enrichment | ✅ |
| Android TWA | 🔵 needs TWA build |
| SEO SSR detail pages (P13) | ✅ **fully live** — indexing turned on 2026-07-19 (P13b) |
| Public facet pages (P17) | ✅ **done**, live on fandex.org |
| **Post-launch (future):** | |
| UI/UX overhaul — mobile-first polish (H1) | ✅ **DONE 2026-07-27**, incl. the follow-up mockup-vs-live rebuild (4 rounds) and the small-tasks batch. Direction 2a "Ticket · Calm", full IA restructure (public Home at `/`, `/dashboard`→308→`/wishlist`, new `/calendar` + `/profile`, adaptive nav, Library⇄Wishlist tab). Design system + per-phase changelog: [docs/ui-overhaul.md](docs/ui-overhaul.md) §10; handoff bundle at [docs/design/fandex-handoff/](docs/design/fandex-handoff/); of the 8 anatomy judgment calls logged in [docs/mockup-gap-audit.md](docs/mockup-gap-audit.md), **3 were fixed in round 4 (A.2/A.3/A.4) and the last 5 were all decided 2026-07-28** (A1/B5/B6/B7/C8 — decided, not yet built). Logged-in-verified (5th smoke sweep, 2026-07-27). **Not deployed** — Railway paused until ~1 Aug, so this whole overhaul is local-only so far. |
| Data-model hardening (H2) | ✅ **done** |
| Monetization strategy (H3) | 🟢 **scoped, v1 launch = donations + affiliate only** (2026-07-18): ads + one-time unlock + freemium **deferred to Path B** (H3.8 user threshold); on free TMDB/Trakt tiers meanwhile (risk accepted) · ⚠️ makes H4.0/H4.2 (Impressum) critical path even at this reduced scope |
| Legal & compliance — privacy, cookies, account deletion, support (H4) | 🟢 **scoped** (2026-07-18, ~110k now) · **H4.6 (account deletion) + H4.7 (data export) ✅ done 2026-07-23** — live in Settings' new "Your data" section, not yet eyeballed logged-in · legal links via /profile footer · **Impressum + address deferred to H3 gate** pending your legal advice (H4.0) |
| Fandex Score — visible per-item taste match (H5) | ✅ **DONE 2026-07-27 — H5.1 through H5.7 all complete**, incl. H5.5 (calibration: `K` 10→25, bands re-anchored to `center ± 8`), verified against the real 1,855-item library. Score badge + breakdown are LIVE; `/dev/scoring` weights/taxonomy admin panel (gated to your userId locally — **add `SCORING_ADMIN_USER_IDS` on Railway too if you want it in prod**). Unified sort model (Release date · Popularity · Rating · Fandex Score) across Discover/Library/Wishlist + facet pages. Design in [docs/fandex-score.md](docs/fandex-score.md). A future pass could still tune `C`/role weights now that the spread is legible. |

---
_✅ done · 🔵 in progress / needs input · 🟢 later · 🔭 future / not yet scoped · 🔒 security · 🔧 config_
