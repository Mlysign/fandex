# Fandex — Status

_Your index of every game, movie & show._ · High-level roadmap. **Full detail + completion history live in [TASKS.md](TASKS.md).**

**👉 2026-07-28 (latest): 6th smoke sweep — 15 findings (SM18–SM32), 4 of them 🟠.** First sweep run fully logged in from the start, and the first to exercise the five surfaces shipped earlier the same day (A1/B5/B6/B7/C8) — every one of them produced at least one finding. The 🟠s: **/profile's "Coming up" lists 1954–1972 releases** (`/api/calendar` returns all wishlist items oldest-first with no future filter; `/calendar` filters client-side, `/profile` doesn't); **`/library` renders all 2,014 cards at once** (44.5k DOM nodes — a search keystroke blocks the main thread 237ms, clearing the box 1,426ms); **Discover's result count contradicts the grid** ("TITLES · 1" over 17 cards); and **the new Library/Wishlist tabs change no URL, title, heading or count, and Back exits the page**. Zero console errors and zero server errors throughout; Fandex Score and Insights math both reconcile exactly; **H4.6/H4.7 finally eyeballed logged-in** (export = 200, 1.38 MB, no credential leaks). Anon side covered by cookie-less curl only — no anon browser pass, so the SM8 Back regression test is still unverified this round. Full table + repro in [TASKS.md](TASKS.md).

**👉 2026-07-28: the mockup-gap closeout shipped — all 5 items built, logged-in verified.** `docs/mockup-gap-audit.md`'s last 5 open items (A1/B5/B6/B7/C8) were decided earlier the same day, then built the same session per [.claude/plans/2026-07-28-mockup-gap-closeout.md](.claude/plans/2026-07-28-mockup-gap-closeout.md): Calendar agenda rows got the Rate+Bookmark bar; the desktop nav gained a live People/Tags/Titles search field; the item-detail personal block became the mockup's Fandex Score panel + Rate it/Save pair (and gained an anon-gated score state that didn't exist before); Insights' five sections were restyled to the panel/eyebrow anatomy; Library and Wishlist merged into one shared tabbed view (All/Wishlist/Unrated/Rated) behind two routes. Two real bugs found and fixed along the way: a `usePersistedState` inline-`normalize` footgun that silently reverted sort changes, and — separately — **`GET /api/dev/login`** (`c1c57a8`) is what made verifying any of this possible at all: it mints a local session from `DEV_LOGIN_USER_ID` for the logged-in-only surfaces (`/library`, `/wishlist`, `/insights`, `/profile`, `/settings`, the item-detail personal block) that previously needed a real OAuth round-trip to check. Also corrected a **bookkeeping lag**: S2/S4/S9/S10 were listed as open but had shipped in `34f87fe` a day earlier — the whole S1–S11 batch is done.

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
| UI/UX overhaul — mobile-first polish (H1) | ✅ **DONE 2026-07-27**, incl. the follow-up mockup-vs-live rebuild (4 rounds) and the small-tasks batch, **plus the gap-closeout (A1/B5/B6/B7/C8) shipped 2026-07-28** — see [docs/mockup-gap-audit.md](docs/mockup-gap-audit.md), every item now "✅ Fixed". Direction 2a "Ticket · Calm", full IA restructure (public Home at `/`, `/dashboard`→308→`/wishlist`, new `/calendar` + `/profile`, adaptive nav, Library⇄Wishlist tab now a 4-way status filter — All/Wishlist/Unrated/Rated). Design system + per-phase changelog: [docs/ui-overhaul.md](docs/ui-overhaul.md) §10/§12; handoff bundle at [docs/design/fandex-handoff/](docs/design/fandex-handoff/). Logged-in-verified throughout (5th smoke sweep 2026-07-27; gap-closeout verified live 2026-07-28 via `/api/dev/login`). **Not deployed** — Railway paused until ~1 Aug, so this whole overhaul is local-only so far. |
| Data-model hardening (H2) | ✅ **done** |
| Monetization strategy (H3) | 🟢 **scoped, v1 launch = donations + affiliate only** (2026-07-18): ads + one-time unlock + freemium **deferred to Path B** (H3.8 user threshold); on free TMDB/Trakt tiers meanwhile (risk accepted) · ⚠️ makes H4.0/H4.2 (Impressum) critical path even at this reduced scope |
| Legal & compliance — privacy, cookies, account deletion, support (H4) | 🟢 **scoped** (2026-07-18, ~110k now) · **H4.6 (account deletion) + H4.7 (data export) ✅ done 2026-07-23** — live in Settings' new "Your data" section, not yet eyeballed logged-in · legal links via /profile footer · **Impressum + address deferred to H3 gate** pending your legal advice (H4.0) |
| Fandex Score — visible per-item taste match (H5) | ✅ **DONE 2026-07-27 — H5.1 through H5.7 all complete**, incl. H5.5 (calibration: `K` 10→25, bands re-anchored to `center ± 8`), verified against the real 1,855-item library. Score badge + breakdown are LIVE; `/dev/scoring` weights/taxonomy admin panel (gated to your userId locally — **add `SCORING_ADMIN_USER_IDS` on Railway too if you want it in prod**). Unified sort model (Release date · Popularity · Rating · Fandex Score) across Discover/Library/Wishlist + facet pages. Design in [docs/fandex-score.md](docs/fandex-score.md). A future pass could still tune `C`/role weights now that the spread is legible. |

---
_✅ done · 🔵 in progress / needs input · 🟢 later · 🔭 future / not yet scoped · 🔒 security · 🔧 config_
