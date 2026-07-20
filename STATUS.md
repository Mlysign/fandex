# Fandex — Status

_Your index of every game, movie & show._ · High-level roadmap. **Full detail + completion history live in [TASKS.md](TASKS.md).**

**👉 2026-07-20: Railway incident fixed (PR1–PR8).** The post-P13b crawler wave exposed a lock-error wall (`database is locked`), a memory ramp toward 8 GB, and a $19.54/mo cost estimate. Root causes fixed same day: `BEGIN IMMEDIATE` transactions (Litestream contention), heap cap, bounded caches on the OMDB/item/facet public read paths, image-optimizer hardening, `?sort=` crawl disallow. Full detail in TASKS.md ("Production incident — 2026-07-20"). **Watch the Railway dashboard over the next days**: errors → ~0, memory ≤ ~2 GB, cost drifting back toward $5–8.

**Previously: round-2 QA batch (Q23–Q31) shipped 2026-07-19.** All 9 follow-up items implemented: facet-page popularity/Fandex-badge/`/studio/focus` fixes, Discover tag search + IGDB + Fandex-sort scroll fixes, tag "Fandex impact" pill replacing the Bayesian stat, capped-facet graying, main-vs-support cast weighting, Insights category overrides. 255 tests + typecheck + lint (0 errors) clean; anon surfaces browser-verified. **Logged-in verification still outstanding** — please eyeball the Fandex Score breakdown, facet-page badges, the tag-page impact pill, and Discover's Fandex-sort scroll with your own session (see TASKS.md for the full list). Everything else is either waiting on you (Android TWA, H3.0, legal advice) or not yet scoped (H1).

---

## 🟢 Live
Fandex is live at **https://fandex.org** and ready to share — hosted on Railway (Cloudflare DNS, HTTPS, email routing), all launch-blockers cleared, security hardened, library complete. Phases 1–6 essentially done.

## ▶ What's left
| | Item | |
|--|------|--|
| 🔵 | **Android TWA** (P15/P16) | Needs you to build the TWA (Bubblewrap/PWABuilder) → package name + cert → set 2 env vars. Serving infra ready. |

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
| UI/UX overhaul — mobile-first polish (H1) | 🔭 planned |
| Data-model hardening (H2) | ✅ **done** |
| Monetization strategy (H3) | 🟢 **scoped, v1 launch = donations + affiliate only** (2026-07-18): ads + one-time unlock + freemium **deferred to Path B** (H3.8 user threshold); on free TMDB/Trakt tiers meanwhile (risk accepted) · ⚠️ makes H4.0/H4.2 (Impressum) critical path even at this reduced scope |
| Legal & compliance — privacy, cookies, account deletion, support (H4) | 🟢 **scoped** (2026-07-18, ~110k now) · legal links via /profile footer · **Impressum + address deferred to H3 gate** pending your legal advice (H4.0) |
| Fandex Score — visible per-item taste match (H5) | 🔵 **H5.1–H5.4 + H5.6 + H5.7 done** (2026-07-19) — score badge + breakdown are LIVE; `/dev/scoring` weights/taxonomy admin panel (gated to your userId locally — **add `SCORING_ADMIN_USER_IDS` on Railway too if you want it in prod**). **H5.6**: calibration knobs self-explain + Preview pins up to 3 items; **tag bundling** (merge synonym/misspelled spellings into one canonical tag; migration 10). **H5.7**: **unified sort model** — Discover/Library/Wishlist + facet pages now all share Release date · Popularity · Rating (Bayesian) · **Fandex Score**. Nothing here manually checked logged-in yet (needs your own login). Please sanity-check cards/detail, `/dev/scoring`, and the new sort options. Design in [docs/fandex-score.md](docs/fandex-score.md), only H5.5 (calibrate) remains |

---
_✅ done · 🔵 in progress / needs input · 🟢 later · 🔭 future / not yet scoped · 🔒 security · 🔧 config_
